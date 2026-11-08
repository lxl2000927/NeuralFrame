import { useId } from "react";
import { t } from "./i18n";
import { ImagePlus, FolderOpen, EyeOff } from "lucide-react";
import { Artwork } from "./components";
import type { Game } from "./types";
import { getBridge } from "./bridge";
import { errorText } from "./domain";

export type CardAction =
  "poster" | "open" | "hide" | "scan" | "details" | "copy" | "restore";
type GameMenuPosition = { x?: number; y?: number; keyboard?: boolean };
export type GameMenuHandler = (game: Game, position: GameMenuPosition) => void;

export async function showGameMenu(
  game: Game,
  position: GameMenuPosition,
  busy: boolean,
  action: (game: Game, action: CardAction) => void,
  message: (s: string) => void,
) {
  try {
    const choice = await getBridge().gameMenu(game.dir, {
      position,
      busy,
      labels: {
        details: t("查看游戏详情"),
        open: t("打开游戏目录"),
        copy: t("复制游戏目录"),
        scan: t("重新扫描游戏"),
        poster: t("更换封面"),
        restore: t("卸载并恢复游戏原始状态"),
        hide: t("隐藏游戏"),
        cancel: t("取消"),
        confirmRestore: t("恢复这款游戏的原始文件？"),
        restoreHint: t(
          "将删除本次部署的文件，并从 _DLSS5_Backup 还原原始文件。游戏需要处于关闭状态。",
        ),
      },
    });
    if (
      choice === "open" ||
      choice === "copy" ||
      choice === "details" ||
      choice === "poster" ||
      choice === "restore" ||
      choice === "scan" ||
      choice === "hide"
    )
      action(game, choice);
  } catch (e) {
    message(errorText(e));
  }
}
export function gameMenuEvents(game: Game, openMenu: GameMenuHandler) {
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      openMenu(game, { x: e.clientX, y: e.clientY });
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      openMenu(game, { keyboard: true, x: rect.left + 12, y: rect.top + 12 });
    },
  };
}

export function GameCard({
  game,
  busy,
  onSelect,
  onAction,
  openMenu,
}: {
  game: Game;
  busy: boolean;
  onSelect: (dir: string) => void;
  onAction: (game: Game, action: CardAction) => void;
  openMenu: GameMenuHandler;
}) {
  const statusId = useId();
  const scan = game.cached;
  const api = scan?.apiLabel || scan?.api;
  const hasDlss = Boolean(scan?.dlss || scan?.hasDlss);
  const hasAddon = Boolean(scan?.addon || scan?.optiscaler);
  const apiLabel =
    api?.replace(/^(?:DX|D3D|Direct3D)\s*(\d+(?:\.\d+)?)$/i, "DirectX $1") ||
    (scan ? t("API 未识别") : t("API 待检测"));
  return (
    <article
      className="home-game-card"
      aria-label={game.name}
      {...gameMenuEvents(game, openMenu)}
    >
      <div className="card-face">
        <button
          className="card-main"
          title={game.name}
          aria-label={game.name}
          aria-describedby={statusId}
          onClick={() => onSelect(game.dir)}
        >
          <span className="card-cover">
            <Artwork game={game} layout="cover" />
            <span className="card-status" id={statusId}>
              {scan?.ok ? (
                <>
                  <span
                    data-present={hasDlss || undefined}
                    title={scan.dlss ? `DLSS ${scan.dlss}` : undefined}
                  >
                    {scan.dlss || t(hasDlss ? "有 DLSS" : "无 DLSS")}
                  </span>
                  <span data-present={hasAddon || undefined}>
                    {scan.optiscaler ? "OptiScaler" : t(hasAddon ? "插件" : "无插件")}
                  </span>
                </>
              ) : (
                <span>
                  {t(!scan ? "待扫描" : scan.reason === "error" ? "扫描失败" : "未检测")}
                </span>
              )}
            </span>
          </span>
          <strong className="card-title">{game.name}</strong>
        </button>
        <div className="card-tools">
          <div
            className="card-actions"
            role="group"
            aria-label={t("{0} 操作", [game.name])}
          >
            <button
              disabled={busy}
              title={t("更换封面")}
              aria-label={t("更换封面：{0}", [game.name])}
              onClick={() => onAction(game, "poster")}
            >
              <ImagePlus size={16} />
            </button>
            <button
              disabled={busy}
              title={t("打开游戏目录")}
              aria-label={t("打开目录：{0}", [game.name])}
              onClick={() => onAction(game, "open")}
            >
              <FolderOpen size={16} />
            </button>
            <button
              disabled={busy}
              title={t("隐藏游戏（可在设置中恢复）")}
              aria-label={t("隐藏游戏：{0}", [game.name])}
              onClick={() => onAction(game, "hide")}
            >
              <EyeOff size={16} />
            </button>
          </div>
          <button
            className="card-api"
            data-dx12={apiLabel === "DirectX 12" || undefined}
            disabled={busy}
            title={t("{0} · 点击重新检测", [api || "尚未识别图形 API"])}
            aria-label={t("检测图形 API：{0}", [game.name])}
            onClick={() => onAction(game, "scan")}
          >
            {apiLabel}
          </button>
        </div>
      </div>
    </article>
  );
}
