import { createContext, useContext } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { t } from "../i18n";
import { size } from "../domain";
import "./DownloadAction.css";

export type DownloadKind = "library" | "runtime";
export type QueueItem = {key:string;kind:DownloadKind;id:string;cached:boolean};
export type RowTransfer = {
  kind: DownloadKind; id: string; name?:string; stage: string; loaded: number; total: number; speed: number;
  source?: string; sourceReason?:string; connections?:number; index?: number; count?: number; overallLoaded?: number; overallTotal?: number;
  cancelling: boolean; cancel: () => void; discard:()=>void;
};
export function transferProgress(row: RowTransfer) {
  const multi = (row.count || 0) > 1 && !!row.overallTotal;
  const total = multi ? row.overallTotal || 0 : row.total;
  const loaded = multi ? row.overallLoaded || 0 : row.loaded;
  const percent = row.stage === "ready" ? 100 : row.stage === "download" && total > 0
    ? Math.max(0,Math.min(100,loaded / total * 100)) : undefined;
  const label = t(row.stage === "verify" || row.stage === "checking" ? "校验中" :
    row.stage === "download" ? "下载中" : row.stage === "ready" ? "已就绪" :
    // An active library request is already being prepared even though its first
    // progress event has not arrived; the queue panel shows the real waiting rows.
    row.stage === "queued" ? (row.kind === "library" ? "准备中" : "等待中") : "准备中");
  return {total,loaded,percent,label,multi};
}

export type QueueFailure = {attempt:number;key:string;kind:DownloadKind;id:string;name:string;reason:string;detail:string;at:number};
export const DownloadContext = createContext<{
  row: RowTransfer | null;
  queueItems:QueueItem[];
  completed:number;
  recentFailures:QueueFailure[];
  removeQueued:(key:string)=>void;
  clearFailure:(attempt:number)=>void;
  downloadRuntime: (id: string, cached: boolean) => Promise<boolean>;
} | null>(null);

export function DownloadAction({ id, kind = "library", cached = false, label = "下载入库", bytes,
  disabled, blocked = false, onStart, upgrade, className }: {
  id: string; kind?: DownloadKind; cached?: boolean; label?: string; bytes?: number;
  disabled?: boolean; blocked?: boolean; onStart?: () => void; upgrade?: [string, string]; className?: string;
}) {
  const context = useContext(DownloadContext);
  const row = context?.row;
  if (row && row.id === id && row.kind === kind) {
    const {percent,label:status,multi:aggregate} = transferProgress(row);
    return <div className="download-active">
      <span title={row.sourceReason}>{percent != null ? `${aggregate ? t("总进度") + " " : ""}${percent.toFixed(0)}%${row.speed ? " · " + size(row.speed) + "/s" : ""}${row.connections ? " · " + t("{0} 连接",[row.connections]) : ""}${row.source ? " · " + row.source : ""}` : status}</span>
      <button type="button" className={className} disabled={row.cancelling || (row.stage === "queued" && row.kind !== "library") || ["checking", "ready"].includes(row.stage)}
        onClick={row.cancel}>{t(row.cancelling ? (row.stage === "download" ? "正在暂停…" : "正在取消…") : (row.stage === "download" ? "暂停" : "取消"))}</button>
      {row.stage === "download" && <button type="button" className="danger" disabled={row.cancelling} title={t("取消并清理")} aria-label={t("取消并清理")} onClick={row.discard}>×</button>}
      <progress max={100} value={percent} aria-label={t("下载进度")} />
    </div>;
  }
  const caption = cached ? t("校验缓存") : upgrade ? t("更新 {0} → {1}", upgrade)
    : [t(label), bytes && size(bytes)].filter(Boolean).join(" ");
  const queueKey = `${kind}:${id}`;
  if (context?.queueItems.some(item => item.key === queueKey))
    return <button type="button" className={className} disabled>{t("已加入下载队列")}</button>;
  const canQueue = !!row && row.kind === kind && !blocked;
  return <button type="button" className={className} disabled={blocked || (disabled && !canQueue)}
    onClick={onStart || (() => void context?.downloadRuntime(id, cached))}>
    {cached ? <ShieldCheck size={14} /> : <Download size={14} />}{canQueue ? t("加入下载队列") : caption}
  </button>;
}
