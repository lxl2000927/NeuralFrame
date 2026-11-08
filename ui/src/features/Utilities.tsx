import { t, useLanguage, setLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  Trash2,
  Plus,
  Copy,
} from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Row, Select } from "../components";
import { errorText } from "../domain";
import type {
  Settings as SettingsData,

} from "../types";

type Message = { message: (s: string) => void };

export function Settings({
  message,
  theme,
  onTheme,
  libraryRevision = 0,
  onLibraryChange,
  onLibraryReset,
  onSettingsReset,
  onGroupingChange,
  ask,
}: {
  theme: string;
  onTheme: (t: string) => void;
  libraryRevision?: number;
  onLibraryChange: () => Promise<void>;
  onLibraryReset: () => Promise<void>;
  onSettingsReset: () => Promise<void>;
  onGroupingChange: (on: boolean) => void;
  ask: (title: string, body: string, confirm?: string) => Promise<boolean>;
} & Message) {
  const language = useLanguage();
  const [data, setData] = useState<SettingsData | null>(null),
    [rev, setRev] = useState(0),
    [error, setError] = useState("");
  const actionLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const refresh = () => setRev((v) => v + 1);
  useEffect(() => {
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
  }, [rev, libraryRevision]);
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
  return (
    <div className="page-scroll settings-page">
      {error && <p className="error">{t(error)}</p>}
      {!data ? (
        !error ? <Loading /> : <button onClick={refresh}>{t("重试")}</button>
      ) : (
        <fieldset disabled={saving}>
          <h2>{t("外观与启动")}</h2>
          <div className="settings-table appearance-settings">
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
            <Row label={t("主题")}>
              <Select
                label={t("主题")}
                value={theme}
                onChange={onTheme}
                options={[
                  ["dark", t("深色")],
                  ["light", t("浅色")],
                ]}
              />
            </Row>
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
            <h2>{t("已添加的扫描文件夹")}</h2>
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
                    className="icon-button"
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
              <h2>{t("已隐藏的游戏")}</h2>
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
          <h2>{t("数据与缓存")}</h2>
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
          </div>
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
        </fieldset>
      )}
    </div>
  );
}
