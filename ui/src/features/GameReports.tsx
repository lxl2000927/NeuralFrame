import { ChevronRight, Copy, FileUp } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import { Empty } from "../components";
import { getBridge } from "../bridge";
import { diagnosticChecks, vramEstimateLevel } from "../diagnostics";
import { errorText } from "../domain";
import type { Model, StatusDiagnostics } from "../types";

type Message = (text: string) => void;

// Display metadata from the 2.3.0 portable catalog. File identity stays with the inspected model.
const catalogTitles: Record<string, { name: string; version?: string; date?: string }> = {
  "310.8.SF-v2": { name: "DLSS 5 NR 310.8.SF-v2 (全架构满血画质模型 · Ada/Blackwell/Ampere/Turing)" },
  "310.9.16-oct2026": {
    name: "DLSS 5 NR 310.9.16 (2026-10 极速模型管线 · 118M 2× 提速架构)",
    version: "310.9.16.0",
    date: "2026-10-16",
  },
};

function ModelRow({ model, catalogId, profileSm, message, profileView }: {
  model: Model; catalogId: string; profileSm?: string; message: Message; profileView: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const local = model.availableOnDisk;
  const entry = catalogTitles[catalogId];
  const name = entry ? t(entry.name) : model.name || catalogId;
  const alias = catalogId !== model.id;
  const version = entry?.version || model.version || "—";
  const date = entry?.date || model.catalogDate;
  const state = local ? "本地可用" : model.downloadable ? "可按需下载" : model.sha256 ? "需手动导入" : "仅目录记录";
  const arch = model.architectures || [];
  const smMatch = profileSm && arch.length ? arch.includes(profileSm) : null;
  const matchLabel = smMatch == null ? "待确认架构" : !smMatch ? "架构不匹配" : local ? "架构匹配" : "目录架构匹配";
  const copyHash = async () => {
    if (!model.sha256) return;
    try {
      const copied = await getBridge().copyText(model.sha256);
      message(t(copied ? "指纹已复制" : "复制失败"));
    } catch (error) {
      message(errorText(error));
    }
  };
  return (
    <tr className="model-entry" data-compact={!expanded || undefined}>
      <th scope="row">
        <button type="button" className="model-row-toggle" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
          <span>
            <strong>{name}</strong>
            <small>{catalogId}{!profileView && !expanded && <span className="model-summary-state"> · {t(state)}</span>}</small>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {expanded && <>
          {alias
            ? <small>{t("{0} 是 {1} 的目录别名，模型文件版本为 {2}。", [catalogId, model.id, model.version || "—"])}</small>
            : model.catalogAliases?.map(id => <small key={id}>{t("原版目录别名：{0}", [id])}</small>)}
          <small>{t("文件来源")} · {t(!local && model.downloadable ? "在线配套组件" : model.sourceType || "未记录")}</small>
          {model.description && <small>{t(model.description)}</small>}
        </>}
      </th>
      <td data-label={t("版本与收录日期")}>
        <span className="model-version">{version} {date && <time dateTime={date}>({date})</time>}</span>
        {expanded && <>
          {model.importedAt && <small>{t("导入于 {0}", [model.importedAt.slice(0, 10)])}</small>}
          {!!model.size && <small>{t(local ? "本地文件大小" : "目录文件大小")} · {(model.size / 1048576).toFixed(1)} MiB</small>}
        </>}
      </td>
      <td data-label={t("CUDA 架构")}>
        {expanded ? <>
          <span className="model-architectures">{arch.length ? arch.map(sm =>
            <span key={sm}>sm_{sm}{model.smCounts?.[sm] != null && <small>{t("{0} 个内核", [model.smCounts[sm]])}</small>}</span>
          ) : "—"}</span>
          {arch.length === 1 && arch[0] === "120" && <small>{t("仅 Blackwell 架构")}</small>}
        </> : arch.join(", ") || "—"}
      </td>
      <td data-label={t("文件状态与兼容性")}>
        {profileView && <span className="model-chip" data-tone={smMatch === false ? "mismatch" : smMatch && local ? "match" : undefined}>{t(matchLabel)}</span>}
        {(!profileView || expanded) && <strong className={`model-file-state${local ? " available" : ""}`}>{t(state)}</strong>}
        {expanded && <>
          {smMatch != null && <small>{t(smMatch ? "含档位架构 sm_{0}" : "不含档位架构 sm_{0}", [profileSm])}</small>}
          {local && model.compatBadge && <small>{t(model.compatBadge)}</small>}
          {model.compatReason && <small>{t(model.compatReason)}</small>}
        </>}
      </td>
      <td data-label={t("SHA-256 指纹")}>
        {!expanded ? <code>{model.sha256 ? model.sha256.slice(0, 12) + "…" : "—"}</code> : model.sha256 ? <>
          <button className="model-hash-copy" aria-label={t("复制 {0} 的完整 SHA-256", [catalogId])} onClick={() => void copyHash()}>
            <Copy size={14} aria-hidden="true" />{t(local ? "本地文件 SHA-256" : "目录 SHA-256")}
          </button>
          <code className="model-hash">{model.sha256}</code>
        </> : <small>{t("目录未提供指纹。导入 DLL 后，将按实际文件识别。")}</small>}
      </td>
    </tr>
  );
}

export function ModelTable({ models, profileSm, profileName, message, onImport, busy, profileView = false }: {
  models: Model[]; profileSm?: string; profileName?: string; message: Message; onImport: () => void; busy: boolean; profileView?: boolean;
}) {
  const localCount = models.filter(model => model.availableOnDisk).length;
  const modelIds = new Set(models.map(model => model.id));
  const rows = models.flatMap(model => [model.id, ...(model.catalogAliases || []).filter(id => catalogTitles[id] && !modelIds.has(id))]
    .map(id => ({ id, model })));
  const count = models.length > 0 && <p className="model-count">{rows.length === models.length
    ? t("本地可用 {0} / {1}", [localCount, models.length])
    : t("{0} 个目录条目 · 本地可用文件 {1} / {2}", [rows.length, localCount, models.length])}</p>;
  const importButton = <button disabled={busy} onClick={onImport}><FileUp size={16} />{t("导入模型文件…")}</button>;
  const importNote = models.some(model => !model.availableOnDisk && !model.downloadable) &&
    <p className="model-availability-note">{t("缺少文件的历史版本可手动导入对应的 nvngx_dlssnr.dll。")}</p>;
  return (
    <section className="model-block">
      <div className="section-toolbar">
        <div>
          <h2>{t(profileView ? "DLSS 5 神经渲染模型版本数据库 (Model & CUDA Fatbin Database)" : "DLSS 5 神经渲染模型版本数据库")}</h2>
          {profileView ? <p className="model-intro">{t("按当前档位的 CUDA SM 架构比对模型。导入 DLL 后可核验文件指纹与所含内核。")}</p> : count}
        </div>
        {profileView ? <span className="model-chip" data-tone="match">{t("全档位哈希与 SM 校验已启用")}</span> : importButton}
      </div>
      {!profileView && importNote}
      {models.length ? <div className="model-table-wrap">
        <table className="model-table">
          <thead><tr>
            <th scope="col">{t("模型名称 / ID")}</th>
            <th scope="col">{t("版本与收录日期")}</th>
            <th scope="col">{t(profileView ? "包含 CUDA SM 架构" : "CUDA 架构")}</th>
            <th scope="col">{profileView ? t("当前档位兼容性") : t("文件状态与兼容性")}{profileView && profileName && <small>{profileName}</small>}</th>
            <th scope="col">{t("SHA-256 指纹")}</th>
          </tr></thead>
          <tbody>{rows.map(({ id, model }) => <ModelRow key={id} catalogId={id} model={model} profileSm={profileSm} message={message} profileView={profileView} />)}</tbody>
        </table>
      </div> : <Empty>{t("没有可用的神经渲染模型。")}</Empty>}
      {profileView && <div className="model-import-bar">{count}{importNote}{importButton}</div>}
    </section>
  );
}
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
            <DiagnosticValue text={budget.usagePercent == null || !budget.vramTotalMB
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
