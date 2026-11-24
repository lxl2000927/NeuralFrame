import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, Undo2 } from "lucide-react";
import type { Draft, Status } from "../types";
import type { applyPatch } from "../domain";
import { t } from "../i18n";
import { moveMenuFocus } from "../menuFocus";

export function ActionMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"Home" | "End">("Home");
  useLayoutEffect(() => {
    if (open) moveMenuFocus(panel.current, initialFocus.current);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="action-menu" ref={root} onBlur={e => {
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }} onKeyDown={e => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      trigger.current?.focus();
      setOpen(false);
      return;
    }
    if (open && e.key === "Tab") {
      trigger.current?.focus();
      setOpen(false);
      return;
    }
    if (open) {
      if (moveMenuFocus(panel.current, e.key)) e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      initialFocus.current = e.key === "ArrowUp" ? "End" : "Home";
      setOpen(true);
    }
  }}>
    <button ref={trigger} type="button" className="icon-button" aria-label={t("更多操作")} title={t("更多操作")} aria-expanded={open}
      onClick={() => {
        initialFocus.current = "Home";
        setOpen(!open);
      }}><Ellipsis size={17} /></button>
    {open && <div ref={panel} className="action-menu-items" onPointerDownCapture={e => {
      if (!(e.target as Element).closest("button:enabled")) e.preventDefault();
    }} onClick={e => {
      if (!(e.target as Element).closest("button:enabled")) return;
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
      setOpen(false);
    }}>{children}</div>}
  </div>;
}

type Scope = NonNullable<Parameters<typeof applyPatch>[2]>;
export function GraphicsActions({ draft, status, changed, busy, canRestore, undo, apply, restore, rescan, setupAction, setupBlocked, blocksApply }: {
  draft?: Draft | null; status?: Status; changed: boolean; busy: boolean; canRestore: boolean;
  undo: () => void; apply: (scope: Scope) => void; restore: () => void;
  rescan: () => void;
  setupAction?: () => void;
  setupBlocked: boolean;
  blocksApply: (scope: Scope) => boolean;
}) {
  const disabled = busy || !draft || !status?.ok;
  const enableBoth = !!status?.launcherProtected && !changed && draft?.neuralMode === "off" && draft.mfgMode === "off";
  return <>
    <button disabled={!changed || busy} onClick={undo}>{t("撤销")}</button>
    <button className="primary" disabled={setupAction ? busy || setupBlocked : disabled || (!changed && !enableBoth) || blocksApply(enableBoth ? "enableBoth" : "changed")}
      onClick={() => setupAction ? setupAction() : apply(enableBoth ? "enableBoth" : "changed")}>
      {t(setupAction ? "预览并应用安装方式" : enableBoth ? "一键启用神经渲染与补帧" : "预览并应用")}
    </button>
    <ActionMenu>
      <button disabled={busy} onClick={rescan}>{t("重新检测文件")}</button>
      {status?.launcherProtected && !enableBoth && <button disabled={disabled || blocksApply("enableBoth")}
        onClick={() => apply("enableBoth")}>{t("一键启用神经渲染与补帧")}</button>}
      <button disabled={disabled || blocksApply("both")} onClick={() => apply("both")}>{t("重新应用当前配置")}</button>
      <button className="danger" disabled={busy || !canRestore} onClick={restore}><Undo2 size={15} />{t("一键卸载并恢复")}</button>
    </ActionMenu>
  </>;
}
