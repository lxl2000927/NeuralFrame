import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { t } from "../i18n";
import type { LibraryVersion } from "./libraryCatalog";

// The pinned or first matching version is already rendered by the group header.
const batchSize = 12;

export function LibraryHistoryRows({ versions, renderRow }: {
  versions: LibraryVersion[];
  renderRow: (row: LibraryVersion) => ReactNode;
}) {
  const [end, setEnd] = useState(1 + batchSize);
  const more = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<{ group: HTMLTableSectionElement; index: number } | null>(null);
  const loadMore = useCallback(() => {
    const group = more.current?.closest("tbody");
    if (group && more.current === document.activeElement) {
      focusNext.current = { group, index: end };
    }
    setEnd(Math.min(end + batchSize, versions.length));
  }, [end, versions.length]);

  useEffect(() => {
    const button = more.current;
    if (!button) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { root: button.closest(".page-scroll"), rootMargin: "160px 0px" });
    observer.observe(button);
    return () => observer.disconnect();
  }, [loadMore]);

  useLayoutEffect(() => {
    if (!focusNext.current) return;
    const { group, index } = focusNext.current;
    focusNext.current = null;
    group.rows[index]?.querySelector<HTMLButtonElement>(".component-history-name")?.focus();
  }, [end]);

  return <>
    {versions.slice(1, end).map(renderRow)}
    {end < versions.length && <tr className="component-history-more">
      <td colSpan={5}>
        <button type="button" ref={more} className="component-text-button" onClick={loadMore}>
          {t("显示更多版本（剩余 {0}）", [versions.length - end])}
          <ChevronDown size={14} />
        </button>
      </td>
    </tr>}
  </>;
}
