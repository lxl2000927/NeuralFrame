import { t } from "../i18n";
import { diagnosticChecks, vramEstimateLevel } from "../diagnostics";
import type { StatusDiagnostics } from "../types";

function DiagnosticValue({ text }: { text: string }) {
  const last = text.slice(-1);
  return <b title={text}>{last === "。" || last === "）"
    ? <>{text.slice(0, -1)}<span className="diag-end-mark">{last}</span></>
    : text}</b>;
}

export function DiagnosticsPanel({ diagnostics }: { diagnostics: StatusDiagnostics }) {
  const d = diagnostics.coExecution || {};
  const conflicts = diagnostics.dllConflicts?.length || 0;
  const errors = diagnostics.errorLogs?.length || 0;
  const budget = d.vramBudget;
  const budgetLevel = vramEstimateLevel(budget);
  const combinedTone = diagnostics.combinedStatus === "verified" ? "ok"
    : ["experimental", "incompatible"].includes(diagnostics.combinedStatus || "") ? "warn" : "";
  const pct = Math.max(0, Math.min(100, Number(budget?.usagePercent) || 0));
  const rows: [string, string][] = [
    [t("游戏名称"), diagnostics.gameName || "—"],
    [t("生效硬件档位"), diagnostics.hardwareProfileLabel || diagnostics.hardwareProfile || "—"],
    [t("图形 API"), diagnostics.graphicsApi || "—"],
    [t("神经渲染状态"), diagnostics.neuralStatus || "—"],
    [t("MFG 状态"), diagnostics.mfgStatus || "—"],
    [t("无 DLSS / 低版本 / 破解兼容"), d.dlssCompat?.summary || "—"],
    [t("DLL 冲突"), conflicts ? t("{0} 项冲突", [String(conflicts)]) : t("无冲突（0 项冲突）")],
    [t("错误日志"), errors ? t("{0} 项异常", [String(errors)]) : t("无错误记录（0 项异常）")],
    [t("备份状态"), diagnostics.backupStatus || "—"],
  ];
  return (
    <section className="runtime-block">
      <div className="section-toolbar">
        <div>
          <h2>{t("兼容性与诊断")}</h2>
          <p className="muted">
            {t("以下为文件与配置检查及显存估算。实际加载状态请查看游戏的运行诊断。")}
          </p>
        </div>
        {diagnostics.combinedBadge && (
          <span className={`module-badge ${combinedTone}`}>
            {t(diagnostics.combinedStatus === "verified" ? "配置检查通过" : diagnostics.combinedBadge)}
          </span>
        )}
      </div>
      <div className="diag-table">
        {rows.map(([label, value]) => (
          <div className="diag-row" key={label}>
            <span>{label}</span>
            <DiagnosticValue text={t(value)} />
          </div>
        ))}
      </div>
      {!!(conflicts || errors) && <details className="diagnostic-evidence" open>
        <summary>{t("冲突与错误详情")}</summary>
        <ul>{(diagnostics.dllConflicts || []).map((c, i) => <li key={`conflict-${i}`}><strong>{c.code || t("DLL 冲突")}</strong> · {t(c.message || t("未知冲突"))}</li>)}
          {(diagnostics.errorLogs || []).map((text, i) => <li key={`error-${i}`}>{t(text)}</li>)}
        </ul>
      </details>}
      {budget && (
        <div className="vram-bar">
          <div className="vram-head">
            <span>
              {t("1080p 显存参考估算")}
              {budget.totalAddedOverheadMB != null
                ? ` · ${t("附加开销 +{0} MiB", [budget.totalAddedOverheadMB])}`
                : ""}
            </span>
            <DiagnosticValue text={budget.estimatedTotalMB == null ? t(budget.summary || "暂无显存估算") : budget.usagePercent == null || !budget.vramTotalMB
                ? t("参考占用 {0} MiB，未检测到显存容量", [budget.estimatedTotalMB ?? "—"])
                : t("参考占用 {0} / {1} MiB（{2}% · 预计余量 {3} MiB）", [
                budget.estimatedTotalMB ?? "—", budget.vramTotalMB,
                budget.usagePercent, budget.headroomMB ?? "—",
              ])} />
          </div>
          {!!budget.vramTotalMB && budget.usagePercent != null && <div className="vram-track" role="meter" aria-label={t("1080p 显存参考估算")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i style={{ width: `${pct}%` }} className={budgetLevel === "critical" ? "danger" : budgetLevel === "caution" ? "warn" : ""} />
          </div>}
          {budget.neuralOverheadMB != null && budget.mfgOverheadMB != null && (
            <small className="vram-breakdown">{t("神经渲染 +{0} MiB · 多帧生成 +{1} MiB", [budget.neuralOverheadMB, budget.mfgOverheadMB])}</small>
          )}
        </div>
      )}
      <div className="check-grid">
        {diagnosticChecks(diagnostics).map((check, index) => {
          const title = check.title;
          return (
            <div className="check-card" key={title}>
              <div className="check-head">
                <strong>
                  {index + 1}. {t(title)}
                </strong>
                <span className={`module-badge ${check.state === "pass" ? "ok" : check.state === "warn" ? "warn" : ""}`}>
                  {t(check.state === "pass" ? "配置检查通过" : check.state === "warn" ? "需注意" : check.state === "estimate" ? "参考估算" : check.state === "idle" ? "无需检查" : "尚未确认")}
                </span>
              </div>
              <small>{t(check.message)}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
