import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./components";
import { getBridge } from "./bridge";
import { errorText, size } from "./domain";
import type { Result } from "./types";
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
    confirm = "继续",
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
            "准备配套组件",
            <>
              <p>先将所需组件下载到本地缓存，再生成游戏文件变更预览。</p>
              <ul>
                {result.downloads?.map((p) => (
                  <li key={p.name}>
                    {p.name} · {size(p.size)}
                  </li>
                ))}
              </ul>
            </>,
            "下载组件",
          ))
        )
          return false;
        setProgress("检查本地缓存…");
        const dispose = getBridge().onComponentProgress((p) =>
          setProgress(
            `${p.name} · ${p.stage === "download" ? `${size(p.loaded || 0)} / ${size(p.total || 0)}` : p.stage === "verify" ? "校验文件" : p.stage === "ready" ? "已就绪" : "检查缓存"}`,
          ),
        );
        try {
          const prepared = await getBridge().componentPrepare(
            result.dependencies,
          );
          if (!prepared.ok) throw Error(prepared.message || "组件准备未完成");
        } finally {
          dispose();
          setProgress(null);
        }
        result = await operation();
      }
      if (result.preview) {
        const plan = result.preview;
        const actions: Record<string, string> = {
          add: "新增",
          replace: "替换",
          remove: "删除",
          keep: "保留",
        };
        if (
          !(await ask(
            "应用前变更预览",
            <>
              <p className="path">{plan.dir}</p>
              {plan.conflicts.length > 0 && (
                <p className="error">版本锁定或文件冲突阻止了此次操作。</p>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>文件</th>
                      <th>操作</th>
                      <th>版本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="path">{r.rel}</td>
                        <td>{actions[r.action] || r.action}</td>
                        <td>
                          {r.before?.version || "—"} → {r.after?.version || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan.externalSteps?.map((s, i) => (
                <p className="path" key={i}>
                  {s.file} {s.args.join(" ")}
                </p>
              ))}
              <p>应用后请重新启动游戏，以加载修改后的组件。</p>
            </>,
            "确认应用",
            plan.conflicts.length > 0,
          ))
        )
          return false;
        result = await operation(plan.token);
      }
      if (!result.ok)
        throw Error(result.message || result.code || "操作未完成");
      onMessage(result.recordWarning || "操作完成。");
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
              <button onClick={() => finish(false)}>取消</button>
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
          title="准备组件"
          onClose={() => {
            void getBridge().componentCancelPrepare();
          }}
          footer={
            <button
              onClick={() => {
                void getBridge().componentCancelPrepare();
              }}
            >
              取消下载
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
