import { t, useLanguage, setLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  Palette, PanelTop, FolderSearch, Cpu, Database, Download,
  Trash2,
  Plus,
  Copy,
} from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Row, Select } from "../components";
import { errorText } from "../domain";
import { HardwareSettings } from "./HardwareSettings";
import { SoftwareUpdate, type UpdateProps } from "./SoftwareUpdate";
import type { Settings as SettingsData } from "../types";
import { StorageReset } from "./StorageReset";
import "./Settings.css";

const categories = [
  {id: "appearance", label: "界面外观", icon: Palette},
  {id: "window", label: "窗口与启动", icon: PanelTop},
  {id: "library", label: "游戏库与扫描", icon: FolderSearch},
  {id: "hardware", label: "硬件信息", icon: Cpu},
  {id: "storage", label: "数据与缓存", icon: Database},
  {id: "updates", label: "软件更新", icon: Download},
] as const;
export type SettingsCategory = typeof categories[number]["id"];

type Message = { message: (s: string) => void };

export function Settings({
  category,
  onCategory,
  update,
  active,
  refreshToken,
  operationBusy,
  message,
  theme,
  onTheme,
  libraryRevision = 0,
  onLibraryChange,
  onLibraryReset,
  onSettingsReset,
  onGroupingChange,
  fontScale,
  onFontScale,
  ask,
}: {
  category: SettingsCategory;
  onCategory: (id: SettingsCategory) => void;
  update: UpdateProps;
  active: boolean;
  refreshToken: number;
  operationBusy: boolean;
  theme: string;
  onTheme: (t: string) => void;
  libraryRevision?: number;
  onLibraryChange: () => Promise<void>;
  onLibraryReset: () => Promise<void>;
  onSettingsReset: () => Promise<void>;
  onGroupingChange: (on: boolean) => void;
  fontScale: number;
  onFontScale: (value:number) => void;
  ask: (title: string, body: string, confirm?: string) => Promise<boolean>;
} & Message) {
  const language = useLanguage();
  const [data, setData] = useState<SettingsData | null>(null),
    [rev, setRev] = useState(0),
    [error, setError] = useState("");
  const actionLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const refresh = () => setRev((v) => v + 1);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBridge()
      .settings()
      .then((r) => {
        if (alive) { setData(r); setError(""); }
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [active, rev, libraryRevision, refreshToken]);
  const action = async (fn: () => Promise<unknown>) => {
    if (actionLock.current) return;
    actionLock.current = true; setSaving(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      message(errorText(e));
      refresh();
    } finally {
      actionLock.current = false; setSaving(false);
    }
  };
  const toggle = (
    key: keyof SettingsData,
    value: boolean,
    save: () => Promise<unknown>,
  ) => {
    if (actionLock.current) return;
    setData((current) => (current ? { ...current, [key]: value } : current));
    void action(save);
  };
  const renderPreferences = (id: Exclude<SettingsCategory, "updates" | "hardware">) => {
    if (!data) return error ? <button onClick={refresh}>{t("重试")}</button> : <Loading />;
    switch (id) {
      case "appearance":
        return (
          <div className="settings-table appearance-settings">
            <Row label={t("主题")}>
              <Select
                label={t("主题")}
                value={theme}
                onChange={onTheme}
                options={[
                  ["light", t("浅色")],
                  ["dark", t("深色")],
                ]}
              />
            </Row>
            <Row label={t("语言")}>
              <Select
                label={t("语言")}
                value={language}
                onChange={(v) => {
                  void action(async () => {
                    await getBridge().setLang(v);
                    setLanguage(v);
                  });
                }}
                options={[
                  ["zh", "简体中文"],
                  ["en", "English"],
                ]}
              />
            </Row>
            <Row label={t("界面字体大小")} hint={t("调整正文字号，范围为 12–18px。")}>
              <div className="font-scale-control"><input aria-label={t("界面字体大小")} type="range" min={12} max={18} step={1} value={fontScale}
                onChange={event=>onFontScale(Number(event.target.value))}/><output>{fontScale}px</output></div>
            </Row>
            <Row
              label={t("界面兼容模式")}
              hint={t("关闭界面硬件加速，用于修复显示残影；重启软件后生效。")}
            >
              <input
                type="checkbox"
                aria-label={t("界面兼容模式")}
                checked={data.safeGraphics}
                onChange={(e) => {
                  const on = e.target.checked;
                  toggle("safeGraphics", on, async () => {
                    const r = await getBridge().setSafeGraphics(on);
                    if (!r.ok) throw Error(t("设置保存失败"));
                    message(t("界面兼容模式已保存，重启软件后生效。"));
                  });
                }}
              />
            </Row>
          </div>
        );
      case "window":
        return (
          <div className="settings-table">
            <Row label={t("关闭窗口时保留托盘")}>
              <input
                type="checkbox"
                aria-label={t("关闭窗口时保留托盘")}
                checked={data.closeToTray}
                onChange={(e) => {
                  const on = e.target.checked;
                  toggle("closeToTray", on, () => getBridge().setCloseToTray(on));
                }}
              />
            </Row>
            <Row
              label={t("记住窗口位置和大小")}
              hint={t("下次启动时恢复位置、尺寸和最大化状态。")}
            >
              <input
                type="checkbox"
                aria-label={t("记住窗口位置和大小")}
                checked={data.rememberWindow || false}
                onChange={(e) => {
                  const on = e.target.checked;
                  toggle("rememberWindow", on, () =>
                    getBridge().setRememberWindow(on),
                  );
                }}
              />
            </Row>
          </div>
        );
      case "library":
        return (
          <>
            <div className="settings-table">
              <Row label={t("自动扫描其他磁盘")}>
                <input
                  type="checkbox"
                  aria-label={t("自动扫描其他磁盘")}
                  checked={data.autoScanDrives}
                  onChange={(e) => {
                    const on = e.target.checked;
                    toggle("autoScanDrives", on, async () => {
                      await getBridge().setAutoScanDrives(on);
                      await onLibraryChange();
                    });
                  }}
                />
              </Row>
              <Row
                label={t("按游戏平台分组")}
                hint={t("在首页和游戏列表中按平台分组。")}
              >
                <input
                  type="checkbox"
                  aria-label={t("按游戏平台分组")}
                  checked={data.groupGamesByStore !== false}
                  onChange={(e) => {
                    const on = e.target.checked;
                    toggle("groupGamesByStore", on, async () => {
                      await getBridge().setGroupGamesByStore(on);
                      onGroupingChange(on);
                    });
                  }}
                />
              </Row>
            </div>
            <details className="advanced">
              <summary>{t("扫描来源与排除目录")}</summary>
              <p className="muted">
                {t("排除目录只影响自动发现，手动添加的游戏会保留。")}
              </p>
              {(data.roots || []).map((dir) => (
                <Row key={dir} label={dir}>
                  <button
                    onClick={() => {
                      void action(async () => {
                        await getBridge().excludeRoot(dir);
                        await onLibraryChange();
                      });
                    }}
                  >
                    {t("排除此目录")}
                  </button>
                </Row>
              ))}
              {!(data.roots || []).length && (
                <p className="muted">{t("当前没有额外扫描来源。")}</p>
              )}
              {(data.excludedRoots || []).map((dir) => (
                <Row key={dir} label={dir} hint={t("已排除")}>
                  <button
                    onClick={() => {
                      void action(async () => {
                        await getBridge().restoreScanRoot(dir);
                        await onLibraryChange();
                      });
                    }}
                  >
                    {t("恢复扫描")}
                  </button>
                </Row>
              ))}
            </details>
            <div className="section-toolbar">
              <h3>{t("已添加的扫描文件夹")}</h3>
              <button
                onClick={() => {
                  void action(async () => {
                    if (await getBridge().addFolder()) await onLibraryChange();
                  });
                }}
              >
                <Plus size={16} />
                {t("添加文件夹")}
              </button>
            </div>
            <div className="settings-table">
              {data.folders.length ? (
                data.folders.map((dir) => (
                  <Row label={dir} key={dir}>
                    <button
                      className="icon-button danger"
                      aria-label={t("移除扫描目录 {0}", [dir])}
                      title={t("移除扫描目录")}
                      onClick={() => {
                        void action(async () => {
                          await getBridge().removeFolder(dir);
                          await onLibraryChange();
                        });
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </Row>
                ))
              ) : (
                <Empty>
                  {t("没有额外扫描目录。游戏平台的安装目录仍会被识别。")}
                </Empty>
              )}
            </div>
            {!!data.hidden?.length && (
              <>
                <h3>{t("已隐藏的游戏")}</h3>
                <div className="settings-table">
                  {data.hidden.map((dir) => (
                    <Row
                      key={dir}
                      label={dir.split(/[\\/]/).pop() || dir}
                      hint={dir}
                    >
                      <button
                        onClick={() => {
                          void action(async () => {
                            await getBridge().unhide(dir);
                            await onLibraryChange();
                          });
                        }}
                      >
                        {t("恢复显示")}
                      </button>
                    </Row>
                  ))}
                </div>
              </>
            )}
          </>
        );
      case "storage":
        return (
          <>
            <div className="settings-table">
              <Row label={t("封面缓存")} hint={data.posterDir}>
                <span>
                  {data.posterCount || 0}
                  {t("张自定义封面")}
                </span>
                <button
                  onClick={() => {
                    void action(async () => {
                      const error = await getBridge().open(data.posterDir);
                      if (error) throw Error(String(error));
                    });
                  }}
                >
                  {t("打开目录")}
                </button>
              </Row>
              <Row
                label={t("重置游戏库")}
                hint={t(
                  "清除手动目录、隐藏列表和封面选择；游戏文件、历史、组件缓存和版本锁定不受影响。",
                )}
              >
                <button
                  className="danger"
                  onClick={() => {
                    void action(async () => {
                      if (
                        !(await ask(
                          t("重置游戏库"),
                          t(
                            "确定清除游戏库索引？此操作不会删除游戏文件或下载的组件。",
                          ),
                          t("重置"),
                        ))
                      )
                        return;
                      await getBridge().resetLibrary();
                      await onLibraryReset();
                    });
                  }}
                >
                  {t("重置")}
                </button>
              </Row>
              <Row
                label={t("重置软件设置")}
                hint={t(
                  "重置软件设置与游戏库索引；保留游戏文件、组件缓存、版本锁定、历史和叠加层独立配置。",
                )}
              >
                <button
                  className="danger"
                  onClick={() => {
                    void action(async () => {
                      if (
                        !(await ask(
                          t("重置软件设置"),
                          t(
                            "确定重置软件设置与游戏库索引？组件库、版本锁定、历史、叠加层配置和游戏文件会保留。",
                          ),
                          t("重置"),
                        ))
                      )
                        return;
                      await getBridge().reset();
                      await onSettingsReset();
                      message(t("设置已重置。界面硬件加速设置将在重启后生效。"));
                    });
                  }}
                >
                  {t("重置")}
                </button>
              </Row>
              <Row label={t("清理缓存并恢复初始状态")} hint={t("一并清理组件缓存和重置管理器，可选择还原已部署游戏。")}>
                <button className="danger" disabled={operationBusy} onClick={() => setResetOpen(true)}>{t("查看重置选项")}</button>
              </Row>
            </div>
            {resetOpen && <StorageReset onClose={() => setResetOpen(false)} onGamesChanged={onLibraryChange}
              onReset={async () => { await onSettingsReset(); refresh(); }} />}
            <p className="path muted">
              {t("配置文件：")}
              {data.stateFile}
              <button
                className="icon-button"
                aria-label={t("复制配置文件路径")}
                title={t("复制路径")}
                style={{ marginLeft: 8, minHeight: 24, padding: 4 }}
                onClick={() => {
                  void getBridge()
                    .copyText(data.stateFile)
                    .then((done) => message(done ? t("已复制路径") : t("复制失败")))
                    .catch((e) => message(errorText(e)));
                }}
              >
                <Copy size={14} />
              </button>
            </p>
          </>
        );
    }
  };
  return (
    <div className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label={t("设置分类")}
        onKeyDown={event => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          const last = buttons.length - 1;
          let next: number;
          switch (event.key) {
            case "Home": next = 0; break;
            case "End": next = last; break;
            case "ArrowLeft": next = index === 0 ? last : index - 1; break;
            case "ArrowRight": next = index === last ? 0 : index + 1; break;
            default: return;
          }
          event.preventDefault();
          buttons[next].focus();
          buttons[next].click();
        }}>
        {categories.map(({id, label, icon:Icon}) => (
          <button key={id} type="button" id={"settings-tab-" + id} role="tab"
            aria-controls={"settings-" + id} aria-selected={category === id}
            tabIndex={category === id ? 0 : -1} onClick={() => onCategory(id)}>
            <Icon size={16} aria-hidden="true" />{t(label)}
          </button>
        ))}
      </div>
      {categories.map(({id, label}) => (
        <section className="settings-panel" key={id} id={"settings-" + id}
          role="tabpanel" aria-labelledby={"settings-tab-" + id} tabIndex={0} hidden={category !== id}>
          {id === "updates" ? <>
            <h2>{t(label)}</h2>
            <SoftwareUpdate {...update} message={message} />
          </> : category === id && (id === "hardware" ?
            <HardwareSettings active={active} refreshToken={refreshToken} disabled={saving || operationBusy} /> :
            <>
              <h2>{t(label)}</h2>
              {error && <p className="error" role="alert">{t(error)}</p>}
              <fieldset disabled={saving}>{renderPreferences(id)}</fieldset>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
