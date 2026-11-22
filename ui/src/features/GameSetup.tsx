import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { t } from "../i18n";
import { getBridge } from "../bridge";
import { Select } from "../components";
import { errorText, gameRouteLabels as routes, neuralGpuReason, sameExecutable, size, usesFramePanel } from "../domain";
import type { Details, Status } from "../types";
import * as installRoutes from "../../../src/shared/install-routes.js";
import * as renderingApi from "../../../src/shared/rendering-api.js";

export type SetupSelection = { exePath: string; route: string };
export function resolveSetup(details: Details, selection: SetupSelection | null) {
  const exes = details.exes || [];
  const exe = selection ? exes.find(item => sameExecutable(item.path, selection.exePath)) :
    exes.find(item => sameExecutable(item.rel, details.installedExe)) ||
    exes.find(item => sameExecutable(item.path, details.exePath)) || exes[0];
  const protectedGame = exe?.launcherProtected ?? details.launcherProtected;
  const target = exe ? renderingApi.effective({...exe, launcherProtected:protectedGame,
    antiCheatWarning:exe.antiCheatWarning || details.antiCheatWarning}, exe.apiOverride || "auto") : null;
  const available: string[] = target ? [...installRoutes.routesFor(target),
    ...installRoutes.componentRoutesFor(target)] : [];
  const recommended = exe?.recommendedRoute === undefined ? details.recommendedRoute : exe.recommendedRoute;
  const ownsInstall = details.installedExe ? sameExecutable(exe?.rel, details.installedExe)
    : !selection || sameExecutable(exe?.path, details.exePath);
  const installed = ownsInstall ? details.installedRoute : undefined;
  const wanted = selection?.route || installed || recommended || "";
  const wantedOptional = installRoutes.componentRoutes.includes(wanted) && wanted;
  const graphicsIssue = wantedOptional && !available.includes(wantedOptional)
    ? (usesFramePanel(wantedOptional) && installRoutes.graphicsRouteReasons[wantedOptional](target)) || "当前程序或渲染 API 不支持所选路线。" : null;
  if (wantedOptional && graphicsIssue && !protectedGame) available.push(wantedOptional);
  // Keep an installed backend visible even if a game update changes eligibility.
  if (target && (selection?.route === 'encore' || (!selection && installed === 'encore')) && !available.includes('encore')) available.push('encore');
  const route = selection?.route === 'encore' ? 'encore' : available.includes(wanted) ? wanted : recommended && available.includes(recommended)
    ? recommended : available[0] || "";
  const encoreIssue = target ? installRoutes.encoreReason(target)
    : "所选游戏程序已不在扫描列表中，请重新选择。";
  const frameNotice = target ? installRoutes.graphicsRouteReasons[target.optiFgHost ? "optifg" : target.xeMfgOptiHost ? "xemfg-optiscaler" : "xemfg"](target) : null;
  return { exe, target, available, route, encoreIssue, graphicsIssue, frameNotice, protectedGame, recommended, installed, ownsInstall };
}

export function GameSetup({ dir, details, status, busy, selection, onChange, onViewFrameRoute, message, onUpdated }: {
  dir: string; details: Details; status?: Status; busy: boolean;
  selection: SetupSelection | null; onChange: (selection: SetupSelection) => void; onViewFrameRoute: (selection: SetupSelection) => void;
  message: (s: string) => void; onUpdated: () => void;
}) {
  const { exe, target, available, route, protectedGame, recommended, installed, ownsInstall, frameNotice } = resolveSetup(details, selection);
  const [saving, setSaving] = useState(false);
  const [builds, setBuilds] = useState<{ builds: { version: string; label: string }[]; current: string } | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (route !== "optiscaler" || protectedGame) return;
    let alive = true;
    getBridge().optiscalerBuilds(dir).then(result => { if (alive) setBuilds(result); })
      .catch(e => { if (alive) message(errorText(e)); });
    return () => { alive = false; };
  }, [dir, route, protectedGame]);
  const save = async (fn: () => Promise<void>) => {
    if (lock.current || busy) return;
    lock.current = true; setSaving(true);
    try { await fn(); onUpdated(); } catch (e) { message(errorText(e)); }
    finally { lock.current = false; setSaving(false); }
  };
  const chooseRoute = (value: string) => { if (exe) onChange({ exePath: exe.path, route: value }); };
  const chooseExe = (exePath:string) => {
    let route = selection?.route || installed || "";
    if (usesFramePanel(route) && !resolveSetup(details,{exePath,route:""}).available.includes(route)) route = "";
    onChange({exePath,route});
  };
  const separate = ["optiscaler","encore",...installRoutes.componentRoutes];
  const reshadeRoutes = available.filter(id => !separate.includes(id));
  const backend = protectedGame ? "native" : separate.includes(route) ? route : "reshade";
  const gpu = status?.hardware?.gpu;
  const classicGpuIssue = gpu?.nvidiaPresent === false && !protectedGame && ["native","feeder","renodx","optiscaler"].includes(route);
  const frameRoute = classicGpuIssue && ["xemfg-optiscaler","optifg","xemfg","anr"].find(id=>available.includes(id) &&
    (id !== "anr" || !installRoutes.anrGpuReason(gpu?.name)));
  const afmf = classicGpuIssue && !frameRoute && installRoutes.afmfDriverMode(target,status?.hardware);
  const currentVersion = protectedGame ? status?.nativeRuntimeStack?.sr?.version || details.currentDlss?.version : details.currentDlss?.version;
  const inspectedTarget = sameExecutable(exe?.path, details.exePath);
  const hasNeuralConsumer = status?.neural?.dependencies?.hasConsumer;
  const installedBackend = installed === "wuwa-proxy" ? "version.dll"
    : installed === "hud" ? t("无")
    : installed === "encore" ? "RTX Encore"
    : installed && installRoutes.componentRoutes.includes(installed) ? t(routes[installed])
    : ownsInstall && details.optiscaler?.installed ? "OptiScaler"
    : details.reshade?.installed ? "ReShade" : t("无");
  const files = details.files || [];
  return <section className="settings-section game-setup" aria-label={t("安装与运行环境")}>
    <h2>{t("安装与运行环境")}</h2>
    <fieldset disabled={busy || saving}>
      <div className="setup-fields">
        <label className="setup-field setup-wide"><span>{t("可执行文件")}</span>
          <Select label={t("可执行文件")} value={exe?.path || selection?.exePath || ""} disabled={!details.exes?.length || details.launcherProtected}
            onChange={chooseExe}
            options={(details.exes || []).map(item => [item.path,
              `${item.rel} — ${item.apiLabel} — ${item.bitness}-bit — ${size(item.size)}`])} />
        </label>
        <label className="setup-field setup-wide"><span>{t("渲染 API")}</span>
          <Select label={t("渲染 API")} value={exe?.apiOverride || "auto"} disabled={!exe}
            options={[["auto", t("自动（检测到：{0}）", [exe?.apiLabel || t("未知")])], ...renderingApi.choices.map(item => [item.value, item.label])]}
            onChange={value => void save(async () => {
              if (!exe) return;
              const result = await getBridge().setApiOverride(dir, exe.path, value);
              if (!result.ok) throw Error(result.message || result.code || t("保存失败"));
            })} />
        </label>
        <label className="setup-field"><span>{t("渲染后端")}</span>
          <Select label={t("渲染后端")} value={backend} disabled={!available.length || protectedGame}
            options={protectedGame ? [["native", t("游戏原生运行库")]] : [
              ...(reshadeRoutes.length ? [["reshade", t("ReShade（默认）")]] : []),
              ...(available.includes("optiscaler") ? [["optiscaler", "OptiScaler"]] : []),
              ...(available.includes("encore") ? [["encore", "RTX Encore"]] : []),
              ...available.filter(id => installRoutes.componentRoutes.includes(id)).map(id => [id,t(routes[id])]),
            ]}
            onChange={value => chooseRoute(value === "reshade"
              ? (recommended && reshadeRoutes.includes(recommended) ? recommended : reshadeRoutes[0])
              : value)} />
        </label>
        <label className="setup-field"><span>{t("安装方式")}</span>
          <Select label={t("安装方式")} value={protectedGame ? "wuwa-proxy" : route}
            disabled={!available.length || protectedGame}
            options={protectedGame ? [["wuwa-proxy", t("鸣潮兼容路线（version.dll）")]]
              : (backend === "reshade" ? reshadeRoutes : [backend]).map(id => [id, t(routes[id])])}
            onChange={chooseRoute} />
        </label>
        {!protectedGame && backend === "reshade" && target && ["dxgi", "d3d8", "d3d9", "ddraw"].includes(target.api) && target.apiLabel !== "DirectX 12" &&
          <label className="setup-field setup-wide"><span>{t("ReShade 加载文件")}</span>
            <Select label={t("ReShade 加载文件")} value={exe?.reshadeProxy || "dxgi"} options={[["dxgi", "dxgi.dll"], ["d3d11", "d3d11.dll"]]}
              onChange={value => void save(async () => {
                if (!exe) return;
                const result = await getBridge().setReshadeProxy(dir, exe.path, value);
                if (!result.ok) throw Error(result.message || result.code || t("保存失败"));
              })} />
          </label>}
        {!protectedGame && route === "optiscaler" &&
          <label className="setup-field setup-wide"><span>{t("OptiScaler 构建版本")}</span>
            <Select label={t("OptiScaler 构建版本")} value={builds?.current || ""} disabled={!builds}
              options={(builds?.builds || []).map(item => [item.version, item.label])}
              onChange={value => void save(async () => {
                const current = await getBridge().setOptiscalerBuild(dir, value);
                if (!current) throw Error(t("保存失败"));
                setBuilds(previous => previous ? { ...previous, current } : previous);
              })} />
          </label>}
      </div>
    </fieldset>
    {route === "feeder" && <p className="footnote">{t("Feeder 向渲染插件提供游戏画面和运动数据。DLSS 神经渲染仍需要兼容的 NVIDIA RTX 显卡。")}</p>}
    {classicGpuIssue && <p className="error">{t(neuralGpuReason)}</p>}
    {frameRoute && exe && <button disabled={busy || saving} onClick={()=>onViewFrameRoute({exePath:exe.path,route:frameRoute})}>{t("查看 {0} 设置", [t(routes[frameRoute])])}</button>}
    {afmf && <div className="footnote">
      <p>{t("此显卡可在 AMD Software: Adrenalin Edition 中设置 AFMF 驱动补帧。")}
        {afmf === "afmf-fullscreen" && " " + t("RX 6000 系列需要独占全屏。")}</p>
      <button onClick={()=>void getBridge().openProject("amd-afmf").then(ok=>{if (!ok) message(t("无法打开项目链接"));}).catch(e=>message(errorText(e)))}>{t("查看 AMD 官方 AFMF 说明")}</button>
    </div>}
    <dl className="setup-status">
      <div><dt>{t("架构")}</dt><dd>{exe?.bitness ? `${exe.bitness}-bit` : t("未知")}</dd></div>
      <div><dt>{t("渲染 API")}</dt><dd className="setup-positive">{target?.apiLabel || t("未知")}</dd></div>
      {inspectedTarget && <div><dt>{t("已安装的后端")}</dt><dd>{installedBackend}</dd></div>}
      {inspectedTarget ? <div><dt>DLSS</dt><dd>{currentVersion || t("未检测到")}
        {protectedGame ? <span className="setup-version-note">{t("保留游戏原版")}</span>
          : details.newDlss && details.newDlss !== currentVersion && selection && backend === "reshade"
            ? <><span className="setup-version-arrow">→</span><span className="setup-positive">{details.newDlss}</span></> : null}</dd></div>
        : <div><dt>DLSS</dt><dd>{t(exe?.hasNativeDlss === undefined ? "尚未检测" : exe.hasNativeDlss ? "检测到原生超分" : "未检测到原生超分")}</dd></div>}
      {inspectedTarget && <><div><dt>{t("神经渲染插件")}</dt><dd>{t(hasNeuralConsumer === undefined ? "尚未检测" : hasNeuralConsumer ? "已安装" : "未安装")}</dd></div>
      <div><dt>ReShade</dt><dd>{details.reshade?.installed ? details.reshade.version || t("已安装") : t("未安装")}</dd></div></>}
    </dl>
    {!protectedGame && target && installRoutes.encoreReason(target) && <p className="footnote">RTX Encore：{t(installRoutes.encoreReason(target)!)}</p>}
    {!protectedGame && frameNotice && !usesFramePanel(route) && <p className="footnote">{t(frameNotice)}</p>}
    {inspectedTarget && <details className="setup-files" open>
      <summary><span>{t("检测到的组件文件")}</span><span>{t("{0} 个", [files.length])}</span><ChevronDown size={15} /></summary>
      <div className="setup-file-list">
        {files.length ? files.map(file => <div className="setup-file" key={file.rel}>
          <code>{file.rel}</code><span>{file.featureMismatch ? t("组件身份与文件名不符") : file.version || "—"}</span>
        </div>) : <p className="setup-empty">{t("未检测到组件文件")}</p>}
      </div>
    </details>}
    {!exe && selection ? <p className="error">{t("所选游戏程序已不在扫描列表中，请重新选择。")}</p>
      : !protectedGame && !available.length && <p className="error">{t("当前 API 或程序位数没有可用路线，可核对程序或手动指定 API。")}</p>}
    {exe?.installIssue && <p className="error">{t(exe.installIssue)}</p>}
  </section>;
}
