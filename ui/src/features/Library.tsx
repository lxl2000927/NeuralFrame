import { t, dateTime } from "../i18n";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileUp } from "lucide-react";
import { getBridge } from "../bridge";
import { useWindowReturn } from "../useWindowReturn";
import { Loading, Modal, Select } from "../components";
import { errorText } from "../domain";
import { LibraryComponents } from "./LibraryComponents";
import type { Library as LibraryData, Updates } from "../types";
import type { Run } from "./Games";

const rateLimitError = "GitHub 请求已限流";

function rateLimitNotice(result: Updates) {
  if (
    !result.nextCheckAt ||
    !result.errors.some((e) => e.message === rateLimitError)
  )
    return "";
  return t("GitHub 暂时限制了请求。可在 {0} 后重新检查。", [
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
  const [gpuSm, setGpuSm] = useState<string | null>(null);
  const importing = active && (importOpen || !!importTarget);
  const returnRevision = useWindowReturn(active, busy || importing || checking);
  const closeImport = () => {
    setImportError("");
    setImportOpen(false);
    onImportClosed();
  };
  const submitImport = async () => {
    setImportError("");
    let notice = "";
    const ok = await run(async () => {
      try {
        if (importTarget) {
          const result = await getBridge().enhancedImportModel(undefined, {
            expectedModelId: importTarget,
          });
          if (result.model)
            notice = t(
              result.model.compatibility?.status === "incompatible"
                ? "模型 {0} 已入库，本机显卡不支持运行此模型。"
                : "已导入模型 {0}",
              [result.model.id],
            );
          if (!result.ok && !result.cancelled)
            setImportError(libraryError(result, t("操作未完成")));
          return result;
        }
        const result = await getBridge().libraryImport(importComponent);
        if (!result.ok && !result.cancelled)
          setImportError(libraryError(result, t("操作未完成")));
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
            current?.checkedAt &&
            current.checkedAt > (r.updates?.checkedAt || "")
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
        if (alive)
          setGpuSm(
            result.ok ? result.hardware?.gpu?.architecture?.sm || null : null,
          );
      })
      .catch(() => {
        if (alive) setGpuSm(null);
      });
    return () => {
      alive = false;
    };
  }, [active, rev, refreshToken, returnRevision]);
  const refresh = () => setRev((v) => v + 1);
  const visibleErrors =
    updates?.errors.filter(
      (e) =>
        !modelsOnly ||
        ["smartergamers-nr", "rhi-nr", "cache"].includes(e.provider),
    ) || [];
  const candidates =
    updates?.candidates.filter(
      (c) => !modelsOnly || c.component === "dlss-nr",
    ) || [];
  const rateNotice =
    updates && rateLimitNotice({ ...updates, errors: visibleErrors });
  const checkUpdates = useCallback(
    async (notify = true) => {
      setChecking(true);
      try {
        const r = await getBridge().libraryCheck();
        if (!r.ok) throw Error(libraryError(r, t("无法检查组件更新")));
        setUpdates(r);
        if (notify) {
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
    if (active && modelsOnly && !importTarget) void checkUpdates(false);
  }, [active, modelsOnly, importTarget, checkUpdates]);
  const toolbar = (
    <div className="inline-actions library-actions">
      {modelsOnly && (
        <button onClick={onBack}>
          <ArrowLeft size={16} />
          {t("返回模型库")}
        </button>
      )}
      <button disabled={busy || checking} onClick={() => void checkUpdates()}>
        {checking ? t("检查中…") : t("检查更新")}
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
          {updates?.checkedAt
            ? t("上次检查：{0}", [dateTime(updates.checkedAt)])
            : t("尚未获取组件版本，可检查更新。")}
        </small>
      </div>
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
                disabled={busy || (!importTarget && !importComponent)}
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
          {importTarget ? (
            <p>
              {t("为 {0} 选择 nvngx_dlssnr.dll，入库前会核对文件指纹。", [
                importTarget,
              ])}
            </p>
          ) : (
            <>
              <p>
                {t(
                  "选择组件类型后导入 DLL、插件文件或完整 ZIP 包。只加入组件库，不会立即写入游戏。",
                )}
              </p>
              <Select
                label={t("导入组件类型")}
                value={importComponent}
                onChange={setImportComponent}
                disabled={busy}
                options={[
                  ["", t("选择组件类型")],
                  ...Object.entries(data?.definitions || {})
                    .filter(
                      ([id, def]) =>
                        !def.internal &&
                        !def.pinned &&
                        (def.files?.length || id === "optiscaler"),
                    )
                    .map(([id, def]) => [id, t(def.name)]),
                ]}
              />
            </>
          )}
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
              candidates={candidates}
              modelsOnly={modelsOnly}
              busy={busy}
              checking={checking}
              downloadVersion={downloadVersion}
              gpuSm={gpuSm}
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
