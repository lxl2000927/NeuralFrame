import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, Undo2 } from "lucide-react";
import type { Draft, Status } from "../types";
import type { applyPatch } from "../domain";
import { t } from "../i18n";

function ActionMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className="action-menu" ref={root} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }}>
    <button className="icon-button" aria-label={t("更多操作")} title={t("更多操作")} aria-expanded={open}
      onClick={() => setOpen(value => !value)}><Ellipsis size={17} /></button>
    {open && <div className="action-menu-items" onClick={() => setOpen(false)}>{children}</div>}
  </div>;
}

type Scope = NonNullable<Parameters<typeof applyPatch>[2]>;
export function GraphicsActions({ draft, status, changed, busy, canRestore, undo, apply, restore, setupAction }: {
  draft?: Draft | null; status?: Status; changed: boolean; busy: boolean; canRestore: boolean;
  undo: () => void; apply: (scope: Scope) => void; restore: () => void;
  setupAction?: () => void;
}) {
  const disabled = busy || !draft || !status?.ok;
  const enableBoth = !!status?.launcherProtected && !changed && draft?.neuralMode === "off" && draft.mfgMode === "off";
  return <>
    <button disabled={!changed || busy} onClick={undo}>{t("撤销")}</button>
    <button className="primary" disabled={setupAction ? busy : disabled || (!changed && !enableBoth)}
      onClick={() => setupAction ? setupAction() : apply(enableBoth ? "enableBoth" : "changed")}>
      {t(setupAction ? "预览并应用安装方式" : enableBoth ? "一键启用神经渲染与补帧" : "预览并应用")}
    </button>
    <ActionMenu>
      {status?.launcherProtected && !enableBoth && <button disabled={disabled}
        onClick={() => apply("enableBoth")}>{t("一键启用神经渲染与补帧")}</button>}
      <button disabled={disabled} onClick={() => apply("both")}>{t("重新应用当前配置")}</button>
      <button className="danger" disabled={busy || !canRestore} onClick={restore}><Undo2 size={15} />{t("一键卸载并恢复")}</button>
    </ActionMenu>
  </>;
}
