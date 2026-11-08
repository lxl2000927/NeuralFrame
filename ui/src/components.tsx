import { t } from "./i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Gamepad2, X, LoaderCircle } from "lucide-react";
import type { Game } from "./types";
export { Select } from "./Select";
export function Artwork({
  game,
  large = false,
  layout = "thumbnail",
}: {
  game: Game;
  large?: boolean;
  layout?: "thumbnail" | "cover" | "banner";
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [backdropSource, setBackdropSource] = useState<string>();
  const url = typeof game.poster === "string" ? game.poster : game.poster?.url;
  const custom = typeof game.poster === "object" && game.poster?.custom;
  const hero = game.hero;
  const candidates = layout === "cover"
    ? (custom ? [url, game.tile, hero] : [game.tile, hero, url])
    : (layout === "banner" && !custom ? [hero, url] : [url, hero]);
  const source = candidates.find((s) => s && !failed.includes(s));
  useEffect(() => setFailed([]), [url, hero, game.tile]);
  return (
    <span
      className={`artwork ${large ? "large" : ""} ${source && source === hero ? "landscape" : ""}`}
    >
      {source ? (
        <>
          {layout === "cover" && backdropSource === source && (
            <span
              aria-hidden="true"
              className="card-backdrop"
              style={{ backgroundImage: `url(${JSON.stringify(source)})` }}
            />
          )}
          <img
            src={source}
            alt=""
            loading={layout === "thumbnail" ? "eager" : "lazy"}
            decoding="async"
            onLoad={layout === "cover" ? (event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              setBackdropSource(Math.abs(naturalWidth / naturalHeight - 16 / 9) > 0.035 ? source : undefined);
            } : undefined}
            onError={() => setFailed((urls) => [...urls, source])}
          />
        </>
      ) : (
        <Gamepad2 aria-hidden="true" />
      )}
    </span>
  );
}
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{t(label)}</span>
        {hint && <small>{t(hint)}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
type SkeletonKind = "cards" | "rows" | "table";
export function Loading({
  text = t("正在读取…"),
  skeleton,
}: {
  text?: string;
  skeleton?: SkeletonKind;
}) {
  if (skeleton === "cards")
    return (
      <div className="skeleton-grid" role="status" aria-label={t(text)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-card" />
        ))}
      </div>
    );
  if (skeleton === "rows")
    return (
      <div role="status" aria-label={t(text)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="skeleton-row" key={i}>
            <div className="skeleton skeleton-avatar" />
            <div style={{ flex: 1 }}>
              <div className="skeleton skeleton-line w60" />
              <div className="skeleton skeleton-line w40" />
            </div>
          </div>
        ))}
      </div>
    );
  if (skeleton === "table")
    return (
      <div className="skeleton-stack" role="status" aria-label={t(text)}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-line w80" />
        ))}
      </div>
    );
  return (
    <div className="loading" role="status">
      <LoaderCircle size={18} />
      {t(text)}
    </div>
  );
}
export function Modal({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{t(title)}</h2>
        <button
          className="icon-button"
          aria-label={t("关闭对话框")}
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
