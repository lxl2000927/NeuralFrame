import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { getBridge } from "../bridge";
import { Row } from "../components";
import { errorText } from "../domain";
import { t } from "../i18n";
import type { UpdateInfo } from "../types";
import mark from "../../../assets/neuralframe/mark-ui.png";

export function releaseText(update: UpdateInfo) {
  if (update.newer && update.latest)
    return t("发现新版本 {0}（当前 {1}）", [update.latest, update.current]);
  if (update.latest && update.latest !== update.current)
    return t("本机版本 {0}，发布源版本 {1}", [update.current, update.latest]);
  if (update.latest) return t("当前已是最新版本 {0}", [update.latest]);
  return t(update.message || "暂时无法读取发布源，稍后再试。");
}
export async function openProjectLink(
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
export function ReleaseCheck({ message, launchRelease }: { message: (s: string) => void; launchRelease?: UpdateInfo }) {
  const [checking, setChecking] = useState(false);
  const [manualResult, setResult] = useState<UpdateInfo>();
  const result = manualResult ?? launchRelease;
  const check = async () => {
    setChecking(true);
    try {
      setResult(await getBridge().checkUpdate(true));
    } catch (e) {
      const reason = errorText(e);
      setResult({ current: __APP_VERSION__, latest: null, newer: false, message: reason });
      message(reason);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <Row
        label={t("检查更新")}
        hint={result ? releaseText(result) : t("从发布源读取最新版本号。")}
      >
        <button disabled={checking} onClick={() => void check()}>
          <RefreshCw size={15} />
          {t(checking ? "检查中…" : "检查")}
        </button>
      </Row>
      {result?.notes && (
        <details className="advanced">
          <summary>
            {t("版本说明")} · {result.latest}
          </summary>
          <p className="release-notes">{result.notes}</p>
        </details>
      )}
    </>
  );
}
export default function About({ message, launchRelease }: { message: (s: string) => void; launchRelease?: UpdateInfo }) {
  return (
    <div className="page-scroll about-page">
      <section className="about-overview">
        <div className="about-brand">
          <img src={mark} alt="" />
          <div>
            <h2>NeuralFrame</h2>
            <small>v{__APP_VERSION__}</small>
          </div>
        </div>
        <p>{t("管理游戏的神经渲染模型、多帧生成和配套组件。")}</p>
        <div className="inline-actions">
          <button onClick={() => void openProjectLink("github", message)}>
            <ExternalLink size={15} />GitHub
          </button>
          <button onClick={() => void openProjectLink("releases", message)}>
            <ExternalLink size={15} />{t("版本发布与更新说明")}
          </button>
        </div>
      </section>
      <div className="settings-table">
        <ReleaseCheck message={message} launchRelease={launchRelease} />
      </div>
    </div>
  );
}
