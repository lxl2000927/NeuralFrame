import type { OverlayPrefs } from "./types";
const special: Record<string, number> = {
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
};
export function keyFromEvent(
  event: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
  >,
): OverlayPrefs["hotkey"] | null {
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.charCodeAt(3)
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.charCodeAt(5)
      : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)
        ? 111 + Number(event.code.slice(1))
        : special[event.code];
  return key && !event.metaKey
    ? {
        key,
        mods:
          (event.ctrlKey ? 1 : 0) |
          (event.altKey ? 2 : 0) |
          (event.shiftKey ? 4 : 0),
      }
    : null;
}
export function keyLabel(hotkey: OverlayPrefs["hotkey"]) {
  const names: Record<number, string> = {
    32: "Space",
    33: "PageUp",
    34: "PageDown",
    35: "End",
    37: "Left",
    38: "Up",
    39: "Right",
    40: "Down",
    45: "Insert",
    46: "Delete",
  };
  const key =
    hotkey.key >= 112 && hotkey.key <= 135
      ? `F${hotkey.key - 111}`
      : names[hotkey.key] || String.fromCharCode(hotkey.key);
  return [
    hotkey.mods & 1 ? "Ctrl" : "",
    hotkey.mods & 2 ? "Alt" : "",
    hotkey.mods & 4 ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join(" + ");
}
