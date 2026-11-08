import { setLanguage, t } from '../../ui/src/i18n';
import { keyLabel } from '../../ui/src/overlay-hotkey';

const root = document.getElementById('panel');
let language = 'zh';
const cache = new Map();
// The native surface receives frequent telemetry with the same labels.
function translate(text) {
  if (language !== 'en' || !/[\u3400-\u9fff]/.test(text)) return text;
  if (!cache.has(text)) {
    if (cache.size >= 512) cache.clear();
    cache.set(text, t(text));
  }
  return cache.get(text);
}
const redraw = window.mountOverlayLive(root, { translate });
window.overlayRuntime.onPreferences(value => {
  window.applyOverlayTheme(root, value);
  root.dataset.overlayHotkey = keyLabel(value.hotkey);
  const next = value.language === 'en' ? 'en' : 'zh';
  if (next !== language) {
    language = next;
    setLanguage(next, false);
    redraw();
  }
  const footer = root.querySelector('.ol-live-hotkey');
  if (footer) footer.textContent = translate(`${root.dataset.overlayHotkey} 显示／隐藏 · 拖动标题栏移动 · 右下角缩放 · Home 高级菜单`);
});
