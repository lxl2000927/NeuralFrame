import { Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import { getBridge } from "../bridge";
import { Select } from "../components";
import { defaultStack, errorText, neuralChoice, profiles } from "../domain";
import { dateTime, t } from "../i18n";
import type { Draft, Runtime, RuntimeStack, Status } from "../types";
import { profileCardCopy, modelOptions as originalModels, stackOptions as originalStacks, inputOptions as originalInputs } from "./profileCardCopy";
import "./GraphicsPanels.css";

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="module-facts">{rows.filter(([, value]) => value !== undefined).map(([label, value]) =>
    <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>
  )}</dl>;
}

function stackVersions(stack: RuntimeStack) {
  return `DLSS SR ${stack.dlssVersion} / Streamline ${stack.streamlineVersion} / Feeder ${stack.feederVersion}`;
}

function MultiplierReading({ dir }: { dir: string }) {
  const [reading, setReading] = useState<Runtime>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function inspect() {
    setBusy(true);
    setError("");
    try {
      const result = await getBridge().componentRuntime(dir);
      if (!result.ok) throw Error(result.message || t("检测失败"));
      setReading(result);
    } catch (e) { setReading(undefined); setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const sample = reading?.mfg;
  const fpsRatio = sample?.state === "active" && sample.sourceFps && sample.sourceFps > 0 &&
    sample.reportedOutputFps && sample.reportedOutputFps > 0 ? sample.reportedOutputFps / sample.sourceFps : null;
  return <div className="multiplier-reading">
    <span aria-live="polite">{error || (sample ? t(sample.label) : t("等待本次运行采样"))}</span>
    {fpsRatio != null && <small>{t("插件输出 / 基础帧率 ≈ {0}×", [fpsRatio.toFixed(2)])}</small>}
    {reading && <small>{dateTime(reading.checkedAt)}
      {sample?.state === "active" && sample.appliedMultiplier ? " · " + t("已应用请求 {0}×", [sample.appliedMultiplier]) : ""}
    </small>}
    <button type="button" disabled={busy} onClick={() => void inspect()}>{t(busy ? "正在检测…" : "检测倍率")}</button>
  </div>;
}

type ModeOption = [string, string, string];

function Modes({ label, value, options, onChange }: {
  label: string; value: string; options: ModeOption[];
  onChange: (value: string) => void;
}) {
  return <div className="module-modes" role="radiogroup" aria-label={t(label)} onKeyDown={e => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) return;
      const current = buttons.indexOf(e.target as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 :
        (current + (["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click(); buttons[next].focus();
    }}>
      {options.map(([id, title, hint]) => <button key={id} type="button" role="radio"
        aria-checked={id === value} tabIndex={id === value ? 0 : -1} onClick={() => onChange(id)}>
        <strong>{title}</strong><small>{t(hint)}</small>
      </button>)}
  </div>;
}

export function GraphicsPanels({ status, exePath, draft, onChange, onApply, onImport, profileNotes, gameDir, showGameDetails = false }: {
  status: Status; exePath?: string; draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onApply: (scope: "neural" | "mfg") => void;
  onImport: () => void;
  profileNotes?: { neural: string; mfg: string };
  gameDir: string;
  showGameDetails?: boolean;
}) {
  const nr = status.neural, mfg = status.mfg;
  const copy = profileCardCopy[draft.hardwareProfile];
  const desktop40 = draft.hardwareProfile === "rtx40_desktop";
  const blackwell = draft.hardwareProfile === "rtx50_desktop";
  const profile = t(copy?.label || profiles.find(([id]) => id === status.hardwareProfile)?.[1] || "未识别");
  const models = nr?.availableModels || [];
  const otherModels = models.map(m => [m.id, [m.name || m.id, m.architectures?.map(sm => "sm_" + sm).join("/"),
    t(m.availableOnDisk ? "本地可用" : m.downloadable ? "按需下载" : "需手动导入")].filter(Boolean).join(" · ")]);
  const modelOptions = copy
    ? [...originalModels, ...otherModels.filter(([id]) => !originalModels.some(([known]) => id === known))]
    : otherModels;
  if (!modelOptions.some(([id]) => id === "310.8.SF-v2"))
    modelOptions.unshift(["310.8.SF-v2", t("310.8.SF-v2 · 按需下载")]);
  const stacks = nr?.runtimeStacks || [];
  const stackOptions = copy ? originalStacks : stacks.length ? stacks.map(stack => [
    stack.id, [t(stack.id === "baseline-310.9.1" ? "基准组合" : "可选组合"), stackVersions(stack), stack.id === defaultStack(draft.hardwareProfile) ? t("档位默认") : ""].filter(Boolean).join(" · "),
  ]) : [["baseline-310.9.1", t("基准组合 · SR 310.9.1 / SL 2.13")], ["oct2026-310.9.16", t("更新组合 · SR 310.9.16 / SL 2.14")]];
  const savedStack = stacks.find(stack => stack.id === (status.configuredRuntimeStack || nr?.configuredRuntimeStack));
  const model = nr?.currentModel;
  const recommended = nr?.latestCompatibleModel;
  const gpu = status.hardware?.gpu;
  const gpuCheck = model && nr?.dependencies?.hasNeuralDll !== false ? nr.gpuCompatibility : undefined;
  const deployment = nr?.installed == null ? "尚未检测" : nr.installed ? "已部署到游戏" : "未部署到游戏";
  const support = mfg?.gpuSupport;
  const supportedModes = support?.nativeX3X4 ? "2× / 3× / 4× 原生" : support?.unlockRequiredForX3X4 ? "2× 原生 · 3× / 4× 实验性解锁"
    : support?.nativeX2 ? "2× 原生" : support?.modeBadges?.x2?.status === "incompatible" ? "不兼容" : "尚未确认";
  const detectedModes = support?.nativeX3X4 ? "Off / x2 (原生支持) / x3 (Blackwell 原生硬件支持) / x4 (Blackwell 原生硬件支持)"
    : support?.unlockRequiredForX3X4 ? (desktop40 ? "Off / x2 (原生支持) / x3 (40系桌面低延迟解锁) / x4 (40系桌面低延迟解锁)" : "Off / x2 (原生支持) / x3 (实验性支持) / x4 (实验性支持)") : supportedModes;
  const savedMode = mfg?.currentConfig?.mode;
  const dlssg = mfg?.dlssg;
  const targetVersion = stacks.find(stack => stack.id === "oct2026-310.9.16")?.dlssgVersion;
  const sl = mfg?.streamline;
  const knownGame = mfg?.knownGame;
  const gameCompatibility = [status.graphicsApi, status.bitness && status.bitness + "-bit", knownGame?.title,
    t(knownGame?.notes || "未收录游戏专用兼容说明，请以运行检测和实际画面为准。")].filter(Boolean).join(" · ");
  const targetArch = blackwell ? "CUDA sm_120 (Blackwell 23 核原生直通)" :
    desktop40 ? "CUDA sm_89 (Ada 桌面满血 15 核)" : "CUDA sm_89 (Ada 笔记本黄金 15 核)";
  const latest = models.find(m => m.role === "latest_compatible");
  const neuralFacts: [string, ReactNode][] = copy ? [
    ["当前硬件档位 (Hardware Profile)", profile],
    ["当前模型 (Current Model)", model ? (model.name || model.id) + (model.version ? " (" + model.version + ")" : "") : t("未安装 (Off)")],
    ["最新模型 (Latest Model)", latest && latest.id !== "310.8.SF-v2" ? latest.name + " · v" + latest.version : "310.8.SF-v2 (Oct 2026)"],
    ["2026-10 官方模型追踪", <span title={t("310.9.16-oct2026 是 310.8.SF-v2 的目录别名。")}>{t("v310.9.16 (118M Faster AI Model · 全档位已内置兼容)")}</span>],
    ["运行时版本 (Runtime Version)", nr?.runtimeVersion ? ["DLSS " + nr.runtimeVersion, sl?.interposerVersion && "SL " + sl.interposerVersion].filter(Boolean).join(" / ")
      : t("待部署 (内置 Oct 2026 DLSS 310.9.16 + SL 2.14.16 + Feeder 1.19.0)")],
    ["GPU 兼容性 (GPU Compatibility)", t("{0} · 目标档位：{1} ({2}) — {3}", [gpu?.name || t("未识别"), profile, t(targetArch), gpuCheck?.badge || recommended?.compatBadge || t("尚未测试")])],
    ["安装状态 (Install Status)", t(nr?.installed == null ? "尚未检测" : nr.installed ? "已安装 ({0})" : "未安装", [nr?.mode || "—"])],
  ] : [
    ["当前硬件档位", profile],
    ["当前模型", model ? (model.name || model.id) + " · " + (model.version || "—") : t(nr?.installed ? "未识别" : deployment)],
    ["本地推荐模型", recommended ? [recommended.name || recommended.id, recommended.version].filter(Boolean).join(" · ") : t("未找到本地兼容模型")],
    ["已检测 SR 版本", nr?.runtimeVersion || t("未检测到")],
    ["已保存运行库组合", savedStack ? stackVersions(savedStack) : t("未记录")],
    ["GPU 兼容性", [gpu?.name, gpu?.architecture?.sm && gpu.architecture.family + " · sm_" + gpu.architecture.sm, t(gpuCheck?.reason || "尚未检测")].filter(Boolean).join(" · ")],
  ];
  const mfgFacts: [string, ReactNode][] = copy ? [
    ["当前补帧档位 (MFG Profile)", profile],
    ["当前显卡 (Current GPU)", gpu?.name || t("未识别")],
    ["DLSS-G 版本 (DLSS-G Version)", dlssg?.exists ? (dlssg.version || "—") + " (" + t(dlssg.valid ? "原生 NVIDIA NGX DLSS-G" : "非原生 DLL") + ")" :
      dlssg?.exists === false && targetVersion ? t("未部署 (应用时自动部署 {0})", [targetVersion]) : t("未检测到")],
    ["支持模式 (Supported Modes)", t(detectedModes)],
    ["实际生效倍率 (Effective Multiplier)", gameDir && <MultiplierReading key={gameDir} dir={gameDir} />],
    ["当前游戏兼容性 (Game Compatibility)", knownGame ? knownGame.title + " (" + t(knownGame.notes) + ")" :
      /^(DirectX\s*12|D3D12|DX12)$/i.test(status.graphicsApi || "") && status.bitness === 64 ? t("标准 DirectX 12 游戏 (支持 Streamline DLSS-G 注入)") : gameCompatibility],
  ] : [
    ["当前补帧档位", profile], ["当前显卡", gpu?.name || t("未识别")],
    ["DLSS-G 版本", dlssg?.exists === false ? [t("未部署"), targetVersion && t("应用补帧时优先部署 {0}", [targetVersion])].filter(Boolean).join(" · ") :
      [dlssg?.version || t("未检测到"), dlssg?.exists && !dlssg.valid && t("文件校验未通过")].filter(Boolean).join(" · ")],
    ["显卡支持模式", [t("关闭"), t(supportedModes)].join(" / ")],
    ["已保存倍率", savedMode && savedMode !== "off" ? savedMode.slice(1) + "×" : t(savedMode === "off" ? "关闭" : "未记录")],
    ["日志记录的生效倍率", mfg?.runtimeVerification?.effectiveMultiplier ? mfg.runtimeVerification.effectiveMultiplier + "×" : t("未记录")],
  ];
  const nrModes: ModeOption[] = copy ? [
    ["off", "Off", "关闭神经渲染"], ["legacy", "Legacy Model", "310.8.0-RTX40 基线"], ["latest_compatible", "Latest Compatible", "最新全兼容模型"],
  ] : [
    ["off", t("关闭"), "关闭神经渲染"], ["legacy", t("旧版模型"), "310.8.0-RTX40 基线"], ["latest_compatible", t("兼容模型"), "本地或按需下载"],
  ];
  const multiplierHint = (count: number) => copy
    ? t(blackwell ? "{0}帧输出 (原生支持)" : desktop40 ? "{0}帧输出 (桌面满血)" : "{0}帧输出 (实验性)", [count])
    : t(support?.nativeX3X4 ? "{0} 帧输出 · 原生" : support?.unlockRequiredForX3X4 ? "{0} 帧输出 · 实验性" :
      support?.modeBadges?.["x" + count]?.status === "incompatible" ? "{0} 帧输出 · 不兼容" : "{0} 帧输出 · 待确认", [count]);
  const mfgModes: ModeOption[] = [
    ["off", copy ? "Off" : t("关闭"), "关闭补帧"],
    ["x2", copy ? "x2" : "2×", copy ? "标准 FG (已验证)" : support?.nativeX2 ? "标准补帧 · 原生" : support?.modeBadges?.x2?.status === "incompatible" ? "标准补帧 · 不兼容" : "标准补帧 · 待确认"],
    ["x3", copy ? "x3" : "3×", multiplierHint(3)], ["x4", copy ? "x4" : "4×", multiplierHint(4)],
  ];
  const modelLabel = copy ? "选择神经渲染模型 (全系 40/50 显卡 100% 兼容)" : "神经渲染模型";
  if (showGameDetails && copy) {
    neuralFacts.push(
      ["本地推荐模型", recommended?.name || recommended?.id || t("未找到本地兼容模型")],
      ["已保存运行库组合", savedStack ? stackVersions(savedStack) : t("未记录")],
      ["GPU 兼容性", t(gpuCheck?.reason || "尚未检测")],
    );
    mfgFacts.push(
      ["已保存倍率", savedMode && savedMode !== "off" ? savedMode.slice(1) + "×" : t(savedMode === "off" ? "关闭" : "未记录")],
      ["日志记录的生效倍率", mfg?.runtimeVerification?.effectiveMultiplier ? mfg.runtimeVerification.effectiveMultiplier + "×" : t("未记录")],
      ["目标程序", exePath || t("未识别")],
    );
  }
  const stackLabel = copy ? "运行时栈版本 (Streamline / DLSS / Feeder)" : "配套运行库";
  const inputLabel = copy ? "帧生成输入源策略 (QualityGuardMode)" : "帧生成输入源策略";
  return <div className="graphics-modules">
    <section className="graphics-module" data-module="neural" aria-label={t("神经渲染配置")}>
      <header className="module-heading"><div><span className="module-eyebrow">{copy ? t("模块 A · DLSS 5 神经渲染") : "DLSS 5 · NR"}</span>
        <h2>{copy ? "Neural Rendering Manager" : t("神经渲染")}</h2></div>
        <span className={`module-badge ${nr?.overallStatus === "verified" ? "ok" : nr?.overallStatus === "incompatible" ? "warn" : ""}`}>{t(nr?.overallBadge || "尚未测试")}</span>
      </header>
      {copy && <p className="manager-description">{t("管理 DLSS 5 神经渲染模型 (nvngx_dlssnr.dll)、CUDA SM 架构校验与 2026-10 运行时栈（笔记本40 / 桌面40 / 桌面50 全兼容）")}</p>}
      <Facts rows={neuralFacts} />
      <div className="module-fields">
        <div className="module-field"><span className="mode-caption">{t(copy ? "DLSS 5 神经渲染模式选择" : "神经渲染模式")}<small>{t(copy ? "选中项仅代表待应用配置" : "选中项为待应用配置")}</small></span>
          <Modes label="神经渲染" value={draft.neuralMode} onChange={v => onChange(neuralChoice(draft, v))} options={nrModes} />
        </div>
        <div className="module-field"><span>{t(modelLabel)}</span>
          <Select label={modelLabel} value={draft.neuralModelId} onChange={v => onChange({ neuralModelId: v, neuralMode: v === "310.8.0-RTX40" ? "legacy" : "latest_compatible" })} options={modelOptions} />
        </div>
        <div className="module-field"><span>{t(stackLabel)}</span>
          <Select label={stackLabel} value={draft.runtimeStack} onChange={v => onChange({ runtimeStack: v })} options={stackOptions} />
        </div>
        {copy ? <p className="module-note" title={profileNotes?.neural}><b>{t("档位模型说明")}</b>{t("：内置模型均同时包含 sm_89 (40系笔记本/桌面卡 15核) 与 sm_120 (50系桌面卡 23核) 原生张量核指令集。")}{t(copy.neural)}</p>
          : <p className="module-note">{t("模型文件与配套运行库独立选择。选项是待应用配置，进入游戏后才能验证加载与效果。")}</p>}
      </div>
      <div className="module-actions">
        <button className="module-command" onClick={() => onApply("neural")}>{copy ? t("🎯 单独加载 DLSS 5 神经渲染") : <><span className="action-symbol" aria-hidden="true">✨</span>{t("仅应用神经渲染设置")}</>}</button>
        <button onClick={onImport} title={copy ? t("手动导入外部合法的 nvngx_dlssnr.dll") : undefined}>{copy ? t("导入外部 .dll") : <><Download size={15} />{t("导入 DLL")}</>}</button>
        {!copy && <small>{t("保留游戏当前的补帧配置。")}</small>}
      </div>
    </section>
    <section className="graphics-module" data-module="mfg" aria-label={t("多帧生成配置")}>
      <header className="module-heading"><div><span className="module-eyebrow">{copy ? t("模块 B · 全系 40/50 显卡 x3/x4 多帧生成") : "DLSS-G · MFG"}</span>
        <h2>{copy ? "Multi Frame Generation Manager" : t("多帧生成")}</h2></div>
        <span className={`module-badge ${mfg?.status === "verified" ? "ok" : mfg?.status === "incompatible" ? "warn" : ""}`}>{t(mfg?.statusBadge || "尚未测试")}</span>
      </header>
      {copy && <p className="manager-description">{t("全面兼容笔记本 40 系列、40 系桌面卡与 50 系列桌面卡的原生 NVIDIA DLSS-G 多帧生成控制器")}</p>}
      <Facts rows={mfgFacts} />
      <div className="module-fields">
        <div className="module-field"><span className="mode-caption">{t(copy ? "Multi Frame Generation 补帧倍率选择" : "补帧倍率")}
          {copy && <small>{t(blackwell ? "50系桌面卡原生硬件直通" : desktop40 ? "40系桌面卡 V3 高锐度 + 低延迟护栏" : "笔记本 40 系列黄金配置")}</small>}</span>
          <Modes label="补帧倍率" value={draft.mfgMode} onChange={v => onChange({ mfgMode: v })} options={mfgModes} />
        </div>
        <div className="module-field"><span>{t(inputLabel)}</span>
          <Select label={inputLabel} value={String(draft.hdrCompatibility)} onChange={v => onChange({ hdrCompatibility: v === "true" })}
            options={copy ? originalInputs : [["false", "原生输入 · QualityGuardMode 0"], ["true", "HDR UI 保护 · QualityGuardMode 2"]]} />
        </div>
        {copy ? <p className="module-note" title={profileNotes?.mfg}><b>{t("档位补帧说明：")}</b>{t(copy.mfg)}</p> : <>
          <p className="module-note">{t("默认使用原生输入。仅在开启 HDR 后出现 UI 闪烁等问题时尝试 HDR UI 保护。实际倍率请查看运行诊断。")}</p>
          <details className="module-compat"><summary>{t("当前游戏兼容说明")}</summary><p>{gameCompatibility}</p><p className="path">{exePath || t("未识别")}</p></details>
        </>}
      </div>
      <div className="module-actions"><button className="module-command" onClick={() => onApply("mfg")}>{copy ? t("🎯 单独加载 MFG 多帧生成 ({0})", [draft.mfgMode.toUpperCase()]) :
        <><span className="action-symbol" aria-hidden="true">⚡</span>{t("仅应用补帧设置")}</>}</button>
        {!copy && <small>{t("保留游戏当前的神经渲染配置。")}</small>}
      </div>
    </section>
  </div>;
}
