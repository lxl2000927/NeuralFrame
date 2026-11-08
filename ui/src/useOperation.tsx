import { locale, t } from "./i18n";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./components";
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
type Prompt = {
  title: string;
  body: ReactNode;
  confirm: string;
  blocked?: boolean;
  resolve: (v: boolean) => void;
};
export function useOperation(
  onMessage: (s: string) => void,
  onCompleted?: () => void,
) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false),
    [prompt, setPrompt] = useState<Prompt | null>(null),
    [progress, setProgress] = useState<string | null>(null);
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
        setProgress(t("检查本地缓存…"));
        const dispose = getBridge().onComponentProgress((p) =>
          setProgress(
            `${t(p.name)} · ${p.stage === "download" ? `${size(p.loaded || 0)} / ${size(p.total || 0)}` : p.stage === "verify" ? t("校验文件") : p.stage === "ready" ? t("已就绪") : t("检查缓存")}`,
          ),
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
      onMessage(result.recordWarning || completion);
      onCompleted?.();
      return true;
    } catch (e) {
      onMessage(errorText(e));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
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
      {progress && (
        <Modal
          title={t("准备组件")}
          onClose={() => {
            void getBridge().componentCancelPrepare();
          }}
          footer={
            <button
              onClick={() => {
                void getBridge().componentCancelPrepare();
              }}
            >
              {t("取消下载")}
            </button>
          }
        >
          <p role="status">{progress}</p>
          <progress />
        </Modal>
      )}
    </>
  );
  return { run, ask, busy, dialog };
}
