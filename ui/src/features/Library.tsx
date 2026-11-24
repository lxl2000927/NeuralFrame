import { t, dateTime } from "../i18n";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileUp, Trash2, Globe, GitBranch, ChevronDown } from "lucide-react";
import { getBridge } from "../bridge";
import { useWindowReturn } from "../useWindowReturn";
import { Loading, Modal, Select } from "../components";
import { errorText, size } from "../domain";
import { LibraryComponents } from "./LibraryComponents";
import type { Library as LibraryData, Updates } from "../types";
import type { Run } from "./Games";

const rateLimitError = "GitHub 请求已限流";
const noCandidates: Updates["candidates"] = [];

function lastReleaseCheck(result?: Updates | null) {
  const index = result?.checkedAt || "";
  const published = result?.publishedCheck?.checked ? result.publishedCheck.at : "";
  return published > index ? published : index;
}

function rateLimitNotice(result: Updates) {
  if (
    !result.nextCheckAt ||
    !result.errors.some((e) => e.message === rateLimitError)
  )
    return "";
  if (Date.now() >= result.nextCheckAt) return t("上次刷新遇到 GitHub 限流，现在可以重新检查版本。");
  if (result.publishedCheck?.checked) {
    const {checked,total} = result.publishedCheck;
    return t("已从 {0}/{1} 个项目发布页核对最新正式版。完整版本列表可在 {2} 后刷新，已有校验值的版本仍可下载。",
      [String(checked),String(total),dateTime(result.nextCheckAt)]);
  }
  return t("GitHub 暂时限制了版本查询，{0} 后可重新检查。已有校验值的版本仍可下载。", [
    dateTime(result.nextCheckAt),
  ]);
}

function libraryError(
  result: { message?: string; code?: string },
  fallback: string,
) {
  return (
    result.message ||
    (result.code === "errJobBusy"
      ? t("另一项操作正在进行，请稍后重试。")
      : fallback)
  );
}
export function Library({
  active,
  modelsOnly,
  onBack,
  downloadVersion,
  run,
  busy,
  message,
  refreshToken = 0,
}: {
  active: boolean;
  modelsOnly: boolean;
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
  const [cacheOpen, setCacheOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cacheComponent,setCacheComponent] = useState("");
  const [cacheAge,setCacheAge] = useState("0");
  const [importError, setImportError] = useState("");
  const [gpu, setGpu] = useState<{sm?: string | null; nvidiaPresent?: boolean | null}>({});
  const importing = active && importOpen;
  const returnRevision = useWindowReturn(active, busy || importing || checking);
  const closeImport = () => {
    setImportError("");
    setImportOpen(false);
  };
  const submitImport = async () => {
    setImportError("");
    const ok = await run(async () => {
      try {
        const result = await getBridge().libraryImport(importComponent);
        if (!result.ok && !result.cancelled)
          setImportError(libraryError(result, t("操作未完成")));
        return result;
      } catch (error) {
        setImportError(errorText(error));
        throw error;
      }
    });
    if (ok) closeImport();
  };
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBridge()
      .libraryComponents()
      .then((r) => {
        if (alive) {
          if (!r.ok) throw Error(libraryError(r, t("组件读取失败")));
          setData(r);
          setUpdates((current) =>
            current && lastReleaseCheck(current) > lastReleaseCheck(r.updates)
              ? current
              : r.updates || null,
          );
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e) || t("组件读取失败"));
      });
    return () => {
      alive = false;
    };
  }, [active, rev, refreshToken, returnRevision]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    // Use the physical GPU, never the user's chosen tuning profile. This cached
    // hardware read runs independently and does not hold up the component list.
    getBridge()
      .enhancedHardware(false, false)
      .then((result) => {
        if (alive) {
          const adapter = result.ok ? result.hardware?.gpu : undefined;
          setGpu({sm: adapter?.architecture?.sm, nvidiaPresent: adapter?.nvidiaPresent});
        }
      })
      .catch(() => {
        if (alive) setGpu({});
      });
    return () => {
      alive = false;
    };
  }, [active, rev, refreshToken, returnRevision]);
  const refresh = () => setRev((v) => v + 1);
  const cleanCache = async () => {
    setCleaning(true);
    try {
      await run(async () => {
        const result = await getBridge().libraryCleanCache({component:cacheComponent,olderThanDays:Number(cacheAge)});
        if (!result.ok) throw Error(result.message || t("缓存清理失败"));
        setCacheOpen(false);
        refresh();
        message(t("已清理 {0} 个版本，释放约 {1}。", [result.removedPackages || 0, size(result.removedBytes || 0)]) + (result.warning ? ` ${result.warning}` : ""));
        return result;
      });
    } finally { setCleaning(false); }
  };
  const cacheRows = data?.cache?.packages.filter(row=>(!cacheComponent||row.component===cacheComponent) &&
    (cacheAge==="0"||Date.parse(row.lastUsedAt||row.at||"")<Date.now()-Number(cacheAge)*86400000)) || [];
  const cacheComponents = [...new Set(data?.cache?.packages.map(row=>row.component)||[])];
  const visibleErrors =
    updates?.errors.filter(
      (e) =>
        !modelsOnly ||
        ["smartergamers-nr", "rhi-nr", "cache"].includes(e.provider),
    ) || [];
  const rateNotice =
    updates && rateLimitNotice({ ...updates, errors: visibleErrors });
  const checkUpdates = useCallback(
    async (notify = true) => {
      setChecking(true);
      try {
        const r = await getBridge().libraryCheck(notify);
        if (!r.ok) throw Error(libraryError(r, t("无法检查组件更新")));
        setUpdates(r);
        if (r.cancelled) {
          if (notify) message(r.message || t("已取消检查，保留上次结果。"));
        } else if (notify) {
          const notice = rateLimitNotice(r);
          if (notice) message(notice);
          else if (r.cached && r.nextCheckAt)
            message(
              t("已显示上次检查结果。可在 {0} 后重新检查。", [
                dateTime(r.nextCheckAt),
              ]),
            );
        }
      } catch (e) {
        message(errorText(e));
      } finally {
        setChecking(false);
      }
    },
    [message],
  );
  useEffect(() => {
    if (active && modelsOnly) void checkUpdates(false);
  }, [active, modelsOnly, checkUpdates]);
  const toolbar = (
    <div className="inline-actions library-actions">
      {modelsOnly && (
        <button onClick={onBack}>
          <ArrowLeft size={16} />
          {t("返回游戏详情")}
        </button>
      )}
      {checking ? (
        <button onClick={() => void getBridge().libraryCancel()}>{t("取消检查")}</button>
      ) : (
        <button disabled={busy} onClick={() => void checkUpdates()}>{t("检查更新")}</button>
      )}
      <button disabled={busy || checking || !data} onClick={() => setCacheOpen(true)}>
        <Trash2 size={15} />
        {t("缓存管理")}
      </button>
      <button
        disabled={busy || checking || !data}
        onClick={() => {
          setImportComponent(modelsOnly ? "dlss-nr" : "");
          setImportError("");
          setImportOpen(true);
        }}
      >
        <FileUp size={15} />
        {t("导入")}
      </button>
    </div>
  );
  return (
    <div className="page-scroll library-page">
      <div className="library-intro">
        {modelsOnly && <h2>{t("在线神经渲染模型")}</h2>}
        <p className="muted">
          {t(
            modelsOnly
              ? "模型按文件指纹区分；同名模型的不同来源分别保留。"
              : "下载只加入组件库；选择版本和应用配置请前往游戏页。",
          )}
        </p>
        <small className="library-update-status">
          {lastReleaseCheck(updates)
            ? t("上次检查：{0}", [dateTime(lastReleaseCheck(updates))])
            : t("尚未获取组件版本，可检查更新。")}
        </small>
      </div>
      <DownloadSources/>
      {!data && toolbar}
      {importing && (
        <Modal
          title="导入本地组件"
          onClose={closeImport}
          footer={
            <>
              <button onClick={closeImport}>{t("取消")}</button>
              <button
                className="primary"
                disabled={busy || !importComponent}
                onClick={() => void submitImport()}
              >
                {t("选择文件并导入…")}
              </button>
            </>
          }
        >
          {importError && (
            <p className="error" role="alert">
              {t(importError)}
            </p>
          )}
          <p>{t("选择组件类型后导入 DLL、插件文件或完整 ZIP 包。只加入组件库，不会立即写入游戏。")}</p>
          <Select
            label={t("导入组件类型")}
            value={importComponent}
            onChange={setImportComponent}
            disabled={busy}
            options={[
              ["", t("选择组件类型")],
              ...Object.entries(data?.definitions || {})
                .filter(([id, def]) => !def.internal && !def.pinned && (def.files?.length || id === "optiscaler"))
                .map(([id, def]) => [id, t(def.name)]),
            ]}
          />
        </Modal>
      )}
      {cacheOpen && data?.cache && (
        <Modal
          title="组件缓存管理"
          onClose={() => !cleaning && setCacheOpen(false)}
          footer={<>
            <button disabled={cleaning} onClick={() => setCacheOpen(false)}>{t("关闭")}</button>
            <button className="primary" disabled={cleaning || (!cacheRows.some(row=>row.removable) && (!!cacheComponent||cacheAge!=="0"||!data.cache.partialBytes))} onClick={() => void cleanCache()}>
              {t(cleaning ? "正在清理…" : "清理可释放缓存")}
            </button>
          </>}
        >
          <p>{t("组件缓存共 {0}，可安全释放约 {1}（含 {2} 临时下载）。", [size(data.cache.totalBytes), size(data.cache.removableBytes), size(data.cache.partialBytes)])}</p>
          <p className="muted">{t("只清理未引用且可重新下载的版本与临时文件；手动导入、内置组件、游戏选择和恢复备份会保留。")}</p>
          <div className="cache-filters"><Select label={t("缓存组件筛选")} value={cacheComponent} onChange={setCacheComponent}
            options={[["",t("全部组件")],...cacheComponents.map(id=>[id,t(data.definitions[id]?.name||id)])]}/>
            <Select label={t("闲置时间")} value={cacheAge} onChange={setCacheAge} options={[["0",t("不限")],["30",t("30 天未使用")],["90",t("90 天未使用")]]}/></div>
          <div className="cache-table"><table>
            <thead><tr><th>{t("组件 / 版本")}</th><th>{t("最近使用")}</th><th>{t("大小")}</th><th>{t("处理方式")}</th></tr></thead>
            <tbody>{cacheRows.map(row => <tr key={row.id}>
              <td><strong>{t(data.definitions[row.component]?.name || row.component)}</strong><br /><small>{row.version}</small></td>
              <td><small>{row.lastUsedAt?dateTime(row.lastUsedAt):row.at?t("入库 {0}",[dateTime(row.at)]):t("无使用记录")}</small></td>
              <td>{size(row.size)}</td>
              <td>{t(row.removable ? "可清理" : row.protectedReason)}</td>
            </tr>)}</tbody>
          </table></div>
        </Modal>
      )}
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
            {rateNotice && <p className="muted">{rateNotice}</p>}
            {visibleErrors
              .filter((e) => !(rateNotice && e.message === rateLimitError))
              .map((e) => (
                <p key={e.provider} className="muted">
                  {e.provider}: {t(e.message)}
                </p>
              ))}
            <LibraryComponents
              key={modelsOnly ? "models" : "components"}
              data={data}
              candidates={updates?.candidates || noCandidates}
              modelsOnly={modelsOnly}
              busy={busy}
              checking={checking}
              downloadVersion={downloadVersion}
              gpuSm={gpu.sm || null}
              nvidiaPresent={gpu.nvidiaPresent}
              toolbar={toolbar}
            />
            {!!data.warnings?.length && (
              <details className="advanced">
                <summary>{t("旧模型迁移提示")}</summary>
                <ul>
                  {data.warnings.map((warning, index) => (
                    <li key={index} className="path">
                      {t(warning)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )
      )}
    </div>
  );
}

function DownloadSources() {
  const [saved,setSaved] = useState(()=>({
    mirror:localStorage.getItem("neuralframe.githubMirror") || "",
    priority:localStorage.getItem("neuralframe.downloadSourcePriority") === "official" ? "official" : "mirror"
  }));
  const [draft,setDraft] = useState(saved);
  const [error,setError] = useState("");
  const prefix = draft.mirror.trim();
  const changed = prefix !== saved.mirror || draft.priority !== saved.priority;
  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (prefix) {
      try {
        const url = new URL(prefix);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error();
      } catch {
        setError(t("请填写 HTTPS 镜像前缀，不含账号、查询参数或片段。"));
        return;
      }
    }
    const next = {...draft,mirror:prefix};
    if (prefix) localStorage.setItem("neuralframe.githubMirror",prefix);
    else localStorage.removeItem("neuralframe.githubMirror");
    localStorage.setItem("neuralframe.downloadSourcePriority",next.priority);
    setSaved(next);setDraft(next);setError("");
  };
  return <details className="source-settings">
    <summary><Globe size={17}/><strong>{t("下载源设置")}</strong><span>{t(!saved.mirror ? "GitHub 直连" : saved.priority==="official" ? "GitHub 优先" : "镜像优先")}</span><ChevronDown size={16}/></summary>
    <form onSubmit={save} noValidate>
      <label className="source-address"><span>{t("自定义下载镜像前缀")}</span>
        <input type="url" className="text-field" value={draft.mirror} placeholder="https://mirror.example/" aria-invalid={!!error}
          aria-describedby={error ? "mirror-input-error" : undefined}
          onChange={e=>{setDraft({...draft,mirror:e.target.value});setError("");}}/></label>
      {error && <p className="error" id="mirror-input-error" role="alert">{error}</p>}
      <fieldset className="source-options" disabled={!prefix}><legend>{t("下载源优先级")}</legend>
        {[["official","GitHub 优先","失败时使用镜像"],["mirror","镜像优先","失败时使用 GitHub"]].map(([id,title,hint])=>
          <label key={id}><input type="radio" name="download-source" value={id} checked={(prefix ? draft.priority : "official")===id}
            onChange={()=>setDraft({...draft,priority:id})}/><span><strong>{t(title)}</strong><small>{t(hint)}</small></span></label>)}
      </fieldset>
      <footer><small><GitBranch size={14}/>{t(prefix ? "文件指纹来自官方元数据" : "未配置镜像，使用 GitHub 直连。")}</small>
        <button type="submit" className="primary" disabled={!changed}>{t("保存下载设置")}</button></footer>
    </form>
  </details>;
}
