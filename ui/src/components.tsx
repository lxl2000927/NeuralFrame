import { useEffect, useRef, useState, type ReactNode } from "react";
import { Gamepad2, X, LoaderCircle } from "lucide-react";
import type { Game } from "./types";
export { Select } from "./Select";
export function Artwork({
  game,
  large = false,
  poster = false,
}: {
  game: Game;
  large?: boolean;
  poster?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = typeof game.poster === "string" ? game.poster : game.poster?.url;
  useEffect(() => setFailed(false), [url]);
  return (
    <span
      className={`artwork ${large ? "large" : ""} ${poster ? "poster" : ""}`}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading={poster ? "lazy" : "eager"}
          decoding="async"
          onError={() => setFailed(true)}
        />
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
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
export function Loading({ text = "正在读取…" }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={18} />
      {text}
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
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
