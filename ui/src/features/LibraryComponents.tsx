import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Package,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { t, dateTime, useLanguage } from "../i18n";
import { LibraryHistoryRows } from "./LibraryHistoryRows";
import { size } from "../domain";
import { getBridge } from "../bridge";
import { DownloadAction } from "./DownloadAction";
import {
  applicationLabels,
  applicationVerdict,
  componentCategories,
  emptyFilters,
  filterLibrary,
  groupLibrary,
  localState,
  pairedXeMfgEngine,
  versionLabel,
  versionAcquisition,
  versionSourceDetails,
  versionSources,
  versionProjectEvidence,
} from "./libraryCatalog";
import type { CatalogFilters, LibraryVersion } from "./libraryCatalog";
import type { Library, Updates } from "../types";
import "./Library.css";

const categories = [
  ["all", "全部"],
  ["nr", "神经渲染"],
  ["fg", "帧生成"],
  ["runtime", "运行库与加载"],
  ["internal", "软件内置"],
];
const purposes: Record<string, string> = {
  "dlss-nr": "神经渲染模型；不同来源和架构的版本分别保留。",
  "renodx-nr": "在 ReShade / RenoDX 路线中调用神经渲染模型。",
  "renodx-multipass": "为多通道渲染路线提供配套处理。",
  feeder: "为 Feeder 路线提供图像输入与宿主程序；不等于帧生成解锁。",
  "mfg-renodx":
    "RenoDX 多帧生成插件；支持条件内为 RTX 20–40 提供解锁，为 RTX 50 提供原生多帧生成控制。",
  "mfg-universal":
    "独立加载器，提供多帧生成与神经渲染控制；RTX 50 使用原生多帧生成。",
  "xemfg-intel": "Intel XeFG 帧生成与 XeLL 低延迟运行库，为 XeMFG 提供配套文件。",
  "dlss-fg":
    "帧生成运行库；需游戏或渲染后端提供对应输入。RTX 50 原生支持多帧生成。",
  "dlss-sr": "DLSS 超分辨率运行库；用于游戏已支持的超分链路。",
  streamline: "连接 DLSS 功能的配套运行库，随安装路线成组部署。",
  "dlss-rr": "光线重建运行库；仅在游戏支持相应功能时使用。",
  reshade: "加载 RenoDX 插件和相关图像处理组件。",
  optiscaler: "可选的图形功能转接路线；下载新版本不会自动替换当前路线。",
  encore: "集成超分、神经渲染与帧生成的可选后端；部分无原生补帧游戏也可使用。",
  preloader: "32 位旧游戏的配套预加载器。",
  localization: "游戏内中文面板适配，随软件维护。",
  overlay: "游戏内 F8 叠加层，随软件维护。",
};
const localLabels = {
  cached: "已入库",
  missing: "未下载",
  damaged: "文件异常",
};
// These describe supported combinations, not new installation selections.
const dependencies: Record<string, string> = {
  "dlss-nr":
    "模型需要神经渲染后端调用；可用于已适配的 RenoDX、独立加载或 Encore 路线，单独下载不会启用渲染。",
  "renodx-nr":
    "需要支持插件的 ReShade、兼容的神经渲染模型及游戏图像输入；由游戏页核对安装条件。",
  "renodx-multipass":
    "与支持多通道的神经渲染路线配套，不是独立的模型或帧生成运行库。",
  feeder:
    "包含图像输入插件、宿主与着色器；与 ReShade 及神经渲染模型配套，组件按路线成组准备。",
  "mfg-renodx":
    "DLSS-G 路线需要对应的原生帧生成链路和 ReShade / RenoDX 加载环境；其他后端按对应版本的项目说明检查。",
  "mfg-universal":
    "独立加载器与运行库按路线配套；鸣潮可在已适配引擎版本中选择，保留启动器校验文件。",
  "xemfg-intel": "独立 XeMFG 路线使用 Intel XeSS SDK 3.0.2 与 MFG Unlocker 1.7.2。OptiScaler 插件路线会校验游戏已有的宿主和 Intel 运行库。",
  "dlss-fg":
    "需要游戏或已适配后端提供帧生成输入；只替换这个 DLL 不会为游戏新增补帧链路。",
  "dlss-sr":
    "用于游戏已有的 DLSS 超分链路；是否可以替换，由游戏页的文件检查与安装预览决定。",
  streamline: "与所选 DLSS 运行库成组部署；不要按版本号单独混搭。",
  "dlss-rr":
    "需要游戏提供光线重建支持及对应输入；下载 DLL 不会增加游戏原本没有的功能。",
  reshade:
    "为 RenoDX、Feeder 和支持的面板插件提供加载环境；需匹配游戏位数与图形 API。",
  encore:
    "需匹配支持的引擎、图形 API 与固定配套运行库；在游戏页选择 Encore 并预览安装条件。",
  optiscaler:
    "需游戏具备可适配的超分接口及受支持的图形 API；由游戏页检查路线是否可用。",
  overlay:
    "NeuralFrame 面板需要支持插件的 ReShade；主题与快捷键在叠加层页设置。",
};
function componentPurpose(component: string, name: string, row: LibraryVersion) {
  return pairedXeMfgEngine(row)
    ? "MFG Unlocker 1.7.2 提供实验性 XeMFG，可用于符合条件的 AMD、Intel 和 NVIDIA 显卡。DLSS-G 与 DLSS 神经渲染需要兼容的 NVIDIA 显卡。"
    : purposes[component] || name;
}

function verdict(row: LibraryVersion, gpuSm: string | null, nvidiaPresent?: boolean | null) {
  const result = applicationVerdict(row, gpuSm, nvidiaPresent);
  for (const field of [
    "label",
    "availability",
    "reason",
    "next",
    "shortReason",
    "nextShort",
    "downloadLabel",
    "evidence",
  ] as const)
    result[field] = t(result[field]);
  return result;
}

type Actions = {
  busy: boolean;
  checking?: boolean;
  downloadVersion: (id: string, cached: boolean) => Promise<boolean>;
  gpuSm: string | null;
  nvidiaPresent?: boolean | null;
};
function VersionAction({
  row,
  busy,
  checking = false,
  downloadVersion,
  info,
}: { row: LibraryVersion; info: ReturnType<typeof applicationVerdict> } & Actions) {
  const { pack } = row;
  const acquisition = versionAcquisition(row);
  const { candidate, cached } = acquisition;
  return (
    <div
      className="component-action"
      title={
        checking
          ? t("正在检查组件版本，完成后可下载或校验。")
          : acquisition.notice
            ? t(acquisition.notice)
            : undefined
      }
    >
      {pack ? (
        <DownloadAction
          kind="runtime"
          id={pack.id}
          cached={pack.downloaded}
          disabled={busy || checking}
          blocked={checking}
          label={info.downloadLabel}
        />
      ) : candidate?.releaseOnly ? (
        <span className="muted">{t("仅发布记录")}</span>
      ) : candidate ? (
        <DownloadAction
          id={candidate.downloadId || candidate.id}
          cached={cached}
          label={info.downloadLabel}
          disabled={busy || checking || acquisition.disabled}
          blocked={checking || acquisition.disabled}
          onStart={() =>
            void downloadVersion(candidate.downloadId || candidate.id, cached)
          }
        />
      ) : (
        <span className="muted">
          {t(info.state === "internal" ? "随软件维护" : "本地导入记录")}
        </span>
      )}
      {pack?.size || candidate?.size ? (
        <small>{size(pack?.size || candidate?.size || 0)}</small>
      ) : null}
    </div>
  );
}

function SourceLink({ url, label }: { url: string; label: string }) {
  const [error, setError] = useState(false);
  return (
    <>
      <button
        className="component-text-button source-link"
        onClick={async () => {
          try {
            setError(
              !(await getBridge().openProject({ componentSource: url })),
            );
          } catch {
            setError(true);
          }
        }}
      >
        {label}
        <ExternalLink size={13} />
      </button>
      {error && (
        <small role="alert">
          {t("无法打开项目链接")}
          <br />
          {url}
        </small>
      )}
    </>
  );
}

function VersionDetails({
  row,
  component,
  data,
  onClose,
  onPaired,
  ...actions
}: {
  row: LibraryVersion;
  component: string;
  data: Library;
  onClose: () => void;
  onPaired?: () => void;
} & Actions) {
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    const list = panel.current?.closest(".page-slot")?.querySelector<HTMLElement>(".library-page");
    const background = [
      ...document.querySelectorAll<HTMLElement>(".titlebar, .sidebar, .appbar"),
      ...(list ? [list] : []),
    ];
    const previous = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    return () => background.forEach((element, index) => { element.inert = previous[index]; });
  }, []);
  useEffect(() => {
    setClosing(false);
    if (panel.current) panel.current.scrollTop = 0;
  }, [row.id]);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  const close = useCallback(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.safeGraphics === "true"
    )
      onClose();
    else setClosing(true);
  }, [onClose]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        panel.current?.closest("[hidden]") ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [close]);
  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const root = panel.current?.closest<HTMLElement>(".component-drawer");
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    )].filter((element) =>
      !element.hasAttribute("disabled") &&
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest("[inert]"));
    if (!items.length) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  const info = verdict(row, actions.gpuSm, actions.nvidiaPresent);
  const acquisition = versionAcquisition(row);
  const candidate = acquisition.candidate;
  const name = data.definitions[component]?.name || component;
  const sources = versionSourceDetails(row);
  const project = versionProjectEvidence(row);
  return (
    <div className="component-sheet">
      <div className="component-scrim" aria-hidden="true" onClick={close}/>
    <aside
      className={`component-drawer${closing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={trapFocus}
    >
      <header>
        <div className="component-drawer-heading">
          <small><Package size={13} aria-hidden="true" />{t("组件详情")}</small>
          <h2 id={titleId}>{t(name)}</h2>
        </div>
        <button
          ref={closeButton}
          type="button"
          className="component-drawer-close"
          aria-label={t("关闭详情")}
          title={`${t("关闭详情")} (Esc)`}
          onClick={close}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="component-drawer-body" ref={panel}>
        <p className="component-detail-purpose">
          {t(componentPurpose(component,name,row))}
        </p>
        <dl className="component-detail-meta">
          <div>
            <dt>{t("版本")}</dt>
            <dd>
              <strong>{versionLabel(row)}</strong>
              {row.pack && (
                <span className="component-paired">{t("配套版本")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("组件来源")}</dt>
            <dd>
              {sources.map((source) => (
                <div className="component-source-detail" key={source.name}>
                  {source.url ? (
                    <SourceLink url={source.url} label={source.name} />
                  ) : (
                    <span>{t(source.name)}</span>
                  )}
                </div>
              ))}
            </dd>
          </div>
          <div>
            <dt>{t("本地文件")}</dt>
            <dd>{t(localLabels[localState(row)])}</dd>
          </div>
          {!!(row.pack?.size || candidate?.size) && (
            <div>
              <dt>{t("下载大小")}</dt>
              <dd>{size(row.pack?.size || candidate?.size || 0)}</dd>
            </div>
          )}
        </dl>
        <section className="component-verdict" data-state={info.state}>
          <div className="component-verdict-heading">
            <h3>{t("NeuralFrame 支持情况")}</h3>
            <span className="component-support-badge" data-state={info.state}>
              {info.label}
            </span>
          </div>
          <dl className="component-verdict-facts">
            <div className="component-application">
              <dt>{t("能否应用")}</dt>
              <dd>{info.availability}</dd>
            </div>
            <div>
              <dt>{t("原因")}</dt>
              <dd>{info.reason}</dd>
            </div>
            <div>
              <dt>{t("下一步")}</dt>
              <dd>{info.next}</dd>
            </div>
          </dl>
          <small className="component-evidence-note">{info.evidence}</small>
          {component === "dlss-nr" && (
            <small>
              {t("本机 CUDA：{0} · 模型 CUDA：{1}", [
                actions.gpuSm ? "sm_" + actions.gpuSm : "—",
                row.modelRequirements?.architectures
                  .map((sm) => "sm_" + sm)
                  .join(" / ") || "—",
              ])}
            </small>
          )}
        </section>
        <section className="component-detail-section component-project-evidence">
          <div className="component-section-heading">
            <h3>{t("支持范围与测试记录")}</h3>
            <span className="muted">{t(project.label)}</span>
          </div>
          <p className="muted">{t(project.summary)}</p>
          {!!project.records.length && (
            <dl className="component-project-records">
              {project.records.map((record, index) => (
                <div key={record.scope + index}>
                  <dt>{t(record.scope)}</dt>
                  <dd>
                    <span>{t(record.status)}</span>
                    {record.detail && <small>{t(record.detail)}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="component-project-links">
            {project.sources.map((source) => (
              <SourceLink
                key={source.url}
                url={source.url}
                label={t(source.label || "查看项目说明")}
              />
            ))}
          </div>
          {project.checkedAt && (
            <small className="muted">
              {t("资料核对日期：{0}", [dateTime(project.checkedAt)])}
            </small>
          )}
        </section>
        <section className="component-detail-section">
          <h3>{t("配套依赖与适用路线")}</h3>
          <p>
            {t(
              (pairedXeMfgEngine(row) ? "独立 XeMFG 配套使用 Intel XeFG 和 XeLL 3.0.2。插件版需游戏中已有适配的 OptiScaler 10 宿主及 Intel 运行库。鸣潮沿用独立加载器和游戏原版 DLSS 文件。" : dependencies[component]) ||
                "随软件或所选安装路线维护，无需手动组合。",
            )}
          </p>
          <p className="muted">
            {t("具体游戏能否使用，以游戏页的安装预览和运行诊断为准。")}
          </p>
        </section>
        <section className="component-detail-section">
          <h3>{t("发布与入库记录")}</h3>
          {candidate?.publishedAt && (
            <small className="muted">
              {t("发布时间：{0}", [dateTime(candidate.publishedAt)])}
            </small>
          )}
          {row.releases.map((release) => (
            <dl className="component-detail-facts" key={release.id}>
              <div>
                <dt>{t("发布标签")}</dt>
                <dd>{release.releaseOnly && release.releaseUrl
                  ? <SourceLink url={release.releaseUrl} label={release.tag} />
                  : release.tag}</dd>
              </div>
              {!release.releaseOnly && <div>
                <dt>{t("下载文件")}</dt>
                <dd>{release.name}</dd>
              </div>}
              {release.catalogModelId && (
                <div>
                  <dt>{t("模型标识")}</dt>
                  <dd>{release.catalogModelId}</dd>
                </div>
              )}
            </dl>
          ))}
          {row.packages.map((pkg) => (
            <p key={pkg.id}>{t("入库版本 {0}", [pkg.version])}</p>
          ))}
          <small className="muted">
            {t(
              "发布标签、入库版本和 DLL 文件版本可能不同；同名模型按文件指纹区分。来源记录不能证明社区是否修改过文件。",
            )}
          </small>
        </section>
        <details className="component-file-details">
          <summary>{t("文件、缓存与指纹")}</summary>
          <p className="path">{row.pack?.cacheRoot || data.root}</p>
          {row.pack?.sha256 && (
            <p className="path">
              {t("配套压缩包 SHA-256")}
              <br />
              {row.pack.sha256}
            </p>
          )}
          {!row.pack && candidate?.sha256 && (
            <p className="path">
              {t("下载文件 SHA-256")}
              <br />
              {candidate.sha256}
            </p>
          )}
          {row.pack?.files?.map((file) => (
            <div className="component-file" key={file.path}>
              <code>{file.path}</code>
              <small>{size(file.size)}</small>
              <code>{file.sha256}</code>
            </div>
          ))}
          {row.packages.map((pkg) => (
            <div key={pkg.id}>
              <p className="path">
                {data.root}
                {"/packages/"}
                {pkg.id}
              </p>
              {pkg.files?.map((file) => (
                <div className="component-file" key={file.rel}>
                  <code>{file.rel}</code>
                  <small>
                    {[file.version, size(file.size)]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  <code>{file.sha256}</code>
                </div>
              ))}
            </div>
          ))}
          {!row.pack?.files?.length &&
            !row.packages.some((p) => p.files?.length) && (
              <p>{t("文件明细将在入库校验后显示。")}</p>
            )}
        </details>
      </div>
      <footer>
        <p
          className={`component-download-note${acquisition.disabled && candidate ? " error" : ""}`}
          role="status"
        >
          {t(
            actions.checking
              ? "正在检查组件版本，完成后可下载或校验。"
              : acquisition.notice ||
                  "下载与校验只处理组件库，不会自动应用到游戏。",
          )}
        </p>
        <div className="component-detail-actions">
          {onPaired ? (
            <button onClick={onPaired}>{t("查看配套版本")}</button>
          ) : (
            <span
              className="component-local-state"
              data-state={localState(row)}
            >
              {t(localLabels[localState(row)])}
            </span>
          )}
          <VersionAction row={row} info={info} {...actions} />
        </div>
      </footer>
    </aside>
    </div>
  );
}

type RowProps = Actions & {
  row: LibraryVersion;
  component: string;
  name: string;
  history?: boolean;
  selected: boolean;
  historyCount?: number;
  expanded?: boolean;
  onToggle: (component: string) => void;
  onDetails: (component: string, id: string, trigger: HTMLButtonElement) => void;
};

const CatalogVersionRow = memo(function CatalogVersionRow({
  row, component, name, history, selected, historyCount = 0, expanded, onToggle, onDetails, ...actions
}: RowProps) {
  useLanguage();
  const info = applicationVerdict(row, actions.gpuSm, actions.nvidiaPresent);
  const project = versionProjectEvidence(row);
  const version = versionLabel(row);
  const source = versionSources(row).map(source => t(source)).join(" · ");
  const purpose = history ? "" : t(componentPurpose(component, name, row));
  const state = localState(row);
  return (
    <tr data-version-id={row.id} data-history={history || undefined} data-selected={selected || undefined}>
      <td>
        {history ? (
          <button className="component-text-button component-name component-history-name"
            aria-label={t("查看 {0} 版本：{1}", [name, version])}
            onClick={event => onDetails(component, row.id, event.currentTarget)}>
            <span aria-hidden="true">↳</span><span>{name}</span><ChevronRight size={14} />
          </button>
        ) : (
          <>
            <div className="component-heading">
              <button className="component-text-button component-name"
                onClick={event => onDetails(component, row.id, event.currentTarget)}>
                {name}<ChevronRight size={14} />
              </button>
            </div>
            <div className="component-description"><span title={purpose}>{purpose}</span></div>
          </>
        )}
      </td>
      <td>
        <div className="component-version-label">
          <strong title={version}>{version}</strong>
          {row.releases[0]?.prerelease && <small>{t("预发布")}</small>}
          {row.pack && <span className="component-paired">{t("配套")}</span>}
        </div>
        <small className="component-source" title={source}>{source}</small>
      </td>
      <td>
        <span className="component-local-state" data-state={state}>{t(localLabels[state])}</span>
      </td>
      <td>
        <div className="component-project-summary" title={t(project.summary)}>
          <span>{t("项目说明")}</span><span>{t(project.label)}</span>
        </div>
        <div className="component-software-summary">
          <span>{t("软件支持")}</span>
          <button className="component-text-button component-status" data-state={info.state}
            title={t(info.availability)} onClick={event => onDetails(component, row.id, event.currentTarget)}>
            {t(info.label)}<ChevronRight size={12} />
          </button>
        </div>
      </td>
      <td>
        <div className="component-row-actions">
          <VersionAction row={row} info={info} {...actions} />
          {historyCount > 0 && <button className="component-history-toggle"
            aria-label={t(expanded ? "收起 {0} 的历史版本（{1}）" : "展开 {0} 的历史版本（{1}）", [name, historyCount])}
            aria-expanded={expanded} onClick={() => onToggle(component)}>
            <span>{t("历史版本")}</span>
            <span className="component-history-count">{historyCount}</span>
            <ChevronDown size={14} />
          </button>}
        </div>
      </td>
    </tr>
  );
});

export function LibraryComponents({
  data,
  candidates,
  modelsOnly,
  toolbar,
  ...actions
}: {
  data: Library;
  candidates: Updates["candidates"];
  modelsOnly: boolean;
  toolbar?: ReactNode;
} & Actions) {
  const [filters, setFilters] = useState<CatalogFilters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterId = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showInternal, setShowInternal] = useState(false);
  const catalog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<{
    component: string;
    id: string;
  } | null>(null);
  const preserveScroll = useCallback((change: () => void) => {
    const page = catalog.current?.closest<HTMLElement>(".page-scroll");
    const top = page?.scrollTop;
    change();
    if (page && top != null)
      window.requestAnimationFrame(() => {
        page.scrollTop = top;
      });
  }, []);
  const openDetails = useCallback((component: string, id: string, trigger: HTMLButtonElement) => {
    opener.current = trigger;
    preserveScroll(() => setSelected({ component, id }));
  }, [preserveScroll]);
  const toggleHistory = useCallback((component: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(component)) next.delete(component);
      else next.add(component);
      return next;
    });
  }, []);
  const closeDetails = useCallback(() => {
    preserveScroll(() => setSelected(null));
  }, [preserveScroll]);
  useLayoutEffect(() => {
    if (selected) return;
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    opener.current = null;
  }, [selected]);
  const groups = useMemo(
    () => groupLibrary(data, candidates, modelsOnly),
    [data, candidates, modelsOnly],
  );
  const effectiveFilters = useMemo(() => modelsOnly
    ? { ...filters, category: "all" }
    : filters, [modelsOnly, filters]);
  const filtering =
    !!effectiveFilters.query.trim() ||
    [
      effectiveFilters.local,
      effectiveFilters.application,
      effectiveFilters.source,
    ].some((value) => value !== "all");
  const historyFilterKey = JSON.stringify(effectiveFilters);
  const filtered = useMemo(() => filterLibrary(groups, data, effectiveFilters, actions.gpuSm, actions.nvidiaPresent),
    [groups, data, effectiveFilters, actions.gpuSm, actions.nvidiaPresent]);
  const visible = filtered.filter(
    (g) =>
      !data.definitions[g.component]?.internal ||
      showInternal ||
      filtering ||
      filters.category === "internal",
  );
  const sources = useMemo(() => [
    ...new Set(groups.flatMap((g) => g.versions.flatMap(versionSources))),
  ].sort(), [groups]);
  const patch = (value: Partial<CatalogFilters>) =>
    setFilters((current) => ({ ...current, ...value }));
  const selectedGroup =
    selected && groups.find((g) => g.component === selected.component);
  const selectedRow =
    selectedGroup && selectedGroup.versions.find((v) => v.id === selected?.id);
  const paired = selectedGroup && selectedGroup.versions.find((v) => v.pack);
  const versionCount = visible.reduce((n, g) => n + g.versions.length, 0);
  const filterChips = [
    { key: "query" as const, value: filters.query.trim(), label: t("搜索") },
    {
      key: "local" as const,
      value:
        filters.local === "all"
          ? ""
          : t(localLabels[filters.local as keyof typeof localLabels]),
      label: t("本地"),
    },
    {
      key: "application" as const,
      value:
        filters.application === "all"
          ? ""
          : t(applicationLabels[filters.application]),
      label: t("应用"),
    },
    {
      key: "source" as const,
      value: filters.source === "all" ? "" : t(filters.source),
      label: t("来源"),
    },
  ].filter((chip) => chip.value);
  return (
    <div className="component-catalog" ref={catalog}>
      <div className="component-toolbar">
        <div className="component-search">
          <Search size={17} />
          <input
            aria-label={t("搜索组件")}
            placeholder={t("搜索名称、版本、文件或来源…")}
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
          />
          {filters.query && (
            <button
              className="component-text-button"
              onClick={() => patch({ query: "" })}
            >
              {t("清除")}
            </button>
          )}
        </div>
        {toolbar}
      </div>
      <div className="component-navigation">
        {!modelsOnly && (
          <div
            className="component-tabs"
            role="group"
            aria-label={t("组件分类")}
          >
            {categories.map(([id, label]) => (
              <button
                key={id}
                aria-pressed={filters.category === id}
                onClick={() => patch({ category: id })}
              >
                {t(label)}
                <small>
                  {t("{0} 类", [
                    groups.filter(
                      (g) =>
                        id === "all" ||
                        (data.definitions[g.component]?.internal
                          ? "internal"
                          : componentCategories[g.component] || "runtime") ===
                          id,
                    ).length,
                  ])}
                </small>
              </button>
            ))}
          </div>
        )}
        <button
          className="component-filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls={filterId}
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <SlidersHorizontal size={14} />
          {t("筛选")}
          {filterChips.length > 0 && <small>{filterChips.length}</small>}
        </button>
        <span
          className="component-result-count"
          aria-live="polite"
          title={t("版本数量包含折叠的历史版本与其他来源。")}
        >
          {t("显示 {0} 类组件 · {1} 个版本", [visible.length, versionCount])}
        </span>
      </div>
      <div id={filterId} className="component-filters" hidden={!filtersOpen}>
        <label>
          {t("本地")}
          <select
            aria-label={t("本地状态筛选")}
            value={filters.local}
            onChange={(e) => patch({ local: e.target.value })}
          >
            <option value="all">{t("全部状态")}</option>
            {Object.entries(localLabels).map(([key, label]) => (
              <option value={key} key={key}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("应用")}
          <select
            aria-label={t("应用条件筛选")}
            value={filters.application}
            onChange={(e) => patch({ application: e.target.value })}
          >
            <option value="all">{t("全部条件")}</option>
            {Object.entries(applicationLabels).map(([key, label]) => (
              <option value={key} key={key}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("来源")}
          <select
            aria-label={t("来源筛选")}
            value={filters.source}
            onChange={(e) => patch({ source: e.target.value })}
          >
            <option value="all">{t("全部来源")}</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {t(source)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(filtering || filters.category !== "all") && (
        <div className="component-filter-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              title={chip.value}
              aria-label={t("移除筛选：{0}", [chip.label])}
              onClick={() =>
                patch({ [chip.key]: chip.key === "query" ? "" : "all" })
              }
            >
              <span>
                {chip.label} · {chip.value}
              </span>
              <X size={12} />
            </button>
          ))}
          <button
            className="component-text-button"
            onClick={() => setFilters(emptyFilters)}
          >
            {t("清空筛选")}
          </button>
        </div>
      )}
      <div className="component-workspace">
        <div className="component-list-area">
          <div className="component-list">
            <table>
              <thead>
                <tr>
                  <th>{t("组件 / 用途")}</th>
                  <th>{t("版本 / 来源")}</th>
                  <th>{t("本地状态")}</th>
                  <th>{t("项目说明 / 软件支持")}</th>
                  <th>{t("操作")}</th>
                </tr>
              </thead>
              {visible.map(({ component, versions }) => {
                const isExpanded = expanded.has(component);
                const rowProps = {
                  ...actions, component, name: t(data.definitions[component]?.name || component),
                  onDetails: openDetails, onToggle: toggleHistory,
                };
                const first = versions[0];
                return (
                  <tbody key={component} data-component={component}>
                    <CatalogVersionRow key={first.id} row={first} {...rowProps}
                      selected={selectedRow?.id === first.id} expanded={isExpanded}
                      historyCount={filtering ? 0 : versions.length - 1} />
                    {(isExpanded || filtering) && versions.length > 1 && (
                      <LibraryHistoryRows key={historyFilterKey} versions={versions} renderRow={row => (
                        <CatalogVersionRow key={row.id} row={row} {...rowProps} history selected={selectedRow?.id === row.id} />
                      )} />
                    )}
                  </tbody>
                );
              })}
            </table>
            {!visible.length && (
              <div className="component-empty">
                <Search size={24} />
                <h3>{t("没有匹配的组件")}</h3>
                <p>{t("试试减少筛选条件，或检查更新以获取更多版本。")}</p>
                <button onClick={() => setFilters(emptyFilters)}>
                  {t("清空筛选")}
                </button>
              </div>
            )}
          </div>
          {!modelsOnly &&
            filters.category === "all" &&
            !filtering &&
            groups.some((g) => data.definitions[g.component]?.internal) && (
              <button
                className="component-text-button component-internal-toggle"
                aria-expanded={showInternal}
                onClick={() => setShowInternal(!showInternal)}
              >
                <ChevronDown size={14} />
                {t(showInternal ? "收起软件内置组件" : "显示软件内置组件")}
              </button>
            )}
        </div>
        {selectedRow && selected && catalog.current?.closest(".page-slot") && createPortal(
          <VersionDetails
            row={selectedRow}
            component={selected.component}
            data={data}
            {...actions}
            onClose={closeDetails}
            onPaired={
              paired && paired.id !== selectedRow.id
                ? () => setSelected({ ...selected, id: paired.id })
                : undefined
            }
          />, catalog.current.closest(".page-slot")!
        )}
      </div>
    </div>
  );
}
