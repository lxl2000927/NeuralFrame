import {useEffect,useRef,useState} from "react";
import {Download,Save,Trash2,Upload} from "lucide-react";
import {Modal} from "../components";
import {getBridge} from "../bridge";
import {dateTime,t} from "../i18n";
import {errorText,gameRouteLabels} from "../domain";
import type {GamePreset} from "../types";
import {createPreset,parsePreset,presetMatches} from "../../../src/core/preset-contract.js";
import "./PresetManager.css";

type Stored=GamePreset&{id:string};
const key=(dir:string)=>`neuralframe.gamePresets.v1:${dir}`;
function rawPresets(dir:string):Stored[]{
  const value=JSON.parse(localStorage.getItem(key(dir))||"[]");
  if (!Array.isArray(value)) throw Error(t("本地预设列表无法读取"));
  return value;
}
function read(dir:string):Stored[]{
  try {return rawPresets(dir).flatMap(item=>{
    try {return typeof item?.id==="string" ? [{...parsePreset(JSON.stringify(item)),id:item.id}] : [];} catch {return [];}
  });}catch{return [];}
}
function hasSettings(settings:Record<string,unknown>){
  return Object.entries(settings).some(([key,value])=>key!=="componentsComplete" && value !== undefined && (value===null || typeof value!=="object" || Object.keys(value).length>0));
}
export function PresetManager({dir,gameName,route,current,gameManaged,onApply,onClose,message}:{
  dir:string;gameName:string;route:string;current:Record<string,unknown>;
  gameManaged:boolean;
  onApply:(settings:Record<string,unknown>)=>void;onClose:()=>void;message:(text:string)=>void;
}){
  const [presets,setPresets]=useState<Stored[]>(()=>read(dir));
  const [name,setName]=useState("");
  const nameInput=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Record<string,string>|null>(null);
  const [loadError,setLoadError]=useState("");
  useEffect(()=>{setPresets(read(dir));setName("");nameInput.current?.focus();},[dir]);
  useEffect(()=>{
    let alive=true;
    setSelected(null);
    setLoadError("");
    void getBridge().librarySelection(dir).then(result=>{
      if (!result.ok || !result.selected) throw Error(result.message||t("组件读取失败"));
      if (alive) setSelected(result.selected);
    }).catch(error=>{if (alive) setLoadError(errorText(error));});
    return()=>{alive=false;};
  },[dir]);
  const store=(update:(previous:Stored[])=>Stored[])=>{
    localStorage.setItem(key(dir),JSON.stringify(update(rawPresets(dir))));
    setPresets(read(dir));
  };
  const save=()=>{
    try{
      if (!selected || busy || !name.trim()) return;
      const components=Object.fromEntries(Object.entries({...selected,...current.components as Record<string,string>}).filter(([,value])=>value));
      const preset=createPreset({name,gameName,route,settings:{...current,components,componentsComplete:true}});
      if (!hasSettings(preset.settings)) throw Error(t("此路线当前没有可保存的桌面参数"));
      store(previous=>[{...preset,id:crypto.randomUUID()},...previous]);setName("");message(t("预设已保存"));
    }catch(error){message(errorText(error));}
  };
  const apply=(preset:Stored)=>{
    if (!presetMatches(preset,route,gameName) || !hasSettings(preset.settings)) return;
    const settings={...preset.settings};
    if (settings.componentsComplete) {
      if (!selected) return;
      const target=settings.components as Record<string,string>;
      const names=new Set([...Object.keys(selected),...Object.keys(target)]);
      settings.components=Object.fromEntries([...names].filter(key=>(selected[key]||"")!==(target[key]||"")).map(key=>[key,target[key]||""]));
    }
    onApply(settings);onClose();message(t("预设已载入草稿，请检查变更预览"));
  };
  const exportPreset=async(preset:Stored)=>{
    setBusy(true);try{
      const {id:_id,...value}=preset;
      const result=await getBridge().presetExport(value);
      if(result.ok)message(t("预设已安全导出"));
      else if(!result.cancelled)message(result.message||t("导出失败"));
    }catch(error){message(errorText(error));}finally{setBusy(false);}
  };
  const importPreset=async()=>{
    setBusy(true);try{
      const result=await getBridge().presetImport();
      if(result.ok&&result.preset){
        const preset=parsePreset(JSON.stringify(result.preset));
        if(!presetMatches(preset,route,gameName))throw Error(t("预设路线与当前游戏配置路线不一致"));
        store(previous=>[{...preset,id:crypto.randomUUID()},...previous]);message(t("预设已导入，确认后再应用"));
      }else if(!result.cancelled)message(result.message||t("导入失败"));
    }catch(error){message(errorText(error));}finally{setBusy(false);}
  };
  return <Modal title={t("本地配置预设")} onClose={onClose} footer={<>
    <button disabled={busy} onClick={()=>void importPreset()}><Upload size={14}/>{t("导入预设")}</button>
    <button onClick={onClose}>{t("关闭")}</button>
  </>}>
    <form className="preset-create" onSubmit={event=>{event.preventDefault();save();}}>
      <label>
        <span>{t("预设名称")}</span>
        <input ref={nameInput} className="text-field" value={name} maxLength={80} placeholder={t("例如：画质优先、低延迟")} onChange={event=>setName(event.target.value)}/>
      </label>
      <button type="submit" className="primary" disabled={!name.trim()||busy||!selected}><Save size={14}/>{t("保存当前配置")}</button>
    </form>
    <p className="footnote">{t("应用预设只修改未提交的草稿，仍需经过变更预览。导出不包含游戏路径、令牌或本机诊断开关。")}</p>
    {gameManaged&&<p className="footnote">{t("当前补帧模式由游戏菜单管理。预设仅保存可在桌面应用的参数和组件选择。")}</p>}
    {loadError&&<p role="alert">{t(loadError)}</p>}
    {presets.length?<div className="preset-list">{presets.map(preset=>{
      const compatible=presetMatches(preset,route,gameName);
      const reason=!compatible?"预设路线与当前游戏配置路线不一致":!hasSettings(preset.settings)?"此预设未记录可应用的参数":"";
      return <article className="preset-row" key={preset.id}>
      <div><strong>{preset.name}</strong><small>{dateTime(preset.createdAt)} · {t(gameRouteLabels[preset.route]||preset.route)}</small>{reason&&<small>{t(reason)}</small>}</div>
      <div className="inline-actions">
        <button disabled={busy||!!reason||(!!preset.settings.componentsComplete&&!selected)} onClick={()=>apply(preset)}>{t("应用")}</button>
        <button className="icon-button" disabled={busy} title={t("安全导出")} aria-label={t("导出预设 {0}",[preset.name])} onClick={()=>void exportPreset(preset)}><Download size={14}/></button>
        <button className="icon-button danger" disabled={busy} title={t("删除")} aria-label={t("删除预设 {0}",[preset.name])} onClick={()=>{try{store(previous=>previous.filter(row=>row?.id!==preset.id));}catch(error){message(errorText(error));}}}><Trash2 size={14}/></button>
      </div>
    </article>;})}</div>:<p className="muted">{t("当前游戏还没有本地预设。")}</p>}
  </Modal>;
}
