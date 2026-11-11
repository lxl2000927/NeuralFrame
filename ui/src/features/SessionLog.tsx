import { useEffect, useId, useState } from "react";
import { Check, ChevronRight, Copy, Eraser, ScrollText } from "lucide-react";
import { getBridge } from "../bridge";
import { errorText } from "../domain";
import { t } from "../i18n";
import { JOB_LOG_LIMIT, type JobRow } from "../useJobLog";
import "./SessionLog.css";

const fieldLabels: Record<string, string> = {
  rel: "相对路径", file: "文件", name: "名称", version: "版本", kind: "类型",
  from: "变更前", to: "变更后", ours: "配套版本", error: "错误信息", message: "消息",
  date: "备份日期", route: "渲染路线", game: "游戏", replaced: "备份中的替换项", added: "备份中的新增项",
  content: "内容",
};
const fileActions = new Set(["restored", "deleted", "added", "replaced"]);
const warnings = new Set(["historySaveWarning", "driverNeuralFault", "oldShaderCompiler", "overlaySkipped",
  "restoreProfileWarning", "motionProviderFallback", "reshadeNoAddonSupport", "reshadeSetupMissing"]);

function fieldText(value: unknown): string {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function fieldsOf(value: unknown): [string, string][] {
  if (value == null) return [];
  if (typeof value !== "object" || Array.isArray(value)) return [["content", fieldText(value)]];
  return Object.entries(value).map(([key, field]) => [key, fieldText(field)]);
}

function fieldLabel(key: string) {
  return Object.hasOwn(fieldLabels, key) ? t(fieldLabels[key]) : key;
}

function LogItem({ row }: { row: JobRow }) {
  const { value, code, title } = row;
  const data: Record<string, unknown> = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const path = data.rel ?? data.file ?? data.name;
  const filename = typeof path === "string" ? path.split(/[\\/]/).filter(Boolean).pop() : "";
  const isFile = fileActions.has(code) && !!filename;
  const complete = code === "applyDone" || code === "restoreDone";
  const warning = warnings.has(code) || !!data.error;
  const fields = fieldsOf(value);
  const badge = isFile ? title : t(complete ? "完成" : warning ? "注意" : "记录");
  const version = data.version ?? (code === "replaced" ? data.to : null);
  const detail = typeof value === "string" ? value : data.error ?? data.message;
  const body = (
    <>
      <time className="session-log-time">{row.clock}</time>
      <span className="session-log-action" data-tone={isFile ? code : warning ? "warning" : complete ? "done" : undefined}>{badge}</span>
      <span className="session-log-subject">
        <span className={isFile ? "session-log-file" : undefined}>{isFile ? filename : title}</span>
        {!isFile && filename && <span className="session-log-file">{filename}</span>}
        {version != null && <span className="session-log-version">{code === "replaced" && data.from != null ? `${data.from} → ` : ""}{String(version)}</span>}
        {!isFile && typeof detail === "string" && <span className="session-log-message">{detail}</span>}
      </span>
      {fields.length > 0 && <ChevronRight size={14} aria-hidden="true" className="session-log-chevron" />}
    </>
  );
  return <li>{fields.length ? (
    <details className="session-log-record">
      <summary className="session-log-row">{body}</summary>
      <dl className="session-log-fields">{fields.map(([key, text]) =>
        <div key={key}><dt>{fieldLabel(key)}</dt><dd>{key === "kind" && text === "runtime" ? t("运行库") : text}</dd></div>
      )}</dl>
    </details>
  ) : <div className="session-log-row">{body}</div>}</li>;
}

export function SessionLog({ rows, clear }: { rows: JobRow[]; clear: () => void }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; detail?: string } | null>(null);
  const id = useId();
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  async function copy() {
    const text = rows.map(row => {
      const fields = fieldsOf(row.value).map(([key, value]) => `${fieldLabel(key)}: ${value}`);
      return [`[${row.clock}] ${row.title}`, ...fields].join(" · ");
    }).join("\n");
    try {
      setFeedback({ ok: await getBridge().copyText(text) });
    } catch (error) {
      setFeedback({ ok: false, detail: errorText(error) });
    }
  }
  return (
    <section className="session-log" aria-label={t("本次操作日志")}>
      <div className="session-log-toolbar">
        <button type="button" className="session-log-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <ScrollText size={17} aria-hidden="true" />
          <strong>{t("本次操作日志")}</strong>
          <span className="session-log-count" title={t("最多保留 {0} 条记录", [JOB_LOG_LIMIT])}>{rows.length} / {JOB_LOG_LIMIT}</span>
          <ChevronRight size={14} aria-hidden="true" className="session-log-chevron" />
        </button>
        <div className="session-log-tools">
          <button type="button" aria-label={t("复制日志")} title={feedback?.detail} data-copied={feedback?.ok}
            disabled={!rows.length} onClick={copy}>
            {feedback?.ok ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            <span role="status">{t(feedback ? feedback.ok ? "日志已复制" : "复制失败" : "复制日志")}</span>
          </button>
          <button type="button" disabled={!rows.length} onClick={() => { clear(); setFeedback(null); }}>
            <Eraser size={14} aria-hidden="true" />{t("清空显示")}
          </button>
        </div>
      </div>
      <div id={id} hidden={!open}>
        {open && (rows.length ? <div className="session-log-scroll" tabIndex={0} role="region" aria-label={t("日志记录，最新在前")}>
          <div className="session-log-columns" aria-hidden="true"><span>{t("时间")} ↓</span><span>{t("操作")}</span><span>{t("内容")}</span></div>
          <ul>{rows.slice().reverse().map(row => <LogItem key={row.id} row={row} />)}</ul>
        </div> : <p className="session-log-empty">{t("暂无操作记录。")}</p>)}
      </div>
    </section>
  );
}
