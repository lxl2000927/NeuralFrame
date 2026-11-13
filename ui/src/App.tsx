import { t, useLanguage, setLanguage } from "./i18n";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  Home,
  Gamepad2,
  Package,
  Layers,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Minus,
  Square,
  X,
  Plus,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Puzzle,
  Info,
  FolderPlus,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { getBridge } from "./bridge";
import { Loading } from "./components";
import { retryMissingArtwork } from "./useArtwork";
import { GameCard, showGameMenu, type CardAction, type GameMenuHandler } from "./GameCard";
import { HomeIntake, HomeActivity, HomeShelf } from "./features/Home";
import { errorText, groupByLauncher } from "./domain";
import { useOperation } from "./useOperation";
import { DownloadContext } from "./features/DownloadAction";
import type { Draft, Game, UpdateInfo } from "./types";
import type { Run } from "./features/Games";
import mark from "../../assets/neuralframe/mark-ui.png";
function preloadablePage<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let ready: ComponentType<P> | undefined;
  let pending: ReturnType<typeof load> | undefined;
  const preload = () => pending ||= load().then(module => {
    ready = module.default;
    return module;
  }, error => { pending = undefined; throw error; });
  const LazyPage = lazy(preload);
  function Page(props: P) {
    // A preloaded screen can render on the first click without a Suspense fallback.
    // Keep the chosen component stable after mount so navigation preserves edits.
    const [Screen] = useState<ComponentType<P>>(() => ready || LazyPage);
    return <Screen {...props} />;
  }
  return Object.assign(Page, { preload });
}
const Games = preloadablePage(async () => ({ default: (await import("./features/Games")).Games }));
const Library = preloadablePage(async () => ({ default: (await import("./features/Library")).Library }));
const Addons = lazy(() =>
  import("./features/Addons").then((m) => ({ default: m.Addons })),
);
const Settings = lazy(() =>
  import("./features/Utilities").then((m) => ({ default: m.Settings })),
);
const About = lazy(() => import("./features/About"));
const History = lazy(() =>
  import("./features/History").then((m) => ({ default: m.History })),
);
const Overlay = preloadablePage(async () => ({ default: (await import("./features/Overlay")).Overlay }));
const nav = [
  { id: "home", label: "首页", icon: Home },
  { id: "games", label: "游戏", icon: Gamepad2 },
  { id: "library", label: "组件", title: "组件库", icon: Package },
  { id: "addons", label: "附加组件", icon: Puzzle },
  { id: "overlay", label: "叠加层", icon: Layers },
  { id: "history", label: "历史", title: "操作历史", icon: HistoryIcon },
];
const settingsPage = { id: "settings", label: "设置", icon: SettingsIcon };
type NoticeTone = "ok" | "error" | "info";
type Notice = { id: number; text: string; tone: NoticeTone };
// Feature pages still report a bare string; only an explicit tone overrides
// this, so a failure never reads like a success.
const noticeTone = (text: string): NoticeTone =>
  /失败|无法|不能|不支持|冲突|错误|异常|取消|未完成|缺少|无效|拒绝|超时|不匹配|未找到|中断/.test(text)
    ? "error"
    : /完成|成功|已应用|已还原|已保存|已就绪|已恢复|已复制|已隐藏/.test(text)
      ? "ok"
      : "info";
const noticeDuration = (tone: NoticeTone) => (tone === "error" ? 9000 : tone === "ok" ? 4000 : 5200);
const pages: { id: string; label: string; title?: string; icon: typeof Home }[] = [
  ...nav,
  settingsPage,
  { id: "about", label: "关于", title: "关于 NeuralFrame", icon: Info },
];
export default function App() {
  useLanguage();
  useEffect(() => {
    const online = () => retryMissingArtwork(true);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  useEffect(() => {
    const commonPages = [Games, Library, Overlay];
    let cancelled = false;
    let idle: number;
    const next = () => {
      const page = commonPages.shift();
      if (!cancelled && page) idle = window.requestIdleCallback(() => {
        void page.preload().catch(() => {}).finally(next);
      }, { timeout: 2000 });
    };
    next();
    return () => { cancelled = true; window.cancelIdleCallback(idle); };
  }, []);
  const [page, setPage] = useState("home"),
    [modelLibraryOrigin, setModelLibraryOrigin] = useState(""),
    [importTarget, setImportTarget] = useState<string>(),
    [visited, setVisited] = useState(() => new Set(["home"])),
    [refreshToken, setRefreshToken] = useState(0),
    [games, setGames] = useState<Game[]>([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [notice, setNoticeState] = useState<Notice | null>(null),
    [noticeHeld, setNoticeHeld] = useState(false),
    [launchRelease, setLaunchRelease] = useState<UpdateInfo>(),
    [cardBusy, setCardBusy] = useState(""),
    [libraryRevision, setLibraryRevision] = useState(0),
    [groupGames, setGroupGames] = useState(false),
    [theme, setTheme] = useState(() =>
      localStorage.getItem("neuralframe.theme") === "light" ? "light" : "dark",
    ),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const noticeId = useRef(0);
  const revisionClock = useRef(0);
  const setNotice = useCallback((text: string, tone?: NoticeTone) => {
    if (!text) {
      setNoticeState(null);
      setNoticeHeld(false);
      return;
    }
    setNoticeState({ id: ++noticeId.current, text, tone: tone || noticeTone(text) });
  }, []);
  // Auto-dismiss is held while the pointer or focus stays on the message, so a
  // long error can be read without racing the timer.
  useEffect(() => {
    if (!notice || noticeHeld) return;
    const timer = setTimeout(
      () => setNoticeState((current) => (current?.id === notice.id ? null : current)),
      noticeDuration(notice.tone),
    );
    return () => clearTimeout(timer);
  }, [notice, noticeHeld]);
  const operation = useOperation(setNotice, () =>
    setRefreshToken(++revisionClock.current),
  );

  const navigate = (id: string, modelOrigin = "", modelToImport?: string) => {
    setImportTarget(modelToImport);
    setModelLibraryOrigin(modelOrigin);
    setVisited((previous) =>
      previous.has(id) ? previous : new Set([...previous, id]),
    );
    setPage(id);
  };
  const libraryRequest = useRef(0);
  const setGameDraft = (dir: string, next?: Draft) => setDrafts(previous => {
    const updated = { ...previous };
    if (next) updated[dir] = next;
    else delete updated[dir];
    return updated;
  });
  const [scanning,setScanning] = useState(false);
  const load = async (preferredDir?: string) => {
    const request = ++libraryRequest.current;
    setLoading(true);
    setScanning(false);
    try {
      const g = await getBridge().library();
      if (request !== libraryRequest.current) return;
      setGames(g);
      setRefreshToken(++revisionClock.current);
      // Artwork requests belong to visible Artwork instances, independently of
      // the library scan. Offscreen games must not delay the selected game's art.
      const pending = g.filter(game => !game.cached);
      if (pending.length) {
        setScanning(true);
        void (async () => {
          for (const game of pending) {
            if (request !== libraryRequest.current) return;
            try {
              const cached = await getBridge().scan(game.dir);
              if (request === libraryRequest.current)
                setGames(current => current.map(item => item.dir === game.dir ? { ...item, cached } : item));
            } catch (e) { if (request === libraryRequest.current) setNotice(errorText(e)); }
          }
          if (request === libraryRequest.current) setScanning(false);
        })();
      }
      const picked = preferredDir && g.find(game => game.dir.toLowerCase() === preferredDir.toLowerCase());
      setSelected(previous => picked ? picked.dir : g.some(game => game.dir === previous) ? previous : g[0]?.dir || "");
    } catch (e) {
      if (request === libraryRequest.current) setNotice(errorText(e));
    } finally {
      if (request === libraryRequest.current) setLoading(false);
    }
  };
  const readPreferences = async () => {
    const boot = await getBridge().boot();
    document.documentElement.dataset.safeGraphics = String(boot.safeGraphics === true);
    setLanguage(boot.lang || "zh");
    if (boot.theme === "dark" || boot.theme === "light") {
      setTheme(boot.theme);
      localStorage.setItem("neuralframe.theme", boot.theme);
    }
    setGroupGames(boot.groupGamesByStore !== false);
  };
  useEffect(() => {
    void load();
    void readPreferences().catch((e) => setNotice(errorText(e)));
    let mounted = true;
    void getBridge().checkUpdate?.().then(result => {
      if (mounted) setLaunchRelease(result);
    }).catch(() => { /* The library is usable offline. */ });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const add = async (open = false) => {
    try {
      const picked = await getBridge().addGame();
      if (picked) {
        await load(typeof picked === "string" ? picked : picked.dir);
        if (open) navigate("games");
      }
    } catch (e) {
      setNotice(errorText(e));
    }
  };
  const dropGame = async (dir: string) => {
    try {
      const picked = await getBridge().addGameByPath(dir);
      if (!picked) throw Error(t("请选择游戏文件夹。"));
      await load(picked);
      navigate("games");
    } catch (e) { setNotice(errorText(e)); }
  };
  const addFolder = async () => {
    try { if (await getBridge().addFolder()) { await load(); setLibraryRevision(v => v+1); } }
    catch (e) { setNotice(errorText(e)); }
  };
  const changeTheme = (value: string) => {
    void getBridge()
      .setTheme(value)
      .then(() => {
        setTheme(value);
        localStorage.setItem("neuralframe.theme", value);
      })
      .catch((e) => setNotice(errorText(e)));
  };
  const windowAction = (action: string) => {
    void getBridge()
      .window(action)
      .catch((e) => setNotice(errorText(e)));
  };
  const select = (dir: string) => {
    setSelected(dir);
    navigate("games");
  };
  const scanCard = async (dir: string) => {
    const cached = await getBridge().scan(dir);
    setGames(current => current.map(game => game.dir === dir ? { ...game, cached } : game));
  };
  const runForGame: Run = async action => {
    const dir = selected;
    const done = await operation.run(action);
    if (done && dir) {
      try { await scanCard(dir); } catch (e) { setNotice(errorText(e)); }
    }
    return done;
  };
  const cardAction = async (game: Game, action: CardAction) => {
    if (action === "details") return select(game.dir);
    if (action === "open" || action === "copy") {
      try {
        if (action === "copy") setNotice(t(await getBridge().copyText(game.dir) ? "已复制路径" : "复制失败"));
        else { const error = await getBridge().open(game.dir); if (error) throw Error(String(error)); }
      } catch(e) { setNotice(errorText(e)); }
      return;
    }
    if (cardBusy || operation.busy) return;
    setCardBusy(game.dir);
    try {
      if (action === "poster") {
        const url = await getBridge().setPoster(game.dir);
        if (url)
          setGames((current) =>
            current.map((g) =>
              g.dir === game.dir
                ? { ...g, poster: { url, custom: true, tall: true } }
                : g,
            ),
          );
      } else if (action === "scan") {
        await scanCard(game.dir);
      } else if (action === "restore") {
        if (await operation.run(token => getBridge().restoreGame(game.dir, token))) {
          setDrafts(previous => { const next = {...previous}; delete next[game.dir]; return next; });
          await scanCard(game.dir);
        }
      } else if (
        await operation.ask(
          t("隐藏游戏"),
          t("将“{0}”从游戏库中隐藏？不会删除游戏文件，可在设置中恢复。", [
            game.name,
          ]),
          t("隐藏"),
        )
      ) {
        await getBridge().hide(game.dir);
        setGames((current) => current.filter((g) => g.dir !== game.dir));
        if (selected === game.dir)
          setSelected(games.find((g) => g.dir !== game.dir)?.dir || "");
        setLibraryRevision((v) => v + 1);
        setNotice(t("已隐藏“{0}”，可在设置中恢复。", [game.name]));
      }
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setCardBusy("");
    }
  };
  const menuOpen = useRef(false);
  const openMenu:GameMenuHandler = (game,position) => {
    if (menuOpen.current) return;
    menuOpen.current = true;
    void showGameMenu(game,position,!!cardBusy || operation.busy,cardAction,setNotice)
      .finally(() => { menuOpen.current = false; });
  };
  const homeGroups = groupByLauncher(games, groupGames);
  const currentPage = pages.find((item) => item.id === page);
  const PageIcon = currentPage?.icon || Home;
  const renderNavItem = ({ id, label, icon: Icon }: (typeof nav)[number]) => {
    const current = page === id ? "page" : page === "about" && id === "settings" ? "location" : undefined;
    return (
      <button key={id} className={current ? "nav-item active" : "nav-item"}
        aria-current={current} onClick={() => navigate(id)}
        onPointerEnter={() => {
          if (id === "games") void import("./features/Games");
          else if (id === "library") void import("./features/Library");
          else if (id === "addons") void import("./features/Addons");
          else if (id === "history") void import("./features/History");
          else if (id === "overlay") void import("./features/Overlay");
          else if (id === "settings") void import("./features/Utilities");
        }}>
        <Icon aria-hidden="true" />
        <span>{t(label)}</span>
      </button>
    );
  };
  return (
    <DownloadContext.Provider value={operation.downloads}><div className="app-shell">
      <header
        className="titlebar"
        onDoubleClick={() => windowAction("maximize")}
      >
        <img src={mark} alt="" />
        <strong>NeuralFrame</strong>
        <span>{__APP_VERSION__}</span>
        {launchRelease?.newer && launchRelease.latest && <button
          className="release-notice" onClick={() => navigate("about")}
          onDoubleClick={event => event.stopPropagation()}>
          {t("发现新版本 {0}", [launchRelease.latest])}
        </button>}
        <div className="window-controls">
          <button
            aria-label={t("最小化")}
            onClick={() => windowAction("minimize")}
          >
            <Minus size={15} />
          </button>
          <button
            aria-label={t("最大化")}
            onClick={() => windowAction("maximize")}
          >
            <Square size={13} />
          </button>
          <button
            aria-label={t("关闭窗口")}
            onClick={() => windowAction("close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <nav className="sidebar" id="primary-navigation" aria-label={t("主导航")}>
        <div className="nav-primary">{nav.map(renderNavItem)}</div>
        {renderNavItem(settingsPage)}
      </nav>
      <main className="app-content" data-page={page}>
        <div className="appbar">
          <h1><span className="page-emblem" aria-hidden="true"><PageIcon size={18} /></span>{t(currentPage?.title || currentPage?.label)}</h1>
          {(nav.some(item => item.id === page) || page === "settings" || page === "about") && (
            <div className="inline-actions">
              {(page === "settings" || page === "about") && (
                <button onClick={() => navigate(page === "about" ? "settings" : "about")}>
                  {page === "about" ? <ArrowLeft size={16} /> : <Info size={16} />}
                  {page === "about" ? t("返回设置") : t("关于 NeuralFrame")}
                </button>
              )}
              {page === "games" && (
                <>
                  <button disabled={operation.busy} onClick={() => void add()}>
                    <Plus size={17} />{t("添加游戏")}
                  </button>
                  <button disabled={operation.busy} onClick={() => void addFolder()}>
                    <FolderPlus size={16} />{t("添加扫描文件夹")}
                  </button>
                </>
              )}
              {page === "home" && <button
                aria-busy={loading || scanning}
                disabled={operation.busy || loading || scanning}
                onClick={() => { retryMissingArtwork(); void load(); }}
              >
                <RefreshCw size={17} className={loading || scanning ? "refresh-spinning" : undefined} />
                {t(loading || scanning ? "正在扫描游戏库…" : "扫描游戏库")}
              </button>}
            </div>
          )}
        </div>
        <div className="page-content">
          {pages
            .filter(({ id }) => visited.has(id))
            .map(({ id, label }) => (
              <section
                className="page-slot"
                key={id}
                hidden={page !== id}
                aria-label={t("{0}页面", [label])}
              >
                <Suspense fallback={<Loading skeleton="table" />}>
                  {id === "games" &&
                    (loading && !games.length ? (
                      <Loading text={t("读取游戏库…")} skeleton="rows" />
                    ) : (
                      <Games
                        onBrowseModels={() => navigate("library", "games")}
                      onImportModel={id => navigate("library", "games", id)}
                        onDownloadModel={operation.downloadVersion}
                        games={games}
                        grouped={groupGames}
                        openMenu={openMenu}
                        selected={selected}
                        onSelect={setSelected}
                        drafts={drafts}
                        setDraft={setGameDraft}
                        run={runForGame}
                        busy={operation.busy}
                        message={setNotice}
                        ask={operation.ask}
                        active={page === "games"}
                        refreshToken={refreshToken}
                      />
                    ))}
                  {id === "home" && (
                    <div className="page-scroll home-page">
                      <HomeIntake games={games} active={page === "home"} refreshToken={refreshToken} disabled={loading || operation.busy}
                        browse={() => void add(true)} drop={dropGame} select={select} message={setNotice}/>
                      <div className="section-toolbar">
                        <h2 className="library-heading">{t("游戏库")} <small>{games.length}</small></h2>
                        <button onClick={() => navigate("games")}>
                          {t("查看全部")}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                      {homeGroups.map((group) => (
                        <section
                          key={group.name}
                          className={group.name ? "home-group" : ""}
                        >
                          {group.name && (
                            <h2>
                              {group.name === "Added by hand"
                                ? t("手动添加")
                                : group.name}{" "}
                              <small>{group.games.length}</small>
                            </h2>
                          )}
                          <HomeShelf label={group.name || t("游戏库")} count={group.games.length}>
                            {group.games.map((g) => (
                              <GameCard
                                openMenu={openMenu}
                                key={g.key}
                                game={g}
                                busy={Boolean(cardBusy) || operation.busy}
                                onSelect={select}
                                onAction={(game, action) => {
                                  void cardAction(game, action);
                                }}
                              />
                            ))}
                          </HomeShelf>
                        </section>
                      ))}
                      {!games.length && (
                        <p className="muted">
                          {t("添加一款游戏，开始配置神经渲染与帧生成。")}
                        </p>
                      )}
                      <HomeActivity message={setNotice} />
                    </div>
                  )}
                  {id === "library" && (
                    <Library
                      downloadVersion={operation.downloadVersion}
                      modelsOnly={!!modelLibraryOrigin}
                      onBack={() => navigate(modelLibraryOrigin)}
                      importTarget={importTarget} onImportClosed={() => setImportTarget(undefined)}
                      active={page === "library"}
                      run={operation.run}
                      busy={operation.busy}
                      message={setNotice}
                      refreshToken={refreshToken}
                    />
                  )}{" "}
                  {id === "addons" && <Addons message={setNotice} active={page === "addons"} refreshToken={refreshToken} />}{" "}
                  {id === "overlay" && <Overlay message={setNotice} active={page === "overlay"} refreshToken={refreshToken} />}{" "}
                  {id === "history" && (
                    <History
                      message={setNotice}
                      ask={operation.ask}
                      active={page === "history"} refreshToken={refreshToken}
                    />
                  )}{" "}
                  {id === "settings" && (
                    <Settings
                      active={page === "settings"}
                      refreshToken={refreshToken}
                      operationBusy={operation.busy}
                      message={setNotice}
                      theme={theme}
                      onTheme={changeTheme}
                      libraryRevision={libraryRevision}
                      onLibraryChange={load}
                      onLibraryReset={async () => {
                        setDrafts({});
                        await load();
                      }}
                      onSettingsReset={async () => {
                        setDrafts({});
                        await readPreferences();
                        await load();
                      }}
                      onGroupingChange={setGroupGames}
                      ask={operation.ask}
                    />
                  )}
                  {id === "about" && <About message={setNotice} launchRelease={launchRelease} />}
                </Suspense>
              </section>
            ))}
        </div>
      </main>
      {notice && (
        <div
          className={`toast toast-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
          onMouseEnter={() => setNoticeHeld(true)}
          onMouseLeave={e => setNoticeHeld(e.currentTarget.matches(":focus-within"))}
          onFocus={() => setNoticeHeld(true)}
          onBlur={e => setNoticeHeld(e.currentTarget.matches(":hover"))}
        >
          <span className="toast-icon" aria-hidden="true">
            {notice.tone === "error" ? <AlertCircle size={16} />
              : notice.tone === "ok" ? <CheckCircle2 size={16} />
                : <Info size={16} />}
          </span>
          <span className="toast-text">{t(notice.text)}</span>
          <button
            className="toast-close"
            type="button"
            aria-label={t("关闭提示")}
            onClick={() => setNotice("")}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {operation.dialog}
    </div></DownloadContext.Provider>
  );
}
