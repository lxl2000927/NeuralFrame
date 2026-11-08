import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Artwork, Empty, Select } from "../components";
import { groupByLauncher } from "../domain";
import { locale, t } from "../i18n";
import type { Game } from "../types";
import { gameMenuEvents, type GameMenuHandler } from "../GameCard";
import * as filters from "../../../src/renderer/game-filters.js";

const all = { api: "all", dlss: "all", addon: "all" };
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
  const visible = games.filter(
    (game) =>
      filters.matches(game, criteria) &&
      `${game.name} ${game.launcher}`
        .normalize("NFKC")
        .toLowerCase()
        .includes(needle),
  );
  visible.sort((a, b) => collator.compare(a.name, b.name));
  const groups = groupByLauncher(visible, grouped);
  const apis = new Set([
    "DirectX 12",
    "DirectX 11",
    "DirectX 10",
    "DirectX 9",
    "DirectX 8",
    "Vulkan",
    "OpenGL",
    ...games.map(filters.apiKey),
  ]);
  const chips: [keyof typeof all, string, string][] = [
    [
      "api",
      "DirectX 12",
      `DirectX 12 · ${games.filter((g) => filters.apiKey(g) === "DirectX 12").length}`,
    ],
    [
      "dlss",
      "ready",
      t("可配置 {0}", [games.filter(filters.canInstall).length]),
    ],
    [
      "dlss",
      "present",
      t("有 DLSS {0}", [games.filter(filters.hasDlss).length]),
    ],
  ];
  return (
    <aside className="game-list">
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
        {expanded && (
          <div id="game-list-filters" className="game-list-filters">
            <span>{t("渲染 API")}</span>
            <Select
              label={t("渲染 API")}
              value={criteria.api}
              onChange={(v) => update("api", v)}
              options={[
                ["all", t("所有图形 API")],
                ["dx11-dx12", "DirectX 11 / 12"],
                ...Array.from(apis, (api) => [api, t(apiNames[api] || api)]),
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
                ...filters
                  .versions(games)
                  .map((v) => ["version:" + v, "DLSS " + v]),
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
                {name === "Added by hand" ? t("手动添加") : name} ·{" "}
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
                    {game.launcher === "Added by hand"
                      ? t("手动添加")
                      : game.launcher}
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
  );
}
