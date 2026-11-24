import { useEffect, useState } from "react";
import {
  ArrowRight,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { getBridge } from "../bridge";
import { Modal, Row } from "../components";
import { errorText } from "../domain";
import { t } from "../i18n";
import type { UpdateInfo } from "../types";

function releaseText(update: UpdateInfo) {
  if (update.newer && update.latest)
    return t("发现新版本 {0}（当前 {1}）", [update.latest, update.current]);
  if (update.latest && update.latest !== update.current)
    return t("本机版本 {0}，发布源版本 {1}", [update.current, update.latest]);
  if (update.latest) return t("当前已是最新版本 {0}", [update.latest]);
  return t(update.message || "暂时无法读取发布源，稍后再试。");
}
async function openProjectLink(
  key: "github" | "releases",
  message: (s: string) => void,
) {
  try {
    if (!(await getBridge().openProject(key)))
      throw Error(t("无法打开项目链接"));
  } catch (e) {
    message(errorText(e));
  }
}
function ReleaseNotes({text}: {text: string}) {
  return <div className="release-notes">{text.trim().split(/\r?\n\s*\r?\n/).map((block, i) => {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length === 1 && /^#{1,6}\s/.test(lines[0]))
      return <h3 key={i}>{lines[0].replace(/^#{1,6}\s+/, "")}</h3>;
    if (lines.every(line => /^\s*[-*]\s+/.test(line)))
      return <ul key={i}>{lines.map((line, j) => <li key={j}>{line.replace(/^\s*[-*]\s+/, "")}</li>)}</ul>;
    return <p key={i}>{block}</p>;
  })}</div>;
}

export type UpdateProps = {
  result?: UpdateInfo;
  version: string;
  onResult: (result: UpdateInfo) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
};

export function SoftwareUpdate({
  result,
  version,
  onResult,
  open,
  onOpen,
  message,
}: UpdateProps & { message: (s: string) => void }) {
  const [task, setTask] = useState<
    "check" | "download" | "apply" | "rollback"
  >();
  const [progress, setProgress] = useState<{
    received: number;
    total: number;
  }>();
  const [error, setError] = useState("");
  useEffect(() => getBridge().onUpdateProgress(setProgress), []);
  const linux = result?.platform === "linux-appimage";
  const portable = result?.platform === "windows-portable";
  const act = async (type: NonNullable<typeof task>) => {
    if (task) return;
    if (
      type === "apply" &&
      linux &&
      !window.confirm(
        t("将替换当前 AppImage 并重启。上一版本会保留为备份，是否继续？"),
      )
    )
      return;
    if (
      type === "rollback" &&
      !window.confirm(t("恢复上一版本并重启？当前版本会保留为 rejected 备份。"))
    )
      return;
    setTask(type);
    setError("");
    try {
      const bridge = getBridge();
      if (type === "check") {
        const answer = await bridge.checkUpdate(true);
        onResult(answer);
        if (answer.newer) onOpen(true);
      } else if (type === "download") {
        setProgress(undefined);
        const answer = await bridge.downloadUpdate();
        onResult(answer);
        if (!answer.ok) throw Error(answer.message || t("下载失败"));
      } else {
        const answer = await (type === "apply"
          ? bridge.applyUpdate()
          : bridge.rollbackUpdate());
        if (!answer.ok) {
          onResult(await bridge.checkUpdate());
          throw Error(answer.message || t("更新失败"));
        }
        if (linux) message(answer.message || t("正在重启"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setTask(undefined);
    }
  };
  const action = result?.staged
    ? linux
      ? "安装并重启"
      : portable
        ? "显示便携版文件"
        : "打开安装程序"
    : "下载更新";
  return (
    <>
      <div className="settings-table">
        <Row
          label={"NeuralFrame " + version}
          hint={result ? releaseText(result) : t("从发布源读取最新版本号。")}
        >
          {(result?.newer || result?.notes) && (
            <button onClick={() => onOpen(true)}>
              {t(result.newer ? "查看更新" : "版本说明")}
            </button>
          )}
          <button disabled={!!task} onClick={() => void act("check")}>
            <RefreshCw size={15} />
            {t(task === "check" ? "检查中…" : "检查更新")}
          </button>
        </Row>
        {result?.rollbackAvailable && (
          <Row
            label={t("恢复上一版本")}
            hint={t("使用更新前保留的 AppImage 备份并重启。")}
          >
            <button disabled={!!task} onClick={() => void act("rollback")}>
              <RotateCcw size={15} />
              {t("恢复并重启")}
            </button>
          </Row>
        )}
      </div>
      {!open && (error || result?.updateMessage) && (
        <p className="error" role="alert">
          {error || t(result?.updateMessage)}
        </p>
      )}
      <div className="settings-update-links">
        <button onClick={() => void openProjectLink("github", message)}>
          <ExternalLink size={14} />
          GitHub
        </button>
        <button onClick={() => void openProjectLink("releases", message)}>
          <ExternalLink size={14} />
          {t("版本发布与更新说明")}
        </button>
      </div>
      {open && result && (
        <Modal
          title={result.newer ? "软件更新" : "版本说明"}
          className="software-update"
          onClose={() => onOpen(false)}
          footer={
            <>
              <button onClick={() => onOpen(false)}>
                {t(result.newer ? "稍后再说" : "关闭")}
              </button>
              {result.newer &&
                (result.canInstall ? (
                  <button
                    className="primary"
                    disabled={!!task}
                    onClick={() =>
                      void act(result.staged ? "apply" : "download")
                    }
                  >
                    <Download size={15} />
                    {t(task === "download" ? "正在下载…" : action)}
                  </button>
                ) : (
                  <button
                    onClick={() => void openProjectLink("releases", setError)}
                  >
                    <ExternalLink size={15} />
                    {t("打开发行页")}
                  </button>
                ))}
            </>
          }
        >
          <p className="update-version">
            {result.newer && (
              <>
                <span>v{result.current}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
            <strong>v{result.latest}</strong>
          </p>
          {result.assetName && (
            <p className="update-file">
              {result.assetName} · {((result.size || 0) / 1048576).toFixed(1)}{" "}
              MB
            </p>
          )}
          {task === "download" && (
            <div className="update-progress" role="status">
              <progress
                aria-label={t("下载更新")}
                value={progress?.received}
                max={progress?.total || 1}
              />
              {progress &&
                t("已下载 {0} / {1} MB", [
                  (progress.received / 1048576).toFixed(1),
                  (progress.total / 1048576).toFixed(1),
                ])}
            </div>
          )}
          {result.staged && (
            <p role="status">
              {t(
                linux
                  ? "更新已下载并通过校验"
                  : "已校验并保存到下载文件夹中的 NeuralFrame 目录。",
              )}
            </p>
          )}
          {(error || result.updateMessage) && (
            <p className="error" role="alert">
              {error || t(result.updateMessage)}
            </p>
          )}
          {result.notes && <ReleaseNotes text={result.notes} />}
        </Modal>
      )}
    </>
  );
}
