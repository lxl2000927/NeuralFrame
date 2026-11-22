import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Artwork, Empty, Select } from "../components";
import { groupByLauncher, launcherLabel } from "../domain";
import { locale, t } from "../i18n";
import type { Game } from "../types";
import { gameMenuEvents, type GameMenuHandler } from "../GameCard";
import * as filters from "../../../src/renderer/game-filters.js";

const all = { api: "all", dlss: "all", addon: "all" };
const widthKey = "neuralframe.gameListWidth";
const clampWidth = (width: number, { min, max }: { min: number; max: number }) => Math.max(min, Math.min(max, Math.round(width)));
const widthLimits = (list: HTMLElement) => {
  const min = Math.min(180, parseFloat(getComputedStyle(list).getPropertyValue("--game-list-default")) || 290);
  const max = Math.max(min, Math.min(520, Math.floor((list.parentElement?.clientWidth || 0) * 0.45)));
  return { min, max };
};
const apiNames: Record<string, string> = {
  pending: "待扫描",
  unknown: "API 未识别",
  error: "扫描失败",
  "no-graphics-exe": "未识别图形程序",
  "no-exe": "没有可执行文件",
  "renderer-in-dll": "渲染器位于 DLL",
};

export function GameBrowser({
  games,
  selected,
  onSelect,
  grouped,
  openMenu,
}: {
  games: Game[];
  selected: string;
  onSelect: (dir: string) => void;
  grouped: boolean;
  openMenu: GameMenuHandler;
}) {
  const [query, setQuery] = useState("");
  const [criteria, setCriteria] = useState(all);
  const asideRef = useRef<HTMLElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startX: number; startWidth: number; pending: number; min: number; max: number } | null>(null);
  const frame = useRef<number | null>(null);
  const displayWidth = (width: number) => {
    asideRef.current?.style.setProperty("--game-list-width", `${width}px`);
    separatorRef.current?.setAttribute("aria-valuenow", String(width));
  };
  useLayoutEffect(() => {
    const list = asideRef.current!;
    const saved = Number(localStorage.getItem(widthKey));
    if (Number.isFinite(saved) && saved >= 150 && saved <= 520) displayWidth(saved);
    const sync = () => {
      if (!list.offsetWidth) return;
      const { min, max } = widthLimits(list);
      separatorRef.current?.setAttribute("aria-valuemin", String(min));
      separatorRef.current?.setAttribute("aria-valuemax", String(max));
      separatorRef.current?.setAttribute("aria-valuenow", String(list.offsetWidth));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(list.parentElement!);
    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  const [expanded, setExpanded] = useState(false);
  const listScroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (expanded && listScroll.current) listScroll.current.scrollTop = 0;
  }, [expanded]);
  const update = (key: keyof typeof all, value: string) =>
    setCriteria((prev) => ({ ...prev, [key]: value }));
  const activeCount = Object.values(criteria).filter((v) => v !== "all").length;
  const language = locale();
  const collator = useMemo(
    () => new Intl.Collator(language, { numeric: true }),
    [language],
  );
  const needle = query.normalize("NFKC").trim().toLowerCase();
  const visible = useMemo(() => games.filter(game =>
    filters.matches(game, criteria) &&
    (!needle || `${game.name} ${game.launcher} ${t(launcherLabel(game.launcher))}`.normalize("NFKC").toLowerCase().includes(needle)),
  ).sort((a, b) => collator.compare(a.name, b.name)), [games, criteria, needle, collator]);
  const groups = useMemo(() => groupByLauncher(visible, grouped), [visible, grouped]);
  const counts = useMemo(() => {
    if (!expanded) return null;
    const apis = new Set(["DirectX 12", "DirectX 11", "DirectX 10", "DirectX 9", "DirectX 8", "Vulkan", "OpenGL"]);
    let dx12 = 0, ready = 0, dlss = 0;
    for (const game of games) {
      const api = filters.apiKey(game);
      apis.add(api);
      if (api === "DirectX 12") dx12++;
      if (filters.canInstall(game)) ready++;
      if (filters.hasDlss(game)) dlss++;
    }
    return { apis, dx12, ready, dlss, versions: filters.versions(games) };
  }, [games, expanded]);
  const chips: [keyof typeof all, string, string][] = counts ? [
    ["api", "DirectX 12", `DirectX 12 · ${counts.dx12}`],
    ["dlss", "ready", t("可配置 {0}", [counts.ready])],
    ["dlss", "present", t("有 DLSS {0}", [counts.dlss])],
  ] : [];
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current || !asideRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = asideRef.current.offsetWidth;
    drag.current = { id: event.pointerId, startX: event.clientX, startWidth, pending: startWidth, ...widthLimits(asideRef.current) };
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    current.pending = clampWidth(current.startWidth + event.clientX - current.startX, current);
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      displayWidth(current.pending);
    });
  };
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const width = event.type === "pointerup" ? clampWidth(current.startWidth + event.clientX - current.startX, current) : current.pending;
    if (width !== current.startWidth || asideRef.current?.offsetWidth !== width) displayWidth(width);
    if (width !== current.startWidth) localStorage.setItem(widthKey, String(width));
    drag.current = null;
  };
  return (
    <>
    <aside className="game-list" ref={asideRef}>
      <div className="game-list-scroll" ref={listScroll}>
        <div className="game-search-bar">
          <div className="game-search search-box">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label={t("搜索游戏")}
                placeholder={t("搜索游戏…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              className="game-search-filter"
              aria-label={t("筛选游戏")}
              title={t("筛选游戏")}
              aria-expanded={expanded}
              data-active={activeCount > 0 || undefined}
              aria-controls="game-list-filters"
              onClick={() => setExpanded(!expanded)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              {activeCount > 0 && <span>{activeCount}</span>}
            </button>
          </div>
        </div>
        {counts && (
          <div id="game-list-filters" className="game-list-filters">
            <span>{t("渲染 API")}</span>
            <Select
              label={t("渲染 API")}
              value={criteria.api}
              onChange={(v) => update("api", v)}
              options={[
                ["all", t("所有图形 API")],
                ["dx11-dx12", "DirectX 11 / 12"],
                ...Array.from(counts.apis, (api) => [api, t(apiNames[api] || api)]),
              ]}
            />
            <span>{t("DLSS 状态")}</span>
            <Select
              label={t("DLSS 状态")}
              value={criteria.dlss}
              onChange={(v) => update("dlss", v)}
              options={[
                ["all", t("全部状态")],
                ["ready", t("可配置")],
                ["present", t("有 DLSS")],
                ["absent", t("无 DLSS")],
                ["installed", t("已安装")],
                ...counts.versions.map((v) => ["version:" + v, "DLSS " + v]),
              ]}
            />
            <span>{t("附加组件")}</span>
            <Select
              label={t("附加组件筛选")}
              value={criteria.addon}
              onChange={(v) => update("addon", v)}
              options={[
                ["all", t("全部状态")],
                ["present", t("有附加组件")],
                ["absent", t("无附加组件")],
              ]}
            />
            <div className="quick-filters">
              {chips.map(([key, value, label]) => (
                <button
                  key={value}
                  aria-pressed={criteria[key] === value}
                  onClick={() =>
                    update(key, criteria[key] === value ? "all" : value)
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              disabled={!query && !activeCount}
              onClick={() => {
                setQuery("");
                setCriteria(all);
              }}
            >
              {t("清除筛选")}
            </button>
          </div>
        )}
        {groups.map(({ name, games: list }) => (
          <div key={name}>
            {name && (
              <h3 className="game-group-name">
                {t(launcherLabel(name))} ·{" "}
                {list.length}
              </h3>
            )}
            {list.map((game) => (
              <button
                key={game.key}
                {...gameMenuEvents(game, openMenu)}
                className={`game-row ${game.dir === selected ? "selected" : ""}`}
                aria-pressed={game.dir === selected}
                onClick={() => onSelect(game.dir)}
              >
                <Artwork game={game} />
                <span>
                  <strong>{game.name}</strong>
                  <small>
                    {t(launcherLabel(game.launcher))}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ))}
        {!visible.length && (
          <Empty>
            {t(games.length ? "没有匹配的游戏" : "添加游戏或扫描游戏目录")}
          </Empty>
        )}
      </div>
      <div className="list-count" role="status">
        {t("显示 {0} / {1}", [visible.length, games.length])}
      </div>
    </aside>
    <div className="game-list-resizer" ref={separatorRef} role="separator" aria-label={t("调整游戏列表宽度")} aria-orientation="vertical" aria-valuemin={180} aria-valuemax={520} tabIndex={0}
      onPointerDown={resize}
      onPointerMove={moveResize}
      onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}
      onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const list = asideRef.current!;
        const width = clampWidth(list.offsetWidth + (event.key === "ArrowRight" ? 16 : -16), widthLimits(list));
        displayWidth(width);
        localStorage.setItem(widthKey, String(width));
      }} />
    </>
  );
}
