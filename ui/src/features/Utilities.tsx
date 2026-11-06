import { useEffect, useState } from "react";
import { Trash2, Plus, ExternalLink } from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Row, Select } from "../components";
import { errorText } from "../domain";
import type { OverlayPrefs, Settings as SettingsData } from "../types";
type Message = { message: (s: string) => void };
export function Settings({
  message,
  theme,
  onTheme,
}: { theme: string; onTheme: (t: string) => void } & Message) {
  const [data, setData] = useState<SettingsData | null>(null),
    [rev, setRev] = useState(0),
    [error, setError] = useState("");
  const refresh = () => setRev((v) => v + 1);
  useEffect(() => {
    let alive = true;
    getBridge()
      .settings()
      .then((r) => {
        if (alive) setData(r);
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [rev]);
  const action = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      refresh();
    } catch (e) {
      message(errorText(e));
    }
  };
  return (
    <div className="page-scroll narrow">
      <h1>设置</h1>
      {error && <p className="error">{error}</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <h2>外观与启动</h2>
          <div className="settings-table">
            <Row label="主题">
              <Select
                label="主题"
                value={theme}
                onChange={onTheme}
                options={[
                  ["dark", "深色"],
                  ["light", "浅色"],
                ]}
              />
            </Row>
            <Row label="关闭窗口时保留托盘">
              <input
                type="checkbox"
                aria-label="关闭窗口时保留托盘"
                checked={data.closeToTray}
                onChange={(e) => {
                  void action(() =>
                    getBridge().setCloseToTray(e.target.checked),
                  );
                }}
              />
            </Row>
            <Row label="自动扫描其他磁盘">
              <input
                type="checkbox"
                aria-label="自动扫描其他磁盘"
                checked={data.autoScanDrives}
                onChange={(e) => {
                  void action(() =>
                    getBridge().setAutoScanDrives(e.target.checked),
                  );
                }}
              />
            </Row>
          </div>
          <div className="section-toolbar">
            <h2>已添加的扫描文件夹</h2>
            <button
              onClick={() => {
                void action(() => getBridge().addFolder());
              }}
            >
              <Plus size={16} />
              添加文件夹
            </button>
          </div>
          <div className="settings-table">
            {data.folders.length ? (
              data.folders.map((dir) => (
                <Row label={dir} key={dir}>
                  <button
                    className="icon-button"
                    aria-label={`移除扫描目录 ${dir}`}
                    title="移除扫描目录"
                    onClick={() => {
                      void action(() => getBridge().removeFolder(dir));
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </Row>
              ))
            ) : (
              <Empty>没有额外扫描目录。游戏平台的安装目录仍会被识别。</Empty>
            )}
          </div>
          <h2>关于 NeuralFrame</h2>
          <Row label="软件版本">
            <span>{__APP_VERSION__}</span>
          </Row>
          <Row label="项目仓库">
            <button
              onClick={() => {
                void action(() => getBridge().openProject("github"));
              }}
            >
              <ExternalLink size={15} />
              GitHub
            </button>
          </Row>
          <p className="muted">Neural rendering & frame generation</p>
          <p className="path muted">配置文件：{data.stateFile}</p>
        </>
      )}
    </div>
  );
}
export function History({
  message,
  ask,
  active = true,
}: {
  ask: (title: string, body: string, confirm?: string) => Promise<boolean>;
  active?: boolean;
} & Message) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null),
    [error, setError] = useState("");
  const load = () =>
    getBridge()
      .history()
      .then((r) => {
        setRows(r.rows);
        if (r.warning) message("部分历史记录无法读取。");
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    if (active) void load();
  }, [active]);
  return (
    <div className="page-scroll">
      <div className="section-toolbar">
        <h1>操作历史</h1>
        <button
          disabled={!rows?.length}
          onClick={() => {
            void (async () => {
              if (
                !(await ask(
                  "清除操作历史",
                  "只清除历史列表，游戏文件、原始备份和版本锁定记录会保留。",
                  "清除历史",
                ))
              )
                return;
              try {
                const r = await getBridge().clearHistory();
                if (!r.ok) throw Error(r.message || "清除失败");
                await load();
              } catch (e) {
                message(errorText(e));
              }
            })();
          }}
        >
          <Trash2 size={16} />
          清除历史
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>暂无操作记录。</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>游戏</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.date ? new Date(String(r.date)).toLocaleString() : "—"}
                  </td>
                  <td className="path">
                    {String(r.name || r.gameName || r.dir || "—")}
                  </td>
                  <td>{String(r.action || r.kind || "组件变更")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
export function Overlay({ message }: Message) {
  const [prefs, setPrefs] = useState<OverlayPrefs | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    getBridge()
      .overlayPreferences()
      .then((r) => {
        if (alive) {
          if (!r.ok) throw Error(r.error);
          setPrefs(r.value);
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  const save = async (patch: Partial<OverlayPrefs>) => {
    setSaving(true);
    try {
      const r = await getBridge().saveOverlayPreferences(patch);
      if (!r.ok) throw Error(r.error);
      setPrefs(r.value);
      message("叠加层设置已保存。");
    } catch (e) {
      message(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="page-scroll narrow">
      <h1>游戏内叠加层</h1>
      <p className="muted">配置紧凑面板的显示、快捷键和配色。</p>
      {error && <p className="error">{error}</p>}
      {!prefs ? (
        <Loading />
      ) : (
        <>
          <fieldset disabled={saving}>
            <div className="settings-table">
              <Row label="启用游戏内面板">
                <input
                  type="checkbox"
                  aria-label="启用游戏内面板"
                  checked={prefs.enabled}
                  onChange={(e) => {
                    void save({ enabled: e.target.checked });
                  }}
                />
              </Row>
              <Row label="面板快捷键">
                <Select
                  label="面板快捷键"
                  value={String(prefs.hotkey.key)}
                  onChange={(v) => {
                    void save({
                      hotkey: { key: Number(v), mods: prefs.hotkey.mods },
                    });
                  }}
                  options={[
                    ["117", "F6"],
                    ["118", "F7"],
                    ["119", "F8"],
                    ["120", "F9"],
                    ["121", "F10"],
                  ]}
                />
              </Row>
              <Row label="面板主题">
                <Select
                  label="面板主题"
                  value={prefs.theme}
                  onChange={(v) => {
                    void save({ theme: v });
                  }}
                  options={[
                    ["green", "绿色"],
                    ["blue", "蓝色"],
                    ["purple", "紫色"],
                    ...(prefs.custom ? [["custom", prefs.custom.name]] : []),
                  ]}
                />
              </Row>
            </div>
          </fieldset>
          <p className="footnote">
            游戏需要安装并加载 F8
            面板组件。组件是否已加载，请在对应游戏的运行诊断中检查。
          </p>
          <button
            disabled={saving}
            onClick={() => {
              void (async () => {
                setSaving(true);
                try {
                  const r = await getBridge().overlayInstall("builtin");
                  if (!r.ok) throw Error(r.error);
                } catch (e) {
                  message(errorText(e));
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            安装面板到游戏…
          </button>
        </>
      )}
    </div>
  );
}
