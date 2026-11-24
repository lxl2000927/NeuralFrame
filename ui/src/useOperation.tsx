import { locale, t } from "./i18n";
import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Modal } from "./components";
import { DownloadContext, type DownloadKind, type QueueItem, type QueueFailure } from "./features/DownloadAction";
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
  overallLoaded?: number;
  overallTotal?: number;
  source?: string;
  sourceReason?: string;
  connections?: number;
  speed: number;
  note?: string;
};
// Only the queue controls and preparation dialog subscribe to byte-level updates.
function createTransferProgress() {
  let current: Transfer | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(next: Transfer | null) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

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
  const transferTail = useRef<Promise<boolean>>(Promise.resolve(true));
  const queued = useRef(new Map<string, QueueItem>());
  const [queueItems,setQueueItems] = useState<QueueItem[]>([]);
  const [completed,setCompleted] = useState(0);
  const [recentFailures,setRecentFailures] = useState<QueueFailure[]>([]);
  const failureAttempt = useRef(0);
  const cancelMode = useRef<"pause"|"discard"|"cancel">("cancel");
  const recordFailure = (kind:DownloadKind,id:string,name:string,detail:string) => {
    const reason=detail.split(/\r?\n/)[0].slice(0,180)||t("下载失败");
    setRecentFailures(current=>[{attempt:++failureAttempt.current,key:`${kind}:${id}`,kind,id,name,reason,detail,at:Date.now()},...current].slice(0,6));
  };
  const rate = useRef({ key: "", at: 0, bytes: 0, speed: 0 });
  const lastPaint = useRef(0);
  const [busy, setBusy] = useState(false),
    [prompt, setPrompt] = useState<Prompt | null>(null),
    [cancelling, setCancelling] = useState(false);
  const [transferProgress] = useState(createTransferProgress);
  // A single monotonic sample per asset keeps the speed honest when ranges
  // arrive in parallel and the reported byte count jumps.
  const absorb = (next: Omit<Transfer, "speed">) => {
    const key = `${next.name}|${next.stage}|${next.index ?? 0}|${next.total > 0}|${(next.overallTotal ?? 0) > 0}`;
    const now = Date.now();
    const seen = rate.current;
    if (seen.key !== key) rate.current = { key, at: now, bytes: next.loaded, speed: 0 };
    else if (next.stage === "download" && now - lastPaint.current < 120 && (next.total <= 0 || next.loaded < next.total)) return;
    else if (now - seen.at >= 500) {
      const speed = ((next.loaded - seen.bytes) * 1000) / (now - seen.at);
      rate.current = { key, at: now, bytes: next.loaded, speed: Math.max(0, speed) };
    }
    lastPaint.current = now;
    transferProgress.publish({ ...next, speed: rate.current.speed });
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
            overallLoaded: p.overallLoaded,
            overallTotal: p.overallTotal,
            source: p.source, sourceReason:p.sourceReason, connections:p.connections,
            note: p.stage === "verify" ? t("正在校验下载内容，请稍候。")
              : p.stage === "ready" ? t("已就绪，正在写入缓存…") : undefined,
          }),
        );
        try {
          const prepared = await getBridge().componentPrepare(
            result.dependencies,
            sourceOptions(),
          );
          if (prepared.cancelled) return false;
          if (!prepared.ok)
            throw Error(prepared.message || t("组件准备未完成"));
        } finally {
          dispose();
          transferProgress.publish(null);
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
  const sourceOptions = () => ({mirror:localStorage.getItem("neuralframe.githubMirror") || "",
    priority:(localStorage.getItem("neuralframe.downloadSourcePriority") === "official" ? "official" : "mirror") as "mirror"|"official"});
  const executeTransfer = (kind: DownloadKind, id: string, cached: boolean) => run(async () => {
    const bridge = getBridge();
    let displayName=id;
    cancelMode.current="cancel";
    rate.current = { key: "", at: 0, bytes: 0, speed: 0 };
    setCancelling(false);
    const subscribe = kind === "library" ? bridge.onLibraryProgress : bridge.onComponentProgress;
    const dispose = subscribe(p => {
      displayName=p.name||id;
      absorb({
        kind, id,
        name: displayName,
        stage: p.stage || "download",
        loaded: p.loaded || 0,
        total: p.total || 0,
        source: p.source, sourceReason:p.sourceReason, connections:p.connections,
        index: p.index,
        count: p.count,
        overallLoaded: p.overallLoaded,
        overallTotal: p.overallTotal,
        note: p.stage === "verify" ? t("正在校验下载内容，请稍候。") : undefined,
      });
    });
    absorb({ kind, id, name: id, stage: cached ? "checking" : "queued", loaded: 0, total: 0 });
    try {
      const result=kind === "library" ? await bridge.libraryDownload(id, sourceOptions()) : await bridge.componentPrepare(["runtime:" + id], sourceOptions());
      if(result.cancelled){
        const mode=cancelMode.current as "pause"|"discard"|"cancel";
        onMessage(t(mode==="discard"?"已取消下载并清理临时分段。":mode==="pause"?"已暂停下载，已保留可续传数据。":"已取消下载。"));
      }else if(!result.ok){
        recordFailure(kind,id,displayName,result.message||result.code||t("下载失败"));
      }else{
        setRecentFailures(current=>current.filter(failure=>failure.key!==`${kind}:${id}`));
      }
      return result;
    } catch(error) {
      recordFailure(kind,id,displayName,errorText(error));
      throw error;
    } finally {
      dispose();
      transferProgress.publish(null);
      setCancelling(false);
    }
  });
  const runTransfer = (kind: DownloadKind, id: string, cached: boolean) => {
    const key = `${kind}:${id}`;
    if (queued.current.has(key)) return Promise.resolve(true);
    if (!running.current && !queued.current.size) setCompleted(0);
    const item = {key, kind, id, cached};
    queued.current.set(key, item);
    setQueueItems([...queued.current.values()]);
    const execute = async () => {
      if (queued.current.get(key) !== item) return false;
      queued.current.delete(key);
      setQueueItems([...queued.current.values()]);
      try { return await executeTransfer(kind, id, cached); }
      finally { setCompleted(value=>value+1); }
    };
    const result = transferTail.current.then(execute, execute);
    transferTail.current = result.catch(() => false);
    return result;
  };
  const downloadVersion = (id: string, cached = false) => runTransfer("library", id, cached);
  const downloadRuntime = (id: string, cached: boolean) => runTransfer("runtime", id, cached);
  const cancelProgress = (discard = false) => {
    const progress = transferProgress.getSnapshot();
    if (!progress || cancelling || (progress.stage === "queued" && progress.kind !== "library")) return;
    cancelMode.current=discard?"discard":progress.stage==="download"?"pause":"cancel";
    setCancelling(true);
    void (progress.kind === "library" ? getBridge().libraryCancel({discard}) : getBridge().componentCancelPrepare({discard}))
      .catch(error => { setCancelling(false); onMessage(errorText(error), "error"); });
  };
  const dialog = prompt && (
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
  );
  const removeQueued = (key:string) => {
    const item=queued.current.get(key);
    if(!item)return;
    queued.current.delete(key);
    setQueueItems([...queued.current.values()]);
    onMessage(t("已移出队列：{0}",[item.id]));
  };
  const clearFailure = (attempt:number) => setRecentFailures(current=>current.filter(failure=>failure.attempt!==attempt));
  return { run, ask, busy, dialog, downloadVersion, feedback: {
    transferProgress, cancelling, cancelProgress, downloadRuntime, queueItems, completed, recentFailures, removeQueued, clearFailure,
  } };
}

export function TransferFeedback({feedback, children}: {
  feedback: ReturnType<typeof useOperation>["feedback"]; children: ReactNode;
}) {
  const {transferProgress, cancelling, cancelProgress, ...downloads} = feedback;
  const progress = useSyncExternalStore(transferProgress.subscribe, transferProgress.getSnapshot);
  const row = progress && progress.kind !== "prepare" && progress.id
    ? { ...progress, kind: progress.kind, id: progress.id, cancelling, cancel:()=>cancelProgress(false), discard:()=>cancelProgress(true) } : null;
  return <DownloadContext.Provider value={{...downloads, row}}>
    {children}
    {progress?.kind === "prepare" && <PreparationDialog progress={progress} cancelling={cancelling} cancelProgress={cancelProgress} />}
  </DownloadContext.Provider>;
}

function PreparationDialog({progress, cancelling, cancelProgress}: {
  progress: Transfer; cancelling: boolean; cancelProgress: (discard?: boolean) => void;
}) {
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
      onClose={()=>cancelProgress(false)}
      footer={
        <>
          <button onClick={()=>cancelProgress(false)} disabled={cancelling || progress.stage === "queued"}>
            {t(cancelling ? (downloading ? "正在暂停…" : "正在取消…") : (downloading ? "暂停下载" : "取消下载"))}
          </button>
          {downloading && <button className="danger" onClick={()=>cancelProgress(true)} disabled={cancelling}>{t("取消并清理")}</button>}
        </>
      }
    >
      <div className="transfer">
        <p className="transfer-head" role="status">
          <span className="transfer-name">
            {progress.count && progress.count > 1 && progress.index
              ? `${progress.index}/${progress.count} · `
              : ""}
            {t(progress.name)}
          </span>
          <span className="transfer-stage">{stageLabel}</span>
        </p>
        <progress
          max={100}
          value={downloading ? percent : undefined}
          aria-label={t("下载进度")}
        />
        {!!progress.count && progress.count > 1 && !!progress.overallTotal && (
          <div className="transfer-overall">
            <small>{t("整体进度")}</small>
            <progress max={100} value={Math.min(100, (progress.overallLoaded || 0) / progress.overallTotal * 100)} aria-label={t("整体下载进度")} />
            <small>{size(progress.overallLoaded || 0)} / {size(progress.overallTotal)}</small>
          </div>
        )}
        <p className="transfer-meta">
          {downloading && progress.total > 0 && (
            <span>{size(progress.loaded)} / {size(progress.total)} · {percent.toFixed(0)}%</span>
          )}
          {downloading && progress.speed > 0 && <span>{speedText(progress.speed)}</span>}
          {downloading && !!progress.connections && <span>{t("{0} 连接",[progress.connections])}</span>}
          {progress.source && <span title={progress.sourceReason}>{progress.source}</span>}
          {eta && <span>{eta}</span>}
          {progress.note && <span>{progress.note}</span>}
        </p>
      </div>
    </Modal>
  );
}
