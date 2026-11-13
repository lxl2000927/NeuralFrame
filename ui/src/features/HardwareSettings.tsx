import { useEffect, useRef, useState } from "react";
import { getBridge } from "../bridge";
import { Loading, Row } from "../components";
import { errorText } from "../domain";
import { t } from "../i18n";
import type { HardwareResult } from "../types";
import "./HardwareSettings.css";

export function HardwareSettings({active, refreshToken, disabled}: {
  active: boolean; refreshToken: number; disabled: boolean;
}) {
  const [data, setData] = useState<HardwareResult>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!active) return;
    const request = ++generation.current;
    setLoading(true);
    getBridge().enhancedHardware().then(result => {
      if (request !== generation.current) return;
      if (!result.ok) throw Error(result.message || t("硬件检测失败"));
      setData(result); setError("");
    }).catch(error => {
      if (request === generation.current) setError(errorText(error));
    }).finally(() => {
      if (request === generation.current) setLoading(false);
    });
    return () => { ++generation.current; };
  }, [active, refreshToken, revision]);

  const hardware = data?.hardware, gpu = hardware?.gpu;
  const power = gpu?.powerDefaultW || gpu?.powerMaxW
    ? t("默认 {0} W / 最高 {1} W", [gpu?.powerDefaultW || "—", gpu?.powerMaxW || "—"]) : t("功耗信息不可用");
  return <section className="hardware-settings" aria-label={t("硬件信息")}>
    <h2>{t("硬件信息")}</h2>
    {error && <p className="error" role="alert">{t(error)} <button disabled={loading || disabled} onClick={() => setRevision(value => value + 1)}>{t("重试")}</button></p>}
    {!data ? !error && <Loading text="读取硬件信息…" skeleton="rows" /> :
      <div className="settings-table hardware-information" aria-busy={loading}>
        <Row label={t("本机物理显卡")} hint={gpu?.architecture?.sm ? "CUDA sm_" + gpu.architecture.sm : undefined}>
          <span>{gpu?.detected === false ? t("未识别") : gpu?.name || "—"}</span>
        </Row>
        <Row label={t("显存")}><span>{gpu?.vramTotalMB ? `${gpu.vramTotalMB} MiB` : t("显存信息不可用")}</span></Row>
        <Row label={t("显卡驱动与功耗上限")} hint={power}><span>{gpu?.driver || "—"}</span></Row>
        <Row label={t("处理器与系统内存")} hint={[hardware?.cpuCores ? t("{0} 个逻辑核心", [hardware.cpuCores]) : "", hardware?.ramGB ? `${hardware.ramGB} GB RAM` : ""].filter(Boolean).join(" · ")}>
          <span>{hardware?.cpu || "—"}</span>
        </Row>
        <Row label={t("当前显示器")}><span>{[hardware?.display?.resolution?.replace("x", " × "), hardware?.display?.refreshRateHz ? `${hardware.display.refreshRateHz} Hz` : ""].filter(Boolean).join(" · ") || t("显示器信息不可用")}</span></Row>
      </div>
    }
  </section>;
}
