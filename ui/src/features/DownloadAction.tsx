import { createContext, useContext } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { t } from "../i18n";
import { size } from "../domain";
import "./DownloadAction.css";

export type DownloadKind = "library" | "runtime";
type RowTransfer = {
  kind: DownloadKind; id: string; stage: string; loaded: number; total: number; speed: number;
  cancelling: boolean; cancel: () => void;
};
export const DownloadContext = createContext<{
  row: RowTransfer | null;
  downloadRuntime: (id: string, cached: boolean) => Promise<boolean>;
} | null>(null);

export function DownloadAction({ id, kind = "library", cached = false, label = "下载入库", bytes,
  disabled, onStart, upgrade, className }: {
  id: string; kind?: DownloadKind; cached?: boolean; label?: string; bytes?: number;
  disabled?: boolean; onStart?: () => void; upgrade?: [string, string]; className?: string;
}) {
  const context = useContext(DownloadContext);
  const row = context?.row;
  if (row && row.id === id && row.kind === kind) {
    const downloading = row.stage === "download" && row.total > 0;
    const percent = downloading ? Math.min(100, Math.max(0, row.loaded / row.total * 100)) : undefined;
    const status = row.stage === "verify" || row.stage === "checking" ? t("校验中")
      : row.stage === "ready" ? t("已就绪") : row.stage === "download" ? t("下载中") : t("准备中");
    return <div className="download-active">
      <span>{percent != null ? `${percent.toFixed(0)}%${row.speed ? " · " + size(row.speed) + "/s" : ""}` : status}</span>
      <button type="button" className={className} disabled={row.cancelling || (row.stage === "queued" && row.kind !== "library") || ["checking", "ready"].includes(row.stage)}
        onClick={row.cancel}>{t(row.cancelling ? "正在取消…" : "取消")}</button>
      <progress max={100} value={percent} aria-label={t("下载进度")} />
    </div>;
  }
  const caption = cached ? t("校验缓存") : upgrade ? t("更新 {0} → {1}", upgrade)
    : [t(label), bytes && size(bytes)].filter(Boolean).join(" ");
  return <button type="button" className={className} disabled={disabled}
    onClick={onStart || (() => void context?.downloadRuntime(id, cached))}>
    {cached ? <ShieldCheck size={14} /> : <Download size={14} />}{caption}
  </button>;
}
