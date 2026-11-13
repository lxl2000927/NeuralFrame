import type { StatusDiagnostics, VramBudget } from "./types";

export type DiagnosticCheck = { title: string; state: "pass" | "warn" | "idle" | "estimate" | "unknown"; message: string };
export function vramEstimateLevel(budget?: VramBudget) {
  if (!budget?.vramTotalMB || budget.usagePercent == null) return "unknown";
  return budget.level ?? (budget.usagePercent >= 92 ? "caution" : "safe");
}
// These are disk/configuration checks. None establishes successful GPU execution.
export function diagnosticChecks(diagnostics: StatusDiagnostics): DiagnosticCheck[] {
  const d = diagnostics.coExecution || {};
  const conflicts = d.dllConflicts ?? diagnostics.dllConflicts;
  const level = vramEstimateLevel(d.vramBudget);
  return [
    { title: "模块 DLL 冲突检查", state: !conflicts ? "unknown" : conflicts.length ? "warn" : "pass",
      message: !conflicts ? "尚无检查数据" : conflicts.length ? "发现冲突，请展开下方详情。" : "无 DLL 命名或 Hook 冲突" },
    { title: "Streamline / NGX 注入链协同", state: !d.slChainCheck ? "unknown" : d.slChainCheck.ok ? "pass" : "warn",
      message: d.slChainCheck?.message || "尚无检查数据" },
    { title: "运动矢量与补帧质量保护", state: !d.motionVectorCheck ? "unknown" : !d.bothActive ? "idle" : d.motionVectorCheck.configurationSupported === false ? "unknown" : d.motionVectorCheck.mitigationActive ? "pass" : "warn",
      message: !d.motionVectorCheck ? "尚无检查数据" : !d.bothActive ? "未同时配置神经渲染与补帧，无需检查双模块协同。" : d.motionVectorCheck.configurationSupported === false ? d.motionVectorCheck.message : d.motionVectorCheck.mitigationActive ? "已检测到边界伪影缓解配置，实际插帧质量需在游戏中确认。" : "未检测到边界伪影缓解配置。" },
    { title: "HUD / HDR 闪烁与拖影抑制", state: !d.hudFlickerCheck || d.hudFlickerCheck.configurationSupported === false ? "unknown" : d.hudFlickerCheck.hdrGameNeedsGuard ? "warn" : "pass",
      message: !d.hudFlickerCheck ? "尚无检查数据" : d.hudFlickerCheck.configurationSupported === false ? d.hudFlickerCheck.message : d.hudFlickerCheck.hdrGameNeedsGuard ? "此游戏有 HDR UI 保护建议，请按实际 HDR 状态选择输入策略。" : String(d.hudFlickerCheck.qualityGuardMode) === "2" ? "已配置 HDR UI 保护；画面稳定性需在游戏中确认。" : "当前采用原生输入策略；画面稳定性需在游戏中确认。" },
    { title: "显存预算", state: level === "unknown" ? "unknown" : level === "safe" ? "estimate" : "warn",
      message: level === "unknown" ? "尚无有效显存预算数据" : "按硬件档位和配置的神经渲染、补帧模式估算。游戏实际占用需在运行时测量。" },
    { title: "Reflex 帧同步与延迟控制", state: !d.reflexCheck ? "unknown" : d.reflexCheck.hasReflexDll ? "pass" : "unknown",
      message: !d.reflexCheck ? "尚无检查数据" : d.reflexCheck.hasReflexDll ? "已检测到 Reflex DLL，是否执行需在游戏中验证。" : "未检测到独立 Reflex DLL，无法据此判断延迟控制是否生效。" },
    { title: "游戏退出后完整恢复能力", state: !d.backupCheck ? "unknown" : !d.backupCheck.ok ? "warn" : d.backupCheck.hasManifest === false ? "idle" : "pass",
      message: d.backupCheck?.message || "尚无检查数据" },
  ];
}
