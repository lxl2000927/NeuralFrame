import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Check,
  Code2,
  Keyboard,
  Palette,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Modal } from "../components";
import { errorText } from "../domain";
import { t, useLanguage } from "../i18n";
import { keyFromEvent, keyLabel } from "../overlay-hotkey";
import type {
  OverlayPrefs,
  OverlayLibrary,
  OverlayBridgeState,
  OverlayResult,
} from "../types";
import "./Overlay.css";

/* 自定义主题的派生变量：逐条照抄 renderer/overlay-panel.js 的 overlayThemeVars */
function overlayThemeVars(accent?: string): Record<string, string> {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(accent || ""));
  if (!hex) return {};
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const pair = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  const mix = (c: number, target: number, amount: number) =>
    pair(c + (target - c) * amount);
  return {
    "--ol-accent": `#${pair(r)}${pair(g)}${pair(b)}`,
    "--ol-bright": `#${mix(r, 255, 0.47)}${mix(g, 255, 0.47)}${mix(b, 255, 0.47)}`,
    "--ol-soft": `#${pair(r)}${pair(g)}${pair(b)}25`,
    "--ol-back": `#${mix(r, 16, 0.88)}${mix(g, 21, 0.88)}${mix(b, 25, 0.88)}`,
  };
}
const THEMES = [
  { id: "green", name: "翡翠绿", accent: "#8bc400" },
  { id: "blue", name: "蔚蓝", accent: "#4aa8ee" },
  { id: "purple", name: "紫晶", accent: "#b45dea" },
];

function Preview({
  theme,
  custom,
  hotkey,
  thumbnail = false,
}: {
  theme: string;
  custom: OverlayPrefs["custom"];
  hotkey: OverlayPrefs["hotkey"];
  thumbnail?: boolean;
}) {
  const language = useLanguage();
  const frame = useRef<HTMLIFrameElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(620),
    [scale, setScale] = useState(1);
  const configure = useCallback(
    () =>
      frame.current?.contentWindow?.postMessage(
        {
          type: "neuralframe-preview-config",
          theme,
          custom,
          hotkey: keyLabel(hotkey),
          language,
          thumbnail,
        },
        "*",
      ),
    [theme, custom, hotkey.key, hotkey.mods, language, thumbnail],
  );
  useEffect(configure, [configure]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "neuralframe-preview-height"
      )
        return;
      const next = event.data.height;
      if (Number.isFinite(next) && next >= 54 && next <= 2000) setHeight(next);
    };
    const observer = new ResizeObserver(([entry]) =>
      setScale(Math.min(1, entry.contentRect.width / 534)),
    );
    if (stage.current) observer.observe(stage.current);
    window.addEventListener("message", receive);
    return () => {
      observer.disconnect();
      window.removeEventListener("message", receive);
    };
  }, []);
  return (
    <div
      ref={stage}
      className={`overlay-preview-stage ${thumbnail ? "is-thumbnail" : ""}`}
      style={{ height: height * scale }}
    >
      <iframe
        ref={frame}
        src="./overlay-preview.html"
        onLoad={configure}
        title={t(thumbnail ? "主题缩略图" : "交互式面板预览")}
        tabIndex={thumbnail ? -1 : 0}
        aria-hidden={thumbnail || undefined}
        inert={thumbnail}
        style={{ height, transform: `scale(${scale})` }}
      />
    </div>
  );
}

export function Overlay({
  message,
  active = true,
}: {
  message: (s: string) => void;
  active?: boolean;
}) {
  const [prefs, setPrefs] = useState<OverlayPrefs | null>(null);
  const [library, setLibrary] = useState<OverlayLibrary | null>(null);
  const [bridge, setBridge] = useState<OverlayBridgeState | null>(null);
  const [error, setError] = useState(""),
    [bridgeError, setBridgeError] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const locked = useRef(false),
    generation = useRef(0);
  const [preview, setPreview] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  const [name, setName] = useState(""),
    [accent, setAccent] = useState("#ff7a00");
  const [dialogError, setDialogError] = useState("");
  const [hotkey, setHotkey] = useState<OverlayPrefs["hotkey"] | null>(null);
  const [keyError, setKeyError] = useState("");
  const capture = useRef<HTMLButtonElement>(null);
  const refreshBridge = useRef<() => void>(() => {});
  const refresh = useCallback(async () => {
    refreshBridge.current();
    const revision = ++generation.current;
    setLoading(true);
    try {
      const [settings, entries] = await Promise.all([
        getBridge().overlayPreferences(),
        getBridge().overlays(),
      ]);
      if (revision !== generation.current) return;
      if (!settings.ok) throw Error(settings.error);
      if (!entries.ok) throw Error(entries.error);
      setPrefs(settings.value);
      setLibrary(entries.value);
      setError("");
    } catch (e) {
      if (revision === generation.current) setError(errorText(e));
    } finally {
      if (revision === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (active) void refresh();
    return () => {
      ++generation.current;
    };
  }, [active, refresh]);
  // The install preference says nothing about service or game connection health.
  // Poll only this lightweight status while the page and window are visible.
  useEffect(() => {
    if (!active) return;
    let disposed = false,
      revision = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const request = ++revision;
      if (document.hidden || disposed) return;
      try {
        const result = await getBridge().overlayBridge();
        if (disposed || request !== revision) return;
        if (!result.ok) throw Error(result.error);
        setBridge(result.value);
        setBridgeError("");
      } catch (e) {
        if (!disposed && request === revision) {
          setBridge(null);
          setBridgeError(errorText(e));
        }
      } finally {
        if (!disposed && request === revision) timer = setTimeout(poll, 5000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      ++revision;
      if (!document.hidden) void poll();
    };
    refreshBridge.current = visibility;
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      disposed = true;
      refreshBridge.current = () => {};
      ++revision;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active]);
  useEffect(() => {
    if (hotkey) capture.current?.focus();
  }, [Boolean(hotkey)]);

  const save = async (patch: Partial<OverlayPrefs>) => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setDialogError("");
    try {
      const result = await getBridge().saveOverlayPreferences(patch);
      if (!result.ok) throw Error(result.error);
      ++generation.current;
      setPrefs(result.value);
      setLoading(false);
      message(t("叠加层设置已保存。"));
      return true;
    } catch (e) {
      const text = errorText(e);
      setDialogError(text);
      message(text);
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const action = async (
    fn: () => Promise<OverlayResult<unknown>>,
    success?: string,
  ) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) throw Error(result.error);
      // null is the native dialog's cancelled result, never an installation.
      if (result.value != null && success) message(t(success));
      await refresh();
    } catch (e) {
      message(errorText(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const themes = [
    ...THEMES,
    ...(prefs?.custom ? [{ id: "custom", ...prefs.custom }] : []),
  ];
  const selectedPreview = themes.find((th) => th.id === preview);
  const builtin = library?.overlays.find((entry) => entry.builtin);
  const customEntries =
    library?.overlays.filter((entry) => !entry.builtin) || [];
  const status = !bridge
    ? [
        "pending",
        bridgeError ? "无法读取叠加层服务状态。" : "正在检测叠加层服务…",
      ]
    : !bridge.addon
      ? ["error", "缺少内置面板插件，游戏无法加载 F8 面板。"]
      : !bridge.listening
        ? ["error", "叠加层服务未运行，请重启 NeuralFrame。"]
        : bridge.connected
          ? [
              "connected",
              bridge.game
                ? "叠加层已连接游戏，并收到运行数据。"
                : "已连接游戏，等待面板运行数据。",
            ]
          : [
              "ready",
              "叠加层服务已就绪。请保持 NeuralFrame 运行，在游戏中按 {0} 打开面板。",
            ];
  return (
    <div className="page-scroll overlay-page">
      <div className="overlay-head">
        <div>
          <h2>{t("面板主题")} <small className="overlay-beta">Beta</small></h2>
          <p className="muted">
            {t("选择配色风格，先预览，再应用到游戏内面板。")}
          </p>
        </div>
        <div className="overlay-toolbar">
          <label
            className="check-label overlay-switch"
            title={t(
              "从「游戏 → 安装路线」安装 DLSS 时，一并安装内置面板。",
            )}
          >
            <input
              type="checkbox"
              aria-label={t("随 DLSS 安装叠加层")}
              checked={prefs?.enabled ?? false}
              disabled={!prefs || busy || loading}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />
            {t("随 DLSS 安装叠加层")}
          </label>
          <button
            disabled={busy}
            onClick={() => void action(() => getBridge().overlaySource())}
          >
            <Code2 size={15} />
            {t("开发者文件")}
          </button>
          <button
            disabled={!prefs || busy}
            onClick={() => {
              setHotkey({ ...prefs!.hotkey });
              setKeyError("");
              setDialogError("");
            }}
          >
            <Keyboard size={15} />
            {t("快捷键")} · {prefs ? keyLabel(prefs.hotkey) : "—"}
          </button>
          <button
            disabled={!prefs || busy}
            onClick={() => {
              setName(prefs?.custom?.name || t("我的主题"));
              setAccent(prefs?.custom?.accent || "#ff7a00");
              setDialogError("");
              setCreating(true);
            }}
          >
            <Palette size={15} />
            {t("创建主题")}
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(
                () => getBridge().overlayAdd(),
                "自定义叠加层已添加到组件库。",
              )
            }
          >
            <Plus size={16} />
            {t("添加叠加层")}
          </button>
          <button
            className="icon-button"
            aria-label={t("刷新叠加层列表")}
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <p className="overlay-install-hint muted">
        {t("通过档位配置的游戏，可在下方选择「单独安装…」添加面板。主题和快捷键会同步到已连接的内置面板。")}
      </p>
      <div className="overlay-status" data-state={status[0]} role="status">
        <i />
        <div>
          {t(status[1], [prefs ? keyLabel(prefs.hotkey) : "…"])}
          {bridgeError && <small>{t(bridgeError)}</small>}
          {bridge?.addon === false && bridge.addonFile && (
            <small className="path">{bridge.addonFile}</small>
          )}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button disabled={loading} onClick={() => void refresh()}>
            {t("重试")}
          </button>
        </p>
      )}
      {!prefs || !library ? (
        !error && <Loading text={t("读取叠加层设置…")} />
      ) : (
        <>
          <div className="overlay-themes">
            {themes.map((theme) => (
              <article
                key={theme.id}
                className={`overlay-theme-card ${prefs.theme === theme.id ? "selected" : ""}`}
                data-overlay-theme={theme.id}
                style={
                  {
                    "--theme-accent": theme.accent,
                    ...(theme.id === "custom"
                      ? overlayThemeVars((theme as { accent?: string }).accent)
                      : {}),
                  } as CSSProperties
                }
              >
                {active && (
                  <Preview
                    theme={theme.id}
                    custom={prefs.custom}
                    hotkey={prefs.hotkey}
                    thumbnail
                  />
                )}
                <div className="overlay-theme-bottom">
                  <h2>{theme.id === "custom" ? theme.name : t(theme.name)}</h2>
                  <div className="inline-actions">
                    <button
                      aria-pressed={prefs.theme === theme.id}
                      disabled={busy}
                      onClick={() => void save({ theme: theme.id })}
                    >
                      {prefs.theme === theme.id && <Check size={14} />}
                      {t(prefs.theme === theme.id ? "已选中" : "选择")}
                    </button>
                    <button
                      onClick={() => {
                        setDialogError("");
                        setPreview(theme.id);
                      }}
                    >
                      {t("预览")}
                    </button>
                    {theme.id === "custom" && (
                      <button
                        className="icon-button danger"
                        aria-label={t("删除自定义主题")}
                        disabled={busy}
                        onClick={() =>
                          void save({
                            custom: null,
                            theme:
                              prefs.theme === "custom" ? "green" : prefs.theme,
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="overlay-builtin">
            <div>
              <strong>{t("内置 F8 面板插件")}</strong>
              <small>{t(builtin?.ready ? "本地可用" : "插件文件缺失")}</small>
            </div>
            <button
              disabled={busy || !builtin?.ready}
              onClick={() =>
                void action(
                  () => getBridge().overlayInstall("builtin"),
                  "叠加层已安装到游戏目录。",
                )
              }
            >
              {t("单独安装…")}
            </button>
          </div>
          <p className="muted">
            {t(
              "单独安装只复制面板插件，需要目标游戏已经安装支持插件的 ReShade。",
            )}
          </p>
          <details
            className="advanced overlay-library"
            open={customEntries.length > 0}
          >
            <summary>
              {t("自定义叠加层")} ({customEntries.length})
            </summary>
            {customEntries.length ? (
              customEntries.map((entry) => (
                <article className="overlay-entry" key={entry.id}>
                  <div>
                    <strong>{entry.name}</strong>
                    <p className="muted">
                      {t("外部原生插件不支持此处的主题预览。")}
                    </p>
                    <small>{entry.architecture}-bit</small>
                    {!entry.ready && <small className="error">{t("不可用")}</small>}
                  </div>
                  <div className="inline-actions">
                    <button
                      disabled={busy || !entry.ready}
                      onClick={() =>
                        void action(
                          () => getBridge().overlayInstall(entry.id),
                          "叠加层已安装到游戏目录。",
                        )
                      }
                    >
                      {t("单独安装…")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(() => getBridge().overlayRemove(entry.id), "已移除")
                      }
                    >
                      {t("从组件库移除")}
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <Empty>
                {t(
                  "可添加 .addon64 或 .addon32 文件；添加只保存副本，不会直接安装到游戏。",
                )}
              </Empty>
            )}
          </details>
          <details className="advanced overlay-installations">
            <summary>
              {t("已有安装记录")} ({library.installations.length})
            </summary>
            {library.installations.length ? (
              library.installations.map((entry) => (
                <article className="overlay-entry" key={entry.id}>
                  <div>
                    <strong>
                      {entry.overlayId === "builtin"
                        ? t("内置 F8 面板插件")
                        : entry.name}
                    </strong>
                    <p className="path">{entry.directory}</p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(() => getBridge().overlayUninstall(entry.id), "已移除")
                    }
                  >
                    {t("仅移除叠加层")}
                  </button>
                </article>
              ))
            ) : (
              <Empty>{t("暂无面板安装记录。")}</Empty>
            )}
          </details>
          {!!library.errors.length && (
            <div className="error" role="alert">
              {library.errors.map((text, i) => (
                <p key={i}>{t(text)}</p>
              ))}
            </div>
          )}
        </>
      )}
      {prefs && selectedPreview && (
        <Modal
          title={t("预览 · {0}", [
            selectedPreview.id === "custom"
              ? selectedPreview.name
              : t(selectedPreview.name),
          ])}
          onClose={() => setPreview(null)}
          footer={
            <>
              <button onClick={() => setPreview(null)}>{t("关闭预览")}</button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void save({ theme: selectedPreview.id }).then((ok) => {
                    if (ok) setPreview(null);
                  })
                }
              >
                {t("使用此主题")}
              </button>
            </>
          }
        >
          <p className="muted">
            {t(
              "交互演示，不会修改游戏参数。此处与实际 F8 面板共用同一套控件。",
            )}
          </p>
          <Preview
            theme={selectedPreview.id}
            custom={prefs.custom}
            hotkey={prefs.hotkey}
          />
          {dialogError && (
            <p className="error" role="alert">
              {t(dialogError)}
            </p>
          )}
        </Modal>
      )}
      {prefs && creating && (
        <Modal
          title={t("创建主题")}
          onClose={() => {
            if (!busy) setCreating(false);
          }}
          footer={
            <>
              <button disabled={busy} onClick={() => setCreating(false)}>
                {t("取消")}
              </button>
              <button
                className="primary"
                disabled={busy || !name.trim()}
                onClick={() =>
                  void save({
                    custom: { name: name.trim(), accent },
                    theme: "custom",
                  }).then((ok) => {
                    if (ok) setCreating(false);
                  })
                }
              >
                {t("保存并使用")}
              </button>
            </>
          }
        >
          <div className="overlay-custom-fields">
            <label>
              {t("主题名称")}
              <input
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              {t("强调色")}
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <p className="muted">
            {t("其余配色由强调色自动生成；保存后会立即选中此主题。")}
          </p>
          <Preview
            theme="custom"
            custom={{ name, accent }}
            hotkey={prefs.hotkey}
          />
          {dialogError && (
            <p className="error" role="alert">
              {t(dialogError)}
            </p>
          )}
        </Modal>
      )}
      {hotkey && (
        <Modal
          title={t("更改面板快捷键")}
          onClose={() => {
            if (!busy) setHotkey(null);
          }}
          footer={
            <>
              <button disabled={busy} onClick={() => setHotkey(null)}>
                {t("取消")}
              </button>
              <button
                className="primary"
                disabled={busy || Boolean(keyError)}
                onClick={() =>
                  void save({ hotkey }).then((ok) => {
                    if (ok) setHotkey(null);
                  })
                }
              >
                {t("保存")}
              </button>
            </>
          }
        >
          <p>{t("点击下方区域并按下组合键，例如 F9 或 Ctrl + Shift + O。")}</p>
          <button
            ref={capture}
            className="overlay-key-capture"
            aria-label={t("录制面板快捷键")}
            disabled={busy}
            onKeyDown={(e) => {
              if (["Tab", "Escape"].includes(e.key)) return;
              e.preventDefault();
              e.stopPropagation();
              if (["Control", "Alt", "Shift"].includes(e.key)) return;
              const next = keyFromEvent(e);
              if (next) {
                setHotkey(next);
                setKeyError("");
              } else setKeyError(t("此按键保留或不受支持，请选择其他组合键。"));
            }}
          >
            {keyLabel(hotkey)}
          </button>
          <p className="muted">
            {t(
              "支持字母、数字、F1–F24 和 Ctrl / Alt / Shift 组合；Home、Escape、Windows 键保留。",
            )}
          </p>
          {(keyError || dialogError) && (
            <p className="error" role="alert">
              {t(keyError || dialogError)}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
