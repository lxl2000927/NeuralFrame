import { useEffect, useState } from "react";
import {
  Search,
  Play,
  FolderOpen,
  RefreshCw,
  ChevronRight,
  Download,
  LockKeyhole,
} from "lucide-react";
import { getBridge } from "../bridge";
import { Artwork, Empty, Loading, Row, Select } from "../components";
import {
  applyPatch,
  changedFields,
  errorText,
  profiles,
  readDraft,
} from "../domain";
import type {
  Details,
  Draft,
  Game,
  Inventory,
  Library,
  Result,
  Runtime,
  RuntimeItem,
  Status,
} from "../types";
export type Run = (
  operation: (token?: string) => Promise<Result>,
) => Promise<boolean>;
type Props = {
  games: Game[];
  selected: string;
  onSelect: (dir: string) => void;
  drafts: Record<string, Draft>;
  setDraft: (dir: string, draft: Draft) => void;
  busy: boolean;
  run: Run;
  message: (s: string) => void;
};
export function Games(props: Props) {
  const [query, setQuery] = useState("");
  const filtered = props.games.filter((g) =>
    `${g.name} ${g.launcher}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = props.games.find((g) => g.dir === props.selected);
  return (
    <div className="games-workspace">
      <aside className="game-list">
        <div className="game-search">
          <Search size={17} />
          <input
            aria-label="搜索游戏"
            placeholder="搜索游戏…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="game-list-scroll">
          {filtered.map((game) => (
            <button
              key={game.key}
              className={`game-row ${game.dir === props.selected ? "selected" : ""}`}
              aria-pressed={game.dir === props.selected}
              onClick={() => props.onSelect(game.dir)}
            >
              <Artwork game={game} />
              <span>
                <strong>{game.name}</strong>
                <small>{game.launcher}</small>
              </span>
            </button>
          ))}
          {!filtered.length && (
            <Empty>
              {props.games.length ? "没有匹配的游戏" : "添加游戏或扫描游戏目录"}
            </Empty>
          )}
        </div>
        <div className="list-count">{filtered.length} 款游戏</div>
      </aside>
      {selected ? (
        <GameEditor key={selected.dir} {...props} game={selected} />
      ) : (
        <Empty>选择一款游戏，查看配置和组件。</Empty>
      )}
    </div>
  );
}
function GameEditor({
  game,
  drafts,
  setDraft,
  run,
  busy,
  message,
}: Props & { game: Game }) {
  const [tab, setTab] = useState("graphics"),
    [data, setData] = useState<{ details: Details; status: Status } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([
      getBridge().details(game.dir),
      getBridge().enhancedStatus(game.dir),
    ])
      .then(([details, status]) => {
        if (active) {
          setData({ details, status });
          if (!status.ok)
            setError(
              status.message || "未识别到可配置的游戏程序，请核对游戏目录。",
            );
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [game.dir, revision]);
  const base = data ? readDraft(data.status) : null,
    draft = drafts[game.dir] || base,
    changes = base && draft ? changedFields(base, draft) : [];
  const change = (key: keyof Draft, value: string | boolean) => {
    if (draft) setDraft(game.dir, { ...draft, [key]: value });
  };
  const refresh = () => setRevision((v) => v + 1);
  const execute = async () => {
    if (!base || !draft) return;
    try {
      const config = applyPatch(base, draft);
      if (
        await run((token) => getBridge().enhancedApply(game.dir, config, token))
      ) {
        refresh();
        setRuntime(null);
      }
    } catch (e) {
      message(errorText(e));
    }
  };
  const models = data?.status.neural?.availableModels || [];
  const modelOptions = models.map((m) => [
    m.id,
    `${m.name || m.id}${m.availableOnDisk ? "" : " · 按需下载"}`,
  ]);
  if (!modelOptions.some(([id]) => id === "310.8.SF-v2"))
    modelOptions.unshift(["310.8.SF-v2", "310.8.SF-v2 · 按需下载"]);
  return (
    <section className="game-detail">
      <div className="game-detail-top">
        <div className="game-identity">
          <Artwork game={game} large />
          <div>
            <h1>{game.name}</h1>
            <p>{game.launcher}</p>
            <p className="path" title={game.dir}>
              {game.dir}
            </p>
          </div>
        </div>
        <div className="game-actions">
          <button
            className="icon-button"
            aria-label="打开游戏目录"
            title="打开游戏目录"
            onClick={() => {
              void getBridge()
                .open(game.dir)
                .catch((e) => message(errorText(e)));
            }}
          >
            <FolderOpen />
          </button>
          <button
            className="primary"
            disabled={!data?.details.exePath || busy}
            onClick={() => {
              void getBridge()
                .launchGame(game.dir)
                .then((r) => {
                  if (r?.ok === false) message(r.message || "启动失败");
                })
                .catch((e) => message(errorText(e)));
            }}
          >
            <Play size={16} />
            启动游戏
          </button>
        </div>
      </div>
      <div className="installed-strip">
        <span
          title={data?.details.files
            ?.map((f) => `${f.name} ${f.version || ""}`)
            .join("\n")}
        >
          已检测组件：
          {!data
            ? "读取中…"
            : data.details.files?.length
              ? `${data.details.files.length} 个文件 · ${data.details.api || "API 待确认"}`
              : "未发现 DLSS 运行库"}
        </span>
        <span className="runtime-summary">
          <i />
          {runtime
            ? runtime.processState === "running"
              ? "游戏运行中"
              : runtime.nr.label
            : "运行状态未检测"}
        </span>
      </div>
      <div className="tabs" role="tablist">
        {[
          ["graphics", "画质与补帧"],
          ["components", "组件与版本"],
          ["runtime", "运行诊断"],
        ].map(([id, label]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="detail-scroll">
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={refresh}>重试</button>
          </div>
        )}
        {!data && !error && <Loading text="读取游戏配置…" />}
        {data && tab === "graphics" && draft && (
          <>
            <fieldset disabled={busy || !data.status.ok}>
              <section className="settings-section">
                <h2>神经渲染</h2>
                <div className="settings-table">
                  <Row label="神经渲染">
                    <Select
                      label="神经渲染"
                      value={draft.neuralMode}
                      onChange={(v) => change("neuralMode", v)}
                      options={[
                        ["off", "关闭"],
                        ["latest_compatible", "兼容模型"],
                        ["legacy", "自定义 / 旧版模型"],
                      ]}
                    />
                  </Row>
                  <Row label="神经渲染模型">
                    <Select
                      label="神经渲染模型"
                      disabled={draft.neuralMode === "off"}
                      value={draft.neuralModelId}
                      onChange={(v) => change("neuralModelId", v)}
                      options={modelOptions}
                    />
                  </Row>
                </div>
              </section>
              <section className="settings-section">
                <h2>多帧生成</h2>
                <div className="settings-table">
                  <Row label="补帧倍率">
                    <Select
                      label="补帧倍率"
                      value={draft.mfgMode}
                      onChange={(v) => change("mfgMode", v)}
                      options={[
                        ["off", "关闭"],
                        ["x2", "2×"],
                        ["x3", "3×"],
                        ["x4", "4×"],
                      ]}
                    />
                  </Row>
                  <Row label="硬件档位">
                    <Select
                      label="硬件档位"
                      value={draft.hardwareProfile}
                      onChange={(v) => change("hardwareProfile", v)}
                      options={profiles}
                    />
                  </Row>
                </div>
              </section>
              <details className="advanced">
                <summary>
                  <ChevronRight size={16} />
                  高级设置
                </summary>
                <Row label="配套运行库">
                  <Select
                    label="配套运行库"
                    value={draft.runtimeStack}
                    onChange={(v) => change("runtimeStack", v)}
                    options={[
                      ["baseline-310.9.1", "基准组合 · SR 310.9.1 / SL 2.13"],
                      ["oct2026-310.9.16", "更新组合 · SR 310.9.16 / SL 2.14"],
                    ]}
                  />
                </Row>
                <Row label="HDR 兼容策略" hint="根据游戏实际表现启用">
                  <input
                    type="checkbox"
                    aria-label="HDR 兼容策略"
                    checked={draft.hdrCompatibility}
                    onChange={(e) =>
                      change("hdrCompatibility", e.target.checked)
                    }
                  />
                </Row>
                <Row label="当前显卡">
                  <span className="muted">
                    {data.status.hardware?.gpu?.name || "未识别"}
                  </span>
                </Row>
                <Row label="实际游戏程序">
                  <span className="path">
                    {data.details.exePath || "未识别"}
                  </span>
                </Row>
                <Row label="自定义模型">
                  <button
                    onClick={() => {
                      void getBridge()
                        .enhancedImportModel()
                        .then((r) => {
                          if (r?.ok) {
                            refresh();
                            message("模型已导入");
                          } else if (r?.message) message(r.message);
                        })
                        .catch((e) => message(errorText(e)));
                    }}
                  >
                    <Download size={16} />
                    导入 DLL
                  </button>
                </Row>
              </details>
            </fieldset>
            <p className="footnote">
              这些是磁盘配置与待应用参数。实际渲染效果和补帧倍率请查看运行诊断。
            </p>
          </>
        )}
        {tab === "components" && (
          <GameComponents
            dir={game.dir}
            run={run}
            busy={busy}
            message={message}
          />
        )}
        {tab === "runtime" && (
          <RuntimePanel
            dir={game.dir}
            onRuntime={setRuntime}
            message={message}
          />
        )}
      </div>
      <div className="apply-bar">
        <span>
          {tab === "graphics"
            ? changes.length
              ? `${changes.length} 项待应用修改`
              : "配置已读取"
            : tab === "components"
              ? "版本锁定与恢复由组件记录管理"
              : "仅显示当前进程和有效时间内的证据"}
        </span>
        <div>
          {tab === "graphics" ? (
            <>
              <button
                disabled={!changes.length || busy}
                onClick={() => {
                  if (base) setDraft(game.dir, base);
                }}
              >
                撤销
              </button>
              <button
                className="primary"
                disabled={!changes.length || !data?.status.ok || busy}
                onClick={() => {
                  void execute();
                }}
              >
                预览并应用
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                void getBridge()
                  .saveDiagnostics(game.dir, [])
                  .then((r) => {
                    if (r?.ok) message("诊断报告已导出");
                    else if (r?.message) message(r.message);
                  })
                  .catch((e) => message(errorText(e)));
              }}
            >
              导出诊断报告
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
function GameComponents({
  dir,
  run,
  busy,
  message,
}: {
  dir: string;
  run: Run;
  busy: boolean;
  message: (s: string) => void;
}) {
  const [inventory, setInventory] = useState<Inventory | null>(null),
    [library, setLibrary] = useState<Library | null>(null),
    [error, setError] = useState(""),
    [rev, setRev] = useState(0),
    [selection, setSelection] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    Promise.all([
      getBridge().componentInventory(dir),
      getBridge().libraryComponents(dir),
    ])
      .then(([i, l]) => {
        if (alive) {
          if (!i.ok || !l.ok)
            throw Error(i.message || l.message || "组件读取失败");
          setInventory(i);
          setLibrary(l);
          setSelection(l.profile?.selected || {});
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [dir, rev]);
  const refresh = () => setRev((v) => v + 1);
  if (error)
    return (
      <div className="error">
        {error}
        <button onClick={refresh}>重试</button>
      </div>
    );
  if (!inventory || !library) return <Loading text="读取组件与版本记录…" />;
  return (
    <>
      <div className="section-toolbar">
        <h2>已安装组件与文件</h2>
        <button onClick={refresh} disabled={busy}>
          <RefreshCw size={15} />
          刷新
        </button>
      </div>
      <div className="settings-table">
        <Row
          label={inventory.lock ? "当前组合已锁定" : "版本未锁定"}
          hint="锁定后，管理器会阻止组件文件被替换"
        >
          <button
            disabled={busy || !inventory.rows.length}
            onClick={() => {
              void getBridge()
                .componentLock(dir, !inventory.lock)
                .then((r) => {
                  if (!r.ok) throw Error(r.message);
                  refresh();
                })
                .catch((e) => message(errorText(e)));
            }}
          >
            <LockKeyhole size={16} />
            {inventory.lock ? "解除锁定" : "锁定当前组合"}
          </button>
        </Row>
      </div>
      {inventory.rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>组件 / 文件</th>
                <th>磁盘版本</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {inventory.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <strong>{r.name}</strong>
                    <details>
                      <summary>路径与来源</summary>
                      <p className="path">{r.rel}</p>
                      <p>{r.source}</p>
                      <code className="path">{r.sha256}</code>
                    </details>
                  </td>
                  <td>{r.version || "无版本信息"}</td>
                  <td>
                    {!r.present
                      ? "文件缺失"
                      : r.lockState === "drift"
                        ? "偏离锁定"
                        : "已安装"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>尚未安装受管理的组件。</Empty>
      )}
      <details className="advanced">
        <summary>
          <ChevronRight size={16} />
          选择配套组件版本
        </summary>
        {Object.entries(library.definitions)
          .filter(
            ([id, d]) =>
              !d.internal && library.packages.some((p) => p.component === id),
          )
          .map(([id, d]) => (
            <Row key={id} label={d.name}>
              <Select
                label={d.name}
                value={selection[id] || ""}
                onChange={(v) => setSelection((s) => ({ ...s, [id]: v }))}
                options={[
                  ["", "使用配套默认版本"],
                  ...library.packages
                    .filter(
                      (p) =>
                        p.component === id &&
                        p.present &&
                        p.compatibility.ready,
                    )
                    .map((p) => [p.id, p.version]),
                ]}
              />
            </Row>
          ))}
        <div className="inline-actions">
          <button
            disabled={busy}
            onClick={() => {
              void (async () => {
                try {
                  const selected = await getBridge().librarySelect(
                    dir,
                    selection,
                  );
                  if (!selected.ok) throw Error(selected.message);
                  if (
                    await run((token) => getBridge().libraryApply(dir, token))
                  )
                    refresh();
                } catch (e) {
                  message(errorText(e));
                }
              })();
            }}
          >
            预览版本变更
          </button>
          {library.rollback && (
            <button
              disabled={busy}
              onClick={() => {
                void run((token) =>
                  getBridge().libraryRollback(dir, library.rollback!.id, token),
                ).then((ok) => {
                  if (ok) refresh();
                });
              }}
            >
              回滚上次组件更新
            </button>
          )}
        </div>
      </details>
      <div className="restore-row">
        <span className="muted">使用游戏目录中的原始备份恢复文件。</span>
        <button
          className="danger"
          disabled={busy}
          onClick={() => {
            void run((token) => getBridge().restoreGame(dir, token)).then(
              (ok) => {
                if (ok) refresh();
              },
            );
          }}
        >
          恢复原始文件
        </button>
      </div>
    </>
  );
}
function RuntimePanel({
  dir,
  onRuntime,
  message,
}: {
  dir: string;
  onRuntime: (r: Runtime) => void;
  message: (s: string) => void;
}) {
  const [result, setResult] = useState<Runtime | null>(null),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true,
      inFlight = false;
    const probe = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      setBusy(true);
      try {
        const r = await getBridge().componentRuntime(dir);
        if (alive) {
          if (!r.ok) throw Error(r.message || "检测失败");
          setResult(r);
          onRuntime(r);
        }
      } catch (e) {
        if (alive) {
          setResult(null);
          message(errorText(e));
        }
      } finally {
        inFlight = false;
        if (alive) setBusy(false);
      }
    };
    void probe();
    const timer = auto
      ? setInterval(() => {
          void probe();
        }, 5000)
      : null;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      clearInterval(clock);
    };
  }, [dir, auto]);
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await getBridge().componentRuntime(dir);
      if (!r.ok) throw Error(r.message);
      setResult(r);
      onRuntime(r);
    } catch (e) {
      setResult(null);
      message(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const item = (name: string, data: RuntimeItem) => {
    const stale = !!data.at && now - data.at > 30000;
    return (
      <section className="runtime-block">
        <h2>{name}</h2>
        <strong
          className={
            stale ? "muted" : data.state === "active" ? "positive" : ""
          }
        >
          {stale ? "运行记录已过期" : data.label}
        </strong>
        <p>{stale ? "超过 30 秒没有新遥测，请刷新检测。" : data.detail}</p>
        {data.requestedMultiplier && (
          <p>
            请求 {data.requestedMultiplier}× · 已应用请求{" "}
            {data.appliedMultiplier || "—"}×
          </p>
        )}
        {data.sourceFps !== undefined &&
          data.reportedOutputFps !== undefined && (
            <p>
              插件报告：基础 {data.sourceFps.toFixed(1)} / 输出{" "}
              {data.reportedOutputFps.toFixed(1)} FPS
            </p>
          )}
        {data.evidence && (
          <details>
            <summary>判断依据</summary>
            <pre>{data.evidence}</pre>
          </details>
        )}
      </section>
    );
  };
  return (
    <>
      <div className="section-toolbar">
        <h2>运行时检测</h2>
        <div className="inline-actions">
          <label className="check-label">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            自动刷新
          </label>
          <button
            disabled={busy}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw size={16} />
            {busy ? "检测中…" : "刷新"}
          </button>
        </div>
      </div>
      {result ? (
        <>
          {item("DLSS 神经渲染", result.nr)}
          {item("DLSS-G / 多帧生成", result.mfg)}
          <p className="muted">
            检测于 {new Date(result.checkedAt).toLocaleTimeString()} · DLL
            加载不代表渲染已生效。
          </p>
          {!!result.modules?.length && (
            <details className="advanced">
              <summary>
                <ChevronRight size={16} />
                已加载模块
              </summary>
              {result.modules.map((m) => (
                <p className="path" key={m.path}>
                  {m.path}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <Empty>
          {busy ? "正在检查游戏进程和运行日志…" : "暂无本次检测结果，请刷新。"}
        </Empty>
      )}
    </>
  );
}
