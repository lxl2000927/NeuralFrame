import { t } from "./i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Gamepad2, X, LoaderCircle } from "lucide-react";
import type { Game } from "./types";
import { useArtwork } from "./useArtwork";
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
  const [backdropSource, setBackdropSource] = useState<string>();
  const {ref, url, tile, hero, custom, failed} = useArtwork(game, layout);
  const candidates = layout === "thumbnail"
    ? [url, hero, tile]
    : custom ? [url, tile, hero] : [tile, hero, url];
  const source = candidates.find(Boolean);
  return (
    <span
      ref={ref}
      className={`artwork ${large ? "large" : ""}`}
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
            loading="lazy"
            decoding="async"
            onLoad={layout === "cover" ? (event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              setBackdropSource(Math.abs(naturalWidth / naturalHeight - 16 / 9) > 0.035 ? source : undefined);
            } : undefined}
            onError={() => failed(source)}
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
  className = "",
  dismissOnBackdrop = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
  dismissOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={titleId}
      onPointerDown={e => {
        const box = e.currentTarget.getBoundingClientRect();
        backdropPress.current = e.target === e.currentTarget &&
          (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom);
      }}
      onClick={e => {
        const box = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
        if (dismissOnBackdrop && backdropPress.current && e.target === e.currentTarget && outside) onClose();
        backdropPress.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{t(title)}</h2>
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
