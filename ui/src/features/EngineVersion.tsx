import { useEffect, useState } from "react";
import { Select } from "../components";
import { getBridge } from "../bridge";
import { errorText } from "../domain";
import { t } from "../i18n";
import type { EngineInfo, Library } from "../types";

// Only read the library catalog here. Passing a game path would trigger a
// second inventory scan beside the game's existing status request.
export function useEngineLibrary(enabled:boolean, revision:number) {
  const [data,setData] = useState<Library>();
  const [error,setError] = useState("");
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    if (!enabled) return;
    let live = true;
    void getBridge().libraryComponents().then(result=>{
      if (!live) return;
      if (!result.ok) throw Error(result.message || t("读取组件失败"));
      setData(result); setError("");
    }).catch(e=>{if(live) setError(errorText(e));});
    return ()=>{live=false;};
  },[enabled,revision,retry]);
  return {data,error,retry:()=>setRetry(v=>v+1)};
}

export function selectedEngine(library:Library|undefined, component:string, selection:string|undefined, current?:EngineInfo) {
  if (selection === undefined && current?.version) return current;
  if (selection) return library?.packages.find(p=>p.id===selection && p.component===component)?.engine;
  return library?.runtimePacks.find(p=>p.component===component && p.engine?.recommended)?.engine;
}

export function EngineVersion({component,library,current,value,onChange,onBrowse,error,onRetry}: {
  component:string; library?:Library; current?:EngineInfo; value?:string;
  onChange:(value:string|undefined)=>void; onBrowse:()=>void; error?:string; onRetry:()=>void;
}) {
  const recommendation = library?.runtimePacks.find(p=>p.component===component && p.engine?.recommended);
  const selected = selectedEngine(library,component,value,current);
  const latest = library?.updates?.candidates.find(c=>c.component===component && !c.stale);
  const options = [
    ["__keep__",current?.version ? t("保留已安装版本 {0}",[current.version]) : t("首次安装使用推荐版本")],
    ["",t("使用推荐版本 {0}",[recommendation?.version || "—"])],
    ...(library?.packages || []).filter(p=>p.component===component && p.present && p.engine?.compatible && p.engine.verified)
      .map(p=>[p.id,`${p.engine?.version || p.version} · ${p.engine?.recommended ? t("推荐") : t("已适配")} · ${p.source}`]),
  ];
  if (value && !options.some(([id])=>id===value)) options.push([value,t("所选组件已不可用，请重新选择")]);
  return <section className="module-field engine-version" aria-label={t("引擎版本")}>
    <span>{t("引擎版本")}</span>
    <Select label={t(component==='encore' ? "Encore 引擎版本" : "鸣潮独立加载器版本")}
      value={value === undefined ? "__keep__" : value} options={options} onChange={v=>onChange(v==='__keep__'?undefined:v)}/>
    <p className="footnote">{t("已安装：{0} · 推荐：{1}",[current?.version || t("未安装"),recommendation?.version || "—"])}
      {selected?.version ? ` · ${t("待应用：{0}",[selected.version])}` : ""}</p>
    <p className="footnote">{t("上游最新（上次检查）：{0}",[latest?.engine?.version || latest?.tag || t("尚未检查")])}</p>
    <p className="footnote">{t("推荐版本可以更换。仅列出已入库且完成适配的版本；调整参数不会自动升级引擎。")}</p>
    {error && <p className="error" role="alert">{error} <button onClick={onRetry}>{t("重试")}</button></p>}
    <button onClick={onBrowse}>{t("管理引擎版本与更新")}</button>
  </section>;
}
