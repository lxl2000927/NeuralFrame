import { ChevronRight, Copy, Download, FileUp } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import { Empty } from "../components";
import { DownloadAction } from "./DownloadAction";
import { getBridge } from "../bridge";
import { diagnosticChecks, vramEstimateLevel } from "../diagnostics";
import { errorText, modelArchitectureLimit } from "../domain";
import type { Model, StatusDiagnostics } from "../types";

type Message = (text: string) => void;

type ModelActions = {onImport: (expectedModelId: string) => void; onChoose?: (id: string) => void; onBrowseModels: () => void; onDownload: (id: string) => void; busy: boolean};

function ModelRow({ model, profileSm, gpuSm, message, profileView, onChoose, onImport, onBrowseModels, onDownload, busy }: ModelActions & {
  model: Model; profileSm?: string; gpuSm?: string | null; message: Message; profileView: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const local = model.availableOnDisk;
  const downloadId = model.downloadId;
  const name = model.name || model.id;
  const version = model.version || "—";
  const date = model.catalogDate;
  const limit = modelArchitectureLimit(model, gpuSm, profileSm);
  const arch = model.architectures || [];
  const smMatch = profileSm && arch.length ? arch.includes(String(profileSm)) : null;
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
            <small>{model.id}</small>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {expanded && <>
          {model.upstreamRepo && <small>{t("上游仓库")} · {model.upstreamRepo}</small>}
          {(local || !model.upstreamRepo) && <small>{t("文件来源")} · {t(!local && model.downloadable && !model.downloadId ? "在线配套组件" : model.sourceType || "未记录")}</small>}
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
      <td data-label={t("当前档位兼容性")}>
        {profileView && <span className="model-chip" data-tone={smMatch === false ? "mismatch" : smMatch && local ? "match" : undefined}>{t(matchLabel)}</span>}
        {!profileView && <strong>{t(matchLabel)}</strong>}
        {expanded && <>
          {smMatch != null && <small>{t(smMatch ? "含档位架构 sm_{0}" : "不含档位架构 sm_{0}", [profileSm])}</small>}
          {local && model.compatBadge && <small>{t(model.compatBadge)}</small>}
          {model.compatReason && <small>{t(model.compatReason)}</small>}
        </>}
      </td>
      <td className="model-acquisition" data-label={t("模型文件")}>
        {local || !model.sha256 ? <strong className={`model-file-state${local && !limit ? " available" : ""}`}>{t(local ? (limit ? "已入库" : "本地可用") : "仅目录记录")}</strong>
          : downloadId ? <DownloadAction className="model-file-action" id={downloadId} bytes={model.downloadSize}
            disabled={busy} onStart={() => onDownload(downloadId)} />
          : <button className="model-file-action" disabled={busy} onClick={() => model.downloadable ? onBrowseModels() : onImport(model.id)}>
            {model.downloadable ? <Download size={14} /> : <FileUp size={14} />}
            {t(model.downloadable ? "获取在线模型" : "在组件库导入")}
          </button>}
        {local && !limit && smMatch !== false && onChoose && <button className="model-file-action" disabled={busy}
          onClick={() => onChoose(model.id)}>{t("使用此模型")}</button>}
        {limit && <small>{t(limit)}</small>}
        {(!limit || expanded) && !local && !model.downloadable && <small>{t(model.sha256 ? "暂无已核实的下载源" : "目录未提供文件指纹")}</small>}
        {!expanded ? model.sha256 && <code>{model.sha256.slice(0, 12)}…</code> : model.sha256 ? <>
          <button className="model-hash-copy" aria-label={t("复制 {0} 的完整 SHA-256", [model.id])} onClick={() => void copyHash()}>
            <Copy size={14} aria-hidden="true" />{t(local ? "本地文件 SHA-256" : "目录 SHA-256")}
          </button>
          <code className="model-hash">{model.sha256}</code>
        </> : <small>{t("目录未提供指纹。导入 DLL 后，将按实际文件识别。")}</small>}
      </td>
    </tr>
  );
}

export function ModelTable({ models, profileSm, gpuSm, profileName, message, onChoose, onImport, onBrowseModels, onDownload, busy, profileView = false }: ModelActions & {
  models: Model[]; profileSm?: string; gpuSm?: string | null; profileName?: string; message: Message; profileView?: boolean;
}) {
  const localCount = models.filter(model => model.availableOnDisk).length;
  const count = models.length > 0 && <p className="model-count">{t("模型目录 {0} 项 · 本地已有 {1} 项", [models.length, localCount])}</p>;
  return (
    <section className="model-block">
      <div className="section-toolbar">
        <div>
          <h2>{t(profileView ? "DLSS 5 神经渲染模型版本数据库 (Model & CUDA Fatbin Database)" : "DLSS 5 神经渲染模型版本数据库")}</h2>
          {count}
        </div>
        {profileView && <span className="model-chip" data-tone="match">{t("全档位哈希与 SM 校验已启用")}</span>}
      </div>
      <div className="model-acquisition-bar">
        <div className="inline-actions">
          <button disabled={busy} onClick={onBrowseModels}><Download size={16} />{t("获取在线模型")}</button>
        </div>
        <p>{t("已有模型文件可在组件库中导入。")}</p>
      </div>
      {models.length ? <div className="model-table-wrap">
        <table className="model-table">
          <thead><tr>
            <th scope="col">{t("模型名称 / ID")}</th>
            <th scope="col">{t("版本与收录日期")}</th>
            <th scope="col">{t(profileView ? "包含 CUDA SM 架构" : "CUDA 架构")}</th>
            <th scope="col">{t("当前档位兼容性")}{profileView && profileName && <small>{profileName}</small>}</th>
            <th scope="col">{t("模型文件 / SHA-256")}</th>
          </tr></thead>
          <tbody>{models.map(model => <ModelRow key={model.id} model={model} profileSm={profileSm} gpuSm={gpuSm} message={message} profileView={profileView} onChoose={onChoose} onImport={onImport} onBrowseModels={onBrowseModels} onDownload={onDownload} busy={busy} />)}</tbody>
        </table>
      </div> : <Empty>{t("没有可用的神经渲染模型。")}</Empty>}
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
