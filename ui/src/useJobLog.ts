import { useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "./bridge";
import { locale, t } from "./i18n";

const labels: Record<string, string> = {
  wuwaProxyConfigured: "已配置鸣潮独立加载器",
  wuwaExternalModelKept: "已保留外部变更后的模型和归属记录",
  restored: "已还原",
  deleted: "已移除",
  added: "已添加",
  replaced: "已替换",
  applyDone: "配置应用完成",
  restoreDone: "原始文件还原完成",
  skipSameVersion: "已保留相同版本",
  skipNewerVersion: "已保留较新版本",
  skipRuntimeArchitecture: "已跳过架构不匹配的运行库",
  addonInstalled: "插件已安装",
  addonEnabledInIni: "插件已在配置文件中启用",
  runningSetup: "正在运行安装程序",
  reshadeInstalled: "ReShade 已安装",
  reshadeAlreadyThere: "已保留现有 ReShade",
  reshadeSetupMissing: "未找到 ReShade 安装程序",
  reshadeNoAddonSupport: "当前 ReShade 不支持插件",
  reshadeXboxFallback: "已使用 Xbox 兼容安装方式",
  reshadeNewerAvailable: "有较新的 ReShade 版本",
  asiUpgraded: "ASI 加载器已升级",
  proxyUpgraded: "代理库已升级",
  vulkanLayerInstalled: "Vulkan 层已安装",
  vulkanLayerRemoved: "Vulkan 层已移除",
  vulkanLayerKept: "已保留 Vulkan 层",
  streamlineKept: "已保留现有 Streamline",
  backendSwitching: "正在切换渲染后端",
  backendRecovered: "已恢复中断的部署操作",
  restoreProfileWarning: "还原前未能保存配置",
  antiCheatRiskAccepted: "已确认反作弊风险",
  motionProviderReady: "运动矢量提供程序已就绪",
  motionProviderFallback: "已回退到备用运动矢量提供程序",
  legacyWrapperReady: "旧版图形接口兼容层已就绪",
  historySaveWarning: "历史记录未能完整读取或保存",
  driverNeuralFault: "检测到神经渲染驱动兼容问题",
  oldShaderCompiler: "检测到旧版着色器编译器",
  overlaySkipped: "本次已跳过游戏内面板",
  feedVkLayerReady: "Vulkan 互操作层已就绪",
  neuralModelKept: "已保留现有神经渲染模型",
  rivalConsumerSetAside: "冲突的神经渲染插件已移入备份",
  overlayNotForRoute: "当前渲染路径不支持游戏内面板",
  multipassNext: "多遍渲染组件已安装，可在游戏内 RenoDX 面板中配置",
  forwarderRetired: "已移除旧版转发器",
  optiDownloading: "正在下载并校验 OptiScaler",
  optiVerified: "OptiScaler 已通过校验",
  restoreRecovered: "正在使用保留的备份记录恢复文件",
};

export const JOB_LOG_LIMIT = 200;
type JobEntry = { id: number; time: number; code: string; value: unknown };
export type JobRow = JobEntry & { clock: string; title: string };

export function useJobLog(gameDir?: string) {
  const [entries, setEntries] = useState<JobEntry[]>([]);
  const sequence = useRef(0);
  const language = locale();
  const target = gameDir?.toLowerCase();
  useEffect(
    () =>
      getBridge().onJob((event) => {
        if (target && event.dir?.toLowerCase() !== target) return;
        const value = event.params ?? event.data;
        const entry = { id: ++sequence.current, time: Date.now(), code: event.code, value };
        setEntries((previous) => [...previous.slice(1 - JOB_LOG_LIMIT), entry]);
      }),
    [target],
  );
  const clock = useMemo(() => new Intl.DateTimeFormat(language, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }), [language]);
  const rows: JobRow[] = useMemo(() => entries.map(entry => ({
    ...entry, clock: clock.format(entry.time), title: Object.hasOwn(labels, entry.code) ? t(labels[entry.code]) : entry.code,
  })), [entries, clock]);
  // Keep the technical payload available to the home activity feed and diagnostic export.
  const lines = useMemo(() => rows.map(({ clock, title, value }) => {
    const detail = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
    return `[${clock}] ${title} ${detail}`.trimEnd();
  }), [rows]);
  return { rows, lines, clear: () => setEntries([]) };
}
