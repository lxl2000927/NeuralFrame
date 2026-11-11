import { useEffect, useState } from "react";
import { getBridge } from "../bridge";
import { errorText } from "../domain";
import { dateTime, t } from "../i18n";
import type { ProxySettings, Runtime, Status } from "../types";
import "./StandaloneStatus.css";

const choices: Record<string, string[]> = {
  dlss5HookStage: ["自动", "超分前", "超分后", "呈现前"],
  dlss5UpsampleFilter: ["双线性", "双三次", "最近邻", "边缘感知"],
  dlss5UiCorrection: ["自动", "关闭", "开启"],
};
function format(key: string, value: unknown): string {
  if (value == null) return "—";
  if (choices[key]) return t(choices[key][Number(value)] || "未知");
  if (typeof value === "boolean") return t(value ? "开启" : "关闭");
  if (key === "dlss5ResolutionScale") return `${value}%`;
  if (key === "dlss5OverallIntensity") return `${Math.round(Number(value) * 100)}%`;
  return String(value);
}
const rows = [
  ["神经渲染开关", "dlss5"],
  ["工作分辨率", "dlss5ResolutionScale"], ["自动分辨率", "dlss5ResolutionScaleAuto"],
  ["执行时机", "dlss5HookStage"], ["推理次数", "dlss5PassCount"],
  ["上采样", "dlss5UpsampleFilter"], ["自动遮罩", "dlss5CharacterMask"],
  ["UI 校正", "dlss5UiCorrection"], ["渲染强度", "dlss5OverallIntensity"],
];

export function StandaloneRuntimeFacts({ runtime }: { runtime: Runtime }) {
  const s = runtime.standalone;
  const fresh = !!s && Date.now() - s.at <= 30000;
  const actual = fresh && runtime.nr.state === "active" ? s.actual : null;
  const nrStale = !!runtime.nr.at && Date.now() - runtime.nr.at > 30000;
  const fgStale = !!runtime.mfg.at && Date.now() - runtime.mfg.at > 30000;
  return <div className="standalone-live">
    <p><b>{t("神经渲染")}</b> · {t(nrStale ? "运行记录已过期" : runtime.nr.label)}</p>
    {actual && <p>{t("实际工作参数")} · {format("dlss5HookStage", actual.stage)} · {actual.scale}% · {actual.extentWidth}×{actual.extentHeight}
      {" · "}{t("推理 {0} 次", [actual.passes])}
      {actual.gpuMs >= 0 && <> · GPU {actual.gpuMs.toFixed(2)} ms</>}</p>}
    <p><b>{t("补帧")}</b> · {t(fgStale ? "运行记录已过期" : runtime.mfg.label)}<br />{t(fgStale ? "超过 30 秒没有新遥测，请刷新检测。" : runtime.mfg.detail)}</p>
    {!fgStale && runtime.mfg.requestedMode === "dynamic" && <p>{t("动态补帧支持")}: {t(runtime.mfg.dynamicSupported == null ? "等待运行库确认" : runtime.mfg.dynamicSupported ? "运行库支持" : "当前运行库不支持，未作为动态生效")}</p>}
    {fresh && <p>{t("实际加载运行库")} · DLSS FG {s.stack.fg || "—"} / Streamline {s.stack.streamline || "—"}
      {s.stack.ota && <> · NVIDIA OTA</>}</p>}
  </div>;
}

export function StandaloneStatus({ dir, profile, enabled, active = true, onRuntime }: {
  dir: string; profile: NonNullable<Status["standaloneProfile"]>; enabled: boolean; active?: boolean;
  onRuntime?: (value: Runtime | null) => void;
}) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || !dir) return;
    let alive = true, pending = false;
    setRuntime(null);
    async function probe() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await getBridge().componentRuntime(dir);
        if (!result.ok) throw Error(result.message || t("检测失败"));
        if (alive) { setRuntime(result); onRuntime?.(result); setError(""); }
      } catch (e) {
        if (alive) { setRuntime(null); onRuntime?.(null); setError(errorText(e)); }
      } finally { pending = false; }
    }
    void probe();
    const timer = setInterval(() => void probe(), 5000);
    document.addEventListener("visibilitychange", probe);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", probe); };
  }, [dir, active, profile.saved, retry, onRuntime]);
  const current = runtime?.standalone;
  const fresh = current && Date.now() - current.at <= 30000;
  const saved = profile.saved;
  const target: ProxySettings = { ...profile.target, dlss5: enabled };
  const readback: Record<string, unknown> = { ...current?.settings, dlss5: current?.enabled };
  const drift = fresh && Object.entries(target).some(([key, value]) => readback[key] !== value);
  return <section className="standalone-status" aria-label={t("独立加载参数与运行状态")}>
    <header><h3>{t("独立加载参数与运行状态")}</h3><small>{runtime ? dateTime(runtime.checkedAt) : t("正在读取本次进程…")}</small></header>
    {error ? <p className="error">{error} <button onClick={() => setRetry(v => v + 1)}>{t("重试")}</button></p>
      : runtime && <StandaloneRuntimeFacts runtime={runtime} />}
    <details className="standalone-parameters"><summary>{t("档位参数对照")}</summary>
    <p className="muted">{t("待应用参数来自所选硬件档位；已保存来自配置文件；组件回读来自当前游戏进程。每 5 秒自动检测。")}</p>
    <div className="standalone-table"><table><thead><tr><th scope="col">{t("神经渲染参数")}</th><th scope="col">{t("待应用")}</th><th scope="col">{t("已保存")}</th><th scope="col">{t("组件回读")}</th></tr></thead>
      <tbody>{rows.map(([label, key]) => <tr key={key}><th scope="row">{t(label)}</th><td>{format(key, target[key])}</td>
        <td>{format(key, saved?.[key])}</td><td>{format(key, fresh ? readback[key] : undefined)}</td></tr>)}</tbody></table></div>
    <p className="muted">{t("独立组件不提供 RenoDX 的 4/8 工作集上限、曝光治理和专用补帧补丁接口；这些设置未迁移，也不会显示为已生效。")}</p>
    </details>
    {saved && !profile.adapterVersion && <p className="standalone-notice">{t("旧版部署尚未应用完整档位参数，请点击“仅应用神经渲染设置”。")}</p>}
    {drift && <p className="standalone-notice">{t("组件回读与所选档位不同，可能尚未应用或已在游戏面板调整。")}</p>}
    {fresh && current.pending && <p>{t("组件正在等待应用新参数；回读值不代表已经生效。")}</p>}
  </section>;
}
