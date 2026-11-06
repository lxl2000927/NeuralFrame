import type { Draft, Status } from "./types";
export const profiles = [
  ["rtx40_laptop", "RTX 40 笔记本"],
  ["rtx40_desktop", "RTX 40 桌面显卡"],
  ["rtx50_desktop", "RTX 50 系列"],
];
export function readDraft(status: Status): Draft {
  const nr = status.neural,
    fg = status.mfg?.currentConfig;
  return {
    neuralMode: nr?.mode || "off",
    neuralModelId: nr?.currentModel?.id || "310.8.SF-v2",
    mfgMode: fg?.mode || "off",
    hardwareProfile: status.hardwareProfile || "rtx40_laptop",
    runtimeStack:
      nr?.configuredRuntimeStack || nr?.runtimeStack || "baseline-310.9.1",
    hdrCompatibility: fg?.settings?.qualityGuardMode === 2,
  };
}
export function changedFields(base: Draft, draft: Draft) {
  return (Object.keys(draft) as (keyof Draft)[]).filter(
    (k) => base[k] !== draft[k],
  );
}
export function applyPatch(base: Draft, draft: Draft): Partial<Draft> {
  if (
    !["off", "legacy", "latest_compatible"].includes(draft.neuralMode) ||
    !["off", "x2", "x3", "x4"].includes(draft.mfgMode) ||
    !profiles.some(([id]) => id === draft.hardwareProfile) ||
    !["baseline-310.9.1", "oct2026-310.9.16"].includes(draft.runtimeStack)
  )
    throw Error("此组件配置包含尚不支持的值，请重新选择。");
  const fields = changedFields(base, draft);
  if (!fields.length) throw Error("没有待应用的修改。");
  const patch: Partial<Draft> = { hardwareProfile: draft.hardwareProfile };
  if (
    fields.some((k) =>
      [
        "neuralMode",
        "neuralModelId",
        "runtimeStack",
        "hardwareProfile",
      ].includes(k),
    ) &&
    (draft.neuralMode !== "off" || fields.includes("neuralMode"))
  ) {
    patch.neuralMode = draft.neuralMode;
    patch.neuralModelId = draft.neuralModelId;
    patch.runtimeStack = draft.runtimeStack;
  }
  if (
    fields.some((k) =>
      ["mfgMode", "hdrCompatibility", "hardwareProfile"].includes(k),
    ) &&
    (draft.mfgMode !== "off" || fields.includes("mfgMode"))
  ) {
    patch.mfgMode = draft.mfgMode;
    patch.hdrCompatibility = draft.hdrCompatibility;
  }
  if (!patch.neuralMode && !patch.mfgMode)
    throw Error("相关功能尚未开启，请先选择要应用的神经渲染或补帧模式。");
  return patch;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const size = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
