import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Download, FolderOpen } from "lucide-react";
import { Artwork, Loading } from "../components";
import { getBridge } from "../bridge";
import { useWindowReturn } from "../useWindowReturn";
import { errorText, size } from "../domain";
import { dateTime, t } from "../i18n";
import { useJobLog } from "../useJobLog";
import { DownloadContext, transferProgress } from "./DownloadAction";
import type { Game } from "../types";

type Message = (text: string) => void;
export function HomeShelf({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () => {
      const previous = element.scrollLeft > 1;
      const next = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges(old => old.previous === previous && old.next === next ? old : { previous, next });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); };
  }, [count]);
  const scroll = (direction: number) => {
    const element = row.current;
    const card = element?.firstElementChild;
    if (!element || !card) return;
    const step = card.getBoundingClientRect().width + parseFloat(getComputedStyle(element).columnGap);
    const pageSize = Math.max(1, Math.floor((element.clientWidth + 1) / step));
    const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches||document.documentElement.dataset.safeGraphics==="true";
    element.scrollBy({ left: direction * step * pageSize, behavior: reduced ? "instant" : "smooth" });
  };
  return <div className="home-shelf" role="group" aria-label={label} data-count={Math.min(count,4)}>
    <div className="home-games" ref={row}>{children}</div>
    <button className="shelf-previous" disabled={!edges.previous} aria-label={t("向前浏览游戏")} onClick={() => scroll(-1)}><ChevronLeft size={20} /></button>
    <button className="shelf-next" disabled={!edges.next} aria-label={t("向后浏览游戏")} onClick={() => scroll(1)}><ChevronRight size={20} /></button>
  </div>;
}

export function HomeIntake({
  games, active, refreshToken, loading, disabled, browse, drop, select, message,
}: {
  games: Game[]; active: boolean; refreshToken: number; loading: boolean; disabled: boolean;
  browse: () => void; drop: (dir: string) => Promise<void>; select: (dir: string) => void; message: Message;
}) {
  const [recent, setRecent] = useState<{ dir: string; at: number }[]>([]);
  const returnRevision = useWindowReturn(active, disabled);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!active) return;
    let current = true;
    getBridge().recents().then(rows => { if (current) setRecent(rows); })
      .catch(e => { if (current) message(errorText(e)); });
    return () => { current = false; };
  }, [active, refreshToken, message, returnRevision]);
  const byDir = new Map(games.map(game => [game.dir.toLowerCase(), game]));
  const matches = recent.flatMap(entry => {
    const game = byDir.get(entry.dir.toLowerCase());
    return game ? [{ game, at: entry.at }] : [];
  }).slice(0, 8);
  if(loading&&!games.length)return <div className="home-intake home-loading"><Loading text={t("正在读取游戏库…")} skeleton="rows"/></div>;
  const dropZone=<div
    className={`home-drop ${over ? "drag-over" : ""}`}
    onDragOver={e=>{
      if(e.dataTransfer.types.includes("Files")){e.preventDefault();e.dataTransfer.dropEffect=disabled?"none":"copy";setOver(!disabled);}
    }}
    onDragLeave={e=>{if(!(e.relatedTarget instanceof Node&&e.currentTarget.contains(e.relatedTarget)))setOver(false);}}
    onDrop={e=>{
      e.preventDefault();setOver(false);if(disabled||!e.dataTransfer.files.length)return;
      const dir=getBridge().pathForFile(e.dataTransfer.files[0]);
      if(dir)void drop(dir);else message(t("请选择游戏文件夹。"));
    }}>
    <FolderOpen size={22}/>
    <span className="home-drop-copy"><strong>{t(games.length?"添加游戏":"将游戏文件夹拖到这里")}</strong><small>{t(games.length?"也可以把游戏文件夹拖到这里":"选择已安装游戏的目录，只读取并添加。")}</small></span>
    <button className={games.length?"":"primary"} disabled={disabled} onClick={browse}>{t("添加游戏")}</button>
  </div>;
  if(!games.length)return <div className="home-intake home-intake-empty"><section className="home-empty">
    <h2>{t("从添加一款游戏开始")}</h2><p>{t("添加后即可检查神经渲染与帧生成路线。")}</p>{dropZone}
  </section></div>;
  return <div className="home-intake home-intake-compact">
    {matches.length>0&&<section className="home-recents"><h2>{t("最近配置的游戏")}</h2><div className="recent-list">
      {matches.map(({game,at})=><button key={game.key} onClick={()=>select(game.dir)}><Artwork game={game}/><span><strong>{game.name}</strong><small>{dateTime(at)}</small></span></button>)}
    </div></section>}
    {dropZone}
  </div>;
}

export function HomeDownloadSummary({onOpen}:{onOpen:()=>void}){
  const context=useContext(DownloadContext),row=context?.row,waiting=context?.queueItems.length||0,failure=context?.recentFailures[0];
  if(!row&&!waiting&&!failure)return null;
  const progress=row&&transferProgress(row);
  const name=row?(row.name&&row.name!==t("组件")?t(row.name):row.id):failure?.name||failure?.id||"";
  return <button className="home-download-summary" data-failed={!row&&!waiting&&!!failure} onClick={onOpen}>
    {failure&&!row?<AlertCircle size={18}/>:<Download size={18}/>}<span><strong>{row?progress?.label:waiting?t("下载等待中"):t("最近下载失败")} · {name}</strong>
      <small>{progress?(progress.percent!=null?`${Math.floor(progress.percent)}% · ${size(progress.loaded)} / ${size(progress.total)}`:t("{0} / 总量未知",[size(progress.loaded)])):waiting?t("等待 {0} 项",[waiting]):failure?.reason}</small></span>
    {waiting>0&&row&&<b>{t("等待 {0} 项",[waiting])}</b>}{progress&&<progress max={100} value={progress.percent} aria-label={t("首页下载进度")}/>}<ChevronRight size={17}/>
  </button>;
}

export function HomeActivity({ message }: { message: Message }) {
  const { lines, clear } = useJobLog();
  return <section className="home-activity"><div className="section-toolbar"><h2>{t("活动日志")}</h2><div className="inline-actions">
    <button disabled={!lines.length} onClick={()=>void getBridge().copyText(lines.join("\n")).then(ok=>message(t(ok?"已复制日志":"复制失败"))).catch(e=>message(errorText(e)))}>{t("复制日志")}</button>
    <button disabled={!lines.length} onClick={clear}>{t("清空日志")}</button>
  </div></div>{lines.length?<pre tabIndex={0}>{lines.join("\n")}</pre>:<p className="muted">{t("本次运行还没有操作记录。")}</p>}</section>;
}
