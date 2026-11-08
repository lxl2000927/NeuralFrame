import { t, dateTime } from "../i18n";
import { useEffect, useState } from "react";
import { RefreshCw, Download, ShieldCheck } from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Select } from "../components";
import { errorText, size } from "../domain";
import type { Library as LibraryData, Updates } from "../types";
import { Modal } from "../components";
import type { Run } from "./Games";

const rateLimitError = "GitHub 请求已限流";

function rateLimitNotice(result: Updates) {
  if (!result.nextCheckAt || !result.errors.some(e => e.message === rateLimitError)) return "";
  return t("GitHub 暂时限制了请求。可在 {0} 后重新检查。", [dateTime(result.nextCheckAt)]);
}

function libraryError(result: {message?: string; code?: string}, fallback: string) {
  return result.message || (result.code === "errJobBusy"
    ? t("另一项操作正在进行，请稍后重试。")
    : fallback);
}
export function Library({
  active,
  run,
  busy,
  message,
  refreshToken = 0,
}: {
  active: boolean;
  run: Run;
  busy: boolean;
  message: (s: string) => void;
  refreshToken?: number;
}) {
  const [data, setData] = useState<LibraryData | null>(null),
    [error, setError] = useState(""),
    [rev, setRev] = useState(0);
  const [checking, setChecking] = useState(false),
    [updates, setUpdates] = useState<Updates | null>(null),
    [download, setDownload] = useState<string | null>(null);
  const [importComponent, setImportComponent] = useState("");
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBridge()
      .libraryComponents()
      .then((r) => {
        if (alive) {
          if (!r.ok) throw Error(libraryError(r, t("组件读取失败")));
          setData(r);
          setUpdates(current => current?.checkedAt && current.checkedAt > (r.updates?.checkedAt || "")
            ? current : r.updates || null);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e) || t("组件读取失败"));
      });
    return () => {
      alive = false;
    };
  }, [active, rev, refreshToken]);
  const refresh = () => setRev((v) => v + 1);
  const rateNotice = updates && rateLimitNotice(updates);
  return (
    <div className="page-scroll library-page">
      <div className="section-toolbar">
        <div>
          <p className="muted">
            {t("软件与组件独立管理。下载到缓存后，在游戏页选择使用的版本。")}
          </p>
        </div>
        <div className="inline-actions">
          <button
            disabled={busy || checking}
            onClick={() => {
              void (async () => {
                setChecking(true);
                try {
                  const r = await getBridge().libraryCheck();
                  if (!r.ok) throw Error(libraryError(r, t("无法检查组件更新")));
                  setUpdates(r);
                  const notice = rateLimitNotice(r);
                  if (notice) message(notice);
                  else if (r.cached && r.nextCheckAt) {
                    message(t("已显示上次检查结果。可在 {0} 后重新检查。", [dateTime(r.nextCheckAt)]));
                  }
                } catch (e) {
                  message(errorText(e));
                } finally {
                  setChecking(false);
                }
              })();
            }}
          >
            {checking ? t("检查中…") : t("检查组件更新")}
          </button>
          <button disabled={busy} onClick={refresh}>
            <RefreshCw size={16} />
            {t("刷新列表")}
          </button>
        </div>
      </div>
      {error && (
        <div className="error">
          {t(error)}
          <button onClick={refresh}>{t("重试")}</button>
        </div>
      )}
      {!data && !error ? (
        <Loading skeleton="rows" />
      ) : (
        data && (
          <>
            <div className="library-import">
              <div><strong>{t("导入本地组件")}</strong><p className="muted">{t("选择组件类型后导入 DLL、插件文件或完整 ZIP 包。只加入组件库，不会立即写入游戏。")}</p></div>
              <Select label={t("导入组件类型")} value={importComponent} onChange={setImportComponent} disabled={busy} options={[["", t("选择组件类型")], ...Object.entries(data.definitions).filter(([id, definition]) => !definition.internal && !definition.pinned && (definition.files?.length || id === "optiscaler")).map(([id, definition]) => [id, t(definition.name)])]} />
              <button disabled={busy || !importComponent} onClick={() => void run(() => getBridge().libraryImport(importComponent)).then(ok => { if (ok) refresh(); })}>{t("选择文件并导入…")}</button>
            </div>
            <h2>{t("配套组件")} <small className="section-count">{data.runtimePacks.length}</small></h2>
            <div className="table-wrap">
              <table className="runtime-packs">
                <thead>
                  <tr>
                    <th>{t("组件")}</th>
                    <th>{t("版本")}</th>
                    <th>{t("下载大小")}</th>
                    <th>{t("本地状态")}</th>
                    <th>{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runtimePacks.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{t(p.name)}</strong>
                      </td>
                      <td>{p.version}</td>
                      <td>{size(p.size)}</td>
                      <td><span className="library-state" data-tone={p.downloaded ? "ready" : undefined}>{t(p.downloaded ? "已缓存" : "按需下载")}</span></td>
                      <td>
                          <button
                            disabled={busy}
                            onClick={() => {
                              void run(() => getBridge().libraryCheckRuntime(p.id)).then(ok => { if (ok) refresh(); });
                            }}
                          >
                            {p.downloaded ? <ShieldCheck size={15} /> : <Download size={15} />}
                            {t(p.downloaded ? "校验缓存" : "下载")}
                          </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="advanced">
              <summary>
                {t("上游可用版本")}
                {updates?.checkedAt
                  ? ` · ${dateTime(updates.checkedAt)}`
                  : ""}
              </summary>
              {rateNotice && <p className="muted">{rateNotice}</p>}
              {updates?.errors.filter(e => !(rateNotice && e.message === rateLimitError)).map((e) => (
                <p key={e.provider} className="muted">
                  {e.provider}: {t(e.message)}
                </p>
              ))}
              {updates?.candidates.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("组件 / 来源")}</th>
                        <th>{t("版本")}</th>
                        <th>{t("大小")}</th>
                        <th>{t("操作")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {updates.candidates.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {t(
                              data.definitions[c.component]?.name ||
                                c.component,
                            )}
                            <small className="block">{c.repo}</small>
                          </td>
                          <td>
                            {c.tag}
                            {c.stale ? t("（缓存记录）") : ""}
                          </td>
                          <td>{size(c.size)}</td>
                          <td>
                            <button
                              disabled={busy || !c.downloadable || c.stale}
                              onClick={() => {
                                void (async () => {
                                  setDownload(t("开始下载…"));
                                  const unsubscribe =
                                    getBridge().onLibraryProgress((p) =>
                                      setDownload(
                                        `${t(p.name)} · ${p.stage === "download" ? `${size(p.loaded || 0)} / ${size(p.total || 0)}` : t("校验中")}`,
                                      ),
                                    );
                                  try {
                                    await run(() =>
                                      getBridge().libraryDownload(c.id),
                                    );
                                    refresh();
                                  } finally {
                                    unsubscribe();
                                    setDownload(null);
                                  }
                                })();
                              }}
                            >
                              {t("下载入库")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">
                  {t(updates?.checkedAt ? (updates.errors.length ? "部分来源读取失败，当前没有可列出的版本。" : "已检查组件来源，没有可列出的新版本。") : "点击“检查组件更新”获取上游版本。入库后仍需通过适配检查，才可应用到游戏。")}
                </p>
              )}
            </details>
            <h2>{t("已入库版本")} <small className="section-count">{data.packages.length}</small></h2>
            {!!data.warnings?.length && (
              <details className="advanced">
                <summary>{t("旧模型迁移提示")}</summary>
                <ul>{data.warnings.map((warning, index) => <li key={index} className="path">{t(warning)}</li>)}</ul>
              </details>
            )}
            {data.packages.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("组件")}</th>
                      <th>{t("版本")}</th>
                      <th>{t("适配状态")}</th>
                      <th>{t("来源")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.packages.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {t(
                            data.definitions[p.component]?.name || p.component,
                          )}
                        </td>
                        <td>{p.version}</td>
                        <td title={t(p.present ? p.compatibility.reason : "重新下载或导入此版本以修复缓存。")}>
                          <span className="library-state" data-tone={!p.present ? "warning" : p.compatibility.ready ? "ready" : undefined}>
                            {t(p.present ? p.compatibility.label : "缓存文件缺失或不完整")}
                          </span>
                        </td>
                        <td>{t(p.source)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{t("下载配套组件后，可在这里查看可选版本。")}</Empty>
            )}
            <p className="path muted">
              {t("缓存目录：")}
              {data.root}
            </p>
          </>
        )
      )}
      {download && (
        <Modal
          title={t("下载组件")}
          onClose={() => {
            void getBridge().libraryCancel();
          }}
          footer={
            <button
              onClick={() => {
                void getBridge().libraryCancel();
              }}
            >
              {t("取消下载")}
            </button>
          }
        >
          <p>{download}</p>
          <progress />
        </Modal>
      )}
    </div>
  );
}
