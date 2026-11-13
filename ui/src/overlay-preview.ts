// The desktop preview uses the same renderer and styles as the offscreen F8
// surface. It deliberately has no preload or runtime bridge and only sample data.
import "../../src/renderer/style.css";
import "../../src/renderer/overlay-lab.css";
import "../../src/renderer/overlay-controls.css";
import "../../src/renderer/overlay-compact.css";
import "../../src/renderer/overlay-surface.css";
import "../../src/renderer/overlay-typography.css";
import "./overlay-preview.css";
import "../../src/renderer/overlay-panel.js";
import "../../src/renderer/overlay-live.js";
import { setLanguage, t } from "./i18n";
import type { OverlayPrefs } from "./types";

const runtime = window as typeof window & {
  mountOverlayLive: (
    root: HTMLElement,
    options: { designOnly: boolean; translate: typeof t },
  ) => void;
  applyOverlayTheme: (
    root: HTMLElement,
    prefs: Pick<OverlayPrefs, "theme" | "custom">,
  ) => void;
};
const panel = document.getElementById("panel")!;
let currentLanguage = "";
window.addEventListener("message", (event) => {
  if (
    event.source !== parent ||
    event.data?.type !== "neuralframe-preview-config"
  )
    return;
  const config = event.data;
  if (
    !["green", "blue", "purple", "custom"].includes(config.theme) ||
    !["zh", "en"].includes(config.language)
  )
    return;
  const custom =
    config.custom && /^#[0-9a-f]{6}$/i.test(config.custom.accent)
      ? config.custom
      : null;
  panel.dataset.overlayHotkey =
    typeof config.hotkey === "string" ? config.hotkey.slice(0, 64) : "F8";
  setLanguage(config.language, false);
  runtime.applyOverlayTheme(panel, { theme: config.theme, custom });
  if (currentLanguage !== config.language) {
    currentLanguage = config.language;
    runtime.mountOverlayLive(panel, {
      designOnly: true,
      translate: t,
    });
  }
  const footer = panel.querySelector(".ol-live-hotkey");
  if (footer)
    footer.textContent = t(
      "{0} 显示／隐藏 · 拖动标题栏移动 · 右下角缩放 · Home 高级菜单",
      [panel.dataset.overlayHotkey],
    );
});
