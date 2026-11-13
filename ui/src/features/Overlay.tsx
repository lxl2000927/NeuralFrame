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
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { getBridge } from "../bridge";
import { useWindowReturn } from "../useWindowReturn";
import { Loading, Modal } from "../components";
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

const THEMES = [
  { id: "green", name: "翡翠绿", accent: "#8bc400" },
  { id: "blue", name: "蔚蓝", accent: "#4aa8ee" },
  { id: "purple", name: "紫晶", accent: "#b45dea" },
];

type Appearance = Pick<OverlayPrefs, "theme" | "custom">;

function sameAppearance(a: Appearance, b: Appearance) {
  return (
    a.theme === b.theme &&
    a.custom?.name === b.custom?.name &&
    a.custom?.accent === b.custom?.accent
  );
}

function Preview({
  theme,
  custom,
  hotkey,
}: {
  theme: string;
  custom: OverlayPrefs["custom"];
  hotkey: OverlayPrefs["hotkey"];
}) {
  const language = useLanguage();
  const frame = useRef<HTMLIFrameElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 534, height: 330 });
  const scale = Math.min(1, Math.max(1, bounds.width) / 534);
  const configure = useCallback(
    () =>
      frame.current?.contentWindow?.postMessage(
        {
          type: "neuralframe-preview-config",
          theme,
          custom,
          hotkey: keyLabel(hotkey),
          language,
        },
        "*",
      ),
    [theme, custom, hotkey.key, hotkey.mods, language],
  );
  useEffect(configure, [configure]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setBounds({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (stage.current) observer.observe(stage.current);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={stage} className="overlay-preview-stage">
      <iframe
        ref={frame}
        src="./overlay-preview.html"
        onLoad={configure}
        title={t("交互式面板预览")}
        style={{ height: bounds.height / scale, transform: `scale(${scale})` }}
      />
    </div>
  );
}

export function Overlay({
  message,
  active = true,
  refreshToken = 0,
}: {
  message: (s: string) => void;
  active?: boolean;
  refreshToken?: number;
}) {
  const [prefs, setPrefs] = useState<OverlayPrefs | null>(null);
  const [library, setLibrary] = useState<OverlayLibrary | null>(null);
  const [bridge, setBridge] = useState<OverlayBridgeState | null>(null);
  const [prefsError, setPrefsError] = useState(""),
    [libraryError, setLibraryError] = useState(""),
    [bridgeError, setBridgeError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false),
    prefsRevision = useRef(0),
    libraryRevision = useRef(0);
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [windowVisible, setWindowVisible] = useState(!document.hidden);
  const [dialogError, setDialogError] = useState("");
  const [hotkey, setHotkey] = useState<OverlayPrefs["hotkey"] | null>(null);
  const [keyError, setKeyError] = useState("");
  const currentAppearance = appearance || prefs;
  const appearanceDirty = !!(
    prefs &&
    appearance &&
    !sameAppearance(appearance, prefs)
  );
  const returnRevision = useWindowReturn(
    active,
    busy || !!hotkey || appearanceDirty,
  );
  const capture = useRef<HTMLButtonElement>(null);
  const refreshBridge = useRef<() => void>(() => {});
  const readPrefs = useCallback(async () => {
    const revision = ++prefsRevision.current;
    setPrefsError("");
    try {
      const settings = await getBridge().overlayPreferences();
      if (revision !== prefsRevision.current) return;
      if (!settings.ok) throw Error(settings.error);
      setPrefs(settings.value);
      setAppearance((current) =>
        current && sameAppearance(current, settings.value) ? null : current,
      );
    } catch (e) {
      if (revision === prefsRevision.current) setPrefsError(errorText(e));
    }
  }, []);
  const readLibrary = useCallback(async () => {
    const revision = ++libraryRevision.current;
    setLibraryError("");
    try {
      const entries = await getBridge().overlays();
      if (revision !== libraryRevision.current) return;
      if (!entries.ok) throw Error(entries.error);
      setLibrary(entries.value);
    } catch (e) {
      if (revision === libraryRevision.current) setLibraryError(errorText(e));
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void readPrefs();
    void readLibrary();
    return () => {
      ++prefsRevision.current;
      ++libraryRevision.current;
    };
  }, [active, refreshToken, returnRevision, readPrefs, readLibrary]);
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
      setWindowVisible(!document.hidden);
      clearTimeout(timer);
      ++revision;
      if (!document.hidden) void poll();
    };
    refreshBridge.current = visibility;
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      disposed = true;
      refreshBridge.current = () => {};
      ++revision;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, refreshToken, returnRevision]);
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
      ++prefsRevision.current;
      setPrefs(result.value);
      setAppearance((current) =>
        current && sameAppearance(current, result.value) ? null : current,
      );
      setPrefsError("");
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
      if (result.value !== null && success) {
        message(t(success));
        await readLibrary();
        refreshBridge.current();
      }
    } catch (e) {
      message(errorText(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const themes = [
    ...THEMES,
    {
      id: "custom",
      name: "自定义",
      accent: currentAppearance?.custom?.accent || "#ff7a00",
    },
  ];
  const builtin = library?.overlays.find((entry) => entry.builtin);
  const customEntries =
    library?.overlays.filter((entry) => !entry.builtin) || [];
  const stageAppearance = (next: Appearance) => {
    setAppearance(prefs && sameAppearance(next, prefs) ? null : next);
  };
  const selectTheme = (theme: string) => {
    if (!prefs || busy) return;
    setDialogError("");
    // A hidden, invalid custom draft must not prevent applying a built-in theme.
    // Keep the saved custom theme intact when abandoning its invalid edits.
    const custom =
      theme !== "custom" &&
      currentAppearance?.custom &&
      !currentAppearance.custom.name.trim()
        ? prefs.custom
        : currentAppearance?.custom;
    stageAppearance({
      theme,
      custom:
        custom ||
        (theme === "custom"
          ? { name: t("我的主题"), accent: "#ff7a00" }
          : null),
    });
  };
  const editCustom = (patch: Partial<NonNullable<OverlayPrefs["custom"]>>) => {
    if (currentAppearance?.custom)
      stageAppearance({
        theme: "custom",
        custom: { ...currentAppearance.custom, ...patch },
      });
  };
  const applyAppearance = async () => {
    if (appearance && (await save(appearance))) setAppearance(null);
  };
  const connection = !bridge
    ? t("状态未知")
    : !bridge.listening
      ? t("未连接")
      : bridge.connected
        ? t(bridge.game ? "已连接 · 有运行数据" : "已连接 · 等待数据")
        : t("等待游戏连接");
  return (
    <div className="page-scroll overlay-page">
      <div className="overlay-intro">
        <p>{t("管理 NeuralFrame 游戏内面板的外观、快捷键与插件安装。")}</p>
        <details className="overlay-more">
          <summary aria-label={t("更多叠加层操作")}>
            <MoreHorizontal size={18} />
          </summary>
          <button
            disabled={busy}
            onClick={() => void action(() => getBridge().overlaySource())}
          >
            <Code2 size={14} />
            {t("开发者文件")}
          </button>
        </details>
      </div>
      <div className="overlay-health" role="group" aria-label={t("面板状态")}>
        <div data-state={bridge?.addon === false ? "error" : "neutral"}>
          <span>{t("插件文件")}</span>
          <strong>
            {t(!bridge ? "状态未知" : bridge.addon ? "文件齐全" : "文件缺失")}
          </strong>
        </div>
        <div data-state={bridge?.listening === false ? "error" : "neutral"}>
          <span>{t("本地服务")}</span>
          <strong>
            {t(!bridge ? "状态未知" : bridge.listening ? "运行中" : "未运行")}
          </strong>
        </div>
        <div
          data-state={
            bridge?.listening && bridge.connected ? "connected" : "neutral"
          }
        >
          <span>{t("游戏连接")}</span>
          <strong>{connection}</strong>
        </div>
      </div>
      <p className="overlay-connection-hint muted" role="status">
        {t(
          bridge?.connected && bridge.listening
            ? "请保持 NeuralFrame 运行，使用 {0} 打开已连接的内置面板。"
            : "游戏加载面板插件后才会建立连接；文件齐全或服务运行不代表已经安装到游戏。",
          [prefs ? keyLabel(prefs.hotkey) : "…"],
        )}
      </p>
      {bridgeError && (
        <p className="error" role="alert">
          {t(bridgeError)}{" "}
          <button onClick={() => refreshBridge.current()}>{t("重试")}</button>
        </p>
      )}
      {bridge?.addon === false && (
        <p className="error">{t("缺少内置面板插件，游戏无法加载 F8 面板。")}</p>
      )}
      {bridge?.listening === false && (
        <p className="error">{t("叠加层服务未运行，请重启 NeuralFrame。")}</p>
      )}
      {prefsError && (
        <p className="error" role="alert">
          {t(prefsError)}{" "}
          <button onClick={() => void readPrefs()}>{t("重试")}</button>
        </p>
      )}

      <section className="overlay-workbench" aria-label={t("面板外观")}>
        <div className="overlay-preview-pane">
          <div className="overlay-preview-label">
            <strong>{t("外观预览")}</strong>
            <small>{t("交互演示 · 不会修改游戏参数")}</small>
          </div>
          <div className="overlay-preview-canvas">
            {prefs && currentAppearance
              ? active &&
                windowVisible && (
                  <Preview
                    theme={currentAppearance.theme}
                    custom={currentAppearance.custom}
                    hotkey={prefs.hotkey}
                  />
                )
              : !prefsError && <Loading text={t("读取面板设置…")} />}
          </div>
        </div>
        <div className="overlay-settings-pane">
          <div className="overlay-settings-heading">
            <h2>{t("面板外观")}</h2>
            <small>
              {t(appearanceDirty ? "外观尚未应用" : "当前外观已保存")}
            </small>
          </div>
          <div
            className="overlay-theme-options"
            role="group"
            aria-label={t("主题配色")}
          >
            {themes.map((theme) => (
              <button
                key={theme.id}
                disabled={!prefs || busy}
                aria-pressed={currentAppearance?.theme === theme.id}
                onClick={() => selectTheme(theme.id)}
                style={{ "--theme-color": theme.accent } as CSSProperties}
              >
                <span className="overlay-color-dot" aria-hidden="true">
                  {currentAppearance?.theme === theme.id && <Check size={12} />}
                </span>
                {t(theme.name)}
              </button>
            ))}
          </div>
          {currentAppearance?.theme === "custom" &&
            currentAppearance.custom && (
              <div className="overlay-custom-fields">
                <label>
                  {t("主题名称")}
                  <input
                    value={currentAppearance.custom.name}
                    maxLength={32}
                    disabled={busy}
                    onChange={(e) => editCustom({ name: e.target.value })}
                  />
                </label>
                <label>
                  {t("强调色")}
                  <input
                    type="color"
                    value={currentAppearance.custom.accent}
                    disabled={busy}
                    onChange={(e) => editCustom({ accent: e.target.value })}
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label={t("删除自定义主题")}
                  disabled={busy}
                  onClick={() =>
                    stageAppearance({ theme: "green", custom: null })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          <p className="muted overlay-theme-hint">
            {t("选择配色仅改变预览；应用后同步到已连接的 NeuralFrame 面板。")}
          </p>
          <div className="inline-actions overlay-appearance-actions">
            <button
              disabled={busy || !appearanceDirty}
              onClick={() => {
                setAppearance(null);
                setDialogError("");
              }}
            >
              {t("撤销")}
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !appearanceDirty ||
                (currentAppearance?.theme === "custom" &&
                  !currentAppearance.custom?.name.trim())
              }
              onClick={() => void applyAppearance()}
            >
              {t("应用外观")}
            </button>
          </div>
          {dialogError && !hotkey && (
            <p className="error" role="alert">
              {t(dialogError)}
            </p>
          )}
          <div className="overlay-setting-line">
            <span>{t("面板快捷键")}</span>
            <button
              disabled={!prefs || busy}
              onClick={() => {
                setHotkey({ ...prefs!.hotkey });
                setKeyError("");
                setDialogError("");
              }}
            >
              <Keyboard size={14} />
              {prefs ? keyLabel(prefs.hotkey) : "—"}
            </button>
          </div>
          <label className="check-label overlay-install-toggle">
            <input
              type="checkbox"
              checked={prefs?.enabled ?? false}
              disabled={!prefs || busy}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />
            {t("随支持的安装路线添加内置面板")}
          </label>
          <p className="muted overlay-setting-note">
            {t(
              "此开关仅决定后续安装是否附带面板，不会卸载已有插件。快捷键与此开关单独保存。",
            )}
          </p>
        </div>
      </section>
      <p className="overlay-scope-note">
        {t(
          "这里的主题和快捷键仅作用于 NeuralFrame 面板；鸣潮独立加载器和 Encore 自带面板由各自组件管理。",
        )}
      </p>

      <section className="overlay-management" aria-label={t("面板插件与安装")}>
        <div className="overlay-management-heading">
          <div>
            <h2>{t("面板插件与安装")}</h2>
            <p className="muted">
              {t("安装到游戏需要已有支持插件的 ReShade，并匹配游戏位数。")}
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void action(
                () => getBridge().overlayAdd(),
                "自定义叠加层已添加到组件库。",
              )
            }
          >
            <Plus size={15} />
            {t("导入面板插件…")}
          </button>
        </div>
        {libraryError && (
          <p className="error" role="alert">
            {t(libraryError)}{" "}
            <button onClick={() => void readLibrary()}>{t("重试")}</button>
          </p>
        )}
        {!library ? (
          !libraryError && <Loading text={t("读取组件与版本记录…")} />
        ) : (
          <>
            <div className="overlay-entry overlay-builtin">
              <div>
                <strong>{t("内置 F8 面板插件")}</strong>
                <small>
                  {t(builtin?.ready ? "本地可用" : "插件文件缺失")}
                  {builtin?.architecture
                    ? ` · ${builtin.architecture}-bit`
                    : ""}
                </small>
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
                {t("安装到游戏…")}
              </button>
            </div>
            <details
              className="overlay-management-details"
              open={customEntries.length > 0}
            >
              <summary>
                {t("自定义面板插件")}
                <small>{customEntries.length}</small>
              </summary>
              {customEntries.length ? (
                customEntries.map((entry) => (
                  <article className="overlay-entry" key={entry.id}>
                    <div>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.architecture}-bit ·{" "}
                        {t(entry.ready ? "本地可用" : "文件异常")}
                      </small>
                      <p className="muted">
                        {t("外部原生插件不支持此处的主题预览。")}
                      </p>
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
                        {t("安装到游戏…")}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={t("从组件库移除 {0}", [entry.name])}
                        title={t("从组件库移除")}
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () => getBridge().overlayRemove(entry.id),
                            "已移除",
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="muted overlay-empty-note">
                  {t(
                    "可导入 .addon64 或 .addon32 文件；只加入插件库，不会立即安装到游戏。",
                  )}
                </p>
              )}
            </details>
            <details
              className="overlay-management-details overlay-installations"
              open={library.installations.length > 0}
            >
              <summary>
                {t("已有安装记录")}
                <small>{library.installations.length}</small>
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
                      <small>{t("安装记录不代表游戏当前已加载面板。")}</small>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () => getBridge().overlayUninstall(entry.id),
                          "已移除",
                        )
                      }
                    >
                      {t("仅移除叠加层")}
                    </button>
                  </article>
                ))
              ) : (
                <p className="muted overlay-empty-note">
                  {t("暂无面板安装记录。")}
                </p>
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
      </section>
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
