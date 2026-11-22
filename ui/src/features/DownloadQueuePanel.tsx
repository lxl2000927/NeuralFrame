import {useCallback,useContext,useEffect,useRef,useState} from "react";
import {AlertCircle,Download,Trash2,Inbox,X} from "lucide-react";
import {DownloadContext,transferProgress} from "./DownloadAction";
import {Modal} from "../components";
import {size} from "../domain";
import {t} from "../i18n";
import "./DownloadQueuePanel.css";

export function QueueLauncher({onOpen,open}:{onOpen:()=>void;open:boolean}) {
  const downloads = useContext(DownloadContext);
  const row = downloads?.row;
  const wait = downloads?.queueItems.length || 0;
  const failed = downloads?.recentFailures.length || 0;
  const progress = row && transferProgress(row);
  return <button className="queue-launcher" data-active={!!progress} data-failed={!progress&&failed>0} onClick={onOpen}
    onDoubleClick={event=>event.stopPropagation()} aria-label={t("下载队列")} aria-expanded={open}
    aria-controls="download-queue-panel" title={row ? row.id + " · " + progress?.label : failed ? t("下载队列 · 有失败记录") : t("下载队列")}>
    {failed&&!progress?<AlertCircle size={14} aria-hidden="true"/>:<Download size={14} aria-hidden="true"/>}
    <span>{progress?.label || t("下载队列")}</span>
    {progress?.percent != null && <b>{Math.floor(progress.percent)}%</b>}
    {wait>0 && <small aria-label={t("等待 {0} 项",[wait])}>+{wait}</small>}
    {progress && <progress max={100} value={progress.percent} aria-label={t("当前下载进度")}/>}
  </button>;
}

export function DownloadQueuePanel({onClose}:{onClose:()=>void}){
  const context=useContext(DownloadContext);
  const row=context?.row,items=context?.queueItems||[];
  const progress=row && transferProgress(row);
  const completed = context?.completed || 0;
  const failures = context?.recentFailures || [];
  const count = completed + items.length + (row ? 1 : 0);
  const batchPercent = progress && progress.percent == null ? undefined : (completed + (progress?.percent || 0)/100) / Math.max(1,count) * 100;
  const [compact,setCompact]=useState(()=>matchMedia("(max-width: 700px)").matches);
  const [confirm,setConfirm]=useState<{key:string;name:string}|null>(null);
  const [panelNotice,setPanelNotice]=useState("");
  const opener=useRef<HTMLElement|null>(document.activeElement instanceof HTMLElement?document.activeElement:null);
  const close=useCallback(()=>{
    onClose();
    requestAnimationFrame(()=>{if(opener.current?.isConnected)opener.current.focus({preventScroll:true});});
  },[onClose]);
  useEffect(()=>{
    const query=matchMedia("(max-width: 700px)"),update=()=>setCompact(query.matches);
    query.addEventListener("change",update);return()=>query.removeEventListener("change",update);
  },[]);
  const currentName=row?(row.name&&row.name!==t("组件")?t(row.name):row.id):"";
  const content=<>
    {confirm&&<Modal title={t("取消并清理下载")} onClose={()=>setConfirm(null)} footer={<>
      <button onClick={()=>setConfirm(null)}>{t("保留下载")}</button>
      <button className="danger" onClick={()=>{
        const current=context?.row;
        if(!current||`${current.kind}:${current.id}`!==confirm.key){setPanelNotice(t("当前任务已变化，未执行清理。"));setConfirm(null);return;}
        current.discard();setConfirm(null);
      }}>{t("确认取消并清理")}</button>
    </>}><p>{t("将停止 {0}，删除本次下载的临时分段；已入库组件和其他任务不受影响。",[confirm.name])}</p>
      <p className="muted">{t("普通暂停会保留可续传数据；只有确认清理才会删除临时分段。")}</p></Modal>}
    {panelNotice&&<p className="queue-feedback" role="status">{panelNotice}</p>}
    {row && progress && <article className="queue-current">
      <div className="queue-current-heading"><span><Download size={16}/><span role="status">{progress.label}</span></span>{progress.percent != null && <strong>{Math.floor(progress.percent)}%</strong>}</div>
      <strong title={row.id}>{currentName}</strong>
      <progress max={100} value={progress.percent} aria-label={t("当前下载进度")}/>
      <div className="queue-meta">
        <span>{progress.total>0?`${size(progress.loaded)} / ${size(progress.total)}`:t("{0} / 总量未知",[size(progress.loaded)])}</span>
        {row.speed>0 && <span>{size(row.speed)}/s</span>}
        {!!row.connections && <span>{t("{0} 连接",[row.connections])}</span>}
        {row.source && <span>{row.source}</span>}
      </div>
      {row.sourceReason && <small>{t(row.sourceReason)}</small>}
      <div className="inline-actions">
        <button disabled={row.cancelling || ["checking","ready"].includes(row.stage) || (row.stage==="queued" && row.kind!=="library")} onClick={row.cancel}>
          {t(row.cancelling?(row.stage==="download"?"正在暂停…":"正在取消…"):(row.stage==="download"?"暂停":"取消"))}
        </button>
        {row.stage==="download" && <button className="danger" disabled={row.cancelling} onClick={()=>setConfirm({key:`${row.kind}:${row.id}`,name:currentName})}>{t("取消并清理")}</button>}
      </div>
    </article>}
    {count>1 && (row || items.length>0) && <div className="queue-batch"><small>{t("已处理 {0} 项 · 共 {1} 项",[completed,count])}</small>
      <progress max={100} value={batchPercent} aria-label={t("队列总进度")}/></div>}
    {items.length>0 && <h3 className="queue-wait">{t("等待 {0} 项",[items.length])}</h3>}
    {items.map(item=><article className="queue-entry" key={item.key}>
      <div><strong>{item.id}</strong><small>{t("等待中")} · {item.kind==="runtime"?t("运行时组件"):t("组件库版本")}{item.cached ? " · "+t("校验缓存") : ""}</small></div>
      <button className="queue-remove" aria-label={t("移出队列 {0}",[item.id])} title={t("移出队列")} onClick={()=>context?.removeQueued(item.key)}><Trash2 size={14}/><span>{t("移出队列")}</span></button>
    </article>)}
    {!row&&!items.length&&<div className="queue-empty"><Inbox size={26} aria-hidden="true"/><span>{t("没有活动或等待中的下载。")}</span></div>}
    {failures.length>0&&<section className="queue-failures" aria-labelledby="queue-failure-heading">
      <h3 id="queue-failure-heading"><AlertCircle size={15}/>{t("本次会话最近失败")}</h3>
      {failures.map(failure=><article className="queue-failure" key={failure.attempt}>
        <div><strong>{failure.name||failure.id}</strong><small>{failure.reason}</small></div>
        <button className="icon-button" aria-label={t("清除失败记录 {0}",[failure.name||failure.id])} onClick={()=>context?.clearFailure(failure.attempt)}><X size={14}/></button>
        <details><summary>{t("错误详情")}</summary><p>{failure.detail}</p></details>
      </article>)}
    </section>}
  </>;
  if(compact)return <Modal title={t("下载队列")} onClose={close} footer={<button onClick={close}>{t("关闭")}</button>}><div className="queue-compact">{content}</div></Modal>;
  return <aside id="download-queue-panel" className="download-queue-panel" role="region" aria-label={t("下载队列")}
    onKeyDown={event=>{if(event.key==="Escape"&&!event.defaultPrevented&&!document.querySelector("dialog[open]")){event.preventDefault();close();}}}>
    <header><h2>{t("下载队列")}</h2><button className="icon-button" aria-label={t("关闭下载队列")} onClick={close}><X size={17}/></button></header>
    <div className="download-queue-body">{content}</div>
  </aside>;
}
