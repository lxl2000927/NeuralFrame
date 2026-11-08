import { useEffect, useMemo, useState } from "react";
import { getBridge } from "./bridge";
import { locale, t } from "./i18n";

const labels: Record<string, string> = {
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

export function useJobLog(gameDir?: string) {
  const [entries, setEntries] = useState<
    { time: number; code: string; detail: string }[]
  >([]);
  const language = locale();
  const target = gameDir?.toLowerCase();
  useEffect(
    () =>
      getBridge().onJob((event) => {
        if (target && event.dir?.toLowerCase() !== target) return;
        const value = event.params ?? event.data;
        const detail =
          typeof value === "string"
            ? value
            : value == null
              ? ""
              : JSON.stringify(value);
        const entry = { time: Date.now(), code: event.code, detail };
        setEntries((previous) => [...previous.slice(-199), entry]);
      }),
    [target],
  );
  const lines = useMemo(() => {
    const clock = new Intl.DateTimeFormat(language, { timeStyle: "medium" });
    return entries.map(({ time, code, detail }) => {
      const title = labels[code] ? t(labels[code]) : code;
      return `[${clock.format(time)}] ${title} ${detail}`.trimEnd();
    });
  }, [entries, language]);
  return { lines, clear: () => setEntries([]) };
}
