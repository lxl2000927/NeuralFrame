import type { Lab } from "./types";
export function getBridge(): Lab {
  if (!window.lab) throw Error("请通过 NeuralFrame 桌面程序打开此界面。");
  return window.lab;
}
