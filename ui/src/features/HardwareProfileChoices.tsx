import { t } from "../i18n";
import { defaultStack, profiles } from "../domain";
import type { HardwareProfile, HardwareProfileSource } from "../types";
import "./HardwareProfileChoices.css";

const profileGuide: Record<string, { icon: string; tag: string; gpus: string; neural: string; mfg: string }> = {
  rtx40_laptop: {
    icon: "💻", tag: "黄金档 · 显存优先",
    gpus: "RTX 4050 / 4060 / 4070 / 4080 / 4090 Laptop",
    neural: "使用边缘感知上采样，关闭自动遮罩与 UI 校正。",
    mfg: "启用动态补帧（DynamicMFG=1），通过 DllMain 提前加载插件。默认使用原生输入（QualityGuardMode=0），开启 HDR 保护时改用模式 2。",
  },
  rtx40_desktop: {
    icon: "🖥️", tag: "桌面 Ada · V3 补帧",
    gpus: "RTX 4060 Ti / 4070 SUPER / 4070 Ti SUPER / 4080 SUPER / 4090 D",
    neural: "以完整分辨率处理超分后的画面，工作集用于缓存渲染表面。",
    mfg: "通过 DllMain 提前加载插件，启用动态补帧（DynamicMFG=1）和 V3 方向性插值（AdaptiveQualityProfile=2）。",
  },
  rtx50_desktop: {
    icon: "🚀", tag: "原生多帧生成控制",
    gpus: "RTX 5060 / 5070 / 5070 Ti / 5080 / 5090 · Desktop / Laptop",
    neural: "使用模型中的 Blackwell 原生 CUDA 内核（sm_120）。",
    mfg: "RTX 50 原生支持多帧生成，无需解锁。应用时按实际显卡关闭 Ada 专用修补，保留倍率与动态模式控制；具体倍率仍需游戏和运行库支持。",
  },
};

export function hardwareProfileNotes(profile?: HardwareProfile) {
  const guide = profile && profileGuide[profile.id];
  return profile && guide ? {
    neural: t("{0}以 {1}% 工作分辨率推理 {2} 次，最多使用 {3} 个工作集。", [
      profile.nrHookPoint === 0 ? t("超分后") : t("挂接点 {0}", [profile.nrHookPoint]),
      Math.round(profile.nrResolutionScale * 100), profile.nrPasses, profile.nrMaxWorksets,
    ]) + " " + t(guide.neural),
    mfg: t(guide.mfg),
  } : undefined;
}

const sourceLabels: Record<HardwareProfileSource, string> = {
  selected: "手动选择",
  manifest: "来自游戏部署记录",
  default: "使用已保存的默认档位",
  detected: "按已检测显卡匹配",
  "blackwell-mobile": "RTX 50 笔记本暂无专用档位，沿用同架构桌面参数。",
  "low-vram": "桌面显卡显存低于 10 GiB，使用 RTX 40 笔记本的省显存参数。",
  fallback: "当前显卡暂无匹配档位，显示省显存参考参数。",
};

export function HardwareProfileChoices({ catalog, profileId, source, disabled = false, game = false, standalone = false, onSelect }: {
  catalog?: Record<string, HardwareProfile>; profileId: string; source?: HardwareProfileSource; disabled?: boolean; game?: boolean;
  onSelect: (id: string) => void;
  standalone?: boolean;
}) {
  const profile = catalog?.[profileId];
  const profileNotes = hardwareProfileNotes(profile);
  const profileName = t(profiles.find(([id]) => id === profileId)?.[1] || profile?.shortLabel || "未识别");
  const description = profile && profileNotes && (
    <div className="profile-detail profile-values">
      <strong>{t("当前已选档位：")} {profileName}</strong>
      {source && <small className="muted"> · {t(sourceLabels[source])}</small>}
      {game && <p>{t("代表型号：{0}", [profileGuide[profileId].gpus])}</p>}
      <p>
        <b>{t("DLSS 5 神经渲染策略")}</b>{" · "}
        {standalone ? t("超分后以 {0}% 工作分辨率推理 {1} 次，使用边缘感知上采样，关闭自动遮罩与 UI 校正。", [Math.round(profile.nrResolutionScale * 100), profile.nrPasses]) : profileNotes.neural}
      </p>
      <p><b>{t("MFG 多帧生成策略")}</b>{" · "}{standalone ? t("推荐动态补帧，是否支持由实际加载的运行库确认；也可手动选择固定倍率。使用游戏原生输入。") : profileNotes.mfg}</p>
      <p>
        <b>{t("档位参考")}</b> · sm_{profile.sm} · {profile.targetResolution.replace("x", "×")}
        {profile.vramBudgetMB != null && <> · {t("档位参考显存 {0} MiB", [profile.vramBudgetMB])}</>}
        {" · "}{t("默认运行库")} ·{" "}
        {standalone ? t("保留游戏原版文件，运行中可能使用 NVIDIA OTA 版本") : defaultStack(profile.id) === "oct2026-310.9.16"
          ? "DLSS 310.9.16 / Streamline 2.14.16 / Feeder 1.19"
          : "DLSS 310.9.1 / Streamline 2.13 / Feeder 1.17"}
      </p>
    </div>
  );
  return <>
    <div
      className="profile-cards wide"
      role="radiogroup"
      aria-label={t(game ? "硬件档位" : "默认硬件档位")}
    >
      {profiles.map(([id, label]) => {
        const info = catalog?.[id];
        const card = profileGuide[id];
        if (!card) return null;
        return (
          <button
            key={id}
            className={`profile-card ${profileId === id ? "active" : ""}`}
            role="radio"
            aria-checked={profileId === id}
            disabled={disabled}
            onClick={() => onSelect(id)}
          >
            <span className="profile-choice-heading">
              <strong><span aria-hidden="true">{card.icon} </span>{t(label)}</strong>
              <small className="profile-tag">{t(standalone && id === "rtx40_desktop" ? "桌面 Ada · 全分辨率" : card.tag)}</small>
            </span>
            {!game && <small>{t("代表型号：{0}", [card.gpus])}</small>}
            {info && <small>{standalone ? t("工作分辨率 {0}% · 独立加载", [Math.round(info.nrResolutionScale * 100)]) : t("工作分辨率 {0}% · 最多 {1} 个工作集", [Math.round(info.nrResolutionScale * 100), info.nrMaxWorksets])}</small>}
          </button>
        );
      })}
    </div>
    {description}
  </>;
}
