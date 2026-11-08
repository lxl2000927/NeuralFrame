import { useSyncExternalStore } from "react";
import english from "./locales/en.json" with { type: "json" };

export type Language = "zh" | "en";
const catalog: Record<string, string> = english;
const reverse = new Map(Object.entries(catalog).map(([zh, en]) => [en, zh]));
let current: Language =
  typeof localStorage !== "undefined" &&
  localStorage.getItem("neuralframe.language") === "en"
    ? "en"
    : "zh";
const listeners = new Set<() => void>();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(catalog)
  .filter(([key]) => /\{\d+\}/.test(key))
  .flatMap(([zh, en]) => {
    const pattern = (text: string) =>
      new RegExp(
        "^" +
          text
            .split(/(\{\d+\})/)
            .map((part) =>
              /^\{\d+\}$/.test(part) ? "([\\s\\S]*?)" : escape(part),
            )
            .join("") +
          "$",
      );
    return [
      {
        zh,
        en,
        from: pattern(zh),
        order: [...zh.matchAll(/\{(\d+)\}/g)].map((m) => m[1]),
        language: "en",
      },
      {
        zh,
        en,
        from: pattern(en),
        order: [...en.matchAll(/\{(\d+)\}/g)].map((m) => m[1]),
        language: "zh",
      },
    ];
  });
const prefixes = Object.entries(catalog).filter(
  ([zh, en]) => zh.endsWith("：") && en.endsWith(": "),
);
export function locale() {
  return current === "en" ? "en-US" : "zh-CN";
}
export function t(
  source: string | null | undefined,
  values: unknown[] = [],
): string {
  if (!source) return "";
  let result =
    current === "en"
      ? catalog[source] || source
      : reverse.get(source) || source;
  if (!values.length && result === source) {
    for (const entry of patterns) {
      if (entry.language !== current) continue;
      const match = source.match(entry.from);
      if (match)
        return (current === "en" ? entry.en : entry.zh).replace(
          /\{(\d+)\}/g,
          (_, i) => t(match[entry.order.indexOf(i) + 1] || ""),
        );
    }
    for (const [zh, en] of prefixes) {
      const from = current === "en" ? zh : en;
      if (source.startsWith(from))
        return (current === "en" ? en : zh) + source.slice(from.length);
    }
  }
  return result.replace(/\{(\d+)\}/g, (token, i) =>
    i in values
      ? typeof values[i] === "string"
        ? t(values[i] as string)
        : String(values[i] ?? "")
      : token,
  );
}
export function dateTime(value: string | number | Date) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat(locale(), {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
}
export function setLanguage(value: string, persist = true) {
  const next: Language = value === "en" ? "en" : "zh";
  const changed = next !== current;
  current = next;
  if (persist && typeof localStorage !== "undefined")
    localStorage.setItem("neuralframe.language", current);
  if (typeof document !== "undefined") document.documentElement.lang = locale();
  if (persist && typeof window !== "undefined")
    void window.lab
      ?.setTrayLabels?.({ show: t("打开 NeuralFrame"), quit: t("退出") })
      .catch(() => {});
  if (changed) for (const listener of listeners) listener();
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
