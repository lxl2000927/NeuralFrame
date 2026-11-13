import { useEffect, useRef, useState } from "react";
import { getBridge } from "./bridge";

// A return to this window invalidates only the visible page's read model.
// Blur/focus and visibility events often arrive together; coalesce them and
// defer reads while a dialog, download or local edit operation is in progress.
export function useWindowReturn(active: boolean, blocked = false) {
  const [revision, setRevision] = useState(0);
  const blockedRef = useRef(blocked);
  const resume = useRef<() => void>(() => {});
  useEffect(() => {
    blockedRef.current = blocked;
    if (!blocked) resume.current();
  }, [blocked]);
  useEffect(() => {
    if (!active) return;
    let away = document.hidden, pending = false, lastRead = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!pending || away || document.hidden || blockedRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (away || document.hidden || blockedRef.current) return;
        pending = false;
        lastRead = Date.now();
        setRevision(value => value + 1);
      }, Math.max(180, lastRead + 1000 - Date.now()));
    };
    const leave = () => { away = true; clearTimeout(timer); };
    const enter = () => {
      if (document.hidden) return;
      if (away) pending = true;
      away = false;
      schedule();
    };
    const visibility = () => { if (document.hidden) leave(); else enter(); };
    const unsubscribe = getBridge().onWindowFocus?.(focused => { if (focused) enter(); else leave(); });
    resume.current = schedule;
    window.addEventListener("blur", leave);
    window.addEventListener("focus", enter);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer);
      resume.current = () => {};
      unsubscribe?.();
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", enter);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active]);
  return revision;
}
