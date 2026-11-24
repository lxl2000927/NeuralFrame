import { t, locale } from "../i18n";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  Play,
  FolderOpen,
  ShieldAlert,
  ChevronRight,
  LockKeyhole,
  Copy,
  RefreshCw,
} from "lucide-react";
import { getBridge } from "../bridge";
import { coverTint } from "../coverTint";
import { useWindowReturn } from "../useWindowReturn";
import { useJobLog } from "../useJobLog";
import { SessionLog } from "./SessionLog";
import { Artwork, Empty, Loading, Row, Select } from "../components";
import { InstalledFiles } from "./InstalledFiles";
import { GameComponentVersions } from "./GameComponentVersions";
import { GameBrowser } from "./GameBrowser";
import type { GameMenuHandler } from "../GameCard";
import { GameSetup, resolveSetup, type SetupSelection } from "./GameSetup";
import { anrGpuReason, anrNeuralReason, componentRoutes, supportsMfg, type ComponentRoute } from "../../../src/shared/install-routes.js";
import type { GraphicsRouteSettings, NativeRuntimeKind } from "../types";
import { ActionMenu, GraphicsActions } from "./GraphicsActions";
import { DiagnosticsPanel } from "./GameReports";
import { GraphicsPanels, Modes } from "./GraphicsPanels";
import { EncorePanel, defaultEncore, encoreSettingsIssue } from "./EncorePanel";
import { FrameGenerationPanel, FrameSettingsReadout } from "./FrameGenerationPanel";
import { EngineVersion, selectedEngine, useEngineLibrary } from "./EngineVersion";
import { StandaloneTuning } from "./StandaloneTuning";
import { HardwareProfileChoices, hardwareProfileNotes } from "./HardwareProfileChoices";
import {PresetManager} from "./PresetManager";
import "./GameGraphics.css";
import { StandaloneRuntimeFacts } from "./StandaloneStatus";
import { invalidateGameInspection, useGameDetails, useGameStatus } from "./useGameInspection";
import { useProfileTarget } from "./useProfileTarget";
import { useRestoreStatus } from "./useRestoreStatus";
import {
  applyPatch,
  changedFields,
  defaultStack,
  errorText,
  launcherLabel,
  frameRouteLabels,
  gameRouteLabels,
  profiles,
  mfgGpuReason,
  neuralGpuReason,
  readDraft,
  sameExecutable,
  usesFramePanel,
} from "../domain";
import type {
  Draft,
  Game,
  Inventory,
  Library,
  Result,
  Runtime,
  RuntimeItem,
  Status,
  EncoreSettings,
  MfgAdvanced,
} from "../types";
export type Run = (
  operation: (token?: string) => Promise<Result>,
) => Promise<boolean>;
type Props = {
  onBrowseModels: () => void;
  onBrowseEngines: () => void;
  games: Game[];
  grouped: boolean;
  openMenu: GameMenuHandler;
  selected: string;
  onSelect: (dir: string) => void;
  drafts: Record<string, Draft>;
  setDraft: (dir: string, draft?: Draft) => void;
  busy: boolean;
  run: Run;
  message: (s: string) => void;
  ask?: (title: string, body: string, confirm?: string) => Promise<boolean>;
  active?: boolean;
  refreshToken?: number;
};
type EditorDraft = { setup: SetupSelection | null; components: Record<string, string>; encore?:Record<string,EncoreSettings | undefined>;
  graphics?:Record<string,GraphicsRouteSettings | undefined>;
  encoreEngines?:Record<string,string|undefined>; mfgPackageId?:string; mfgAdvanced?:MfgAdvanced; resetNeuralTuning?:boolean };
const emptyEditorDraft: EditorDraft = { setup: null, components: {} };
export function Games(props: Props) {
  // Keep unapplied route/component choices when an editor or tab unmounts.
  // Component values are only user overrides; "" explicitly means paired default.
  const [editorDrafts, setEditorDrafts] = useState<Record<string, EditorDraft>>({});
  const selected = props.games.find((g) => g.dir === props.selected);
  return (
    <div className="games-workspace">
      <GameBrowser games={props.games} selected={props.selected} onSelect={props.onSelect} grouped={props.grouped} openMenu={props.openMenu} />
      {selected ? (
        <GameEditor key={selected.dir} {...props} game={selected}
          editorDraft={editorDrafts[selected.dir] || emptyEditorDraft}
          onEdit={patch => setEditorDrafts(previous => ({ ...previous,
            [selected.dir]: { ...(previous[selected.dir] || emptyEditorDraft), ...patch },
          }))} />
      ) : (
        <Empty>{t("选择一款游戏，查看配置和组件。")}</Empty>
      )}
    </div>
  );
}
function GameEditor({
  onBrowseModels,
  onBrowseEngines,
  game,
  editorDraft,
  onEdit,
  drafts,
  setDraft,
  run,
  busy,
  message,
  ask,
  active = true,
  refreshToken = 0,
}: Props & { game: Game; editorDraft: EditorDraft; onEdit: (patch: Partial<EditorDraft>) => void }) {
  const setupSelection = editorDraft.setup;
  const [tint, setTint] = useState<string>();
  const updateTint = useCallback((image: HTMLImageElement | null) => setTint(image ? coverTint(image) : undefined), []);
  const setSetupSelection = (setup: SetupSelection | null) => onEdit({ setup });
  const [tab, setTab] = useState("graphics"),
    [showAntiCheatNote, setShowAntiCheatNote] = useState(false),
    [presetOpen, setPresetOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [runtime, setRuntime] = useState<Runtime | null>(null);
  // Window return reads lists/telemetry only. Re-inspecting a game's files is
  // explicit, so focus changes never replace the configuration being edited.
  const returnRevision = useWindowReturn(active && (tab === "components" || tab === "runtime"), busy);
  const { rows: logRows, lines: activity, clear: clearActivity } = useJobLog(game.dir);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const focusFrameEngine = useRef(false);
  const recovery = useRestoreStatus(game.dir, active, revision, refreshToken);
  const detailRead = useGameDetails(game.dir, active, revision, refreshToken);
  const statusRead = useGameStatus(game.dir, "", active, revision, refreshToken);
  const details = detailRead?.value;
  const status = statusRead?.value;
  const gpu = status?.hardware?.gpu;
  const noNvidia = gpu?.nvidiaPresent === false;
  const statusError = statusRead?.error || (status && !status.ok && (status.message || t("未识别到可配置的游戏程序，请核对游戏目录。")));
  const error = tab === "graphics" ? statusError : undefined;
  const loadingPanel = tab === "graphics" && !status;
  const selectedSetup = details ? resolveSetup(details,setupSelection) : null;
  const hostStack = selectedSetup?.route === 'optiscaler';
  const base = status?.ok ? readDraft(status) : null;
  const savedDraft = drafts[game.dir] || base;
  const draft = hostStack && base && savedDraft
    ? {...savedDraft, runtimeStack:base.runtimeStack, hdrCompatibility:base.hdrCompatibility} : savedDraft;
  const changes = base && draft ? changedFields(base, draft) : [];
  const selectedProtected = selectedSetup?.protectedGame ?? status?.launcherProtected;
  const protectedSubtarget = status?.ok && selectedProtected && !status.launcherProtected && !sameExecutable(selectedSetup?.exe?.path, status.exePath);
  const encoreSelected = !selectedProtected && selectedSetup?.route === "encore";
  const graphicsRoute = !selectedProtected && componentRoutes.includes(selectedSetup?.route || "")
    ? selectedSetup!.route as ComponentRoute : null;
  const route = selectedProtected ? "wuwa-proxy" : selectedSetup?.route;
  const combination: string[] = [];
  if (route && !(noNvidia && !graphicsRoute && !encoreSelected && !selectedProtected)) {
    const profile = !graphicsRoute && !encoreSelected && !noNvidia && profiles.find(([id]) => id === draft?.hardwareProfile);
    if (profile) combination.push(t(profile[1]));
    combination.push(t(gameRouteLabels[route] || route));
    const stack = !hostStack && !graphicsRoute && !encoreSelected && !selectedProtected &&
      status?.neural?.runtimeStacks?.find(item => item.id === draft?.runtimeStack);
    if (stack) combination.push(`DLSS SR ${stack.dlssVersion} / Streamline ${stack.streamlineVersion}`);
  }
  const frameRoute = usesFramePanel(graphicsRoute) ? graphicsRoute : null;
  useEffect(()=>{
    if (!focusFrameEngine.current || !graphicsRoute || !status?.ok) return;
    const engine = panelRef.current?.querySelector<HTMLButtonElement>('[data-module="mfg"] [role="radio"][aria-checked="true"]');
    if (engine) { focusFrameEngine.current = false; engine.focus(); }
  }, [graphicsRoute, status?.ok]);
  const graphicsKey = JSON.stringify([selectedSetup?.exe?.path,graphicsRoute]);
  const graphicsDraft = editorDraft.graphics?.[graphicsKey];
  const currentGraphics = status?.graphicsRoute?.route === graphicsRoute && sameExecutable(status?.graphicsRoute?.exePath,selectedSetup?.exe?.path) ? status?.graphicsRoute : undefined;
  const graphicsValues = {...currentGraphics,...graphicsDraft};
  const nativeKinds = selectedSetup?.exe?.sm86NativeKinds || [];
  const selectedKinds = graphicsValues.nativeRuntimes || [];
  const milesR3 = graphicsRoute === "sm86-delta" && selectedSetup?.exe?.steamMiles;
  const gameSwitch = graphicsRoute === "xemfg" && selectedSetup?.exe?.hasGameStreamlineFg &&
    selectedSetup.target?.apiLabel === "DirectX 12" && /\bRTX\s*(?:20|30|40|50)\d\d/i.test(gpu?.name || "");
  const graphicsIssue = selectedSetup?.graphicsIssue || (graphicsRoute?.startsWith("anr") ? anrGpuReason(gpu?.name)
    : graphicsRoute?.startsWith("sm86") && noNvidia ? "Dlssg_for_sm86 需要 NVIDIA GeForce RTX 20–50 系列显卡。" : null);
  const anrNeuralIssue = graphicsRoute === 'anr' && status?.ok
    ? anrNeuralReason(selectedSetup?.exe, status.hardware?.gpu?.architecture?.sm) : null;
  const patchGraphics = (patch:GraphicsRouteSettings) => onEdit({graphics:{...editorDraft.graphics,[graphicsKey]:{...graphicsDraft,...patch}}});
  const profileOverride = !graphicsRoute && !encoreSelected && base && draft && draft.hardwareProfile !== base.hardwareProfile
    ? draft.hardwareProfile : "";
  const projected = useProfileTarget(game.dir, profileOverride, active && tab === "graphics" && !!profileOverride, revision, refreshToken);
  const displayedStatus = profileOverride ? projected?.status : status;
  const setupPending = !!setupSelection && !selectedProtected;
  const encoreKey = (selectedSetup?.exe?.path || setupSelection?.exePath || '').replace(/\\/g,'/').toLowerCase();
  const statusExe = (status?.encore?.exePath || status?.exePath || details?.exePath || '').replace(/\\/g,'/').toLowerCase();
  const currentEncore = encoreKey === statusExe ? status?.encore : undefined;
  const encoreStatus = status ? {...status,encore:currentEncore} : undefined;
  const encoreBase = currentEncore?.installed ? currentEncore.settings : defaultEncore;
  const encoreDraft = editorDraft.encore?.[encoreKey] || encoreBase;
  const setEncoreDraft = (encore?:EncoreSettings) => onEdit({encore:{...editorDraft.encore,[encoreKey]:encore}});
  const encorePackageId = editorDraft.encoreEngines?.[encoreKey];
  const installedEncoreEngine = currentEncore?.installed ? currentEncore.engine : undefined;
  const engineLibrary = useEngineLibrary(active && tab === 'graphics' && (!!status?.launcherProtected || encoreSelected),refreshToken + revision);
  const encoreEngine = selectedEngine(engineLibrary.data,'encore',encorePackageId,installedEncoreEngine);
  const mfgEngine = selectedEngine(engineLibrary.data,'mfg-universal',editorDraft.mfgPackageId,status?.mfg?.engine);
  const changeMfgEngine = (mfgPackageId?:string) => {
    const next = selectedEngine(engineLibrary.data,'mfg-universal',mfgPackageId,status?.mfg?.engine);
    const mfgAdvanced = {...editorDraft.mfgAdvanced};
    if (next?.capabilities?.diagnosticLogging === false) delete mfgAdvanced.diagnosticLogging;
    onEdit({mfgPackageId,mfgAdvanced});
  };
  const encoreChanged = JSON.stringify(encoreBase) !== JSON.stringify(encoreDraft) || encorePackageId !== undefined;
  const advancedChanges = Object.keys(editorDraft.mfgAdvanced || {}).length;
  const singlePassTuning = !["renodx","optiscaler"].includes(selectedSetup?.route || "");
  const resetTuning = singlePassTuning && !!editorDraft.resetNeuralTuning;
  const extraChanges = advancedChanges + Number(editorDraft.mfgPackageId !== undefined) + Number(resetTuning);
  const encoreIssue = selectedSetup?.encoreIssue || currentEncore?.error || (noNvidia && "Encore 首批适配需要识别到 NVIDIA RTX 20 / 30 / 40 / 50 显卡。") || (!status?.ok ? t("读取游戏配置…")
    : encoreSettingsIssue(encoreDraft,encoreStatus || status,selectedSetup?.exe?.hasNativeDlss,encoreEngine,encoreBase));
  const targets = details ? [details, ...(details.exes || [])] : [];
  const antiCheatWarning = targets.some(target => target.antiCheatWarning);
  const antiCheatNames = [...new Set(targets.flatMap(target => target.antiCheatComponents || []))];

  const patchDraft = (patch: Partial<Draft>) => {
    if (draft) setDraft(game.dir, { ...draft, ...patch });
  };
  const presetRoute = selectedProtected ? "wuwa-proxy" : selectedSetup?.route || "";
  const hostManaged = graphicsRoute === "optifg" || graphicsRoute === "xemfg-optiscaler";
  const gameManagedXeMfg = graphicsRoute === "xemfg" && graphicsDraft?.multiplier == null && !!currentGraphics &&
    (currentGraphics.enabled !== true || currentGraphics.dynamic !== false);
  const presetSettings:Record<string,unknown> = {components:editorDraft.components};
  if (encoreSelected) {
    presetSettings.encore=encoreDraft;
    presetSettings.encorePackageId=encorePackageId ?? installedEncoreEngine?.packageId ?? (installedEncoreEngine?.recommended ? "" : undefined);
  } else if (graphicsRoute) {
    if (!hostManaged && !gameManagedXeMfg) {
      const saved = currentGraphics?.filesPresent && !currentGraphics.error ? currentGraphics : undefined;
      const fallback = graphicsRoute.startsWith("anr") ? 6 : graphicsRoute.startsWith("sm86") ? 4 : 2;
      presetSettings.graphics = {
        multiplier:graphicsDraft?.multiplier ?? saved?.multiplier ?? (currentGraphics ? undefined : fallback),
        engine:graphicsDraft?.engine ?? saved?.engine ?? (!currentGraphics && graphicsRoute.startsWith("sm86") ? "DLSS" : undefined),
        sceneCut:graphicsDraft?.sceneCut ?? saved?.sceneCut ?? (!currentGraphics && graphicsRoute.startsWith("anr") ? true : undefined),
        neural:graphicsDraft?.neural ?? saved?.neural ?? (!currentGraphics && graphicsRoute==="anr" ? false : undefined),
        xeMode:gameSwitch ? graphicsValues.xeMode : undefined,
        nativeRuntimes:graphicsRoute.startsWith("sm86") ? graphicsValues.nativeRuntimes : undefined,
      };
    }
  } else if (draft) {
    presetSettings.draft=draft;
    presetSettings.resetNeuralTuning=editorDraft.resetNeuralTuning;
    if (selectedProtected) {
      presetSettings.mfgPackageId=editorDraft.mfgPackageId ?? status?.mfg?.engine?.packageId ?? (status?.mfg?.engine?.recommended ? "" : undefined);
      presetSettings.mfgAdvanced=resetTuning ? editorDraft.mfgAdvanced : {...status?.mfg?.advanced,...editorDraft.mfgAdvanced};
    }
  }
  const applyPreset = (settings:Record<string,unknown>) => {
    const patch:Partial<EditorDraft>={};
    if (encoreSelected) {
      if (settings.encore) patch.encore={...editorDraft.encore,[encoreKey]:{...encoreDraft,...settings.encore as Partial<EncoreSettings>}};
      if (typeof settings.encorePackageId==="string") patch.encoreEngines={...editorDraft.encoreEngines,[encoreKey]:settings.encorePackageId};
    } else if (graphicsRoute) {
      if (!hostManaged && settings.graphics) patch.graphics={...editorDraft.graphics,[graphicsKey]:{...graphicsDraft,...settings.graphics as GraphicsRouteSettings}};
    } else {
      if (draft && settings.draft) patchDraft(settings.draft as Partial<Draft>);
      if (typeof settings.resetNeuralTuning==="boolean") patch.resetNeuralTuning=settings.resetNeuralTuning;
      if (selectedProtected) {
        if (typeof settings.mfgPackageId==="string") patch.mfgPackageId=settings.mfgPackageId;
        if (settings.mfgAdvanced) patch.mfgAdvanced={...editorDraft.mfgAdvanced,...settings.mfgAdvanced as MfgAdvanced};
      }
    }
    if (settings.components) patch.components={...(!settings.componentsComplete && editorDraft.components),...settings.components as Record<string,string>};
    onEdit(patch);
  };
  const refresh = () => {
    invalidateGameInspection(game.dir);
    setRevision((v) => v + 1);
  };
  const executeEncore = async () => {
    const exe = selectedSetup?.exe;
    if (!exe || !status?.ok || encoreIssue) return;
    const {neuralMode,neuralModelId,mfgMode,...encore} = encoreDraft;
    if (await run(token=>getBridge().enhancedApply(game.dir,{
      route:"encore",exePath:exe.path,apiOverride:exe.apiOverride || "auto",neuralMode,neuralModelId,mfgMode,encore,encorePackageId,
    },token))) {
      onEdit({setup:null,encore:{...editorDraft.encore,[encoreKey]:undefined},encoreEngines:{...editorDraft.encoreEngines,[encoreKey]:undefined}}); refresh(); setRuntime(null);
    }
  };
  const executeGraphics = async () => {
    const exe = selectedSetup?.exe;
    if (!graphicsRoute || !exe || !status?.ok || graphicsIssue || (anrNeuralIssue && graphicsValues.neural)) return;
    let graphics = graphicsDraft;
    if (graphicsRoute === "optifg") graphics = undefined;
    if (graphicsRoute === "xemfg-optiscaler") graphics = graphicsDraft?.upgradeHost && !exe.xeMfgHostCurrent ? {upgradeHost:true} : undefined;
    if (graphicsRoute === "xemfg") {
      graphics = {...(graphicsDraft?.multiplier != null || !currentGraphics ? {multiplier:graphicsDraft?.multiplier ?? 2} : {}),
        ...(gameSwitch && graphicsDraft?.xeMode && {xeMode:graphicsDraft.xeMode})};
      if (!Object.keys(graphics).length) graphics = undefined;
    }
    if (await run(token => getBridge().enhancedApply(game.dir,{route:graphicsRoute,exePath:exe.path,
      apiOverride:exe.apiOverride || "auto",graphics},token))) {
      onEdit({setup:null,graphics:{...editorDraft.graphics,[graphicsKey]:undefined}});
      refresh(); setRuntime(null);
    }
  };
  type ApplyScope = NonNullable<Parameters<typeof applyPatch>[2]>;
  const requestedModes = (scope:ApplyScope) => {
    if (!base || !draft) return {};
    const config = scope === "changed" && !changes.length && extraChanges ? {hardwareProfile:draft.hardwareProfile}
      : applyPatch(base,draft,scope,status?.launcherProtected);
    if (scope !== "mfg" && resetTuning) config.neuralMode = draft.neuralMode;
    return config;
  };
  const classicIssue = selectedSetup?.target && !selectedSetup.protectedGame
    ? selectedSetup.target.classicMfgIssue : null;
  const invalidNvidiaMode = (config:Partial<Draft>) => {
    if (noNvidia && config.neuralMode && config.neuralMode !== "off") return neuralGpuReason;
    if (config.mfgMode && config.mfgMode !== "off") return noNvidia ? mfgGpuReason : classicIssue;
    return null;
  };
  const blocksApply = (scope:ApplyScope) => {
    if (!noNvidia && !classicIssue) return false;
    try { return !!invalidNvidiaMode(requestedModes(scope)); } catch { return true; }
  };
  const execute = async (scope: ApplyScope = "changed") => {
    if (encoreSelected) { await executeEncore(); return; }
    if (setupPending) {
      message(t("请先预览并应用安装方式，再应用该路线的参数。"));
      return;
    }
    if (!base || !displayedStatus?.ok) return;
    try {
      const config = {
        ...requestedModes(scope),
        exePath: status?.exePath || details?.exePath || undefined,
        ...(status?.launcherProtected && editorDraft.mfgPackageId !== undefined ? {mfgPackageId:editorDraft.mfgPackageId} : {}),
        ...(status?.launcherProtected && scope !== 'mfg' && advancedChanges ? {mfgAdvanced:editorDraft.mfgAdvanced} : {}),
        ...(scope !== 'mfg' && resetTuning ? {resetNeuralTuning:true} : {}),
      };
      if (hostStack) {
        delete config.runtimeStack;
        delete config.hdrCompatibility;
      }
      const issue = invalidNvidiaMode(config);
      if (issue) {
        message(t(issue));
        return;
      }
      if (
        await run((token) => getBridge().enhancedApply(game.dir, config, token))
      ) {
        if (scope === "both" || scope === "enableBoth" || scope === "changed") setDraft(game.dir, undefined);
        onEdit({mfgPackageId:undefined,...(scope !== 'mfg' ? {mfgAdvanced:undefined,resetNeuralTuning:undefined} : {})});
        refresh();
        setRuntime(null);
      }
    } catch (e) {
      message(errorText(e));
    }
  };
  const installSetup = async () => {
    if (encoreSelected) { await executeEncore(); return; }
    if (!details || !setupPending || noNvidia) return;
    const { exe, route } = resolveSetup(details, setupSelection);
    if (!exe || !route) return;
    if (await run(token => getBridge().install(game.dir, exe.path, route, exe.apiOverride || "auto", token))) {
      setSetupSelection(null);
      refresh();
      setRuntime(null);
    }
  };
  const clearAfterRestore = () => {
    setDraft(game.dir, undefined);
    onEdit({...emptyEditorDraft, graphics:undefined, encore:undefined, encoreEngines:undefined,
      mfgPackageId:undefined, mfgAdvanced:undefined, resetNeuralTuning:undefined});
    setRuntime(null);
    refresh();
  };
  const restore = async () => {
    if (!recovery?.canRestore || (ask && !(await ask(t("卸载并恢复游戏原始状态"),
      t("将删除本次部署的文件，并从 _DLSS5_Backup 还原原始文件。游戏需要处于关闭状态。"), t("恢复"))))) return;
    if (await run(token => getBridge().restoreGame(game.dir, token))) clearAfterRestore();
  };
  const engineNames:Record<string,string> = {
    nvidia:t("NVIDIA DLSS 帧生成"), anr:"ANR FG B20", "anr-addon":"ANR FG B20 · OptiScaler Add-on",
    ...frameRouteLabels,
    sm86:"Dlssg_for_sm86 0.4.2", "sm86-delta":t(selectedSetup?.exe?.steamMiles ? "Dlssg_for_sm86 R3 · 迈尔斯" : "Dlssg_for_sm86 R3 · 三角洲"),
  };
  const engineName = status?.launcherProtected ? t("鸣潮独立加载器") : t(engineNames[graphicsRoute || "nvidia"]);
  const nativeRoute = [selectedSetup?.route, sameExecutable(selectedSetup?.exe?.rel,details?.installedExe) && details?.installedRoute, selectedSetup?.recommended, ...(selectedSetup?.available || [])]
    .find(route=>route && ["native","feeder","renodx","optiscaler"].includes(route) && selectedSetup?.available.includes(route));
  const engineChoices:[string,string,string][] = [
    ...(nativeRoute ? [["nvidia",engineNames.nvidia,t(noNvidia ? "需要 NVIDIA 显卡" : "游戏 DLSS-G 运行库")] as [string,string,string]] : []),
    ...(selectedSetup?.available || []).filter(route=>route === "anr" || usesFramePanel(route) || route === graphicsRoute ||
      route === "anr-addon" && selectedSetup?.route === "optiscaler").map((route):[string,string,string] =>
      [route,t(engineNames[route]),t(route === "anr-addon" || route === "xemfg-optiscaler" || route === "optifg" ? "复用 OptiScaler" : route === "anr" || route === "xemfg" ? "实验性 · 2×–6×" : "社区帧生成")]),
  ];
  const engineChoice = !status?.launcherProtected && engineChoices.length > 1 && <div className="module-field">
    <span>{t("补帧引擎")}</span><Modes label="补帧引擎" value={graphicsRoute || "nvidia"} options={engineChoices}
      onChange={id=>{
        const route = id === "nvidia" ? nativeRoute : id;
        if (!details || !route || !selectedSetup?.exe || route === selectedSetup.route) return;
        const initial = resolveSetup(details,null);
        focusFrameEngine.current = usesFramePanel(route);
        setSetupSelection(route === initial.route && sameExecutable(selectedSetup.exe.path,initial.exe?.path)
          ? null : {exePath:selectedSetup.exe.path,route});
      }}/>
  </div>;
  const graphicsBlocked = !!graphicsIssue || !selectedSetup?.exe || !status?.ok || !!(anrNeuralIssue && graphicsValues.neural);
  const alternative = graphicsRoute && !frameRoute ? {
    supportedModes: graphicsRoute.startsWith("anr") ? t("2×–6× · 实验性") :
      graphicsValues.engine === "XeSS" ? "XeSS · 2×–4×" : "DLSS · 2×–6×",
    blocked: graphicsBlocked,
    neuralControl: graphicsRoute === 'anr' && (selectedSetup?.exe?.hasNativeDlss || graphicsValues.neural) && <label className="setup-field">
      <span>{t("同时启用 DLSS 神经渲染")}</span>
      <Select label={t("同时启用 DLSS 神经渲染")} value={String(graphicsValues.neural ?? false)} disabled={!status?.ok || !!(anrNeuralIssue && !graphicsValues.neural)}
        options={[["true",t("开启")],["false",t("关闭")]]} onChange={value=>patchGraphics({neural:value === "true"})}/>
    </label>,
    fields: <>
      {currentGraphics && (!currentGraphics.filesPresent || currentGraphics.error) && <p role="alert">{t(currentGraphics.error || "配套文件尚不完整")}</p>}
      {graphicsIssue && <p role="alert">{t(graphicsIssue)}</p>}
      {anrNeuralIssue && <p>{t(anrNeuralIssue)}</p>}
      <p>{graphicsRoute.startsWith('anr') ? t("在游戏中启用 DLSS 帧生成。Insert 可打开 OptiScaler 菜单。")
        : t("在游戏中启用 DLSS 帧生成，重启后读取配置。")}</p>
      <p>{t(graphicsRoute.startsWith('anr') ? "显卡范围：RTX 20 及更新、GTX 16、Radeon RX 5000 及更新、Steam Deck、Intel Arc A/B。" : "显卡范围：GeForce RTX 20、30、40、50 系列。")}</p>
      <div className="setup-fields">
        {graphicsRoute.startsWith('sm86') && <label className="setup-field"><span>{t("补帧引擎")}</span>
          <Select label={t("补帧引擎")} value={graphicsValues.engine || "DLSS"} options={[["DLSS","DLSS"],["XeSS","XeSS"]]}
            onChange={value=>patchGraphics({engine:value as "DLSS"|"XeSS",...(value === 'XeSS' && (graphicsValues.multiplier || 4) > 4 ? {multiplier:4} : {})})}/></label>}
        <label className="setup-field"><span>{t("倍率上限")}</span>
          <Select label={t("倍率上限")} value={String(graphicsValues.multiplier || (graphicsRoute.startsWith('anr') ? 6 : 4))}
            options={[...(milesR3 ? [1] : []),2,3,4,...(graphicsRoute.startsWith('anr') || graphicsRoute.startsWith('sm86') && graphicsValues.engine !== 'XeSS' ? [5,6] : [])].map(n=>[String(n),n===1 ? t("跟随驱动默认") : n+"×"])}
            onChange={value=>patchGraphics({multiplier:Number(value)})}/></label>
        {graphicsRoute.startsWith('anr') && <label className="setup-field"><span>{t("切镜保护")}</span>
          <Select label={t("切镜保护")} value={String(graphicsValues.sceneCut ?? true)}
            options={[["true",t("开启")],["false",t("关闭")]]} onChange={value=>patchGraphics({sceneCut:value === "true"})}/></label>}
      </div>
      {milesR3 && <p className="footnote">{t("倍率会同步到 NVIDIA 的《迈尔斯》游戏配置。选择驱动默认或还原部署可恢复原设置。")}</p>}
      {graphicsRoute.startsWith("sm86") && <fieldset className="sm86-runtimes"><legend>{t("更新游戏现有运行库")}</legend>
        {(["sr","rr","fg","streamline"] as NativeRuntimeKind[]).map(kind=>{
          const selected=selectedKinds.includes(kind), available=nativeKinds.includes(kind);
          const labels={sr:"DLSS 超分辨率",rr:"DLSS 光线重建",fg:"DLSS 帧生成",streamline:"Streamline 插件"};
          return <label key={kind}><input type="checkbox" checked={selected} disabled={!available && !selected}
            onChange={event=>patchGraphics({nativeRuntimes:event.target.checked ? [...selectedKinds,kind] : selectedKinds.filter(k=>k!==kind)})}/>
            <span>{t(labels[kind])}</span>{!available && <small>{t("未检测到")}</small>}</label>;
        })}
        <p className="footnote">{t("仅更新当前程序已识别的文件。取消勾选并应用可单独还原这一组。")}</p>
      </fieldset>}
    </>,
  } : undefined;
  return (
    <section className="game-detail" style={tint ? { "--cover-tint": tint } as CSSProperties : undefined}>
      <div className="game-overview">
        <div className="game-detail-top">
          <div className="game-identity">
            <Artwork game={game} layout="banner" large onImageReady={updateTint} />
            <div>
              <div className="game-title-line">
                <h1 title={game.name}>{game.name}</h1>
                <span>{t(launcherLabel(game.launcher))}</span>
              </div>
              <p className="path">
                <span title={game.dir}>{game.dir}</span>
                <button
                  className="icon-button"
                  aria-label={t("复制游戏目录")}
                  title={t("复制路径")}
                  onClick={() => {
                    void getBridge()
                      .copyText(game.dir)
                      .then((done) =>
                        message(done ? t("已复制路径") : t("复制失败")),
                      )
                      .catch((e) => message(errorText(e)));
                  }}
                >
                  <Copy size={13} />
                </button>
              </p>
            </div>
          </div>
          <div className="game-actions">
            <button
              className="icon-button"
              aria-label={t("打开游戏目录")}
              title={t("打开游戏目录")}
              onClick={() => {
                void getBridge()
                  .open(game.dir)
                  .catch((e) => message(errorText(e)));
              }}
            >
              <FolderOpen />
            </button>
            <button
              className="primary"
              disabled={!details?.exePath || busy}
              onClick={() => {
                void getBridge()
                  .launchGame(game.dir)
                  .then((r) => {
                    if (r?.ok === false) message(r.message || t("启动失败"));
                  })
                  .catch((e) => message(errorText(e)));
              }}
            >
              <Play size={16} />
              {t("启动游戏")}
            </button>
          </div>
        </div>
        <div className="installed-strip">
          <span
            title={details?.files
              ?.map((f) => `${f.name} ${f.version || ""}`)
              .join("\n")}
          >
            {t("已检测组件：")}
            {!details
              ? t("读取中…")
              : details.files?.length
                ? t("{0} 个文件 · {1}", [
                    details.files.length,
                    details.api || "API 待确认",
                  ])
                : [t("未发现 DLSS 运行库"), details.api].filter(Boolean).join(" · ")}
          </span>
          {antiCheatWarning && <button type="button" className="anti-cheat-badge"
            aria-expanded={showAntiCheatNote} aria-controls={`${panelId}-anti-cheat`}
            onClick={() => setShowAntiCheatNote(open => !open)}>
            <ShieldAlert size={13} aria-hidden="true" />
            {t(antiCheatNames.length ? "检测到反作弊" : "反作弊提醒")}
            <ChevronRight size={12} aria-hidden="true" />
          </button>}
          <RuntimeSummary runtime={runtime} />
        </div>
        {antiCheatWarning && <div className="game-anti-cheat-note" id={`${panelId}-anti-cheat`} hidden={!showAntiCheatNote}>
          <strong>{t("关于此游戏")}</strong>
          <p>{antiCheatNames.length > 0
            ? t("检测到反作弊组件：{0}。", [antiCheatNames.join(locale() === "en-US" ? ", " : "、")])
            : t("此游戏有反作弊提示。")}{" "}{t("安装第三方 DLL 或叠加层前，请确认该游戏允许使用这些组件。")}</p>
        </div>}
      </div>
      <div className="tabs" role="tablist" aria-label={game.name} onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        const tabs = Array.from(e.currentTarget.querySelectorAll("button"));
        const from = tabs.indexOf(e.target as HTMLButtonElement);
        if (from < 0) return;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1
          : (from + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      }}>
        {[
          ["graphics", t("画质与补帧")],
          ["components", t("组件与版本")],
          ["runtime", t("运行诊断")],
        ].map(([id, label]) => (
          <button
            role="tab"
            id={`${panelId}-${id}`}
            aria-controls={panelId}
            tabIndex={tab === id ? 0 : -1}
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div ref={panelRef} className="detail-scroll" data-tab={tab} role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${tab}`} tabIndex={0}>
        <div className="game-tab-content">
          {details && <div hidden={tab !== "graphics"}>
            <GameSetup dir={game.dir} details={details} status={status} busy={busy}
              selection={setupSelection} onChange={setSetupSelection} onViewFrameRoute={selection=>{
                focusFrameEngine.current = true; setSetupSelection(selection);
              }} message={message} onUpdated={refresh} />
          </div>}
          {tab === "graphics" && detailRead?.error && <p className="error" role="alert">
            {t(detailRead.error)} <button onClick={refresh}>{t("重试")}</button>
          </p>}
          {error && (
            <div className="error" role="alert">
              {t(error)}
              <button onClick={refresh}>{t("重试")}</button>
            </div>
          )}
          {loadingPanel && !error && <Loading text={t("读取游戏配置…")} skeleton="table" />}
          {recovery?.error && (tab === "graphics" || tab === "components") &&
            <p className="error" role="alert">{t(recovery.error)} <button onClick={refresh}>{t("重试")}</button></p>}
          {protectedSubtarget && tab === "graphics" && <p role="alert">{t("请从鸣潮游戏目录打开独立加载器配置。")}</p>}
          {status?.ok && !protectedSubtarget && tab === "graphics" && draft && (
            <fieldset disabled={busy}>
              {encoreSelected ? <EncorePanel value={encoreDraft} status={encoreStatus || status} engine={encoreEngine} hasNativeDlss={selectedSetup?.exe?.hasNativeDlss} issue={encoreIssue}
                engineControl={<EngineVersion component="encore" library={engineLibrary.data} current={installedEncoreEngine} value={encorePackageId}
                  onChange={value=>onEdit({encoreEngines:{...editorDraft.encoreEngines,[encoreKey]:value}})} onBrowse={onBrowseEngines}
                  error={engineLibrary.error} onRetry={engineLibrary.retry}/>}
                onChange={setEncoreDraft} onModels={onBrowseModels} onApply={()=>void executeEncore()}/> : <>
              {!graphicsRoute && <section className="profile-picker game-profile-picker" aria-label={t("硬件专属优化档位")}>
                <h2>{t("硬件专属优化档位")}</h2>
                {!hostStack && !selectedProtected && <p className="footnote">{t("切换档位会更新待应用的默认运行库组合。模型和补帧的可用性仍取决于显卡与游戏。")}</p>}
                {!gpu?.architecture?.sm && <p className="footnote">{t("此处显示 RTX 档位的参考参数。实机兼容性取决于检测到的显卡和游戏路线。")}</p>}
                <HardwareProfileChoices game standalone={status.launcherProtected} catalog={status.hardwareProfiles} profileId={draft.hardwareProfile}
                  source={profileOverride ? "selected" : status.hardwareProfileSource}
                  onSelect={id => { if (id !== draft.hardwareProfile) patchDraft({hardwareProfile:id, runtimeStack:defaultStack(id)}); }} />
              </section>}
              {frameRoute ? <FrameGenerationPanel installed={currentGraphics} route={frameRoute} engineChoice={engineChoice} optiFgInputs={selectedSetup?.target?.optiFgInputs}
                nativeMode={gameSwitch ? graphicsValues.xeMode || "auto" : undefined}
                controls={gameSwitch ? <label className="setup-field"><span>{t("XeMFG 接入方式")}</span>
                  <Select label={t("XeMFG 接入方式")} value={graphicsValues.xeMode || "auto"}
                    options={[["auto",t("自动 · 使用游戏内帧生成开关")],["compatibility",t("兼容模式 · 交换链")]]}
                    onChange={value=>patchGraphics({xeMode:value as "auto"|"compatibility"})}/></label> :
                  frameRoute === "xemfg-optiscaler" && selectedSetup?.exe?.xeMfgHostCurrent && !currentGraphics?.upgradeHost ?
                  <p className="footnote">{t("当前宿主已是 1.7.2 配套版本。")}</p> :
                  frameRoute === "xemfg-optiscaler" ? <label className="setup-field"><span><input type="checkbox" checked={!!graphicsValues.upgradeHost}
                    disabled={currentGraphics?.upgradeHost} onChange={event=>patchGraphics({upgradeHost:event.target.checked})}/> {t("同步更新已识别的 OptiScaler 宿主")}</span>
                    <small>{t("原宿主随部署备份，还原时恢复。")}</small></label> : undefined}
                draftMultiplier={graphicsDraft?.multiplier} issue={graphicsIssue} blocked={graphicsBlocked} vulkan={selectedSetup?.target?.api === "vulkan"}
                change={multiplier=>patchGraphics({multiplier})} apply={()=>void executeGraphics()}/> :
                displayedStatus && <GraphicsPanels active={active} onRuntime={setRuntime} gameDir={game.dir} status={displayedStatus}
                profileNotes={hardwareProfileNotes(displayedStatus.hardwareProfileInfo)}
                exePath={selectedSetup?.exe?.path || displayedStatus.exePath} draft={graphicsRoute && base ? base : draft} onChange={patchDraft}
                alternative={alternative} selectedEngineName={engineName} engineChoice={engineChoice}
                noNativeDlss={selectedSetup?.exe?.hasNativeDlss === false && !selectedProtected}
                nrRoute={selectedSetup?.route} setupPending={setupPending} hostStack={hostStack}
                mfgSupported={status.launcherProtected || !selectedSetup?.target || (supportsMfg(selectedSetup.target) && !selectedSetup.target.classicMfgIssue)}
                mfgIssue={selectedSetup?.target?.classicMfgIssue}
                engineControl={status.launcherProtected && <EngineVersion component="mfg-universal" library={engineLibrary.data} current={status.mfg?.engine}
                  value={editorDraft.mfgPackageId} onChange={changeMfgEngine} onBrowse={onBrowseEngines} error={engineLibrary.error} onRetry={engineLibrary.retry}/>}
                neuralAdvanced={status.launcherProtected && <StandaloneTuning value={{...status.mfg?.advanced,...editorDraft.mfgAdvanced}} engine={mfgEngine}
                  onChange={patch=>onEdit({mfgAdvanced:{...editorDraft.mfgAdvanced,...patch}})} enabled={draft.neuralMode!=='off'}
                  onReset={()=>onEdit({resetNeuralTuning:true,mfgAdvanced:undefined})} resetPending={!!editorDraft.resetNeuralTuning}/>}
                onResetTuning={singlePassTuning ? ()=>onEdit({resetNeuralTuning:true}) : undefined} resetPending={resetTuning}
                onApply={scope => { if (graphicsRoute) void executeGraphics(); else void execute(scope); }}
                onBrowseModels={onBrowseModels} />}
              {profileOverride && !projected && <Loading text={t("读取游戏配置…")}/>}
              </>}
            </fieldset>
          )}
          {tab === "graphics" && draft && !frameRoute && <p className="footnote">{t("这些是磁盘配置与待应用参数。实际渲染效果和补帧倍率请查看运行诊断。")}</p>}
          {profileOverride && tab === "graphics" && projected?.errors.map(detail =>
            <p key={detail} className="error" role="alert">{t(detail)} <button onClick={refresh}>{t("重试")}</button></p>
          )}
          {tab === "components" && (
            <GameComponents
              combination={combination}
              gpuSm={gpu?.architecture?.sm}
              nvidiaPresent={gpu?.nvidiaPresent}
              onConfigure={() => {
                setTab("graphics");
                document.getElementById(panelId + "-graphics")?.focus();
              }}
              onBrowse={onBrowseEngines}
              refreshToken={refreshToken + returnRevision}
              active={active}
              hasBackup={!!recovery?.canRestore}
              onRefresh={refresh}
              onRestore={clearAfterRestore}
              pending={editorDraft.components}
              onChange={components => onEdit({ components })}
              dir={game.dir}
              run={run}
              busy={busy}
              message={message}
            />
          )}
          {tab === "runtime" && (
            <RuntimePanel refreshToken={refreshToken + returnRevision}
              active={active}
              dir={game.dir}
              status={status}
              onRuntime={setRuntime}
              message={message}
            />
          )}
          {tab === "graphics" && <SessionLog rows={logRows} clear={clearActivity} />}
        </div>
      </div>
      <div className="apply-bar">
        <span>
          {tab === "graphics"
            ? graphicsRoute ? t(setupPending || graphicsDraft ? "配置待应用" : "配置已读取") : encoreSelected ? t(encoreChanged || setupPending ? "Encore 配置待应用" : "Encore 配置已读取") : setupPending ? t("安装方式待应用 · 画质与补帧修改 {0} 项", [changes.length + extraChanges]) : changes.length + extraChanges
              ? t("{0} 项待应用修改", [changes.length + extraChanges])
              : t(status?.ok ? "配置已读取" : error ? "操作未完成" : "读取游戏配置…")
            : tab === "components"
                ? t("版本锁定与恢复由组件记录管理")
                : t("仅显示当前进程和有效时间内的证据")}
        </span>
        <div>
          {tab === "graphics" && <button disabled={busy || !status?.ok || !presetRoute || !!protectedSubtarget} onClick={()=>setPresetOpen(true)}>{t("配置预设")}</button>}
          {tab === "graphics" && protectedSubtarget ? null : tab === "graphics" && graphicsRoute ? <>
            <button disabled={busy || (!graphicsDraft && !setupPending)} onClick={()=>onEdit({setup:null,graphics:{...editorDraft.graphics,[graphicsKey]:undefined}})}>{t("撤销")}</button>
            <button className="primary" disabled={busy || graphicsBlocked} onClick={()=>void executeGraphics()}>{t("预览并应用")}</button>
            <ActionMenu><button disabled={busy} onClick={refresh}>{t("重新检测文件")}</button>
              <button className="danger" disabled={busy || !recovery?.canRestore} onClick={()=>void restore()}>{t("一键卸载并恢复")}</button></ActionMenu>
          </> : tab === "graphics" && encoreSelected ? <>
            <button disabled={busy || (!encoreChanged && !setupPending)} onClick={()=>onEdit({setup:null,encore:{...editorDraft.encore,[encoreKey]:undefined},encoreEngines:{...editorDraft.encoreEngines,[encoreKey]:undefined}})}>{t("撤销")}</button>
            <button className="primary" disabled={busy || !!encoreIssue || (!encoreChanged && !setupPending)} onClick={()=>void executeEncore()}>{t("预览并应用")}</button>
            <ActionMenu><button disabled={busy} onClick={refresh}>{t("重新检测文件")}</button>
              <button disabled={busy || !!encoreIssue} onClick={()=>void executeEncore()}>{t("重新应用当前配置")}</button>
              <button className="danger" disabled={busy || !recovery?.canRestore} onClick={()=>void restore()}>{t("一键卸载并恢复")}</button></ActionMenu>
          </> : tab === "graphics" ? (
            <GraphicsActions draft={draft} status={displayedStatus} changed={!!changes.length || !!extraChanges || setupPending} busy={busy}
              setupAction={setupPending ? () => void installSetup() : undefined} setupBlocked={noNvidia || !statusRead} blocksApply={blocksApply}
              canRestore={!!recovery?.canRestore} undo={() => { setDraft(game.dir, undefined); onEdit({setup:null,mfgPackageId:undefined,mfgAdvanced:undefined,resetNeuralTuning:undefined}); }}
              apply={execute} restore={restore} rescan={refresh} />
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                void getBridge()
                  .saveDiagnostics(game.dir, activity.join("\n"))
                  .then((r) => {
                    if (r?.ok) message(t("诊断报告已导出"));
                    else if (r?.message) message(r.message);
                  })
                  .catch((e) => message(errorText(e)));
              }}
            >
              {t("导出诊断报告")}
            </button>
          )}
        </div>
      </div>
      {presetOpen && <PresetManager dir={game.dir} gameName={game.name} route={presetRoute} current={presetSettings} gameManaged={hostManaged || gameManagedXeMfg}
        onApply={applyPreset} onClose={()=>setPresetOpen(false)} message={message}/>}
    </section>
  );
}
function RuntimeSummary({ runtime }: { runtime: Runtime | null }) {
  const [now, setNow] = useState(Date.now);
  const checkedAt = runtime?.checkedAt;
  useEffect(() => {
    if (checkedAt == null) return;
    const update = () => setNow(Date.now());
    update();
    const remaining = checkedAt + 30001 - Date.now();
    const timer = Number.isFinite(remaining) && remaining > 0 ? setTimeout(update, remaining) : undefined;
    // Diagnostics stop when their tab is left. Expire the retained header
    // snapshot without adding background IPC reads, including after suspension.
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [checkedAt]);
  const stale = !!runtime && (!checkedAt || !Number.isFinite(checkedAt) || now - checkedAt > 30000);
  const running = !stale && runtime?.processState === "running";
  return <span className="runtime-summary" data-running={running || undefined}>
    <i />
    {t(!runtime ? "运行状态未检测" : stale ? "运行记录已过期" : running ? "游戏运行中" : runtime.nr.label)}
  </span>;
}
function GameComponents({
  combination, gpuSm, nvidiaPresent, onConfigure, onBrowse,
  refreshToken,
  active,
  hasBackup,
  onRefresh,
  onRestore,
  dir,
  run,
  busy,
  message,
  pending,
  onChange,
}: {
  active: boolean;
  combination: string[];
  gpuSm?: string | null;
  nvidiaPresent?: boolean | null;
  onConfigure: () => void;
  onBrowse: () => void;
  refreshToken: number;
  hasBackup: boolean;
  onRefresh: () => void;
  onRestore: () => void;
  dir: string;
  run: Run;
  busy: boolean;
  message: (s: string) => void;
  pending: Record<string, string>;
  onChange: (pending: Record<string, string>) => void;
}) {
  const [library, setLibrary] = useState<Library | null>(null),
    [error, setError] = useState(""),
    [rev, setRev] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBridge().libraryComponents(dir)
      .then((l) => {
        if (alive) {
          if (!l.ok || !l.inventory?.ok)
            throw Error(l.message || l.inventory?.message || t("组件读取失败"));
          setLibrary(l);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [dir, rev, active, refreshToken]);
  const inventory = library?.inventory;
  const saved = library?.profile?.selected || {};
  const selection = Object.fromEntries(Object.entries({ ...saved, ...pending }).filter(([, value]) => value));
  const refresh = () => setRev((v) => v + 1);
  const refreshAll = () => {
    onRefresh();
    refresh();
  };
  const restoreRow = (
    <div className="restore-row">
      <span className="muted">{t("使用游戏目录中的原始备份恢复文件。")}</span>
      <button
        className="danger"
        disabled={busy || !hasBackup}
        onClick={() => {
          void run((token) => getBridge().restoreGame(dir, token)).then((ok) => {
            if (ok) {
              onRestore();
              refresh();
            }
          });
        }}
      >
        {t("恢复原始文件")}
      </button>
    </div>
  );
  if (error || !inventory || !library) {
    const state = error ? (
      <div className="error">
        {t(error)}
        <button onClick={refreshAll}>{t("重试")}</button>
      </div>
    ) : <Loading text={t("读取组件与版本记录…")} skeleton="table" />;
    return <>{state}{restoreRow}</>;
  }
  return (
    <>
      <GameComponentVersions library={library} rows={inventory.rows} selection={selection} pending={pending}
        combination={combination} gpuSm={gpuSm} nvidiaPresent={nvidiaPresent} busy={busy} onChange={onChange}
        onConfigure={onConfigure} onBrowse={onBrowse}
        onPreview={() => {
          void run(token => getBridge().libraryApply(dir,token,selection)).then(ok => {
            if (ok) { onChange({}); refresh(); }
          });
        }}
        onRollback={library.rollback ? () => {
          void run(token => getBridge().libraryRollback(dir,library.rollback!.id,token)).then(ok => {
            if (ok) { onChange({}); refresh(); }
          });
        } : undefined}/>
      <div className="section-toolbar">
        <h2>{t("已安装组件与文件")}</h2>
        <ActionMenu><button disabled={busy} onClick={refreshAll}>{t("重新检测文件")}</button></ActionMenu>

      </div>
      <div className="settings-table">
        <Row
          label={inventory.lock ? t("当前组合已锁定") : t("版本未锁定")}
          hint={t("锁定后，管理器会阻止组件文件被替换")}
        >
          <button
            disabled={busy || (!inventory.lock && !inventory.rows.some(row => row.present))}
            onClick={() => {
              void getBridge()
                .componentLock(dir, !inventory.lock)
                .then((r) => {
                  if (!r.ok) throw Error(r.message);
                  refresh();
                })
                .catch((e) => message(errorText(e)));
            }}
          >
            <LockKeyhole size={16} />
            {inventory.lock ? t("解除锁定") : t("锁定当前组合")}
          </button>
        </Row>
      </div>
      {inventory.rows.length ? (
        <InstalledFiles key={dir} dir={dir} rows={inventory.rows} packages={library.packages} selection={selection} message={message} />
      ) : (
        <Empty>{t("尚未安装受管理的组件。")}</Empty>
      )}
      {restoreRow}
    </>
  );
}
const PIPELINE_GROUPS: [string, string[]][] = [
  ["神经渲染", ["nvngx_dlssnr.dll", "renodx-dlss5.addon64"]],
  ["帧生成", ["nvngx_dlssg.dll", "renodx-mfgunlock.addon64", "MFGUnlocker.dll"]],
  [
    "老游戏管线",
    [
      "dlss5-feed.addon64",
      "dlss5-feed.addon32",
      "dlss5-feed-host64.exe",
      "DLSS5_Feed.fx",
      "winmm.dll",
    ],
  ],
  [
    "叠加层与中文",
    ["dlss5-lab-overlay.addon64", "dlss5-zh-cn.addon64", "dlss5-zh-cn.addon32"],
  ],
  ["Streamline", ["sl.reflex.dll", "sl.common.dll", "sl.dlss.dll", "sl.dlss_g.dll"]],
];
const baseName = (row: { name?: string; rel?: string }) =>
  (row.rel || row.name || "").split(/[\\/]/).pop() || "";
const frameDiskInfo:Record<keyof typeof frameRouteLabels, [string,string]> = {
  optifg:["OptiFG 磁盘配置","这些值来自 OptiScaler 配置文件。实际补帧效果请在游戏内查看。"],
  xemfg:["XeMFG 磁盘配置","这些值来自 XeMFG 配置文件。当前没有 XeMFG 专用的实时帧率或倍率读数。"],
  "xemfg-optiscaler":["XeMFG 磁盘配置","插件和宿主来自游戏目录。实际补帧倍率请在游戏内的 OptiScaler 菜单中查看。"],
};

function RuntimePanel({
  refreshToken,
  dir,
  status,
  onRuntime,
  message,
  active,
}: {
  dir: string;
  refreshToken: number;
  status?: Status;
  onRuntime: (r: Runtime | null) => void;
  message: (s: string) => void;
  active: boolean;
}) {
  const [result, setResult] = useState<Runtime | null>(null),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false),
    [now, setNow] = useState(Date.now()),
    [inv, setInv] = useState<Inventory | null>(null);
  const probeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBridge()
      .componentInventory(dir)
      .then((i) => {
        if (alive && i.ok) setInv(i);
      })
      .catch(() => {
        /* 组件清单读取失败不影响运行时检测 */
      });
    return () => {
      alive = false;
    };
  }, [dir, active, refreshToken]);
  useEffect(() => {
    if (!active) {
      setBusy(false);
      return;
    }
    let alive = true,
      inFlight = false;
    const probe = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      setBusy(true);
      try {
        const r = await getBridge().componentRuntime(dir);
        if (alive) {
          if (!r.ok) throw Error(r.message || t("检测失败"));
          setResult(r);
          setNow(Date.now());
          onRuntime(r);
        }
      } catch (e) {
        if (alive) {
          setResult(null);
          onRuntime(null);
          message(errorText(e));
        }
      } finally {
        inFlight = false;
        if (alive) setBusy(false);
      }
    };
    probeRef.current = probe;
    void probe();
    return () => {
      alive = false;
      probeRef.current = () => {};
    };
  }, [dir, active, message, onRuntime, refreshToken]);
  useEffect(() => {
    if (!active || !auto) return;
    const timer = setInterval(() => probeRef.current(), 5000);
    return () => clearInterval(timer);
  }, [active, auto]);
  useEffect(() => {
    if (!active || !result) return;
    const timers = [result.nr.at, result.mfg.at, result.mfg.fpsAt].flatMap(at => {
      const expires = (at || 0) + 30001 - Date.now();
      return expires > 0 ? [setTimeout(() => setNow(Date.now()), expires)] : [];
    });
    return () => timers.forEach(clearTimeout);
  }, [active, result]);
  const item = (name: string, data: RuntimeItem) => {
    const stale = !!data.at && now - data.at > 30000;
    return (
      <section className="runtime-block">
        <h2>{name}</h2>
        <strong
          className={
            stale ? "muted" : data.state === "active" ? "positive" : ""
          }
        >
          {stale ? t("运行记录已过期") : t(data.label)}
        </strong>
        <p>
          {stale ? t("超过 30 秒没有新遥测，请刷新检测。") : t(data.detail)}
        </p>
        {data.requestedMode === 'dynamic' ? <p>{t("请求动态补帧")} · {t(data.appliedMode === 'dynamic' ? "组件已应用动态控制" : "尚未确认动态控制生效")}</p> : data.requestedMultiplier && (
          <p>
            {t("请求")}
            {data.requestedMultiplier}
            {t("× · 已应用请求")} {data.appliedMultiplier || "—"}×
          </p>
        )}
        {!stale && (!data.fpsAt || now - data.fpsAt <= 30000) && data.sourceFps !== undefined &&
          data.reportedOutputFps !== undefined && (
            <p>
              {t("插件报告：基础")}
              {data.sourceFps.toFixed(1)}
              {t("/ 输出")} {data.reportedOutputFps.toFixed(1)} FPS
            </p>
          )}
        {data.evidence && (
          <details>
            <summary>{t("判断依据")}</summary>
            <pre>{data.evidence}</pre>
          </details>
        )}
      </section>
    );
  };
  return (
    <>
      <div className="section-toolbar">
        <h2>{t("运行时检测")}</h2>
        <div className="inline-actions">
          <button disabled={busy} onClick={() => probeRef.current()}>
            <RefreshCw size={16} className={busy ? "refresh-spinning" : undefined} />
            {t(busy ? "检测中…" : "立即检测")}
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            {t("自动刷新")}
          </label>

        </div>
      </div>
      {status?.graphicsRoute && usesFramePanel(status.graphicsRoute.route) && <section className="runtime-block" aria-label={t(frameDiskInfo[status.graphicsRoute.route][0])}>
        <h2>{t(frameDiskInfo[status.graphicsRoute.route][0])}</h2>
        <FrameSettingsReadout installed={status.graphicsRoute}/>
        <p className="footnote">{t(frameDiskInfo[status.graphicsRoute.route][1])}</p>
      </section>}
      {result ? (
        <>
          {result.process?.exe && <p className="path">{t("运行中的程序")} · {result.process.exe}</p>}
          {inv?.rows?.length ? (
            <details className="advanced">
              <summary>{t("管线组件")}</summary>
              <div className="pipeline-grid">
                {PIPELINE_GROUPS.map(([group, names]) => {
                  const rows = names
                    .map((n) => inv.rows.find((f) => f.present && baseName(f).toLowerCase() === n.toLowerCase()))
                    .filter(Boolean) as { present?: boolean; version?: string }[];
                  const present = rows.filter((r) => r.present);
                  return (
                    <div className="pipeline-row" key={group}>
                      <div className="pipeline-head">
                        <strong>{t(group)}</strong>
                        <span
                          className={present.length ? "positive" : "muted"}
                        >
                          {present.length}/{names.length}
                        </span>
                      </div>
                      <small>
                        {present.length
                          ? present
                              .map(
                                (r) =>
                                  `${baseName(r as never)}${
                                    r.version ? " " + r.version : ""
                                  }`,
                              )
                              .join(" · ")
                          : t("未部署")}
                      </small>
                    </div>
                  );
                })}
              </div>
              <p className="footnote">
                {t(
                  "这里只反映磁盘上的文件。是否真正加载由下方运行时检测判断。Streamline 由游戏自带时以游戏目录版本为准。",
                )}
              </p>
            </details>
          ) : null}
          {item(t("DLSS 神经渲染"), result.nr)}
          {item(t(usesFramePanel(status?.graphicsRoute?.route) ? "DLSS-G 运行诊断" : "DLSS-G / 多帧生成"), result.mfg)}
          {result.standalone && <section className="runtime-block"><h2>{t("独立加载实际参数")}</h2><StandaloneRuntimeFacts runtime={result} /></section>}
          <p className="muted">
            {t("检测于")}
            {new Date(result.checkedAt).toLocaleTimeString(locale())}
            {t("· DLL 加载不代表渲染已生效。")}
          </p>
          {!!result.modules?.length && (
            <details className="advanced">
              <summary>
                <ChevronRight size={16} />
                {t("已加载模块")}
              </summary>
              {result.modules.map((m) => (
                <p className="path" key={m.path}>
                  {m.path}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <Empty>
          {busy
            ? t("正在检查游戏进程和运行日志…")
            : <>{t("暂无本次检测结果，请重试。")} <button onClick={() => probeRef.current()}>{t("重试")}</button></>}
        </Empty>
      )}
      {status?.diagnostics && (
        <details className="advanced game-diagnostics">
          <summary>{t("文件、配置与显存估算")}</summary>
          <DiagnosticsPanel diagnostics={status.diagnostics} />
        </details>
      )}
    </>
  );
}
