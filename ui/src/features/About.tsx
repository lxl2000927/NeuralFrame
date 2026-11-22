import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Download, RotateCcw } from "lucide-react";
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
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<{received:number;total:number}>();
  const [manualResult, setResult] = useState<UpdateInfo>();
  const result = manualResult ?? launchRelease;
  useEffect(()=>getBridge().onUpdateProgress(value=>setProgress(value)),[]);
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
  const download=async()=>{
    setWorking(true);setProgress(undefined);
    try{const answer=await getBridge().downloadUpdate();setResult(answer);if(!answer.ok)throw Error(answer.message||t("下载失败"));message(t("更新已下载并通过校验"));}
    catch(e){message(errorText(e));}finally{setWorking(false);}
  };
  const apply=async()=>{
    if(!window.confirm(t("将替换当前 AppImage 并重启。上一版本会保留为备份，是否继续？")))return;
    setWorking(true);
    try{
      const answer=await getBridge().applyUpdate();
      if(!answer.ok){
        setResult(await getBridge().checkUpdate());
        throw Error(answer.message||t("更新失败"));
      }
      message(answer.message || t("正在重启到新版"));
    }
    catch(e){message(errorText(e));setWorking(false);}
  };
  const rollback=async()=>{
    if(!window.confirm(t("恢复上一版本并重启？当前版本会保留为 rejected 备份。")))return;
    setWorking(true);
    try{const answer=await getBridge().rollbackUpdate();if(!answer.ok)throw Error(answer.message||t("恢复失败"));message(answer.message || t("正在重启到上一版本"));}
    catch(e){message(errorText(e));setWorking(false);}
  };
  return (
    <>
      <Row
        label={t("检查更新")}
        hint={result ? releaseText(result) : t("从发布源读取最新版本号。")}
      >
        <button disabled={checking||working} onClick={() => void check()}>
          <RefreshCw size={15} />
          {t(checking ? "检查中…" : "检查")}
        </button>
      </Row>
      {result?.updateMessage&&<p className="scan-error" role="alert">{result.updateMessage}</p>}
      {result?.canInstall&&result.newer&&<Row label={t(result.staged?"安装 AppImage 更新":"下载 AppImage 更新")}
        hint={progress&&working?t("已下载 {0} / {1} MB",[(progress.received/1048576).toFixed(1),(progress.total/1048576).toFixed(1)]):t("{0} · {1} MB；下载后核对大小与 SHA-512",[result.assetName||"AppImage",((result.size||0)/1048576).toFixed(1)])}>
        <button disabled={working||checking} onClick={()=>void(result.staged?apply():download())}><Download size={15}/>{t(working?"处理中…":result.staged?"安装并重启":"下载更新")}</button>
      </Row>}
      {result?.rollbackAvailable&&<Row label={t("恢复上一版本")} hint={t("使用更新前保留的 AppImage 备份并重启。")}>
        <button disabled={working||checking} onClick={()=>void rollback()}><RotateCcw size={15}/>{t("恢复并重启")}</button>
      </Row>}
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
        <p>{t("集成社区与开源项目的图形组件，为 RTX 20–50 系列显卡管理神经渲染、多帧生成和配套运行库。")}</p>
        <p>{t("RTX 20–40 可通过相应组件解锁支持的多帧生成路线；RTX 50 原生支持多帧生成，提供参数与组件管理。具体功能取决于显卡、游戏和所选组件。")}</p>
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
