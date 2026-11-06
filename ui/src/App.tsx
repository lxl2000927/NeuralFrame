import { lazy, Suspense, useEffect, useState } from "react";
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
  PanelLeft,
  ArrowRight,
} from "lucide-react";
import { getBridge } from "./bridge";
import { Artwork, Loading } from "./components";
import { errorText } from "./domain";
import { useOperation } from "./useOperation";
import type { Draft, Game } from "./types";
import mark from "../../assets/neuralframe/mark-ui.png";
const Games = lazy(() =>
  import("./features/Games").then((m) => ({ default: m.Games })),
);
const Library = lazy(() =>
  import("./features/Library").then((m) => ({ default: m.Library })),
);
const Settings = lazy(() =>
  import("./features/Utilities").then((m) => ({ default: m.Settings })),
);
const History = lazy(() =>
  import("./features/Utilities").then((m) => ({ default: m.History })),
);
const Overlay = lazy(() =>
  import("./features/Utilities").then((m) => ({ default: m.Overlay })),
);
const nav = [
  { id: "home", label: "首页", icon: Home },
  { id: "games", label: "游戏", icon: Gamepad2 },
  { id: "library", label: "组件", icon: Package },
  { id: "overlay", label: "叠加层", icon: Layers },
  { id: "history", label: "历史", icon: HistoryIcon },
  { id: "settings", label: "设置", icon: SettingsIcon },
];
export default function App() {
  const [page, setPage] = useState("games"),
    [visited, setVisited] = useState(() => new Set(["games"])),
    [refreshToken, setRefreshToken] = useState(0),
    [expanded, setExpanded] = useState(false),
    [games, setGames] = useState<Game[]>([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [theme, setTheme] = useState(() =>
      localStorage.getItem("neuralframe.theme") === "light" ? "light" : "dark",
    ),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const operation = useOperation(setNotice, () =>
    setRefreshToken((v) => v + 1),
  );
  const navigate = (id: string) => {
    setVisited((previous) =>
      previous.has(id) ? previous : new Set([...previous, id]),
    );
    setPage(id);
  };
  const load = async () => {
    setLoading(true);
    try {
      const g = await getBridge().library();
      setGames(g);
      setRefreshToken((v) => v + 1);
      // Covers are independent of the library. Limit background fetches and keep
      // the game controls usable while artwork arrives.
      const missing = g.filter((game) => !game.poster);
      const worker = async () => {
        for (let game = missing.shift(); game; game = missing.shift()) {
          try {
            const art = await getBridge().artFetch(
              game.dir,
              game.name,
              game.appid,
            );
            const url = art.cover || art.hero;
            if (url)
              setGames((current) =>
                current.map((item) =>
                  item.dir === game!.dir ? { ...item, poster: url } : item,
                ),
              );
          } catch {
            /* An unavailable cover must not prevent configuration. */
          }
        }
      };
      void Promise.all([worker(), worker()]);
      setSelected((s) => (g.some((x) => x.dir === s) ? s : g[0]?.dir || ""));
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    getBridge()
      .boot()
      .catch((e) => setNotice(errorText(e)));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const add = async () => {
    try {
      await getBridge().addGame();
      await load();
    } catch (e) {
      setNotice(errorText(e));
    }
  };
  const changeTheme = (value: string) => {
    setTheme(value);
    localStorage.setItem("neuralframe.theme", value);
    void getBridge()
      .setTheme(value)
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
  return (
    <div className={`app-shell ${expanded ? "expanded" : ""}`}>
      <header
        className="titlebar"
        onDoubleClick={() => windowAction("maximize")}
      >
        <img src={mark} alt="" />
        <strong>NeuralFrame</strong>
        <span>{__APP_VERSION__}</span>
        <div className="window-controls">
          <button aria-label="最小化" onClick={() => windowAction("minimize")}>
            <Minus size={15} />
          </button>
          <button aria-label="最大化" onClick={() => windowAction("maximize")}>
            <Square size={13} />
          </button>
          <button aria-label="关闭窗口" onClick={() => windowAction("close")}>
            <X size={17} />
          </button>
        </div>
      </header>
      <nav className="sidebar" aria-label="主导航">
        {nav.map(({ id, label, icon: Icon }, index) => (
          <button
            className={`nav-item ${page === id ? "active" : ""} ${index === 4 ? "nav-bottom" : ""}`}
            key={id}
            aria-current={page === id ? "page" : undefined}
            onClick={() => navigate(id)}
            onPointerEnter={() => {
              if (id === "games") void import("./features/Games");
              else if (id === "library") void import("./features/Library");
              else if (id !== "home") void import("./features/Utilities");
            }}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
        <button
          className="nav-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "收起导航" : "展开导航"}
        >
          <PanelLeft size={18} />
          {expanded && <span>收起导航</span>}
        </button>
      </nav>
      <main className="app-content">
        <div className="appbar">
          <h1>{nav.find((n) => n.id === page)?.label}</h1>
          {(page === "games" || page === "home") && (
            <div className="inline-actions">
              <button
                disabled={operation.busy}
                onClick={() => {
                  void add();
                }}
              >
                <Plus size={17} />
                添加游戏
              </button>
              <button
                className="icon-button"
                aria-label="刷新游戏列表"
                disabled={loading || operation.busy}
                onClick={() => {
                  void load();
                }}
              >
                <RefreshCw size={19} />
              </button>
            </div>
          )}
        </div>
        <div className="page-content">
          {nav
            .filter(({ id }) => visited.has(id))
            .map(({ id }) => (
              <section
                className="page-slot"
                key={id}
                hidden={page !== id}
                aria-label={`${nav.find((n) => n.id === id)?.label}页面`}
              >
                <Suspense fallback={<Loading />}>
                  {id === "games" &&
                    (loading && !games.length ? (
                      <Loading text="读取游戏库…" />
                    ) : (
                      <Games
                        games={games}
                        selected={selected}
                        onSelect={setSelected}
                        drafts={drafts}
                        setDraft={(dir, draft) =>
                          setDrafts((d) => ({ ...d, [dir]: draft }))
                        }
                        run={operation.run}
                        busy={operation.busy}
                        message={setNotice}
                        active={page === "games"}
                        refreshToken={refreshToken}
                      />
                    ))}
                  {id === "home" && (
                    <div className="page-scroll">
                      <div className="section-toolbar">
                        <h1>游戏库</h1>
                        <button onClick={() => navigate("games")}>
                          查看全部
                          <ArrowRight size={16} />
                        </button>
                      </div>
                      <div className="home-games">
                        {games.map((g) => (
                          <button
                            key={g.key}
                            className="home-game-card"
                            onClick={() => select(g.dir)}
                          >
                            <Artwork game={g} poster />
                            <div>
                              <strong>{g.name}</strong>
                              <small>{g.launcher}</small>
                            </div>
                            <span className="card-open" aria-hidden="true">
                              <ArrowRight size={18} />
                            </span>
                          </button>
                        ))}
                      </div>
                      {!games.length && (
                        <p className="muted">
                          添加一款游戏，开始配置神经渲染与帧生成。
                        </p>
                      )}
                      <div className="home-tools">
                        <button onClick={() => navigate("library")}>
                          <Package />
                          <span>
                            <strong>组件库</strong>
                            <small>查看组件版本和本地缓存</small>
                          </span>
                          <ArrowRight size={17} />
                        </button>
                        <button onClick={() => navigate("overlay")}>
                          <Layers />
                          <span>
                            <strong>游戏内面板</strong>
                            <small>快捷键与叠加层偏好</small>
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      </div>
                    </div>
                  )}
                  {id === "library" && (
                    <Library
                      run={operation.run}
                      busy={operation.busy}
                      message={setNotice}
                      refreshToken={refreshToken}
                    />
                  )}{" "}
                  {id === "overlay" && <Overlay message={setNotice} />}{" "}
                  {id === "history" && (
                    <History
                      message={setNotice}
                      ask={operation.ask}
                      active={page === "history"}
                    />
                  )}{" "}
                  {id === "settings" && (
                    <Settings
                      message={setNotice}
                      theme={theme}
                      onTheme={changeTheme}
                    />
                  )}
                </Suspense>
              </section>
            ))}
        </div>
      </main>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {operation.dialog}
    </div>
  );
}
