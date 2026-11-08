import { t, dateTime } from "../i18n";
import { useEffect, useRef, useState } from "react";
import {
  Copy,
  FolderOpen,
  RefreshCw,
  Trash2,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Select } from "../components";
import { errorText, profiles } from "../domain";
import type { HistoryRow } from "../types";

const actionNames: Record<string, string> = {
  install: "安装 / 更新",
  restore: "恢复原始文件",
  recovery: "故障恢复",
  "component-update": "组件版本更新",
  "component-rollback": "组件版本回滚",
  add: "新增",
  replace: "替换",
  remove: "删除",
};
function changeSummary(row: HistoryRow) {
  if (row.action === "component-rollback") return t("回滚 {0} 个文件", [row.replaced]);
  if (row.action === "component-update") return t("更新 {0} 个文件", [row.replaced]);
  return t(row.action === "restore" ? "恢复 {0} 个 · 移除 {1} 个" : "替换 {0} 个 · 新增 {1} 个", [row.replaced, row.added]);
}
const routeNames: Record<string, string> = {
  "component-library": "组件库",
  native: "原生 DLSS",
  feeder: "Feeder",
  renodx: "RenoDX",
  optiscaler: "OptiScaler",
};
const configurationNames: Record<string, string> = {
  hardwareProfile: "硬件档位",
  neuralMode: "神经渲染模式",
  neuralModelId: "神经渲染模型",
  mfgMode: "补帧倍率",
  neuralRuntimeStack: "神经渲染配套运行库",
  mfgRuntimeStack: "补帧配套运行库",
  qualityGuardMode: "帧生成输入源策略",
};
function configurationValue(key: string, value: string | null) {
  if (!value) return "—";
  if (key === "qualityGuardMode") {
    if (value === "2") return t("HDR UI 保护 · QualityGuardMode 2");
    if (value === "0") return t("原生输入 · QualityGuardMode 0");
  }
  if (key === "hardwareProfile")
    return t(profiles.find(([id]) => id === value)?.[1] || value);
  if (key === "mfgMode")
    return value === "off" ? t("关闭") : value.replace(/^x(\d+)$/, "$1×");
  if (key === "neuralMode")
    return t(
      (
        {
          off: "关闭",
          legacy: "旧版模型",
          latest_compatible: "兼容模型",
        } as Record<string, string>
      )[value] || value,
    );
  return value;
}
export function History({
  message,
  ask,
  active = true,
}: {
  message: (s: string) => void;
  ask: (title: string, body: string, confirm?: string) => Promise<boolean>;
  active?: boolean;
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [action, setAction] = useState("");
  const request = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const [warning,setWarning] = useState(false);
  const load = async () => {
    const revision = ++request.current;
    try {
      const result = await getBridge().history();
      if (revision !== request.current) return;
      setRows(result.rows);
      setError("");
      setWarning(!!result.warning);
    } catch (e) {
      if (revision !== request.current) return;
      setRows(null);
      setWarning(false);
      setError(errorText(e));
    }
  };
  useEffect(() => {
    if (active) void load();
    return () => { ++request.current; };
  }, [active]);
  const copyHistory = async () => {
    if (!rows?.length) return;
    const text = rows.map(row => [
      `[${dateTime(row.date)}] ${t(actionNames[row.action] || row.action)} · ${row.name || row.dir}`,
      row.dir, row.exe, [t(routeNames[row.route || ""] || row.route), row.api].filter(Boolean).join(" · "),
      changeSummary(row),
    ].filter(Boolean).join("\n")).join("\n\n");
    try { message(t(await getBridge().copyText(text) ? "历史记录已复制" : "复制失败")); }
    catch (e) { message(errorText(e)); }
  };
  const filtered = rows?.filter(
    (r) =>
      (!action || r.action === action) &&
      `${r.name} ${r.dir} ${r.exe || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="page-scroll">
      <div className="section-toolbar">
        <div>
          <p className="muted">{t("查看组件变更、安装配置与恢复记录。")}</p>
        </div>
        <div className="inline-actions">
          <button disabled={!rows?.length} onClick={() => void copyHistory()}>
            <Copy size={16} />{t("复制全部历史")}
          </button>
          <button
            onClick={() => {
              void load();
            }}
          >
            <RefreshCw size={16} />
            {t("刷新")}
          </button>
          <button
            className="danger"
            disabled={!rows?.length && !warning}
            onClick={() => {
              void (async () => {
                if (
                  !(await ask(
                    t("清除操作历史"),
                    t(
                      "只清除历史列表，游戏文件、原始备份和版本锁定记录会保留。",
                    ),
                    t("清除历史"),
                  ))
                )
                  return;
                try {
                  const r = await getBridge().clearHistory();
                  if (!r.ok) throw Error(r.message || t("清除失败"));
                  await load();
                } catch (e) {
                  message(errorText(e));
                }
              })();
            }}
          >
            <Trash2 size={16} />
            {t("清除历史")}
          </button>
        </div>
      </div>
      <div className="history-filters">
        <div className="search-box">
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInput}
              aria-label={t("搜索历史")}
              placeholder={t("搜索游戏、目录或程序…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query && !e.nativeEvent.isComposing) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </label>
          {query && (
            <button type="button" className="search-clear" aria-label={t("清除搜索")} title={t("清除搜索")}
              onClick={() => {
                setQuery("");
                searchInput.current?.focus();
              }}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <Select
          label={t("历史操作类型")}
          value={action}
          onChange={setAction}
          options={[
            ["", t("全部操作")],
            ["install", t("安装 / 更新")],
            ["component-update", t("组件版本更新")],
            ["component-rollback", t("组件版本回滚")],
            ["restore", t("恢复原始文件")],
            ["recovery", t("故障恢复")],
          ]}
        />
        <small>
          {filtered?.length || 0}
          {t("条记录")}
        </small>
      </div>
      {error && <p className="error">{t(error)}</p>}
      {warning && <p className="error" role="alert">{t("部分历史记录无法读取。")}</p>}
      {!rows ? (
        !error && <Loading skeleton="rows" />
      ) : !filtered?.length ? (
        <Empty>
          {rows.length ? t("没有匹配的记录。") : t("暂无操作记录。")}
        </Empty>
      ) : (
        <div className="history-list">
          {filtered.map((r) => (
            <details className="history-entry" key={r.id}>
              <summary>
                <ChevronRight size={15} aria-hidden="true" />
                <strong className="history-name" title={r.name || r.dir}>{r.name || r.dir}</strong>
                <time dateTime={r.date}>{dateTime(r.date)}</time>
                <span className="history-action">
                  {t(actionNames[r.action] || r.action)}
                </span>
              </summary>
              <div className="history-body">
                <dl className="history-metadata">
                  <dt>{t("文件变更")}</dt>
                  <dd>{changeSummary(r)}</dd>
                  <dt>{t("游戏目录")}</dt>
                  <dd>{r.dir}</dd>
                  <dt>{t("目标程序")}</dt>
                  <dd>{r.exe || t("未记录")}</dd>
                  <dt>{t(r.action.startsWith("component-") ? "操作方式" : "安装方式")}</dt>
                  <dd>
                    {t(routeNames[r.route || ""] || r.route || t("未记录"))}
                  </dd>
                  <dt>{t("图形 API")}</dt>
                  <dd>{r.api || t("未记录")}</dd>
                  <dt>{t("记录来源")}</dt>
                  <dd>
                    {r.imported ? t("从旧备份导入的快照") : t("管理器操作记录")}
                  </dd>
                  {r.configuration &&
                    Object.entries(r.configuration)
                      .filter(([, v]) => v)
                      .map(([key, value]) => (
                        <div className="history-config-row" key={key}>
                          <dt>{t(configurationNames[key] || key)}</dt>
                          <dd>{configurationValue(key, value)}</dd>
                        </div>
                      ))}
                </dl>
                {r.files?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("文件")}</th>
                          <th>{t("操作")}</th>
                          <th>{t(r.action === "install" ? "备份版本 → 目标版本" : "变更前 → 变更后")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.files.map((f, i) => (
                          <tr key={i}>
                            <td className="path">{f.rel}</td>
                            <td>{t(actionNames[f.action] || f.action)}</td>
                            <td>
                              <span title={f.beforeHash}>{f.before || (f.beforeHash ? `SHA-256 ${f.beforeHash.slice(0, 12)}` : "—")}</span>
                              {" → "}
                              <span title={f.afterHash}>{f.after || (f.afterHash ? `SHA-256 ${f.afterHash.slice(0, 12)}` : "—")}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">
                    {t("旧记录未保存逐文件明细，只能显示当时记录的数量。")}
                  </p>
                )}
                <div className="inline-actions">
                  <button
                    onClick={() => {
                      void getBridge()
                        .open(r.dir)
                        .then((error) => {
                          if (error) message(String(error));
                        })
                        .catch((e) => message(errorText(e)));
                    }}
                  >
                    <FolderOpen size={16} />
                    {t("打开游戏目录")}
                  </button>
                  <button
                    onClick={() => {
                      void getBridge()
                        .copyText(JSON.stringify(r, null, 2))
                        .then(ok => message(t(ok ? "记录已复制。" : "复制失败")))
                        .catch((e) => message(errorText(e)));
                    }}
                  >
                    <Copy size={16} />
                    {t("复制完整记录")}
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
