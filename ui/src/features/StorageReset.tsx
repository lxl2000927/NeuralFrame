import { useEffect, useRef, useState } from "react";
import { getBridge } from "../bridge";
import { Modal } from "../components";
import { errorText, size } from "../domain";
import { t } from "../i18n";
import type { ResetGame, ResetProgress, ResetResult } from "../types";

export function StorageReset({onClose, onReset, onGamesChanged}: {
  onClose: () => void;
  onReset: () => Promise<void>;
  onGamesChanged: () => Promise<void>;
}) {
  const [includeGames, setIncludeGames] = useState(false);
  const [phase, setPhase] = useState<"options" | "checking" | "applying" | "result">("options");
  const [token, setToken] = useState("");
  const [games, setGames] = useState<ResetGame[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResetResult>();
  const [progress, setProgress] = useState<ResetProgress>();
  const applying = useRef(false);
  useEffect(() => getBridge().onResetProgress(setProgress), []);

  async function checkGames() {
    setToken(""); setGames([]); setResult(undefined); setError(""); setPhase("checking");
    try {
      const preview = await getBridge().previewResetDeployments();
      if (!preview.ok || !preview.token) throw Error(preview.message || t("无法检查游戏部署"));
      setGames(preview.games || []);
      setToken(preview.token);
    } catch (e) { setError(errorText(e)); }
    finally { setPhase("options"); }
  }

  async function apply() {
    if (applying.current || (includeGames && !token)) return;
    applying.current = true;
    setPhase("applying"); setProgress(undefined); setError("");
    try {
      const response = await getBridge().resetWithCache(includeGames ? token : undefined);
      setResult(response);
      setGames(response.games || []);
      if (response.ok) await onReset();
      else if (response.games?.some(game => game.restored)) await onGamesChanged();
    } catch (e) { setError(errorText(e)); }
    finally { applying.current = false; setPhase("result"); }
  }

  const working = phase === "checking" || phase === "applying";
  const blocked = games.some(game => !!game.error);
  const ready = games.filter(game => !game.error).length;
  const hasResults = phase === "result";
  return <Modal title="清理缓存并恢复初始状态" onClose={() => { if (!applying.current) onClose(); }}
    footer={<>
      <button disabled={phase === "applying"} onClick={onClose}>{t(hasResults ? "关闭" : "取消")}</button>
      {includeGames && !working && !result?.ok && (!token || blocked || hasResults) &&
        <button onClick={() => void checkGames()}>{t("重新检查")}</button>}
      {!hasResults && <button className="danger" disabled={working || (includeGames && (!token || (blocked && !ready)))}
        onClick={() => void apply()}>{t(includeGames && games.length ? "还原并清理" : "清理并重置")}</button>}
    </>}>
    {!hasResults && <>
      <p>{t("清理未引用且可重新下载的组件及临时下载，恢复管理器设置和游戏库索引。手动导入的组件、回滚备份、操作历史和叠加层配置会保留。")}</p>
      <label className="reset-games-choice"><input type="checkbox" checked={includeGames} disabled={working}
        onChange={event => {
          setIncludeGames(event.target.checked);
          if (event.target.checked) void checkGames();
          else { setToken(""); setGames([]); setError(""); }
        }}/>{t("同时还原所有已部署游戏")}</label>
      {includeGames && <p className="muted">{t("请先关闭游戏。还原会移除 NeuralFrame 部署的文件、恢复备份并解除对应游戏的版本锁定。")}</p>}
      {phase === "checking" && <p role="status">{t("正在检查游戏部署和备份…")}</p>}
      {phase === "applying" && <p role="status">{progress ? t("正在还原 {0}/{1} · {2}", [progress.index, progress.total, progress.dir]) : t("正在处理…")}</p>}
      {token && !games.length && <p>{t("未发现已部署的游戏。")}</p>}
      {blocked && <p>{t("可还原的游戏会先处理。所有游戏还原成功后才会清理缓存和重置设置。")}</p>}
    </>}
    {games.length > 0 && <ul className="reset-game-list">{games.map(game =>
      <li key={game.dir}>
        <strong>{game.name}</strong><small className="path">{game.dir}</small>
        <span className={game.error || game.warning ? "error" : "muted"}>{game.error ? t(game.error) :
          game.restored ? [t("已还原"), t(game.warning)].filter(Boolean).join(" · ") : t("涉及 {0} 个文件", [game.files || 0])}</span>
      </li>)}</ul>}
    {result?.ok && <p role="status">{t("设置已重置。界面硬件加速设置将在重启后生效。")} {t("已清理 {0} 个版本，释放约 {1}。", [result.removedPackages || 0, size(result.removedBytes || 0)])}</p>}
    {(error || result?.message) && <p className="error" role="alert">{t(error || result?.message)}</p>}
  </Modal>;
}
