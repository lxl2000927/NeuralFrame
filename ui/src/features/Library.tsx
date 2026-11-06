import { useEffect, useState } from "react";
import { RefreshCw, Download, Check } from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading } from "../components";
import { errorText, size } from "../domain";
import type { Library as LibraryData, Updates } from "../types";
import { Modal } from "../components";
import type { Run } from "./Games";
export function Library({
  run,
  busy,
  message,
  refreshToken = 0,
}: {
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
  useEffect(() => {
    let alive = true;
    getBridge()
      .libraryComponents()
      .then((r) => {
        if (alive) {
          if (!r.ok) throw Error(r.message);
          setData(r);
          setUpdates(r.updates || null);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [rev, refreshToken]);
  const refresh = () => setRev((v) => v + 1);
  return (
    <div className="page-scroll">
      <div className="section-toolbar">
        <div>
          <h1>组件库</h1>
          <p className="muted">
            软件与组件独立管理。下载到缓存后，在游戏页选择使用的版本。
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
                  if (!r.ok) throw Error(r.message);
                  setUpdates(r);
                } catch (e) {
                  message(errorText(e));
                } finally {
                  setChecking(false);
                }
              })();
            }}
          >
            {checking ? "检查中…" : "检查组件更新"}
          </button>
          <button disabled={busy} onClick={refresh}>
            <RefreshCw size={16} />
            刷新列表
          </button>
        </div>
      </div>
      {error && (
        <div className="error">
          {error}
          <button onClick={refresh}>重试</button>
        </div>
      )}
      {!data && !error ? (
        <Loading />
      ) : (
        data && (
          <>
            <h2>配套组件</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>组件</th>
                    <th>版本</th>
                    <th>下载大小</th>
                    <th>本地状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.runtimePacks.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                      </td>
                      <td>{p.version}</td>
                      <td>{size(p.size)}</td>
                      <td>{p.downloaded ? "已缓存" : "按需下载"}</td>
                      <td>
                        {p.downloaded ? (
                          <Check size={17} className="positive" />
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => {
                              void run(async () => {
                                const current =
                                  await getBridge().libraryComponents();
                                return current.runtimePacks.find(
                                  (x) => x.id === p.id,
                                )?.downloaded
                                  ? { ok: true }
                                  : {
                                      ok: false,
                                      dependencies: [p.id],
                                      downloads: [p],
                                      message: "下载组件",
                                    };
                              }).then(refresh);
                            }}
                          >
                            <Download size={15} />
                            下载
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="advanced">
              <summary>
                上游可用版本
                {updates?.checkedAt
                  ? ` · ${new Date(updates.checkedAt).toLocaleDateString()}`
                  : ""}
              </summary>
              {updates?.errors.map((e) => (
                <p key={e.provider} className="muted">
                  {e.provider}：{e.message}
                </p>
              ))}
              {updates?.candidates.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>组件 / 来源</th>
                        <th>版本</th>
                        <th>大小</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {updates.candidates.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {data.definitions[c.component]?.name || c.component}
                            <small className="block">{c.repo}</small>
                          </td>
                          <td>
                            {c.tag}
                            {c.stale ? "（缓存记录）" : ""}
                          </td>
                          <td>{size(c.size)}</td>
                          <td>
                            <button
                              disabled={busy || !c.downloadable || c.stale}
                              onClick={() => {
                                void (async () => {
                                  setDownload("开始下载…");
                                  const unsubscribe =
                                    getBridge().onLibraryProgress((p) =>
                                      setDownload(
                                        `${p.name} · ${p.stage === "download" ? `${size(p.loaded || 0)} / ${size(p.total || 0)}` : "校验中"}`,
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
                              下载入库
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">
                  点击“检查组件更新”获取上游版本。入库后仍需通过适配检查，才可应用到游戏。
                </p>
              )}
            </details>
            <h2>已入库版本</h2>
            {data.packages.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>组件</th>
                      <th>版本</th>
                      <th>适配状态</th>
                      <th>来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.packages.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {data.definitions[p.component]?.name || p.component}
                        </td>
                        <td>{p.version}</td>
                        <td title={p.compatibility.reason}>
                          {p.compatibility.label}
                        </td>
                        <td>{p.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>下载配套组件后，可在这里查看可选版本。</Empty>
            )}
            <p className="path muted">缓存目录：{data.root}</p>
          </>
        )
      )}
      {download && (
        <Modal
          title="下载组件"
          onClose={() => {
            void getBridge().libraryCancel();
          }}
          footer={
            <button
              onClick={() => {
                void getBridge().libraryCancel();
              }}
            >
              取消下载
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
