import {useEffect,useMemo,useRef,useState} from "react";
import {ChevronDown, Download, Search, X} from "lucide-react";
import {getBridge} from "../bridge";
import {t} from "../i18n";
import {errorText,gameRouteLabels} from "../domain";
import type {BatchScanProgress,BatchScanTask,CompatibilityReport,Game} from "../types";
import {Empty,Modal} from "../components";
import "./BatchScan.css";

type Row=CompatibilityReport["rows"][number];
type Status=Row["status"];
const statuses:Status[]=["supported","verify","unsupported","error"];
const taskLabel=(id:string)=>id.length>14?id.slice(0,8)+"…":id;
const statusLabel=(status:Status)=>t(status==="supported"?"可配置":status==="verify"?"需要确认":status==="unsupported"?"不支持":"扫描失败");

export function BatchScan({games,onClose,message}:{games:Game[];onClose:()=>void;message:(text:string)=>void}) {
  const [task,setTask]=useState<BatchScanTask|null>(null);
  const [starting,setStarting]=useState(true);
  const [error,setError]=useState("");
  const [exporting,setExporting]=useState(false);
  const [stopping,setStopping]=useState(false);
  const [generation,setGeneration]=useState(0);
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState<"all"|Status>("all");
  const [menuOpen,setMenuOpen]=useState(false);
  const searchInput=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const activeId=useRef<string|null>(null),pending=useRef<BatchScanProgress[]>([]),forceStart=useRef(false);
  // A scan describes the library as it was when the dialog opened. Background
  // artwork and individual scan results can replace the games array meanwhile.
  const [directories]=useState(()=>games.map(game=>game.dir));
  useEffect(()=>{
    // Each mount or rescan owns its own generation: a late response from a
    // replaced effect must never overwrite the task the dialog now shows.
    let alive=true;
    activeId.current=null;pending.current=[];
    const applyEvent=(event:BatchScanProgress)=>{
      if(event.status!=="running"){
        setTask(event.task);
        setStopping(false);
        return;
      }
      setTask(previous=>{
        if(!previous||previous.id!==event.taskId||previous.status!=="running")return previous;
        // A snapshot may already include rows whose events arrived while it was being fetched.
        if(event.row && event.index===previous.rows.length+1)
          return {...previous,currentGame:event.currentGame,rows:[...previous.rows,event.row]};
        if(!event.row && event.index===previous.rows.length)
          return {...previous,currentGame:event.currentGame};
        return previous;
      });
    };
    const adopt=(next:BatchScanTask)=>{
      if(!alive)return;
      activeId.current=next.id;setTask(next);setStarting(false);
      const buffered=pending.current.filter(event=>event.taskId===next.id);pending.current=[];
      for(const event of buffered)applyEvent(event);
    };
    const begin=async()=>{
      setStarting(true);setError("");setQuery("");setStatus("all");setTask(null);activeId.current=null;
      try{
        const result=await getBridge().gamesBatchScan(directories);
        if(!alive)return;
        if(!result.ok||!result.task)throw Error(result.message||t("扫描失败"));
        adopt(result.task);
      }catch(reason){if(alive)setError(errorText(reason));}
      finally{if(alive)setStarting(false);}
    };
    let unsubscribe=()=>{};
    try{unsubscribe=getBridge().onBatchScanProgress((event:BatchScanProgress)=>{if(!alive)return;if(!activeId.current){pending.current.push(event);return;}if(event.taskId===activeId.current)applyEvent(event);});}catch{}
    void (async()=>{
      try{
        const state=await getBridge().gamesBatchScanState();
        if(!alive)return;
        const existing=state.ok?(state.task??null):null;
        if(existing&&!forceStart.current)adopt(existing);
        else{forceStart.current=false;await begin();}
      }catch(reason){if(alive){setError(errorText(reason));setStarting(false);}}
    })();
    return()=>{alive=false;unsubscribe();};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[directories,generation]);
  useEffect(()=>{
    if(!menuOpen)return;
    const close=(event:PointerEvent)=>{
      if(trigger.current?.contains(event.target as Node)||menu.current?.contains(event.target as Node))return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown",close,true);
    return()=>document.removeEventListener("pointerdown",close,true);
  },[menuOpen]);
  useEffect(()=>{if(menuOpen)menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();},[menuOpen]);
  const rescan=()=>{forceStart.current=true;setMenuOpen(false);setGeneration(value=>value+1);};
  const stop=async()=>{
    if(!task||task.status!=="running")return;
    setStopping(true);
    try{const result=await getBridge().gamesBatchScanStop(task.id);if(!result.ok&&!result.stopping)throw Error(result.message||t("停止失败"));}
    catch(reason){setError(errorText(reason));setStopping(false);}
  };
  const exportingLabel=()=>exporting?t("正在导出…"):report&&report.complete===false?t("导出部分报告"):t("导出完整报告");
  const exportReport=async(format:"json"|"csv")=>{
    setMenuOpen(false);
    if(!report)return;
    setExporting(true);
    try{const result=await getBridge().gamesExportScan(report,format);if(!result.ok&&!result.cancelled)throw Error(result.message||t("导出失败"));if(result.ok)message(t("已导出"));}
    catch(reason){setError(errorText(reason));}
    finally{setExporting(false);trigger.current?.focus();}
  };
  const rows=task?.rows||[];
  const total=task?.total??directories.length;
  const report=task?.report??null;
  const running=starting||task?.status==="running";
  const stopped=task?.status==="stopped";
  const counts=useMemo(()=>{
    const next:{all:number}&Record<Status,number>={all:rows.length,supported:0,verify:0,unsupported:0,error:0};
    for(const row of rows)next[row.status]+=1;
    return next;
  },[rows]);
  const needle=query.trim().toLowerCase();
  const filtered=useMemo(()=>rows.filter(row=>{
    if(status!=="all"&&row.status!==status)return false;
    if(!needle)return true;
    const haystack=[row.name,row.exe,row.api,row.message,...row.routes.flatMap(id=>[id,t(gameRouteLabels[id]||id)])].join(" ").toLowerCase();
    return haystack.includes(needle);
  }),[rows,status,needle]);
  const filtering=status!=="all"||Boolean(needle);
  const showDriver=Boolean(rows.some(row=>row.driverHint));
  const closed=()=>{setMenuOpen(false);onClose();};
  const menuKeys=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    const items=[...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')||[])];
    const index=items.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==="Escape"){
      // Keep Escape from reaching the dialog: the menu closes first, the dialog stays.
      event.preventDefault();event.stopPropagation();setMenuOpen(false);trigger.current?.focus();return;
    }
    if(event.key==="Tab"){setMenuOpen(false);return;}
    let next=-1;
    if(event.key==="ArrowDown")next=index<items.length-1?index+1:0;
    else if(event.key==="ArrowUp")next=index>0?index-1:items.length-1;
    else if(event.key==="Home")next=0;
    else if(event.key==="End")next=items.length-1;
    else return;
    event.preventDefault();items[next]?.focus();
  };
  const triggerKeys=(event:React.KeyboardEvent<HTMLButtonElement>)=>{
    // Enter and Space already activate the button; only ArrowDown needs handling here.
    if(event.key==="ArrowDown"){event.preventDefault();setMenuOpen(true);}
  };
  const statusButtons=<div className="batch-status-filter" role="group" aria-label={t("按状态筛选")}>
    <button type="button" aria-pressed={status==="all"} onClick={()=>setStatus("all")}>{t("全部")} <b>{counts.all}</b></button>
    {statuses.map(value=><button key={value} type="button" data-status={value} aria-pressed={status===value} onClick={()=>setStatus(value)}>{statusLabel(value)} <b>{counts[value]}</b></button>)}
  </div>;
  const exportMenu=<>
    <button type="button" ref={trigger} className="batch-export-trigger" aria-haspopup="menu" aria-expanded={menuOpen}
      disabled={!report||exporting} onClick={()=>setMenuOpen(open=>!open)} onKeyDown={triggerKeys}>
      <Download size={15} aria-hidden="true"/>{exportingLabel()}<ChevronDown size={14} aria-hidden="true"/>
    </button>
    {menuOpen&&<div ref={menu} role="menu" className="batch-export-menu" aria-label={report?.complete===false?t("导出部分报告格式"):t("导出完整报告格式")} onKeyDown={menuKeys}>
      <button type="button" role="menuitem" aria-label={t("导出 JSON")} onClick={()=>void exportReport("json")}>
        <Download size={15} aria-hidden="true"/><span><strong>JSON</strong><small>{t("完整数据，便于复核")}</small></span>
      </button>
      <button type="button" role="menuitem" aria-label={t("导出 CSV")} onClick={()=>void exportReport("csv")}>
        <Download size={15} aria-hidden="true"/><span><strong>CSV</strong><small>{t("表格数据，便于用 Excel 打开")}</small></span>
      </button>
    </div>}
  </>;
  const summaryActions=<div className="batch-summary-actions">
    {task&&<span className="batch-task-id" title={task.id}>{t("任务 {0}",[taskLabel(task.id)])}</span>}
    <span className="batch-count" role="status" aria-live="polite">{t("显示 {0} / {1} 个游戏",[filtered.length,rows.length])}</span>
    <button type="button" onClick={rescan}>{t("重新扫描")}</button>
  </div>;
  const table=<div className="batch-table" role="group" aria-label={t("兼容性扫描结果")} tabIndex={0}>
    <table data-driver={showDriver}><thead><tr><th>{t("游戏")}</th><th>{t("状态")}</th><th>API</th><th>{t("原生能力")}</th><th>{t("可用路线")}</th>{showDriver&&<th>{t("驱动补帧")}</th>}</tr></thead>
      <tbody>{filtered.map((row,index)=><tr key={`${row.name}-${index}`}><td><strong>{row.name}</strong>{row.exe&&<small className="path">{row.exe}</small>}{(row.candidateCount||0)>1&&<small>{t("在 {0} 个候选程序中评估此程序",[row.candidateCount])}</small>}{row.message&&<small>{t(row.message)}</small>}</td>
        <td><span className="batch-status" data-status={row.status}>{statusLabel(row.status)}</span>{row.antiCheat&&<small>{t("检测到反作弊")}</small>}</td>
        <td>{row.api||"—"}{row.bitness&&<small>{row.bitness}-bit</small>}</td>
        <td>{[[row.nativeDlss,"DLSS"],[row.nativeFg,"FG"],[row.nativeDlssFg,"DLSS FG"]].filter(item=>item[0]).map(item=>item[1]).join(" · ")||(row.exe||row.bitness?t("未检测到"):"—")}</td>
        <td>{row.routes.length?row.routes.map(id=>t(gameRouteLabels[id]||id)).join(" / "):"—"}
          {row.recommendedRoute&&<small>{t("推荐路线 · {0}",[t(gameRouteLabels[row.recommendedRoute]||row.recommendedRoute)])}</small>}</td>
        {showDriver&&<td>{row.driverHint?<>{t("此显卡可在 AMD Software: Adrenalin Edition 中设置 AFMF 驱动补帧。")}
          {row.driverHint==="afmf-fullscreen"&&<small>{t("RX 6000 系列需要独占全屏。")}</small>}</>:"—"}</td>}</tr>)}</tbody></table>
  </div>;
  return <Modal title={t("批量兼容性扫描")} className="batch-modal" onClose={closed} footer={<><div className="batch-export">{exportMenu}</div><button onClick={closed}>{t("关闭报告")}</button></>}>
    <div className="batch-scan">
      <p className="muted batch-intro">{t("只读取游戏文件与兼容性信息，不修改游戏；报告不包含绝对路径。")}</p>
      {running&&<div className="batch-progress">
        <span className="batch-progress-copy" role="status" aria-live="polite">{starting&&!task?t("正在启动只读扫描…"):t("正在只读扫描 {0} / {1} 个游戏…",[rows.length,total])}</span>
        {task&&<progress className="batch-progress-bar" max={Math.max(total,1)} value={rows.length} aria-label={t("批量扫描进度")}/>}
        {task?.currentGame&&<span className="batch-progress-current">{t("正在读取：{0}",[task.currentGame])}</span>}
        {task&&<span className="batch-task-id" title={task.id}>{t("任务 {0}",[taskLabel(task.id)])}</span>}
        {task&&<button type="button" className="batch-stop" disabled={stopping} onClick={()=>void stop()}>{stopping?t("正在停止…"):t("停止扫描")}</button>}
      </div>}
      {(error||task?.status==="error")&&<div role="alert" className="scan-error batch-error"><span>{t(error||task?.message||"扫描失败")}</span><button type="button" onClick={rescan}>{t("重试")}</button></div>}
      {(report||rows.length>0)&&<>
        {report&&<div className="batch-summary">
          <div className="batch-summary-copy">
            {task?.status==="error"?
              <><strong>{t("扫描失败：{0} / {1} 个游戏",[rows.length,total])}</strong><span>{t("已完成的部分报告已保留，可导出。")}</span></>:
              report.complete===false?
              <><strong>{t("扫描已停止：{0} / {1} 个游戏",[rows.length,total])}</strong><span>{t("部分报告已保留，可导出。")}</span></>:
              <><strong>{t("扫描完成：{0} 个游戏",[rows.length])}</strong>
                <span>{t("可配置 {0} · 需要确认 {1} · 未支持或失败 {2}",[counts.supported,counts.verify,counts.unsupported+counts.error])}</span></>}
          </div>
          {summaryActions}
        </div>}
        {rows.length>0&&<div className="batch-toolbar">
          <div className="batch-query">
            <div className="search-box batch-search">
              <label className="search-field"><Search size={15} aria-hidden="true"/>
                <input ref={searchInput} aria-label={t("搜索游戏、程序或路线")} placeholder={t("搜索游戏、程序或路线…")}
                  value={query} onChange={event=>setQuery(event.target.value)}
                  onKeyDown={event=>{if(event.key==="Escape"&&(needle||filtering)){event.preventDefault();event.stopPropagation();setQuery("");setStatus("all");}}}/>
              </label>
              {query&&<button type="button" className="search-clear" aria-label={t("清除搜索")} title={t("清除搜索")}
                onClick={()=>{setQuery("");searchInput.current?.focus();}}><X size={14} aria-hidden="true"/></button>}
            </div>
            {statusButtons}
          </div>
        </div>}
        {rows.length===0?(stopped?<Empty><strong>{t("扫描已停止，未读取任何游戏")}</strong><p>{t("可以重新扫描，或先确认游戏库仍然可用。")}</p></Empty>
          :<Empty><strong>{t("没有可扫描的游戏")}</strong><p>{t("先添加游戏，再运行批量扫描。")}</p></Empty>)
          :filtered.length===0?<Empty><strong>{t("没有匹配的游戏")}</strong><p>{t("调整搜索或筛选条件后重试。")}</p>
            <button type="button" onClick={()=>{setQuery("");setStatus("all");searchInput.current?.focus();}}>{t("清除搜索和筛选")}</button></Empty>
          :table}
      </>}
      {!report&&!running&&!(error||task?.status==="error")&&<Empty><strong>{t("没有可扫描的游戏")}</strong><p>{t("先添加游戏，再运行批量扫描。")}</p></Empty>}
    </div>
  </Modal>;
}
