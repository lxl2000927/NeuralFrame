import { t, dateTime } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileUp } from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Modal, Select } from "../components";
import { errorText, libraryUpgrade, size } from "../domain";
import { DownloadAction } from "./DownloadAction";
import type { Library as LibraryData, Updates } from "../types";
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
  modelsOnly,
  importTarget,
  onImportClosed,
  onBack,
  downloadVersion,
  run,
  busy,
  message,
  refreshToken = 0,
}: {
  active: boolean;
  modelsOnly: boolean;
  importTarget?: string;
  onImportClosed: () => void;
  onBack: () => void;
  downloadVersion: (id: string, cached: boolean) => Promise<boolean>;
  run: Run;
  busy: boolean;
  message: (s: string) => void;
  refreshToken?: number;
}) {
  const [data, setData] = useState<LibraryData | null>(null),
    [error, setError] = useState(""),
    [rev, setRev] = useState(0);
  const [checking, setChecking] = useState(false),
    [updates, setUpdates] = useState<Updates | null>(null);
  const [importComponent, setImportComponent] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState("");
  const importing = active && (importOpen || !!importTarget);
  const closeImport = () => { setImportError(""); setImportOpen(false); onImportClosed(); };
  const submitImport = async () => {
    setImportError("");
    let notice = "";
    const ok = await run(async () => {
      try {
        if (importTarget) {
          const result = await getBridge().enhancedImportModel(undefined, { expectedModelId: importTarget });
          if (result.model) notice = t(result.model.compatibility?.status === "incompatible"
            ? "模型 {0} 已入库，本机显卡不支持运行此模型。" : "已导入模型 {0}", [result.model.id]);
          if (!result.ok && !result.cancelled) setImportError(libraryError(result, t("操作未完成")));
          return result;
        }
        const result = await getBridge().libraryImport(importComponent);
        if (!result.ok && !result.cancelled) setImportError(libraryError(result, t("操作未完成")));
        return result;
      } catch (error) {
        setImportError(errorText(error));
        throw error;
      }
    });
    if (ok) {
      closeImport();
      if (notice) message(notice);
    }
  };
  const upstreamList = useRef<HTMLDetailsElement>(null);
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
  const visibleErrors = updates?.errors.filter(e => !modelsOnly || ["smartergamers-nr", "rhi-nr"].includes(e.provider)) || [];
  const candidates = updates?.candidates.filter(c => !modelsOnly || c.component === "dlss-nr") || [];
  const packs = data?.runtimePacks.filter(p => !modelsOnly || p.id === "nr-3108") || [];
  const packages = data?.packages.filter(p => !modelsOnly || p.component === "dlss-nr") || [];
  const rateNotice = updates && rateLimitNotice({...updates, errors:visibleErrors});
  const checkUpdates = useCallback(async (notify = true) => {
    setChecking(true);
    try {
      const r = await getBridge().libraryCheck();
      if (!r.ok) throw Error(libraryError(r, t("无法检查组件更新")));
      setUpdates(r);
      if (upstreamList.current) upstreamList.current.open = true;
      if (notify) {
        const notice = rateLimitNotice(r);
        if (notice) message(notice);
        else if (r.cached && r.nextCheckAt) message(t("已显示上次检查结果。可在 {0} 后重新检查。", [dateTime(r.nextCheckAt)]));
      }
    } catch (e) {
      message(errorText(e));
    } finally {
      setChecking(false);
    }
  }, [message]);
  useEffect(() => {
    if (active && modelsOnly && !importTarget) void checkUpdates(false);
  }, [active, modelsOnly, importTarget, checkUpdates]);
  return (
    <div className="page-scroll library-page">
      <div className="section-toolbar">
        <div>
          {modelsOnly && <h2>{t("在线神经渲染模型")}</h2>}
          <p className="muted">
            {t(modelsOnly ? "上游列表按发布文件计数。相同版本名可能对应不同的 DLL，入库时按文件指纹识别。" : "软件与组件独立管理。下载到缓存后，在游戏页选择使用的版本。")}
          </p>
        </div>
        <div className="inline-actions">
          {modelsOnly && <button onClick={onBack}><ArrowLeft size={16} />{t("返回模型库")}</button>}
          <button
            disabled={busy || checking}
            onClick={() => void checkUpdates()}
          >
            {checking ? t("检查中…") : t("检查更新")}
          </button>
          <button disabled={busy || !data} onClick={() => {
            setImportComponent(modelsOnly ? "dlss-nr" : "");
            setImportError("");
            setImportOpen(true);
          }}><FileUp size={15} />{t("导入")}</button>
        </div>
      </div>
      {importing && <Modal title="导入本地组件" onClose={closeImport}
        footer={<><button onClick={closeImport}>{t("取消")}</button>
          <button className="primary" disabled={busy || (!importTarget && !importComponent)}
            onClick={() => void submitImport()}>{t("选择文件并导入…")}</button></>}>
        {importError && <p className="error" role="alert">{t(importError)}</p>}
        {importTarget ? <p>{t("为 {0} 选择 nvngx_dlssnr.dll，入库前会核对文件指纹。", [importTarget])}</p>
          : <><p>{t("选择组件类型后导入 DLL、插件文件或完整 ZIP 包。只加入组件库，不会立即写入游戏。")}</p>
            <Select label={t("导入组件类型")} value={importComponent} onChange={setImportComponent} disabled={busy}
              options={[["", t("选择组件类型")], ...Object.entries(data?.definitions || {})
                .filter(([id, def]) => !def.internal && !def.pinned && (def.files?.length || id === "optiscaler"))
                .map(([id, def]) => [id, t(def.name)])]} /></>}
      </Modal>}
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
            {(!modelsOnly || packs.length > 0) && <><h2>{t(modelsOnly ? "配套模型" : "配套组件")} <small className="section-count">{packs.length}</small></h2>
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
                  {packs.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{t(p.name)}</strong>
                      </td>
                      <td>{p.version}</td>
                      <td>{size(p.size)}</td>
                      <td><span className="library-state" data-tone={p.downloaded ? "ready" : undefined}>{t(p.downloaded ? "已缓存" : "按需下载")}</span></td>
                      <td>
                        <DownloadAction kind="runtime" id={p.id} cached={p.downloaded} disabled={busy}
                          label={modelsOnly ? "下载入库" : "下载"} bytes={p.size} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></>}
            <details className="advanced" key={modelsOnly ? "models" : "components"} open={modelsOnly || undefined} ref={upstreamList}>
              <summary>
                {modelsOnly ? (updates?.checkedAt ? t("上游发布文件（{0} 个）", [candidates.length]) : t("上游发布文件")) : t("上游可用版本")}
                {updates?.checkedAt
                  ? ` · ${dateTime(updates.checkedAt)}`
                  : ""}
              </summary>
              {rateNotice && <p className="muted">{rateNotice}</p>}
              {visibleErrors.filter(e => !(rateNotice && e.message === rateLimitError)).map((e) => (
                <p key={e.provider} className="muted">
                  {e.provider}: {t(e.message)}
                </p>
              ))}
              {candidates.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t(modelsOnly ? "型号 / 来源" : "组件 / 来源")}</th>
                        <th>{t("版本")}</th>
                        <th>{t("大小")}</th>
                        <th>{t("操作")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => {
                        const modelRelease = c.provider === "smartergamers-nr";
                        const modelLabel = c.catalogModelId || (c.provider === "rhi-nr" ? c.tag.replace(/^dlssnr-/i, "") : "");
                        const cached = c.cachedPackageId && data.packages.find(p => p.id === c.cachedPackageId && p.present);
                        const downloadId = c.downloadId || c.id;
                        return (
                          <tr key={c.id}>
                            <td>
                              {modelsOnly && modelLabel ? modelLabel : t(data.definitions[c.component]?.name || c.component)}
                              <small className="block">{c.repo}</small>
                            </td>
                            <td>
                              {modelRelease ? t("SmarterGamers 发布版 {0}", [c.tag]) : c.tag}
                              {c.stale ? t("（缓存记录）") : ""}
                              {modelRelease && <small className="block">{cached ? t("库内模型 {0}", [cached.version])
                                : /\.dll$/i.test(c.name) ? t("直接下载模型 DLL") : c.name}</small>}
                            </td>
                            <td>{size(c.size)}</td>
                            <td>
                              <DownloadAction id={downloadId} cached={!!cached} bytes={c.size}
                                upgrade={libraryUpgrade(c, data.packages)}
                                disabled={busy || !c.downloadable || !!(c.stale && !cached)}
                                onStart={() => void downloadVersion(downloadId, !!cached)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">
                  {t(checking ? "检查中…" : updates?.checkedAt ? (visibleErrors.length ? "部分来源读取失败，当前没有可列出的版本。" : "已检查组件来源，没有可列出的新版本。") : "点击“检查更新”获取上游版本。")}
                </p>
              )}
            </details>
            <h2>{t("已入库版本")} <small className="section-count">{packages.length}</small></h2>
            {!!data.warnings?.length && (
              <details className="advanced">
                <summary>{t("旧模型迁移提示")}</summary>
                <ul>{data.warnings.map((warning, index) => <li key={index} className="path">{t(warning)}</li>)}</ul>
              </details>
            )}
            {packages.length ? (
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
                    {packages.map((p) => (
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
    </div>
  );
}
