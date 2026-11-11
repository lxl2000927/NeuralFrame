// Visible profile-card text from DLSS5-Swapper-Enhanced 2.3.0.
export const profileCardCopy: Record<string, { label: string; neural: string; mfg: string }> = {
  rtx40_laptop: {
    label: "💻 笔记本 40 系列 (默认黄金档)",
    neural: "【DLSS 5 神经渲染策略】保持黄金单通渲染 (NRPasses=1) + 超分后完整分辨率 (NRHookPoint=0, NRResolutionScale=1, 预设#2 + 自然风格) + 黄金 DLSS 310.9.1.0 超分底座，关闭多通道遮罩与 UI 校正以杜绝画面异常。",
    mfg: "【MFG 多帧生成策略】默认启用 NVIDIA 动态多帧生成 (DynamicMFG=1) + 原生输入模式 (QualityGuardMode=0) + DllMain 抢先挂钩，彻底解决开启补帧黑屏问题。",
  },
  rtx40_desktop: {
    label: "🖥️ 40 系桌面卡 (满血画质 + 桌面补帧)",
    neural: "【DLSS 5 神经渲染策略】解锁 100% 原生满血工作分辨率 (NRResolutionScale=1, NRHookPoint=0) + 8 表面工作集缓冲池 (NRMaxWorksets=8)，根治桌面 2K/4K 高帧率表面重建卡顿。",
    mfg: "【MFG 多帧生成策略】开启 DllMain 抢先挂钩 + NVIDIA 动态多帧生成 (DynamicMFG=1) + V3 方向性高锐度插值 (AdaptiveQualityProfile=2) + Reflex 强制低延迟护栏。",
  },
  rtx50_desktop: {
    label: "🚀 50 系列桌面卡 (Blackwell 原生直通)",
    neural: "【DLSS 5 神经渲染策略】直通 CUDA sm_120 (23 个 Blackwell 原生核函数) + 100% 满血工作分辨率 (NRResolutionScale=1) + 8 表面缓冲池 + 2026-10 极速运行时管线。",
    mfg: "【MFG 多帧生成策略】自动旁路所有 40 系二进制补丁 (TemporalFix=0, BlackwellFrameworkKernels=0, ForceFlipMeteringOff=0)，零冲突直通第 5 代 Tensor 硬件 Flip Metering + Dynamic MFG。",
  },
};

export const modelOptions: string[][] = [
  ["310.8.SF-v2", "310.8.SF-v2 · SmarterGamers"],
  ["310.8.0-RTX40", "310.8.0-RTX40 官方首发原版基线模型 (sm_75/86/89/120 · 全兼容)"],
];

export const stackOptions: string[][] = [
  ["baseline-310.9.1", "v2.2.9 黄金基线运行时 (DLSS 310.9.1.0 超分底座 + Dynamic MFG 310.9.16 · 推荐默认)"],
  ["oct2026-310.9.16", "2026-10 极速运行时 (DLSS 310.9.16 + SL 2.14.16 + Feeder 1.19.0 · 50系原生)"],
];

export const inputOptions: string[][] = [
  ["false", "原生输入模式 (QualityGuardMode=0 · 推荐绝大多数游戏 · 防止黑屏)"],
  ["true", "HDR UI 保护模式 (QualityGuardMode=2 · 仅限开启 HDR 的特定游戏)"],
];
