import { Download } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getBridge } from "../bridge";
import { Select } from "../components";
import { defaultStack, errorText, modelArchitectureLimit, neuralChoice, profiles } from "../domain";
import { dateTime, t } from "../i18n";
import type { Draft, Runtime, RuntimeStack, Status } from "../types";
import { profileCardCopy, inputOptions as originalInputs } from "./profileCardCopy";
import { StandaloneStatus } from "./StandaloneStatus";
import "./GraphicsPanels.css";

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="module-facts">{rows.filter(([, value]) => value !== undefined).map(([label, value]) =>
    <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>
  )}</dl>;
}

function stackVersions(stack: RuntimeStack) {
  return `DLSS SR ${stack.dlssVersion}${stack.dlssgVersion ? ` / FG ${stack.dlssgVersion}` : ""} / Streamline ${stack.streamlineVersion} / Feeder ${stack.feederVersion}`;
}

function nativeFileVersion(file?: { rel: string; version: string | null }) {
  return file ? <span title={file.rel}>{file.version || t("版本未知")}</span> : t("未检测到");
}

function MultiplierReading({ dir }: { dir: string }) {
  const [reading, setReading] = useState<Runtime>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!reading) return;
    const update = () => setNow(Date.now());
    update();
    const timers = [reading.mfg.at || reading.checkedAt, reading.mfg.fpsAt].flatMap(at => {
      const expires = (at || 0) + 30001 - Date.now();
      return expires > 0 ? [setTimeout(update, expires)] : [];
    });
    // A suspended/background window may not run the expiry timer on time.
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [reading]);
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
  const stale = !!reading && now - (sample?.at || reading.checkedAt) > 30000;
  const fpsStale = !!sample?.fpsAt && now - sample.fpsAt > 30000;
  const fpsRatio = !stale && !fpsStale && sample?.state === "active" && sample.sourceFps && sample.sourceFps > 0 &&
    sample.reportedOutputFps && sample.reportedOutputFps > 0 ? sample.reportedOutputFps / sample.sourceFps : null;
  return <div className="multiplier-reading">
    <span aria-live="polite">{error || (sample ? t(stale ? "运行记录已过期" : sample.label) : t("等待本次运行采样"))}</span>
    {fpsRatio != null && <small>{t("插件输出 / 基础帧率 ≈ {0}×", [fpsRatio.toFixed(2)])}</small>}
    {reading && <small>{dateTime(reading.checkedAt)}
      {!stale && sample?.state === "active" && sample.appliedMultiplier ? " · " + t("已应用请求 {0}×", [sample.appliedMultiplier]) : ""}
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

export function GraphicsPanels({ status, exePath, draft, onChange, onApply, onBrowseModels, profileNotes, gameDir, showGameDetails = false, active = true, onRuntime, neuralAdvanced, engineControl, onResetTuning, resetPending }: {
  status: Status; exePath?: string; draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onApply: (scope: "neural" | "mfg") => void;
  onBrowseModels: () => void;
  profileNotes?: { neural: string; mfg: string };
  gameDir: string;
  showGameDetails?: boolean;
  active?: boolean;
  onRuntime?: (value: Runtime | null) => void;
  neuralAdvanced?:ReactNode; engineControl?:ReactNode; onResetTuning?:()=>void; resetPending?:boolean;
}) {
  const nr = status.neural, mfg = status.mfg;
  const protectedGame = status.launcherProtected;
  const nativeStack = status.nativeRuntimeStack;
  const nativeStackHint = t(nativeStack?.indexMissing
    ? "该渠道无官服资源清单，保留原文件；实际加载版本见运行诊断"
    : "无法读取启动器资源清单");
  const copy = profileCardCopy[draft.hardwareProfile];
  const blackwell = mfg?.gpuSupport?.nativeX3X4 === true;
  const profile = t(copy?.label || profiles.find(([id]) => id === status.hardwareProfile)?.[1] || "未识别");
  const models = nr?.availableModels || [];
  const otherModels = models.map(m => [m.id, [m.name || m.id, m.architectures?.map(sm => "sm_" + sm).join("/"),
    t(m.availableOnDisk ? "已入库" : m.downloadable ? "按需下载" : m.sha256 ? "未导入" : "仅目录记录")].filter(Boolean).join(" · ")]);
  const modelOptions = otherModels;
  if (!modelOptions.some(([id]) => id === "310.8.SF-v2"))
    modelOptions.unshift(["310.8.SF-v2", "310.8.SF-v2 · SmarterGamers · " + t("按需下载")]);
  if (protectedGame && nr?.currentModel?.id && !modelOptions.some(([id]) => id === nr.currentModel?.id))
    modelOptions.push([nr.currentModel.id, nr.currentModel.name || nr.currentModel.id]);
  const gpu = status.hardware?.gpu;
  const labeledModels = modelOptions.map(([id, label]) => {
    const entry = models.find(m => m.id === id)
      || (nr?.currentModel?.id === id ? nr.currentModel : undefined);
    const limit = entry && modelArchitectureLimit(entry, gpu?.architecture?.sm, status.hardwareProfileInfo?.sm);
    return [id, limit ? t(limit) + " · " + t(label) : label];
  });
  const stacks = nr?.runtimeStacks || [];
  const stackOptions = stacks.length ? stacks.map(stack => [
    stack.id, [t(stack.id === "baseline-310.9.1" ? "基准组合" : "可选组合"), stackVersions(stack), stack.id === defaultStack(draft.hardwareProfile) ? t("档位默认") : ""].filter(Boolean).join(" · "),
  ]) : [["baseline-310.9.1", t("基准组合 · SR 310.9.1 / SL 2.13")], ["oct2026-310.9.16", t("更新组合 · SR 310.9.16 / SL 2.14")]];
  const savedStack = stacks.find(stack => stack.id === (status.configuredRuntimeStack || nr?.configuredRuntimeStack));
  const model = nr?.currentModel;
  const recommended = nr?.latestCompatibleModel;
  const gpuCheck = model && nr?.dependencies?.hasNeuralDll !== false ? nr.gpuCompatibility : undefined;
  const deployment = nr?.installed == null ? "尚未检测" : nr.installed ? "已部署到游戏" : "未部署到游戏";
  const support = mfg?.gpuSupport;
  const communityModes = !support?.nativeX2 && support?.modeBadges?.x2?.status === "experimental";
  const supportedModes = communityModes ? "2× / 3× / 4× 社区支持，需游戏验证" : support?.nativeX3X4 ? "2× / 3× / 4× 原生" : support?.unlockRequiredForX3X4 ? "2× 原生 · 3× / 4× 实验性解锁"
    : support?.nativeX2 ? "2× 原生" : support?.modeBadges?.x2?.status === "incompatible" ? "不兼容" : "尚未确认";
  const detectedModes = support?.nativeX3X4 ? "2× / 3× / 4× 原生能力 · 需游戏与运行库支持"
    : communityModes ? supportedModes : support?.unlockRequiredForX3X4 ? "2× 原生 · 3× / 4× 社区支持，需游戏验证" : supportedModes;
  const savedMode = mfg?.currentConfig?.mode;
  const savedModeLabel = savedMode === "dynamic" ? t("动态 · 由运行库调节倍率") : savedMode === "follow" ? t("跟随游戏") : savedMode === "off" ? t("关闭") : savedMode?.startsWith("x") ? savedMode.slice(1) + "×" : t("未记录");
  const dlssg = mfg?.dlssg;
  const targetVersion = protectedGame ? undefined : stacks.find(stack => stack.id === "oct2026-310.9.16")?.dlssgVersion;
  const sl = mfg?.streamline;
  const knownGame = mfg?.knownGame;
  const gameCompatibility = [status.graphicsApi, status.bitness && status.bitness + "-bit", knownGame?.title,
    t(knownGame?.notes || "未收录游戏专用兼容说明，请以运行检测和实际画面为准。")].filter(Boolean).join(" · ");
  const targetArch = status.hardwareProfileInfo?.sm ? `CUDA sm_${status.hardwareProfileInfo.sm}` : t("未识别");
  const latest = models.find(m => m.role === "latest_compatible");
  const neuralFacts: [string, ReactNode][] = copy ? [
    ["当前硬件档位 (Hardware Profile)", profile],
    ["当前模型 (Current Model)", model ? (model.name || model.id) + (model.version ? " (" + model.version + ")" : "") : t("未安装 (Off)")],
    ["最新模型 (Latest Model)", latest ? [latest.name || latest.id, latest.version].filter(Boolean).join(" · ") : t("未识别")],
    ["运行时版本 (Runtime Version)", protectedGame ? t("使用游戏原版运行库") : nr?.runtimeVersion ? ["DLSS " + nr.runtimeVersion, sl?.interposerVersion && "SL " + sl.interposerVersion].filter(Boolean).join(" / ")
      : t("未部署")],
    ["GPU 兼容性 (GPU Compatibility)", t("{0} · 目标档位：{1} ({2}) — {3}", [gpu?.name || t("未识别"), profile, t(targetArch), gpuCheck?.badge || recommended?.compatBadge || t("尚未测试")])],
    ["安装状态 (Install Status)", t(nr?.installed == null ? "尚未检测" : nr.installed ? "已安装 ({0})" : "未安装", [nr?.mode || "—"])],
  ] : [
    ["当前硬件档位", profile],
    ["当前模型", model ? (model.name || model.id) + " · " + (model.version || "—") : t(nr?.installed ? "未识别" : deployment)],
    ["本地推荐模型", recommended ? [recommended.name || recommended.id, recommended.version].filter(Boolean).join(" · ") : t("未找到本地兼容模型")],
    ["已检测 SR 版本", protectedGame ? undefined : nr?.runtimeVersion || t("未检测到")],
    ["已保存运行库组合", protectedGame ? undefined : savedStack ? stackVersions(savedStack) : t("未记录")],
    ["GPU 兼容性", [gpu?.name, gpu?.architecture?.sm && gpu.architecture.family + " · sm_" + gpu.architecture.sm, t(gpuCheck?.reason || "尚未检测")].filter(Boolean).join(" · ")],
  ];
  const mfgFacts: [string, ReactNode][] = copy ? [
    ["当前补帧档位 (MFG Profile)", profile],
    ["当前显卡 (Current GPU)", gpu?.name || t("未识别")],
    ["DLSS-G 版本 (DLSS-G Version)", protectedGame ? (nativeStack?.indexAvailable ? nativeFileVersion(nativeStack.fg) : nativeStackHint) : dlssg?.exists ? (dlssg.version || "—") + " (" + t(dlssg.valid ? "原生 NVIDIA NGX DLSS-G" : "非原生 DLL") + ")" :
      dlssg?.exists === false && targetVersion ? t("未部署 (应用时自动部署 {0})", [targetVersion]) : t("未检测到")],
    ["支持模式 (Supported Modes)", t(detectedModes)],
    [protectedGame ? "已保存补帧控制" : "实际生效倍率 (Effective Multiplier)", protectedGame ? savedModeLabel : gameDir && <MultiplierReading key={gameDir} dir={gameDir} />],
    ["当前游戏兼容性 (Game Compatibility)", protectedGame ? t("鸣潮启动器兼容路线 · version.dll") : knownGame ? knownGame.title + " (" + t(knownGame.notes) + ")" : gameCompatibility],
  ] : [
    ["当前补帧档位", profile], ["当前显卡", gpu?.name || t("未识别")],
    ["DLSS-G 版本", protectedGame ? (nativeStack?.indexAvailable ? nativeFileVersion(nativeStack.fg) : nativeStackHint) :
      dlssg?.exists === false ? [t("未部署"), targetVersion && t("应用补帧时优先部署 {0}", [targetVersion])].filter(Boolean).join(" · ") :
      [dlssg?.version || t("未检测到"), dlssg?.exists && !dlssg.valid && t("文件校验未通过")].filter(Boolean).join(" · ")],
    ["显卡支持模式", [t("关闭"), t(supportedModes)].join(" / ")],
    ["已保存倍率", savedModeLabel],
    ["日志记录的生效倍率", mfg?.runtimeVerification?.effectiveMultiplier ? mfg.runtimeVerification.effectiveMultiplier + "×" : t("未记录")],
  ];
  const nrModes: ModeOption[] = copy ? [
    ["off", "Off", "关闭神经渲染"], ["legacy", "Legacy Model", "310.8.0-RTX40 基线"], ["latest_compatible", "Latest Compatible", "最新全兼容模型"],
  ] : [
    ["off", t("关闭"), "关闭神经渲染"], ["legacy", t("旧版模型"), "310.8.0-RTX40 基线"], ["latest_compatible", t("兼容模型"), "本地或按需下载"],
  ];
  const multiplierHint = (count: number) => t(support?.nativeX3X4 ? "{0} 帧输出 · 原生" : support?.unlockRequiredForX3X4 ? "{0} 帧输出 · 实验性" :
      support?.modeBadges?.["x" + count]?.status === "incompatible" ? "{0} 帧输出 · 不兼容" : "{0} 帧输出 · 待确认", [count]);
  const mfgModes: ModeOption[] = [
    ["off", copy ? "Off" : t("关闭"), "关闭补帧"],
    ...(protectedGame ? [["dynamic", t("动态"), "档位推荐 · 按显示器刷新率调节"] as ModeOption] : []),
    ["x2", copy ? "x2" : "2×", support?.nativeX2 ? "标准补帧 · 原生" : communityModes ? "标准补帧 · 社区支持，需游戏验证" : support?.modeBadges?.x2?.status === "incompatible" ? "标准补帧 · 不兼容" : "标准补帧 · 待确认"],
    ["x3", copy ? "x3" : "3×", multiplierHint(3)], ["x4", copy ? "x4" : "4×", multiplierHint(4)],
  ];
  if (protectedGame && ["x5", "x6", "follow"].includes(draft.mfgMode))
    mfgModes.push([draft.mfgMode, draft.mfgMode === "follow" ? t("跟随游戏") : draft.mfgMode.slice(1) + "×", "由游戏面板设置 · 实际支持以运行库为准"]);
  const modelLabel = "神经渲染模型";
  if (showGameDetails && copy) {
    neuralFacts.push(
      ["本地推荐模型", recommended?.name || recommended?.id || t("未找到本地兼容模型")],
      ["已保存运行库组合", protectedGame ? undefined : savedStack ? stackVersions(savedStack) : t("未记录")],
      ["GPU 兼容性", t(gpuCheck?.reason || "尚未检测")],
    );
    mfgFacts.push(
      ["已保存倍率", savedModeLabel],
      ["日志记录的生效倍率", mfg?.runtimeVerification?.effectiveMultiplier ? mfg.runtimeVerification.effectiveMultiplier + "×" : t("未记录")],
      ["目标程序", exePath || t("未识别")],
    );
  }
  const stackLabel = protectedGame || copy ? "运行时栈版本 (Streamline / DLSS / Feeder)" : "配套运行库";
  const inputLabel = copy ? "帧生成输入源策略 (QualityGuardMode)" : "帧生成输入源策略";
  return <div className="graphics-modules">
    {protectedGame && status.standaloneProfile && <StandaloneStatus key={gameDir} dir={gameDir} profile={status.standaloneProfile} enabled={draft.neuralMode !== 'off'} active={active} onRuntime={onRuntime} />}
    <section className="graphics-module" data-module="neural" aria-label={t("神经渲染配置")}>
      <header className="module-heading"><div><span className="module-eyebrow">{copy ? t("模块 A · DLSS 5 神经渲染") : "DLSS 5 · NR"}</span>
        <h2>{copy ? "Neural Rendering Manager" : t("神经渲染")}</h2></div>
        <span className={`module-badge ${nr?.overallStatus === "verified" ? "ok" : nr?.overallStatus === "incompatible" ? "warn" : ""}`}>{t(nr?.overallBadge || "尚未测试")}</span>
      </header>
      {copy && <p className="manager-description">{t(protectedGame ? "管理神经渲染模型与 CUDA 架构兼容性，读取鸣潮自带的运行库版本。" : "管理神经渲染模型、CUDA 架构校验与配套运行库。是否可用取决于模型、显卡和游戏安装路线。")}</p>}
      <Facts rows={neuralFacts} />
      <div className="module-fields">
        <div className="module-field"><span className="mode-caption">{t(copy ? "DLSS 5 神经渲染模式选择" : "神经渲染模式")}<small>{t(copy ? "选中项仅代表待应用配置" : "选中项为待应用配置")}</small></span>
          <Modes label="神经渲染" value={draft.neuralMode} onChange={v => onChange(neuralChoice(draft, v))} options={nrModes} />
        </div>
        <div className="module-field"><span>{t(modelLabel)}</span>
          <Select label={modelLabel} value={draft.neuralModelId} onChange={v => onChange({ neuralModelId: v, neuralMode: v === "310.8.0-RTX40" ? "legacy" : "latest_compatible" })} options={labeledModels} />
        </div>
        {protectedGame ? <section className="module-field native-stack" aria-label={t(stackLabel)}>
          <h3 className="mode-caption">{t(stackLabel)}<small>{t("磁盘原版 · 只读，实际加载版本见运行状态")}</small></h3>
          <Select label={stackLabel} value="game-native" disabled onChange={() => {}}
            options={[["game-native", t("游戏原生运行库 · 随游戏更新")]]} />
          <Facts rows={nativeStack?.indexAvailable ? [
            ["Streamline", nativeFileVersion(nativeStack.streamline)],
            ["DLSS SR", nativeFileVersion(nativeStack.sr)], ["DLSS FG", nativeFileVersion(nativeStack.fg)],
            ["Feeder", t("此路线未使用")],
          ] : [["使用游戏原版运行库", nativeStackHint], ["Feeder", t("此路线未使用")]]} />
        </section> : <div className="module-field"><span>{t(stackLabel)}</span>
          <Select label={stackLabel} value={draft.runtimeStack} onChange={v => onChange({ runtimeStack: v })} options={stackOptions} />
        </div>}
        {protectedGame ? <p className="module-note">{t("鸣潮保留启动器校验的 DLSS 文件。神经渲染与补帧使用主程序旁的 version.dll。")}</p> : profileNotes ? <p className="module-note"><b>{t("档位模型说明")}</b>{profileNotes.neural}</p>
          : <p className="module-note">{t("模型文件与配套运行库独立选择。选项是待应用配置，进入游戏后才能验证加载与效果。")}</p>}
        {neuralAdvanced}
        {!protectedGame && onResetTuning && <details className="module-compat"><summary>{t("神经渲染调校")}</summary>
          <p className="footnote">{t("重新应用模型会保留游戏内调整的外观参数。重置将恢复当前硬件档位的默认参数。")}</p>
          <button disabled={draft.neuralMode === 'off' || resetPending} onClick={onResetTuning}>{t(resetPending ? "重置待应用" : "重置神经渲染调校")}</button>
        </details>}
      </div>
      <div className="module-actions">
        <button className="module-command" onClick={() => onApply("neural")}>{t("仅应用神经渲染设置")}</button>
        <button onClick={onBrowseModels}><Download size={15} />{t("管理模型")}</button>
      </div>
    </section>
    <section className="graphics-module" data-module="mfg" aria-label={t("多帧生成配置")}>
      <header className="module-heading"><div><span className="module-eyebrow">{copy ? t("模块 B · 多帧生成") : "DLSS-G · MFG"}</span>
        <h2>{copy ? "Multi Frame Generation Manager" : t("多帧生成")}</h2></div>
        <span className={`module-badge ${mfg?.status === "verified" ? "ok" : mfg?.status === "incompatible" ? "warn" : ""}`}>{t(mfg?.statusBadge || "尚未测试")}</span>
      </header>
      {copy && <p className="manager-description">{t("RTX 50 使用原生多帧生成控制，无需解锁；RTX 20 / 30 / 40 使用对应社区方案，支持范围以组件、游戏与运行库要求为准。")}</p>}
      <Facts rows={mfgFacts} />
      <div className="module-fields">
        {engineControl}
        <div className="module-field"><span className="mode-caption">{t(copy ? "Multi Frame Generation 补帧倍率选择" : "补帧倍率")}
          {copy && <small>{t(protectedGame ? "动态与固定倍率独立选择，不把动态倍率当作固定输出" : blackwell ? "RTX 50 原生支持，无需解锁；实际倍率需游戏验证" : "档位决定参考参数，支持能力以实际显卡和游戏为准")}</small>}</span>
          <Modes label="补帧倍率" value={draft.mfgMode} onChange={v => onChange({ mfgMode: v })} options={mfgModes} />
        </div>
        <div className="module-field"><span>{t(inputLabel)}</span>
          <Select label={inputLabel} value={String(draft.hdrCompatibility)} onChange={v => onChange({ hdrCompatibility: v === "true" })}
            disabled={protectedGame} options={protectedGame ? [[String(draft.hdrCompatibility), t("使用游戏原生输入")]] : copy ? originalInputs : [["false", "原生输入 · QualityGuardMode 0"], ["true", "HDR UI 保护 · QualityGuardMode 2"]]} />
        </div>
        {protectedGame ? <p className="module-note">{t("应用后在游戏中开启 DLSS 帧生成。实际倍率可在运行诊断中查看。")}</p> : profileNotes ? <p className="module-note"><b>{t("档位补帧说明：")}</b>{profileNotes.mfg}</p> : <>
          <p className="module-note">{t("默认使用原生输入。仅在开启 HDR 后出现 UI 闪烁等问题时尝试 HDR UI 保护。实际倍率请查看运行诊断。")}</p>
          <details className="module-compat"><summary>{t("当前游戏兼容说明")}</summary><p>{gameCompatibility}</p><p className="path">{exePath || t("未识别")}</p></details>
        </>}
      </div>
      <div className="module-actions">
        <button className="module-command" onClick={() => onApply("mfg")}>{t("仅应用补帧设置")}</button>
      </div>
    </section>
  </div>;
}
