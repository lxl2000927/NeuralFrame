import { useState } from "react";
import { getBridge } from "../bridge";
import { Activity, ChevronDown, Download, ExternalLink, Monitor } from "lucide-react";
import { errorText, sameExecutable } from "../domain";
import { Select } from "../components";
import { t } from "../i18n";
import type { Game, GameExecutable } from "../types";
import type { Run } from "./Games";
import { useGameDetails } from "./useGameInspection";
import { effective } from "../../../src/shared/rendering-api.js";
import { supportsPerformanceMonitor } from "../../../src/shared/install-routes.js";
import "./PerformanceMonitor.css";

export type MonitorTarget = {dir:string; path:string};
type Props = {
  games:Game[]; dir:string; onGame:(dir:string)=>void;
  target:MonitorTarget | null; onTarget:(target:MonitorTarget)=>void;
  active:boolean; refreshToken:number; busy:boolean; run:Run;
};
export type MonitorControls = Omit<Props,"active" | "refreshToken">;

export function PerformanceMonitor({games,dir,onGame,target,onTarget,active,refreshToken,busy,run}:Props) {
  const [retry,setRetry] = useState(0);
  const [exportBits,setExportBits] = useState("");
  const [saving,setSaving] = useState(false);
  const [fileMessage,setFileMessage] = useState("");
  const read = useGameDetails(dir,active,retry,refreshToken);
  const details = read?.value;
  const exes = details?.exes || [];
  const explicit = target?.dir === dir ? target.path : undefined;
  const exe = explicit ? exes.find(item=>sameExecutable(item.path,explicit)) :
    exes.find(item=>sameExecutable(item.rel,details?.installedExe)) || exes.find(item=>sameExecutable(item.path,details?.exePath)) || exes[0];
  const api = exe && effective(exe,exe.apiOverride || "auto");
  const previewOnly = !!exe && (exe.launcherProtected ?? details?.launcherProtected) === true;
  let issue = read?.error || "";
  if (!dir) issue = "请先添加游戏。";
  else if (!issue) {
    if (!details) issue = "读取游戏配置…";
    else if (explicit && !exe) issue = "所选游戏程序已不在扫描列表中，请重新选择。";
    else if (!previewOnly) {
      if (!exe || !api || !supportsPerformanceMonitor(api)) issue = "当前程序或渲染 API 不支持 F7 性能监控。";
      else if (exe.installIssue) issue = exe.installIssue;
      else if (details.installedExe && (!sameExecutable(details.installedExe,exe.rel) || details.installedApi && details.installedApi !== api.api))
        issue = "请为当前已部署的游戏程序和渲染 API 配置性能监控。";
    }
  }
  const installed = !!exe?.performanceMonitor?.installed;
  const bits = exportBits || (exe?.bitness === 32 ? "32" : "64");
  const saveFile = async () => {
    setSaving(true);
    setFileMessage("");
    try {
      const result = await getBridge().saveMonitorAddon(Number(bits));
      if (result.ok) setFileMessage(t("已保存 {0} 位 F7 插件。", [bits]));
      else if (!result.cancelled) setFileMessage(t(result.message || "保存失败"));
    } catch (error) { setFileMessage(errorText(error)); }
    finally { setSaving(false); }
  };
  return <section className="monitor-panel" aria-label={t("F7 性能监控")}>
    <header className="monitor-heading"><Activity aria-hidden="true" size={21}/><h2>{t("F7 性能监控")}</h2>
      {exe && !issue && <span className="monitor-installed" data-installed={!previewOnly && installed}>{t(previewOnly ? "仅预览" : installed ? "已安装" : "未安装")}</span>}</header>
    <fieldset className="monitor-body" disabled={busy}>
      <div className="monitor-target">
        <label>{t("目标游戏")}<Select label={t("目标游戏")} value={dir} disabled={!games.length}
          options={games.map(game=>[game.dir,game.name])} onChange={onGame}/></label>
        {!!exes.length && <label>{t("可执行文件")}<Select label={t("可执行文件")} value={exe?.path || explicit || ""} disabled={!!exe && exes.length < 2}
          options={exes.map(item=>[item.path,item.rel])} onChange={path=>onTarget({dir,path})}/></label>}
      </div>
      {issue ? <p className="monitor-issue" role="status">{t(issue)} {read?.error && <button onClick={()=>setRetry(v=>v+1)}>{t("重试")}</button>}</p>
        : exe && <MonitorSettings key={JSON.stringify([dir,exe.path,previewOnly])} exe={exe} dir={dir} run={previewOnly ? undefined : run}/>}
    </fieldset>
    <details className="monitor-export"><summary><Download size={15} aria-hidden="true"/>{t("导出插件文件")}<ChevronDown size={15} aria-hidden="true"/></summary><div className="monitor-files">
      <Select label={t("插件位数")} value={bits} options={[["64","64-bit"],["32","32-bit"]]} onChange={value=>{setExportBits(value);setFileMessage("");}} disabled={saving}/>
      <button disabled={saving} onClick={()=>void saveFile()}><Download size={15}/>{t("保存 F7 插件文件")}</button>
      <button onClick={()=>void getBridge().openProject("f7Source").then(ok=>{if (!ok) setFileMessage(t("无法打开项目链接"));}).catch(error=>setFileMessage(errorText(error)))}>
        <ExternalLink size={14}/>{t("上游源码")}</button>
      {fileMessage && <small role="status">{fileMessage}</small>}
    </div></details>
  </section>;
}

function MonitorSettings({exe,dir,run}:{exe:GameExecutable;dir:string;run?:Run}) {
  const saved = run ? exe.performanceMonitor : undefined;
  const [draft,setDraft] = useState<{mode?:number;corner?:number}>({});
  const defaultMode = saved?.mode ?? (saved?.installed ? 0 : 1);
  const defaultCorner = saved?.corner ?? 1;
  const mode = draft.mode ?? defaultMode;
  const corner = draft.corner ?? defaultCorner;
  const changed = mode !== defaultMode || corner !== defaultCorner;
  const apply = async () => {
    if (!run) return;
    // Send only edited fields so an independent change from the Home menu survives.
    const patch = {...(!saved?.installed && {install:true as const}), ...(mode !== defaultMode && {mode}), ...(corner !== defaultCorner && {corner})};
    if (await run(token=>getBridge().enhancedApply(dir,{exePath:exe.path,apiOverride:exe.apiOverride || "auto",
      performanceMonitor:patch},token))) setDraft({});
  };
  return <div className="monitor-editor">
    <div className="monitor-controls">
      <fieldset className="monitor-modes"><legend>{t("监控显示模式")}</legend>
        <div>{["隐藏","精简","详细"].map((label,index)=><label key={label}>
          <input type="radio" name={`mode-${exe.path}`} checked={mode === index} onChange={()=>setDraft(prev=>({...prev,mode:index}))}/>
          <span>{t(label)}</span>
        </label>)}</div>
      </fieldset>
      {run ? <>
        <p className="monitor-keys"><kbd>F7</kbd>{t("切换显示模式")}<kbd>Home</kbd>{t("调整浮窗位置")}</p>
        <button className="primary" disabled={saved?.installed && !changed} onClick={()=>void apply()}>{t(saved?.installed ? "预览监控设置" : "预览安装并应用设置")}</button>
      </> : <p className="monitor-issue">{t("独立加载路线暂不支持游戏内 F7。可在这里预览显示模式和浮窗位置。")}</p>}
    </div>
    <fieldset className="monitor-position"><legend>{t("浮窗位置")}</legend>
      <div className="monitor-screen">
        <span className="monitor-screen-center" aria-hidden="true"><Monitor size={18}/>{t(mode === 0 ? "浮窗已隐藏" : "位置预览")}</span>
        {["左上","右上","左下","右下"].map((label,index)=><label key={label}>
          <input type="radio" aria-label={t(label)} name={`corner-${exe.path}`} checked={corner === index} onChange={()=>setDraft(prev=>({...prev,corner:index}))}/>
          <span className="monitor-anchor"><span>{t(label)}</span>
            {mode !== 0 && corner === index && <small aria-hidden="true">FPS · VRAM{mode === 2 && <><br/>1% Low · ms</>}</small>}
          </span>
        </label>)}
      </div>
    </fieldset>
  </div>;
}
