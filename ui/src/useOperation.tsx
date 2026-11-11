import { locale, t } from "./i18n";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./components";
import type { DownloadKind } from "./features/DownloadAction";
import { getBridge } from "./bridge";
import { errorText, size } from "./domain";
import type { Preview, Result } from "./types";
function FileChanges({ rows }: { rows: Preview["rows"] }) {
  const actions: Record<string, string> = {
    add: "新增",
    replace: "替换",
    remove: "删除",
    keep: "保留",
  };
  const version = (file: Preview["rows"][number]["before"]) =>
    file?.version || (file?.sha256 ? file.sha256.slice(0, 12) : "—");
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("文件")}</th>
            <th>{t("操作")}</th>
            <th>{t("版本 / 指纹")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rel}>
              <td className="path">
                {row.rel}
                {(row.source || row.backup) && (
                  <details>
                    <summary>{t("路径与来源")}</summary>
                    {row.source && (
                      <small className="block">{t(row.source)}</small>
                    )}
                    {row.backup && (
                      <small className="block">
                        {t(
                          row.backup.create
                            ? "应用时备份原始文件"
                            : "已有原始备份",
                        )}{" "}
                        · {row.backup.version || t("无版本信息")}
                      </small>
                    )}
                  </details>
                )}
              </td>
              <td>{t(actions[row.action] || row.action)}</td>
              <td>
                <span title={row.before?.sha256}>{version(row.before)}</span> →{" "}
                <span title={row.after?.sha256}>{version(row.after)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
type Transfer = {
  kind: "prepare" | DownloadKind;
  id?: string;
  name: string;
  stage: string;
  loaded: number;
  total: number;
  index?: number;
  count?: number;
  speed: number;
  note?: string;
};
type Prompt = {
  title: string;
  body: ReactNode;
  confirm: string;
  blocked?: boolean;
  resolve: (v: boolean) => void;
};
const percentOf = (t: Transfer) =>
  t.total > 0 ? Math.max(0, Math.min(100, (t.loaded / t.total) * 100)) : 0;
const speedText = (bytes: number) => (bytes > 0 ? `${size(bytes)}/s` : "");
function remainingText(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return t("剩余约 {0} 秒", [Math.max(1, Math.round(seconds))]);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return t("剩余约 {0} 分 {1} 秒", [minutes, rest]);
}
export function useOperation(
  onMessage: (s: string, tone?: "ok" | "error") => void,
  onCompleted?: () => void,
) {
  const running = useRef(false);
  const rate = useRef({ key: "", at: 0, bytes: 0, speed: 0 });
  const lastPaint = useRef(0);
  const [busy, setBusy] = useState(false),
    [prompt, setPrompt] = useState<Prompt | null>(null),
    [cancelling, setCancelling] = useState(false),
    [progress, setProgress] = useState<Transfer | null>(null);
  // A single monotonic sample per asset keeps the speed honest when ranges
  // arrive in parallel and the reported byte count jumps.
  const absorb = (next: Omit<Transfer, "speed">) => {
    const key = `${next.name}|${next.stage}`;
    const now = Date.now();
    const seen = rate.current;
    if (seen.key !== key) rate.current = { key, at: now, bytes: next.loaded, speed: 0 };
    else if (next.stage === "download" && now - lastPaint.current < 120 && next.loaded < next.total) return;
    else if (now - seen.at >= 500) {
      const speed = ((next.loaded - seen.bytes) * 1000) / (now - seen.at);
      rate.current = { key, at: now, bytes: next.loaded, speed: Math.max(0, speed) };
    }
    lastPaint.current = now;
    setProgress({ ...next, speed: rate.current.speed });
  };
  const ask = (
    title: string,
    body: ReactNode,
    confirm = t("继续"),
    blocked = false,
  ) =>
    new Promise<boolean>((resolve) =>
      setPrompt({ title, body, confirm, blocked, resolve }),
    );
  const finish = (ok: boolean) => {
    prompt?.resolve(ok);
    setPrompt(null);
  };
  async function run(operation: (token?: string) => Promise<Result>) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    try {
      let result = await operation();
      for (let i = 0; result.dependencies?.length && i < 3; i++) {
        if (
          !(await ask(
            t("准备配套组件"),
            <>
              <p>{t("先将所需组件下载到本地缓存，再生成游戏文件变更预览。")}</p>
              <ul>
                {result.downloads?.map((p) => (
                  <li key={p.name}>
                    {t(p.name)} · {size(p.size)}
                  </li>
                ))}
              </ul>
            </>,
            t("下载组件"),
          ))
        )
          return false;
        rate.current = { key: "", at: 0, bytes: 0, speed: 0 };
        setCancelling(false);
        absorb({ kind: "prepare", name: t("组件"), stage: "queued", loaded: 0, total: 0, note: t("检查本地缓存…") });
        const dispose = getBridge().onComponentProgress((p) =>
          absorb({
            kind: "prepare",
            name: p.name || t("组件"),
            stage: p.stage || "prepare",
            loaded: p.loaded || 0,
            total: p.total || 0,
            index: p.index,
            count: p.count,
            note: p.stage === "verify" ? t("正在校验下载内容，请稍候。")
              : p.stage === "ready" ? t("已就绪，正在写入缓存…") : undefined,
          }),
        );
        try {
          const prepared = await getBridge().componentPrepare(
            result.dependencies,
          );
          if (prepared.cancelled) return false;
          if (!prepared.ok)
            throw Error(prepared.message || t("组件准备未完成"));
        } finally {
          dispose();
          setProgress(null);
          setCancelling(false);
        }
        result = await operation();
      }
      if (result.preview) {
        const plan = result.preview;
        const changed = plan.rows.filter((row) => row.action !== "keep");
        const kept = plan.rows.filter((row) => row.action === "keep");
        if (
          !(await ask(
            t("应用前变更预览"),
            <>
              <p className="path">{plan.dir}</p>
              {plan.antiCheat && <p>
                <strong>{plan.antiCheat.components.length
                  ? t("检测到反作弊组件：{0}。", [plan.antiCheat.components.join(locale() === "en-US" ? ", " : "、")])
                  : t("此游戏有反作弊提示。")}</strong>{" "}
                {t("安装第三方 DLL 或叠加层前，请确认该游戏允许使用这些组件。")}
              </p>}
              {plan.conflicts.length > 0 && (
                <div className="error" role="alert">
                  {t("版本锁定或文件冲突阻止了此次操作。")}
                  <ul>
                    {plan.conflicts.map((reason) => (
                      <li key={reason} className="path">
                        {t(reason)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {changed.length ? (
                <FileChanges rows={changed} />
              ) : (
                <p>{t("没有需要修改的文件。")}</p>
              )}
              {!!kept.length && (
                <details className="advanced">
                  <summary>{t("保留的文件（{0}）", [kept.length])}</summary>
                  <FileChanges rows={kept} />
                </details>
              )}
              {plan.externalSteps?.map((s, i) => (
                <p className="path" key={i}>
                  {s.file} {s.args.join(" ")}
                </p>
              ))}
              {!plan.conflicts.length &&
                !!(changed.length || plan.externalSteps?.length) && (
                  <p>{t("应用后请重新启动游戏，以加载修改后的组件。")}</p>
                )}
            </>,
            t("确认应用"),
            plan.conflicts.length > 0,
          ))
        )
          return false;
        result = await operation(plan.token);
      }
      if (result.cancelled) return false;
      if (!result.ok)
        throw Error(result.message || result.code || t("操作未完成"));
      const completion = result.mfgResult?.skipped
        ? t("神经渲染配置已处理，当前游戏的 API 或位数不支持多帧生成。")
        : t("操作完成。");
      if (result.recordWarning) onMessage(result.recordWarning);
      else onMessage(completion, "ok");
      onCompleted?.();
      return true;
    } catch (e) {
      onMessage(errorText(e), "error");
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const runTransfer = (kind: DownloadKind, id: string, cached: boolean) => run(async () => {
    const bridge = getBridge();
    rate.current = { key: "", at: 0, bytes: 0, speed: 0 };
    setCancelling(false);
    const subscribe = kind === "library" ? bridge.onLibraryProgress : bridge.onComponentProgress;
    const dispose = subscribe(p => absorb({
      kind, id,
      name: p.name || t("组件"),
      stage: p.stage || "download",
      loaded: p.loaded || 0,
      total: p.total || 0,
      note: p.stage === "verify" ? t("正在校验下载内容，请稍候。") : undefined,
    }));
    absorb({ kind, id, name: t("组件"), stage: cached ? "checking" : "queued", loaded: 0, total: 0 });
    try {
      return kind === "library" ? await bridge.libraryDownload(id) : await bridge.componentPrepare(["runtime:" + id]);
    } finally {
      dispose();
      setProgress(null);
      setCancelling(false);
    }
  });
  const downloadVersion = (id: string, cached = false) => runTransfer("library", id, cached);
  const downloadRuntime = (id: string, cached: boolean) => runTransfer("runtime", id, cached);
  const cancelProgress = () => {
    if (!progress || cancelling || progress.stage === "queued") return;
    setCancelling(true);
    void (progress.kind === "library" ? getBridge().libraryCancel() : getBridge().componentCancelPrepare())
      .catch(error => { setCancelling(false); onMessage(errorText(error), "error"); });
  };
  const dialog = (
    <>
      {prompt && (
        <Modal
          title={prompt.title}
          onClose={() => finish(false)}
          footer={
            <>
              <button onClick={() => finish(false)}>{t("取消")}</button>
              <button
                className="primary"
                disabled={prompt.blocked}
                onClick={() => finish(true)}
              >
                {prompt.confirm}
              </button>
            </>
          }
        >
          {prompt.body}
        </Modal>
      )}
      {progress?.kind === "prepare" && (() => {
        const percent = percentOf(progress);
        const downloading = progress.stage === "download";
        const stageLabel = progress.stage === "verify" ? t("校验文件")
          : progress.stage === "ready" ? t("已就绪")
            : downloading ? t("下载中") : t("准备中");
        const eta = downloading && progress.speed > 0 && progress.total > progress.loaded
          ? remainingText((progress.total - progress.loaded) / progress.speed)
          : "";
        return (
          <Modal
            title={t("准备组件")}
            onClose={cancelProgress}
            footer={
              <button onClick={cancelProgress} disabled={cancelling || progress.stage === "queued"}>
                {t(cancelling ? "正在取消…" : "取消下载")}
              </button>
            }
          >
            <div className="transfer">
              <p className="transfer-head" role="status">
                <span className="transfer-name">
                  {progress.count && progress.count > 1 && progress.index
                    ? `${progress.index}/${progress.count} · `
                    : ""}
                  {progress.name}
                </span>
                <span className="transfer-stage">{stageLabel}</span>
              </p>
              <progress
                max={100}
                value={downloading ? percent : undefined}
                aria-label={t("下载进度")}
              />
              <p className="transfer-meta">
                {downloading && progress.total > 0 && (
                  <span>{size(progress.loaded)} / {size(progress.total)} · {percent.toFixed(0)}%</span>
                )}
                {downloading && progress.speed > 0 && <span>{speedText(progress.speed)}</span>}
                {eta && <span>{eta}</span>}
                {progress.note && <span>{progress.note}</span>}
              </p>
            </div>
          </Modal>
        );
      })()}
    </>
  );
  const row = progress && progress.kind !== "prepare" && progress.id
    ? { ...progress, kind: progress.kind, id: progress.id, cancelling, cancel: cancelProgress } : null;
  return { run, ask, busy, dialog, downloadVersion, downloads: { row, downloadRuntime } };
}
