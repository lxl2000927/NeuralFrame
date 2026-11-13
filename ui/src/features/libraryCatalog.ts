import type { ComponentCompatibility, ComponentSource, Library, Updates, ModelRequirements } from "../types";
import { projectEvidence } from "../../../src/shared/component-evidence.js";

export type LibraryVersion = {
  id: string;
  pack?: Library["runtimePacks"][number];
  packages: Library["packages"];
  releases: Updates["candidates"];
  compatibility?: ComponentCompatibility;
  modelRequirements?: ModelRequirements;
};
export type ComponentGroup = { component: string; versions: LibraryVersion[] };

// The main process supplies fingerprint-backed package links. Never merge on
// version labels: SmarterGamers and RankFTW both publish different SF-v2 bytes.
export function groupLibrary(data: Library, candidates: Updates["candidates"], modelsOnly = false): ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>();
  const group = (component: string) => {
    if (!groups.has(component)) groups.set(component, { component, versions: [] });
    return groups.get(component)!;
  };
  const byPackage = new Map<string, LibraryVersion>();
  const byRuntime = new Map<string, LibraryVersion>();
  const packages = new Map(data.packages.map(p => [p.id, p]));
  for (const pack of data.runtimePacks) {
    const locals = (pack.packageIds || []).flatMap(id => {
      const local = packages.get(id);
      return local?.component === pack.component ? [local] : [];
    });
    const row = { id: "runtime:" + pack.id, pack, packages: locals, releases: [], compatibility: pack.compatibility, modelRequirements: pack.modelRequirements };
    group(pack.component).versions.push(row);
    byRuntime.set(pack.id, row);
    for (const local of locals) byPackage.set(local.id, row);
  }
  const byAsset = new Map<string, LibraryVersion>();
  for (const release of candidates) {
    const local = release.cachedPackageId ? packages.get(release.cachedPackageId) : undefined;
    const matchingLocal = local?.component === release.component ? local : undefined;
    const assetKey = release.sha256 ? release.component + ":" + release.sha256 : release.id;
    const paired = release.pairedPackId ? byRuntime.get(release.pairedPackId) : undefined;
    let row = (matchingLocal && byPackage.get(matchingLocal.id)) ||
      (paired?.pack?.component === release.component ? paired : undefined) || byAsset.get(assetKey);
    if (!row) {
      row = { id: "release:" + release.id,
        packages: matchingLocal ? [matchingLocal] : [], releases: [],
        compatibility: matchingLocal?.compatibility || release.compatibility,
        modelRequirements: matchingLocal?.modelRequirements || release.modelRequirements };
      group(release.component).versions.push(row);
    }
    row.releases.push(release);
    if (matchingLocal && !row.packages.some(p => p.id === matchingLocal.id)) row.packages.push(matchingLocal);
    byAsset.set(assetKey, row);
    if (matchingLocal) byPackage.set(matchingLocal.id, row);
  }
  for (const local of data.packages) {
    if (!byPackage.has(local.id)) group(local.component).versions.push({
      id: "local:" + local.id, packages: [local], releases: [], compatibility: local.compatibility, modelRequirements: local.modelRequirements,
    });
  }
  return [...groups.values()].filter(g => !modelsOnly || g.component === "dlss-nr");
}

export function modelEligibility(row: LibraryVersion, gpuSm: string | null) {
  const component = row.pack?.component || row.packages[0]?.component || row.releases[0]?.component;
  if (component !== "dlss-nr") return "not-model";
  if (!gpuSm || !row.modelRequirements?.architectures.length) return "unknown";
  const matches = row.modelRequirements.architectures.includes(gpuSm);
  if (row.modelRequirements.source === "catalog") return matches ? "catalog-match" : "catalog-incompatible";
  return matches ? "match" : "incompatible";
}

export function localState(row: LibraryVersion): "cached" | "missing" | "damaged" {
  // Runtime payloads and imported library files are separate copies. A healthy
  // payload must not hide a missing library file or another broken variant.
  if (row.packages.some(p => !p.present)) return "damaged";
  if (row.pack?.downloaded || row.packages.some(p => p.present)) return "cached";
  return "missing";
}

export function applicationState(row: LibraryVersion, gpuSm: string | null) {
  const kind = row.compatibility?.kind || (row.compatibility?.ready ? "selectable" : "pending");
  if (kind === "internal") return "internal";
  if (localState(row) === "damaged") return "repair";
  const assessment = row.compatibility?.assessment;
  if (kind === "pending") return assessment === "unsupported" || (!assessment && row.packages.length > 0) ? "unsupported" : "verify";
  if (kind === "route") return assessment === "route-version" || (!assessment && !row.pack && !engineInfo(row)?.compatible) ? "route-version" : "route";
  // A matching GPU never grants support to an unadapted plugin or engine.
  const model = modelEligibility(row, gpuSm);
  if (model === "incompatible" || model === "catalog-incompatible") return "incompatible";
  if (model === "unknown") return gpuSm ? "model-check" : "hardware";
  if (model === "catalog-match") return "verify";
  return "selectable";
}

export const applicationLabels: Record<string,string> = {
  selectable:"程序已支持 · 游戏页预览", route:"随安装路线应用",
  verify:"文件身份待确认", unsupported:"NeuralFrame 尚未接入",
  "route-version":"未提供单独替换", incompatible:"显卡架构不匹配",
  hardware:"未识别显卡架构", "model-check":"模型架构待确认",
  repair:"文件异常 · 需修复", internal:"软件内置 · 无需单独安装",
};

function engineInfo(row:LibraryVersion) {
  return row.pack?.engine || row.packages.find(p=>p.engine)?.engine || row.releases.find(r=>r.engine)?.engine;
}

// Presentation policy only: ready/kind remain the main process's installation
// gates. Never turn a download, matching label, or matching GPU into permission.
export function applicationVerdict(row:LibraryVersion,gpuSm:string|null) {
  const state = applicationState(row,gpuSm), local = localState(row), model = modelEligibility(row,gpuSm);
  const engine = engineInfo(row);
  let label = applicationLabels[state], availability = local === 'cached' ? "可进入游戏页预览；仍需检查游戏支持。" : "尚未下载；下载校验后可进入游戏页预览。";
  let reason = row.compatibility?.reason || "此组件允许选择，应用前还会校验文件与游戏支持。";
  let next = local === 'cached' ? "在游戏页选择此版本，检查预览后再应用。" : "下载入库，再到游戏页选择并预览。";
  let shortReason = "需核对具体游戏支持", nextShort = local === 'cached' ? "下一步：游戏页预览" : "下一步：下载入库 → 游戏页";
  let downloadLabel = "下载入库";
  if (state === 'route') {
    label = engine?.compatible ? engine.recommended ? "推荐版本 · 游戏页可选" : "程序已支持 · 游戏页可选" : label;
    availability = local === 'cached' ? "可由游戏页安装路线统一应用，不能单独替换文件。" : "下载配套组件后，由游戏页安装路线统一应用。";
    reason = engine?.compatible ? "程序已登记此引擎的部署方式与参数能力；具体游戏、文件和依赖仍需在应用前检查。" : "这是路线配套组件，需要连同宿主、运行库或加载器一起部署。";
    next = engine?.compatible ? "下载或校验后，到游戏页的引擎版本中选择并预览。" : "到游戏页选择安装路线并预览，管理器会准备所需配套组件。";
    shortReason = engine?.compatible ? "通过引擎版本选项应用" : "宿主与依赖需成组部署";
    nextShort = local === 'cached' ? "下一步：游戏页预览" : "下一步：准备配套 → 游戏页";
  } else if (state === 'verify') {
    availability = "尚不能确认这个文件是否可用，需要先校验身份。";
    reason = model === 'catalog-match' ? "目录标注的架构匹配本机，但尚未由实际文件指纹确认模型身份。" : row.compatibility?.reason || "目前只有发布包信息，不能只凭版本名称确认文件身份与适配情况。";
    next = "下载并校验文件身份，再核对程序是否支持部署此版本。";
    shortReason = model === 'catalog-match' ? "目录架构匹配，文件待确认" : "发布包尚未确认 DLL 身份";
    nextShort = "下一步：下载并校验身份"; downloadLabel = "下载并校验";
  } else if (state === 'unsupported') {
    availability = "当前不能通过 NeuralFrame 应用此版本，可下载入库。";
    reason = "程序尚未登记此文件的部署与参数支持；这不代表原项目未验证或组件不兼容。";
    next = "需要现在应用时，选择程序已支持的版本；下载入库不会自动增加部署支持。";
    shortReason = "尚未提供此版本的部署支持"; nextShort = "下一步：选择程序已支持的版本";
  } else if (state === 'route-version') {
    availability = "当前未提供此版本的单独替换入口；可以使用该路线的配套组合。";
    reason = "该组件需要成组部署，程序尚未开放这个版本的单独替换入口。";
    next = "查看配套版本，或到游戏页选择安装路线；下载此版本只会入库，不会更新路线。";
    shortReason = "当前路线未开放单独选版"; nextShort = "下一步：查看配套版本";
  } else if (state === 'incompatible') {
    label = model === 'catalog-incompatible' ? "目录标注：显卡架构不匹配" : label;
    availability = model === 'catalog-incompatible' ? "按目录记录不适合本机；下载不会改变显卡架构。" : "不能在本机应用这个模型。";
    reason = "该模型记录的 CUDA 架构不包含当前显卡，属于硬件条件限制。";
    next = "选择包含本机 CUDA 架构的模型；无需反复下载这个版本。";
    shortReason = "所需 CUDA 与本机不匹配"; nextShort = "下一步：选择匹配架构的模型"; downloadLabel = "下载留存";
  } else if (state === 'hardware') {
    availability = "尚不能判断本机是否支持此模型。";
    reason = "没有识别到本机显卡的 CUDA 架构，缺少模型兼容性判断依据。";
    next = "到设置查看硬件识别结果，确认显卡和驱动后重新打开组件页。";
    shortReason = "缺少本机 CUDA 架构信息"; nextShort = "下一步：设置中核对硬件";
  } else if (state === 'model-check') {
    availability = "模型架构尚未确认，需通过游戏页检查后才能应用。";
    reason = "目录没有记录此模型的 CUDA 架构，不能据此判定兼容或不兼容。";
    next = local === 'cached' ? "到游戏页选择模型并预览，由实际 DLL 检查显卡架构；检查失败时保留原配置。" : "下载或导入模型，再到游戏页预览实际文件的架构检查结果。";
    shortReason = "缺少模型 CUDA 架构记录"; nextShort = "下一步：游戏页核验模型";
  } else if (state === 'repair') {
    availability = "当前缓存不能直接应用，需要先修复文件。";
    reason = "本地组件文件缺失或大小异常；缓存异常与版本是否适配是两项不同条件。";
    next = row.pack || row.releases.length ? "校验或重新下载缓存；修复后重新核对版本与硬件条件。" : "重新导入同一版本的原始文件，再核对版本与硬件条件。";
    shortReason = "本地文件缺失或大小异常"; nextShort = row.pack || row.releases.length ? "下一步：校验或重新下载" : "下一步：重新导入原文件";
  } else if (state === 'internal') {
    availability = "无需在组件页单独安装或替换。";
    reason = row.compatibility?.reason || "此组件随 NeuralFrame 维护，由对应功能按需使用。";
    next = "通过对应功能使用；需要新版本时更新 NeuralFrame。";
    shortReason = "随软件维护，由功能按需使用"; nextShort = "下一步：使用对应功能";
  }
  const evidence = model === 'not-model' ? "软件支持状态来自 NeuralFrame 的部署规则；游戏内是否生效需查看运行诊断。"
    : row.modelRequirements?.source === 'fingerprint' ? "模型架构依据文件指纹对应记录。"
      : row.modelRequirements?.source === 'catalog' ? "模型架构依据发布目录，实际文件仍需校验。" : "目录暂无模型架构记录。";
  const acquisition = versionAcquisition(row);
  if (acquisition.candidate && acquisition.disabled && ['verify','selectable','model-check','repair'].includes(state)) {
    next = acquisition.notice;
    nextShort = "下一步：检查更新或使用配套版本";
  }
  return {state,label,availability,reason,next,shortReason,nextShort,downloadLabel,evidence};
}

export function versionSourceDetails(row: LibraryVersion): ComponentSource[] {
  const sources: ComponentSource[] = [];
  const add = (source: ComponentSource) => {
    // Transport and ingestion metadata are not component provenance. Old
    // library records can still carry the manager's distribution repository.
    if (!source.name || /^lxl2000927\/NeuralFrame$/i.test(source.name)) return;
    if (!sources.some(s => s.name.toLowerCase() === source.name.toLowerCase())) sources.push(source);
  };
  for (const source of row.pack?.upstreams || []) add(source);
  for (const release of row.releases) if (release.repo) add({name:release.repo,
    url:release.releaseUrl || 'https://github.com/'+release.repo,kind:'release'});
  for (const pkg of row.packages) if (/^[\w.-]+\/[\w.-]+$/.test(pkg.source))
    add({name:pkg.source,url:pkg.releaseUrl || 'https://github.com/'+pkg.source,kind:'release'});
  if (!sources.length) sources.push({name:row.compatibility?.kind === 'internal' ? "软件内置" : "组件来源未记录"});
  return sources;
}

export function versionSources(row: LibraryVersion): string[] {
  return versionSourceDetails(row).map(source => source.name);
}

export function versionAcquisition(row: LibraryVersion) {
  const cachedRelease = (release:Updates['candidates'][number]) => row.packages.some(p=>p.present && p.id===release.cachedPackageId);
  const candidate = row.releases.find(c=>c.downloadable && !c.stale)
    || row.releases.find(c=>c.downloadable && cachedRelease(c))
    || row.releases.find(c=>c.downloadable) || row.releases[0];
  const cached = row.pack ? row.pack.downloaded : !!candidate && cachedRelease(candidate);
  if (row.pack) return {candidate,cached,disabled:false,notice:""};
  if (!candidate) return {candidate,cached,disabled:true,notice:"没有在线下载记录；需要文件时请重新导入。"};
  if (!candidate.downloadable) return {candidate,cached,disabled:true,notice:!candidate.sha256
    ? "发布源未提供 SHA-256 校验值，暂不能下载；请等待发布信息补全后检查更新。"
    : "发布源的下载信息不完整，暂不能下载；请重新检查更新。"};
  if (candidate.stale) return {candidate,cached,disabled:!cached,notice:cached
    ? "下载源暂不可用，仍可校验本地缓存；缓存损坏时需先重新检查更新。"
    : "当前是上次保留的版本记录；请重新检查更新，来源恢复后再下载。"};
  return {candidate,cached,disabled:false,notice:""};
}

export function versionLabel(row: LibraryVersion): string {
  return (row.pack?.component === "dlss-nr" && row.releases.find(r => r.catalogModelId)?.catalogModelId) || row.pack?.version || row.releases[0]?.catalogModelId || row.releases[0]?.tag || row.packages[0]?.version || "—";
}

// Project documentation describes a version's stated capabilities, never the
// installation gate or the state of a user's game. Unknown releases retain
// their own unknown evidence instead of borrowing the latest version's tests.
export function versionProjectEvidence(row: LibraryVersion) {
  const component = row.pack?.component || row.packages[0]?.component || row.releases[0]?.component || "";
  const version = engineInfo(row)?.version || versionLabel(row);
  return projectEvidence(component, version);
}

export const componentCategories: Record<string, string> = {
  encore: "fg",
  "dlss-nr": "nr", "renodx-nr": "nr", "renodx-multipass": "nr", feeder: "nr",
  "mfg-renodx": "fg", "mfg-universal": "fg", "dlss-fg": "fg",
};
export type CatalogFilters = { query: string; category: string; local: string; application: string; source: string };
export const emptyFilters: CatalogFilters = {query: "", category: "all", local: "all", application: "all", source: "all"};
export function filterLibrary(groups: ComponentGroup[], data: Library, filters: CatalogFilters, gpuSm: string | null): ComponentGroup[] {
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groups.flatMap(group => {
    const def = data.definitions[group.component];
    const category = def?.internal ? "internal" : componentCategories[group.component] || "runtime";
    if (filters.category !== "all" && filters.category !== category) return [];
    const versions = group.versions.filter(row => {
      if (filters.local !== "all" && filters.local !== localState(row)) return false;
      if (filters.application !== "all" && filters.application !== applicationState(row, gpuSm)) return false;
      const sources = versionSources(row);
      if (filters.source !== "all" && !sources.includes(filters.source)) return false;
      const text = [group.component, def?.name, ...(def?.files || []), row.id, row.pack?.name, versionLabel(row), ...sources,
        ...row.releases.flatMap(r => [r.name, r.tag, r.catalogModelId]),
        ...row.packages.flatMap(p => [p.version, ...(p.files || []).map(f => f.rel)]),
        ...(row.pack?.files || []).map(f => f.path)].filter(Boolean).join(" ").toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    });
    return versions.length ? [{...group, versions}] : [];
  });
}
