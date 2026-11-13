import { t, locale } from "../i18n";
import { useEffect, useId, useRef, useState } from "react";
import {
  Play,
  FolderOpen,
  ShieldAlert,
  ChevronRight,
  LockKeyhole,
  Copy,
  RefreshCw,
} from "lucide-react";
import { getBridge } from "../bridge";
import { useWindowReturn } from "../useWindowReturn";
import { useJobLog } from "../useJobLog";
import { SessionLog } from "./SessionLog";
import { Artwork, Empty, Loading, Row, Select } from "../components";
import { GameBrowser } from "./GameBrowser";
import type { GameMenuHandler } from "../GameCard";
import { GameSetup, resolveSetup, type SetupSelection } from "./GameSetup";
import { ActionMenu, GraphicsActions } from "./GraphicsActions";
import { DiagnosticsPanel, ModelTable } from "./GameReports";
import { GraphicsPanels } from "./GraphicsPanels";
import { EncorePanel, defaultEncore, encoreSettingsIssue } from "./EncorePanel";
import { EngineVersion, selectedEngine, useEngineLibrary } from "./EngineVersion";
import { StandaloneTuning } from "./StandaloneTuning";
import { HardwareProfileChoices, hardwareProfileNotes } from "./HardwareProfileChoices";
import "./GameGraphics.css";
import { StandaloneRuntimeFacts } from "./StandaloneStatus";
import { invalidateGameInspection, useGameDetails, useGameStatus } from "./useGameInspection";
import { useProfileTarget } from "./useProfileTarget";
import { useRestoreStatus } from "./useRestoreStatus";
import {
  applyPatch,
  changedFields,
  defaultStack,
  errorText,
  readDraft,
} from "../domain";
import type {
  Draft,
  Game,
  Inventory,
  Library,
  Result,
  Runtime,
  RuntimeItem,
  Status,
  EncoreSettings,
  MfgAdvanced,
} from "../types";
export type Run = (
  operation: (token?: string) => Promise<Result>,
) => Promise<boolean>;
type Props = {
  onImportModel: (id: string) => void;
  onBrowseModels: () => void;
  onDownloadModel: (id: string) => void;
  games: Game[];
  grouped: boolean;
  openMenu: GameMenuHandler;
  selected: string;
  onSelect: (dir: string) => void;
  drafts: Record<string, Draft>;
  setDraft: (dir: string, draft?: Draft) => void;
  busy: boolean;
  run: Run;
  message: (s: string) => void;
  ask?: (title: string, body: string, confirm?: string) => Promise<boolean>;
  active?: boolean;
  refreshToken?: number;
};
type EditorDraft = { setup: SetupSelection | null; components: Record<string, string>; encore?:Record<string,EncoreSettings | undefined>;
  encoreEngines?:Record<string,string|undefined>; mfgPackageId?:string; mfgAdvanced?:MfgAdvanced; resetNeuralTuning?:boolean };
const emptyEditorDraft: EditorDraft = { setup: null, components: {} };
export function Games(props: Props) {
  // Keep unapplied route/component choices when an editor or tab unmounts.
  // Component values are only user overrides; "" explicitly means paired default.
  const [editorDrafts, setEditorDrafts] = useState<Record<string, EditorDraft>>({});
  const selected = props.games.find((g) => g.dir === props.selected);
  return (
    <div className="games-workspace">
      <GameBrowser games={props.games} selected={props.selected} onSelect={props.onSelect} grouped={props.grouped} openMenu={props.openMenu} />
      {selected ? (
        <GameEditor key={selected.dir} {...props} game={selected}
          editorDraft={editorDrafts[selected.dir] || emptyEditorDraft}
          onEdit={patch => setEditorDrafts(previous => ({ ...previous,
            [selected.dir]: { ...(previous[selected.dir] || emptyEditorDraft), ...patch },
          }))} />
      ) : (
        <Empty>{t("选择一款游戏，查看配置和组件。")}</Empty>
      )}
    </div>
  );
}
function GameEditor({
  onImportModel,
  onBrowseModels,
  onDownloadModel,
  game,
  editorDraft,
  onEdit,
  drafts,
  setDraft,
  run,
  busy,
  message,
  ask,
  active = true,
  refreshToken = 0,
}: Props & { game: Game; editorDraft: EditorDraft; onEdit: (patch: Partial<EditorDraft>) => void }) {
  const setupSelection = editorDraft.setup;
  const setSetupSelection = (setup: SetupSelection | null) => onEdit({ setup });
  const [tab, setTab] = useState("graphics"),
    [showAntiCheatNote, setShowAntiCheatNote] = useState(false),
    [revision, setRevision] = useState(0),
    [runtime, setRuntime] = useState<Runtime | null>(null);
  // Window return reads lists/telemetry only. Re-inspecting a game's files is
  // explicit, so focus changes never replace the configuration being edited.
  const returnRevision = useWindowReturn(active && (tab === "components" || tab === "runtime"), busy);
  const { rows: logRows, lines: activity, clear: clearActivity } = useJobLog(game.dir);
  const panelId = useId();
  const recovery = useRestoreStatus(game.dir, active, revision, refreshToken);
  const detailRead = useGameDetails(game.dir, active, revision, refreshToken);
  const statusRead = useGameStatus(game.dir, "", active, revision, refreshToken);
  const details = detailRead?.value;
  const status = statusRead?.value;
  const statusError = statusRead?.error || (status && !status.ok && (status.message || t("未识别到可配置的游戏程序，请核对游戏目录。")));
  const error = (tab === "graphics" || tab === "models") ? statusError : undefined;
  const loadingPanel = (tab === "graphics" || tab === "models") && !status;
  const base = status?.ok ? readDraft(status) : null,
    draft = drafts[game.dir] || base,
    changes = base && draft ? changedFields(base, draft) : [];
  const selectedSetup = details ? resolveSetup(details,setupSelection) : null;
  const encoreSelected = !status?.launcherProtected && selectedSetup?.route === "encore";
  const profileOverride = !encoreSelected && base && draft && draft.hardwareProfile !== base.hardwareProfile
    ? draft.hardwareProfile : "";
  const projected = useProfileTarget(game.dir, profileOverride, active && !!profileOverride, revision, refreshToken);
  const displayedStatus = profileOverride ? projected?.status : status;
  const setupPending = !!setupSelection && !details?.launcherProtected && !status?.launcherProtected;
  const encoreKey = (selectedSetup?.exe?.path || setupSelection?.exePath || '').replace(/\\/g,'/').toLowerCase();
  const statusExe = (status?.encore?.exePath || status?.exePath || details?.exePath || '').replace(/\\/g,'/').toLowerCase();
  const currentEncore = encoreKey === statusExe ? status?.encore : undefined;
  const encoreStatus = status ? {...status,encore:currentEncore} : undefined;
  const encoreBase = currentEncore?.installed ? currentEncore.settings : defaultEncore;
  const encoreDraft = editorDraft.encore?.[encoreKey] || encoreBase;
  const setEncoreDraft = (encore?:EncoreSettings) => onEdit({encore:{...editorDraft.encore,[encoreKey]:encore}});
  const encorePackageId = editorDraft.encoreEngines?.[encoreKey];
  const installedEncoreEngine = currentEncore?.installed ? currentEncore.engine : undefined;
  const engineLibrary = useEngineLibrary(active && tab === 'graphics' && (!!status?.launcherProtected || encoreSelected),refreshToken + revision);
  const encoreEngine = selectedEngine(engineLibrary.data,'encore',encorePackageId,installedEncoreEngine);
  const mfgEngine = selectedEngine(engineLibrary.data,'mfg-universal',editorDraft.mfgPackageId,status?.mfg?.engine);
  const encoreChanged = JSON.stringify(encoreBase) !== JSON.stringify(encoreDraft) || encorePackageId !== undefined;
  const advancedChanges = Object.keys(editorDraft.mfgAdvanced || {}).length;
  const extraChanges = advancedChanges + Number(editorDraft.mfgPackageId !== undefined) + Number(!!editorDraft.resetNeuralTuning);
  const encoreIssue = selectedSetup?.encoreIssue || currentEncore?.error || (!status?.ok ? t("读取游戏配置…")
    : encoreSettingsIssue(encoreDraft,status,selectedSetup?.exe?.hasNativeDlss,encoreEngine,encoreBase));
  const targets = details ? [details, ...(details.exes || [])] : [];
  const antiCheatWarning = targets.some(target => target.antiCheatWarning);
  const antiCheatNames = [...new Set(targets.flatMap(target => target.antiCheatComponents || []))];

  const patchDraft = (patch: Partial<Draft>) => {
    if (draft) setDraft(game.dir, { ...draft, ...patch });
  };
  const refresh = () => {
    invalidateGameInspection(game.dir);
    setRevision((v) => v + 1);
  };
  const executeEncore = async () => {
    const exe = selectedSetup?.exe;
    if (!exe || !status?.ok || encoreIssue) return;
    const {neuralMode,neuralModelId,mfgMode,...encore} = encoreDraft;
    if (await run(token=>getBridge().enhancedApply(game.dir,{
      route:"encore",exePath:exe.path,apiOverride:exe.apiOverride || "auto",neuralMode,neuralModelId,mfgMode,encore,encorePackageId,
    },token))) {
      onEdit({setup:null,encore:{...editorDraft.encore,[encoreKey]:undefined},encoreEngines:{...editorDraft.encoreEngines,[encoreKey]:undefined}}); refresh(); setRuntime(null);
    }
  };
  const execute = async (scope: "changed" | "neural" | "mfg" | "both" | "enableBoth" = "changed") => {
    if (encoreSelected) { await executeEncore(); return; }
    if (setupPending) {
      message(t("请先预览并应用安装方式，再应用该路线的参数。"));
      return;
    }
    if (!base || !displayedStatus?.ok) return;
    try {
      const config = {
        ...(scope === 'changed' && !changes.length && extraChanges ? {hardwareProfile:(draft || base).hardwareProfile}
          : applyPatch(base, draft || base, scope, status?.launcherProtected)),
        exePath: status?.exePath || details?.exePath || undefined,
        ...(status?.launcherProtected && editorDraft.mfgPackageId !== undefined ? {mfgPackageId:editorDraft.mfgPackageId} : {}),
        ...(status?.launcherProtected && scope !== 'mfg' && advancedChanges ? {mfgAdvanced:editorDraft.mfgAdvanced} : {}),
        ...(scope !== 'mfg' && editorDraft.resetNeuralTuning ? {resetNeuralTuning:true,neuralMode:(draft || base).neuralMode} : {}),
      };
      if (
        await run((token) => getBridge().enhancedApply(game.dir, config, token))
      ) {
        if (scope === "both" || scope === "enableBoth" || scope === "changed") setDraft(game.dir, undefined);
        onEdit({mfgPackageId:undefined,...(scope !== 'mfg' ? {mfgAdvanced:undefined,resetNeuralTuning:undefined} : {})});
        refresh();
        setRuntime(null);
      }
    } catch (e) {
      message(errorText(e));
    }
  };
  const installSetup = async () => {
    if (encoreSelected) { await executeEncore(); return; }
    if (!details || !setupPending) return;
    const { exe, route } = resolveSetup(details, setupSelection);
    if (!exe || !route) return;
    if (await run(token => getBridge().install(game.dir, exe.path, route, exe.apiOverride || "auto", token))) {
      setSetupSelection(null);
      refresh();
      setRuntime(null);
    }
  };
  const restore = async () => {
    if (!recovery?.canRestore || (ask && !(await ask(t("卸载并恢复游戏原始状态"),
      t("将删除本次部署的文件，并从 _DLSS5_Backup 还原原始文件。游戏需要处于关闭状态。"), t("恢复"))))) return;
    if (await run(token => getBridge().restoreGame(game.dir, token))) {
      setDraft(game.dir, undefined);
      onEdit({ setup: null, components: {}, encore:undefined,encoreEngines:undefined,mfgPackageId:undefined,mfgAdvanced:undefined,resetNeuralTuning:undefined });
      setRuntime(null);
      refresh();
    }
  };
  return (
    <section className="game-detail">
      <div className="game-overview">
        <div className="game-detail-top">
          <div className="game-identity">
            <Artwork game={game} layout="banner" large />
            <div>
              <div className="game-title-line">
                <h1 title={game.name}>{game.name}</h1>
                <span>{game.launcher === "Added by hand" ? t("手动添加") : game.launcher}</span>
              </div>
              <p className="path">
                <span title={game.dir}>{game.dir}</span>
                <button
                  className="icon-button"
                  aria-label={t("复制游戏目录")}
                  title={t("复制路径")}
                  onClick={() => {
                    void getBridge()
                      .copyText(game.dir)
                      .then((done) =>
                        message(done ? t("已复制路径") : t("复制失败")),
                      )
                      .catch((e) => message(errorText(e)));
                  }}
                >
                  <Copy size={13} />
                </button>
              </p>
            </div>
          </div>
          <div className="game-actions">
            <button
              className="icon-button"
              aria-label={t("打开游戏目录")}
              title={t("打开游戏目录")}
              onClick={() => {
                void getBridge()
                  .open(game.dir)
                  .catch((e) => message(errorText(e)));
              }}
            >
              <FolderOpen />
            </button>
            <button
              className="primary"
              disabled={!details?.exePath || busy}
              onClick={() => {
                void getBridge()
                  .launchGame(game.dir)
                  .then((r) => {
                    if (r?.ok === false) message(r.message || t("启动失败"));
                  })
                  .catch((e) => message(errorText(e)));
              }}
            >
              <Play size={16} />
              {t("启动游戏")}
            </button>
          </div>
        </div>
        <div className="installed-strip">
          <span
            title={details?.files
              ?.map((f) => `${f.name} ${f.version || ""}`)
              .join("\n")}
          >
            {t("已检测组件：")}
            {!details
              ? t("读取中…")
              : details.files?.length
                ? t("{0} 个文件 · {1}", [
                    details.files.length,
                    details.api || "API 待确认",
                  ])
                : [t("未发现 DLSS 运行库"), details.api].filter(Boolean).join(" · ")}
          </span>
          {antiCheatWarning && <button type="button" className="anti-cheat-badge"
            aria-expanded={showAntiCheatNote} aria-controls={`${panelId}-anti-cheat`}
            onClick={() => setShowAntiCheatNote(open => !open)}>
            <ShieldAlert size={13} aria-hidden="true" />
            {t(antiCheatNames.length ? "检测到反作弊" : "反作弊提醒")}
            <ChevronRight size={12} aria-hidden="true" />
          </button>}
          <RuntimeSummary runtime={runtime} />
        </div>
        {antiCheatWarning && <div className="game-anti-cheat-note" id={`${panelId}-anti-cheat`} hidden={!showAntiCheatNote}>
          <strong>{t("关于此游戏")}</strong>
          <p>{antiCheatNames.length > 0
            ? t("检测到反作弊组件：{0}。", [antiCheatNames.join(locale() === "en-US" ? ", " : "、")])
            : t("此游戏有反作弊提示。")}{" "}{t("安装第三方 DLL 或叠加层前，请确认该游戏允许使用这些组件。")}</p>
        </div>}
      </div>
      <div className="tabs" role="tablist" aria-label={game.name} onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        const tabs = Array.from(e.currentTarget.querySelectorAll("button"));
        const from = tabs.indexOf(e.target as HTMLButtonElement);
        if (from < 0) return;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1
          : (from + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      }}>
        {[
          ["graphics", t("画质与补帧")],
          ["models", t("模型库")],
          ["components", t("组件与版本")],
          ["runtime", t("运行诊断")],
        ].map(([id, label]) => (
          <button
            role="tab"
            id={`${panelId}-${id}`}
            aria-controls={panelId}
            tabIndex={tab === id ? 0 : -1}
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="detail-scroll" data-tab={tab} role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${tab}`} tabIndex={0}>
        <div className="game-tab-content">
          {details && <div hidden={tab !== "graphics"}>
            <GameSetup dir={game.dir} details={details} status={displayedStatus} busy={busy}
              selection={setupSelection} onChange={setSetupSelection} message={message} onUpdated={refresh} />
          </div>}
          {tab === "graphics" && detailRead?.error && <p className="error" role="alert">
            {t(detailRead.error)} <button onClick={refresh}>{t("重试")}</button>
          </p>}
          {error && (
            <div className="error" role="alert">
              {t(error)}
              <button onClick={refresh}>{t("重试")}</button>
            </div>
          )}
          {loadingPanel && !error && <Loading text={t("读取游戏配置…")} skeleton="table" />}
          {recovery?.error && (tab === "graphics" || tab === "components") &&
            <p className="error" role="alert">{t(recovery.error)} <button onClick={refresh}>{t("重试")}</button></p>}
          {status?.ok && tab === "graphics" && draft && (
            <fieldset disabled={busy}>
              {encoreSelected ? <EncorePanel value={encoreDraft} status={encoreStatus || status} engine={encoreEngine} hasNativeDlss={selectedSetup?.exe?.hasNativeDlss} issue={encoreIssue}
                engineControl={<EngineVersion component="encore" library={engineLibrary.data} current={installedEncoreEngine} value={encorePackageId}
                  onChange={value=>onEdit({encoreEngines:{...editorDraft.encoreEngines,[encoreKey]:value}})} onBrowse={onBrowseModels}
                  error={engineLibrary.error} onRetry={engineLibrary.retry}/>}
                onChange={setEncoreDraft} onModels={()=>setTab("models")} onApply={()=>void executeEncore()}/> : <>
              <section className="profile-picker game-profile-picker" aria-label={t("硬件专属优化档位")}>
                <h2>{t("硬件专属优化档位")}</h2>
                <HardwareProfileChoices game standalone={status.launcherProtected} catalog={status.hardwareProfiles} profileId={draft.hardwareProfile}
                  source={profileOverride ? "selected" : status.hardwareProfileSource}
                  onSelect={id => patchDraft({ hardwareProfile: id, runtimeStack: defaultStack(id) })} />
              </section>
              {displayedStatus && <GraphicsPanels active={active} onRuntime={setRuntime} showGameDetails gameDir={game.dir} status={displayedStatus}
                profileNotes={hardwareProfileNotes(displayedStatus.hardwareProfileInfo)}
                exePath={details?.exePath || displayedStatus.exePath} draft={draft} onChange={patchDraft}
                engineControl={status.launcherProtected && <EngineVersion component="mfg-universal" library={engineLibrary.data} current={status.mfg?.engine}
                  value={editorDraft.mfgPackageId} onChange={mfgPackageId=>onEdit({mfgPackageId})} onBrowse={onBrowseModels} error={engineLibrary.error} onRetry={engineLibrary.retry}/>}
                neuralAdvanced={status.launcherProtected && <StandaloneTuning value={{...status.mfg?.advanced,...editorDraft.mfgAdvanced}} engine={mfgEngine}
                  onChange={patch=>onEdit({mfgAdvanced:{...editorDraft.mfgAdvanced,...patch}})} enabled={draft.neuralMode!=='off'}
                  onReset={()=>onEdit({resetNeuralTuning:true,mfgAdvanced:undefined})} resetPending={!!editorDraft.resetNeuralTuning}/>}
                onResetTuning={()=>onEdit({resetNeuralTuning:true})} resetPending={!!editorDraft.resetNeuralTuning}
                onApply={scope => void execute(scope)}
                onBrowseModels={() => setTab("models")} />}
              {profileOverride && !projected && <Loading text={t("读取游戏配置…")}/>}
              </>}
            </fieldset>
          )}
          {tab === "graphics" && draft && <p className="footnote">{t("这些是磁盘配置与待应用参数。实际渲染效果和补帧倍率请查看运行诊断。")}</p>}
          {profileOverride && (tab === "graphics" || tab === "models") && projected?.errors.map(detail =>
            <p key={detail} className="error" role="alert">{t(detail)} <button onClick={refresh}>{t("重试")}</button></p>
          )}
          {tab === "models" && status?.ok && (profileOverride && !projected
            ? <Loading text={t("读取游戏配置…")}/>
            : <ModelTable models={profileOverride ? projected?.models || [] : status.neural?.availableModels || []} profileSm={displayedStatus?.hardwareProfileInfo?.sm} gpuSm={displayedStatus?.hardware?.gpu?.architecture?.sm} message={message} onImport={onImportModel} onChoose={id => {
              if (encoreSelected) setEncoreDraft({...encoreDraft,neuralModelId:id,neuralMode:"latest_compatible"});
              else patchDraft({ neuralModelId: id, neuralMode: id === "310.8.0-RTX40" ? "legacy" : "latest_compatible" });
              setTab("graphics");
            }} onBrowseModels={onBrowseModels} onDownload={onDownloadModel} busy={busy} />)}
          {tab === "components" && (
            <GameComponents
              refreshToken={refreshToken + returnRevision}
              active={active}
              hasBackup={!!recovery?.canRestore}
              onRefresh={refresh}
              onRestore={() => { setDraft(game.dir, undefined); onEdit({ setup: null, components: {}, encore:undefined,encoreEngines:undefined,mfgPackageId:undefined,mfgAdvanced:undefined,resetNeuralTuning:undefined }); setRuntime(null); refresh(); }}
              pending={editorDraft.components}
              onChange={components => onEdit({ components })}
              dir={game.dir}
              run={run}
              busy={busy}
              message={message}
            />
          )}
          {tab === "runtime" && (
            <RuntimePanel refreshToken={refreshToken + returnRevision}
              active={active}
              dir={game.dir}
              status={status}
              onRuntime={setRuntime}
              message={message}
            />
          )}
          {tab === "graphics" && <SessionLog rows={logRows} clear={clearActivity} />}
        </div>
      </div>
      <div className="apply-bar">
        <span>
          {tab === "graphics"
            ? encoreSelected ? t(encoreChanged || setupPending ? "Encore 配置待应用" : "Encore 配置已读取") : setupPending ? t("安装方式待应用 · 画质与补帧修改 {0} 项", [changes.length + extraChanges]) : changes.length + extraChanges
              ? t("{0} 项待应用修改", [changes.length + extraChanges])
              : t(status?.ok ? "配置已读取" : error ? "操作未完成" : "读取游戏配置…")
            : tab === "models"
              ? t("模型身份由文件 SHA-256 确定，架构匹配不代表已在游戏中生效")
              : tab === "components"
                ? t("版本锁定与恢复由组件记录管理")
                : t("仅显示当前进程和有效时间内的证据")}
        </span>
        <div>
          {tab === "graphics" && encoreSelected ? <>
            <button disabled={busy || (!encoreChanged && !setupPending)} onClick={()=>onEdit({setup:null,encore:{...editorDraft.encore,[encoreKey]:undefined},encoreEngines:{...editorDraft.encoreEngines,[encoreKey]:undefined}})}>{t("撤销")}</button>
            <button className="primary" disabled={busy || !!encoreIssue || (!encoreChanged && !setupPending)} onClick={()=>void executeEncore()}>{t("预览并应用")}</button>
            <ActionMenu><button disabled={busy} onClick={refresh}>{t("重新检测文件")}</button>
              <button disabled={busy || !!encoreIssue} onClick={()=>void executeEncore()}>{t("重新应用当前配置")}</button>
              <button className="danger" disabled={busy || !recovery?.canRestore} onClick={()=>void restore()}>{t("一键卸载并恢复")}</button></ActionMenu>
          </> : tab === "graphics" ? (
            <GraphicsActions draft={draft} status={displayedStatus} changed={!!changes.length || !!extraChanges || setupPending} busy={busy}
              setupAction={setupPending ? () => void installSetup() : undefined}
              canRestore={!!recovery?.canRestore} undo={() => { setDraft(game.dir, undefined); onEdit({setup:null,mfgPackageId:undefined,mfgAdvanced:undefined,resetNeuralTuning:undefined}); }}
              apply={execute} restore={restore} rescan={refresh} />
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                void getBridge()
                  .saveDiagnostics(game.dir, activity.join("\n"))
                  .then((r) => {
                    if (r?.ok) message(t("诊断报告已导出"));
                    else if (r?.message) message(r.message);
                  })
                  .catch((e) => message(errorText(e)));
              }}
            >
              {t("导出诊断报告")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
function RuntimeSummary({ runtime }: { runtime: Runtime | null }) {
  const [now, setNow] = useState(Date.now);
  const checkedAt = runtime?.checkedAt;
  useEffect(() => {
    if (checkedAt == null) return;
    const update = () => setNow(Date.now());
    update();
    const remaining = checkedAt + 30001 - Date.now();
    const timer = Number.isFinite(remaining) && remaining > 0 ? setTimeout(update, remaining) : undefined;
    // Diagnostics stop when their tab is left. Expire the retained header
    // snapshot without adding background IPC reads, including after suspension.
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [checkedAt]);
  const stale = !!runtime && (!checkedAt || !Number.isFinite(checkedAt) || now - checkedAt > 30000);
  const running = !stale && runtime?.processState === "running";
  return <span className="runtime-summary" data-running={running || undefined}>
    <i />
    {t(!runtime ? "运行状态未检测" : stale ? "运行记录已过期" : running ? "游戏运行中" : runtime.nr.label)}
  </span>;
}
function GameComponents({
  refreshToken,
  active,
  hasBackup,
  onRefresh,
  onRestore,
  dir,
  run,
  busy,
  message,
  pending,
  onChange,
}: {
  active: boolean;
  refreshToken: number;
  hasBackup: boolean;
  onRefresh: () => void;
  onRestore: () => void;
  dir: string;
  run: Run;
  busy: boolean;
  message: (s: string) => void;
  pending: Record<string, string>;
  onChange: (pending: Record<string, string>) => void;
}) {
  const [library, setLibrary] = useState<Library | null>(null),
    [error, setError] = useState(""),
    [rev, setRev] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBridge().libraryComponents(dir)
      .then((l) => {
        if (alive) {
          if (!l.ok || !l.inventory?.ok)
            throw Error(l.message || l.inventory?.message || t("组件读取失败"));
          setLibrary(l);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [dir, rev, active, refreshToken]);
  const inventory = library?.inventory;
  const saved = library?.profile?.selected || {};
  const selection = Object.fromEntries(Object.entries({ ...saved, ...pending }).filter(([, value]) => value));
  const refresh = () => setRev((v) => v + 1);
  const refreshAll = () => {
    onRefresh();
    refresh();
  };
  const restoreRow = (
    <div className="restore-row">
      <span className="muted">{t("使用游戏目录中的原始备份恢复文件。")}</span>
      <button
        className="danger"
        disabled={busy || !hasBackup}
        onClick={() => {
          void run((token) => getBridge().restoreGame(dir, token)).then((ok) => {
            if (ok) {
              onRestore();
              refresh();
            }
          });
        }}
      >
        {t("恢复原始文件")}
      </button>
    </div>
  );
  if (error || !inventory || !library) {
    const state = error ? (
      <div className="error">
        {t(error)}
        <button onClick={refreshAll}>{t("重试")}</button>
      </div>
    ) : <Loading text={t("读取组件与版本记录…")} skeleton="table" />;
    return <>{state}{restoreRow}</>;
  }
  return (
    <>
      <div className="section-toolbar">
        <h2>{t("已安装组件与文件")}</h2>
        <ActionMenu><button disabled={busy} onClick={refreshAll}>{t("重新检测文件")}</button></ActionMenu>

      </div>
      <div className="settings-table">
        <Row
          label={inventory.lock ? t("当前组合已锁定") : t("版本未锁定")}
          hint={t("锁定后，管理器会阻止组件文件被替换")}
        >
          <button
            disabled={busy || (!inventory.lock && !inventory.rows.some(row => row.present))}
            onClick={() => {
              void getBridge()
                .componentLock(dir, !inventory.lock)
                .then((r) => {
                  if (!r.ok) throw Error(r.message);
                  refresh();
                })
                .catch((e) => message(errorText(e)));
            }}
          >
            <LockKeyhole size={16} />
            {inventory.lock ? t("解除锁定") : t("锁定当前组合")}
          </button>
        </Row>
      </div>
      {inventory.rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("组件 / 文件")}</th>
                <th>{t("磁盘版本")}</th>
                <th>{t("状态")}</th>
              </tr>
            </thead>
            <tbody>
              {inventory.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <strong>{t(r.name)}</strong>
                    <details>
                      <summary>{t("路径与来源")}</summary>
                      <p className="path">{r.rel}</p>
                      <p>{t(r.source)}</p>
                      <code className="path">{r.sha256}</code>
                    </details>
                  </td>
                  <td>{r.version || t("无版本信息")}</td>
                  <td>
                    {!r.present
                      ? t("文件缺失")
                      : r.lockState === "drift"
                        ? t("偏离锁定")
                        : t("已安装")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{t("尚未安装受管理的组件。")}</Empty>
      )}
      <details className="advanced">
        <summary>
          <ChevronRight size={16} />
          {t("选择配套组件版本")}
        </summary>
        <p className="muted">{t("使用配套默认版本会清除该组件的版本选择。要恢复磁盘文件，请使用回滚或恢复原始文件。")}</p>
        {Object.entries(library.definitions)
          .filter(
            ([id, d]) =>
              !d.internal && library.packages.some((p) => p.component === id),
          )
          .map(([id, d]) => (
            <Row key={id} label={t(d.name)}>
              <Select
                label={t(d.name)}
                value={selection[id] || ""}
                disabled={busy}
                onChange={value => {
                  const next = { ...pending };
                  if (value === (saved[id] || "")) delete next[id]; else next[id] = value;
                  onChange(next);
                }}
                options={[
                  ["", t("使用配套默认版本")],
                  ...library.packages
                    .filter(
                      (p) =>
                        p.component === id &&
                        p.present &&
                        p.compatibility.ready,
                    )
                    .map((p) => [p.id, p.version]),
                ]}
              />
            </Row>
          ))}
        <div className="inline-actions">
          <button
            disabled={busy || (!Object.keys(selection).length && !Object.keys(library.profile?.selected || {}).length)}
            onClick={() => {
              void run(token => getBridge().libraryApply(dir, token, selection)).then(ok => {
                if (ok) { onChange({}); refresh(); }
              });
            }}
          >
            {t("预览版本变更")}
          </button>
          {library.rollback && (
            <button
              disabled={busy}
              onClick={() => {
                void run((token) =>
                  getBridge().libraryRollback(dir, library.rollback!.id, token),
                ).then((ok) => {
                  if (ok) { onChange({}); refresh(); }
                });
              }}
            >
              {t("回滚上次组件更新")}
            </button>
          )}
        </div>
      </details>
      {restoreRow}
    </>
  );
}
const PIPELINE_GROUPS: [string, string[]][] = [
  ["神经渲染", ["nvngx_dlssnr.dll", "renodx-dlss5.addon64"]],
  ["帧生成", ["nvngx_dlssg.dll", "renodx-mfgunlock.addon64", "MFGUnlocker.dll"]],
  [
    "老游戏管线",
    [
      "dlss5-feed.addon64",
      "dlss5-feed.addon32",
      "dlss5-feed-host64.exe",
      "DLSS5_Feed.fx",
      "winmm.dll",
    ],
  ],
  [
    "叠加层与中文",
    ["dlss5-lab-overlay.addon64", "dlss5-zh-cn.addon64", "dlss5-zh-cn.addon32"],
  ],
  ["Streamline", ["sl.reflex.dll", "sl.common.dll", "sl.dlss.dll", "sl.dlss_g.dll"]],
];
const baseName = (row: { name?: string; rel?: string }) =>
  (row.rel || row.name || "").split(/[\\/]/).pop() || "";
function RuntimePanel({
  refreshToken,
  dir,
  status,
  onRuntime,
  message,
  active,
}: {
  dir: string;
  refreshToken: number;
  status?: Status;
  onRuntime: (r: Runtime | null) => void;
  message: (s: string) => void;
  active: boolean;
}) {
  const [result, setResult] = useState<Runtime | null>(null),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false),
    [now, setNow] = useState(Date.now()),
    [inv, setInv] = useState<Inventory | null>(null);
  const probeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getBridge()
      .componentInventory(dir)
      .then((i) => {
        if (alive && i.ok) setInv(i);
      })
      .catch(() => {
        /* 组件清单读取失败不影响运行时检测 */
      });
    return () => {
      alive = false;
    };
  }, [dir, active, refreshToken]);
  useEffect(() => {
    if (!active) {
      setBusy(false);
      return;
    }
    let alive = true,
      inFlight = false;
    const probe = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      setBusy(true);
      try {
        const r = await getBridge().componentRuntime(dir);
        if (alive) {
          if (!r.ok) throw Error(r.message || t("检测失败"));
          setResult(r);
          setNow(Date.now());
          onRuntime(r);
        }
      } catch (e) {
        if (alive) {
          setResult(null);
          onRuntime(null);
          message(errorText(e));
        }
      } finally {
        inFlight = false;
        if (alive) setBusy(false);
      }
    };
    probeRef.current = probe;
    void probe();
    return () => {
      alive = false;
      probeRef.current = () => {};
    };
  }, [dir, active, message, onRuntime, refreshToken]);
  useEffect(() => {
    if (!active || !auto) return;
    const timer = setInterval(() => probeRef.current(), 5000);
    return () => clearInterval(timer);
  }, [active, auto]);
  useEffect(() => {
    if (!active || !result) return;
    const timers = [result.nr.at, result.mfg.at, result.mfg.fpsAt].flatMap(at => {
      const expires = (at || 0) + 30001 - Date.now();
      return expires > 0 ? [setTimeout(() => setNow(Date.now()), expires)] : [];
    });
    return () => timers.forEach(clearTimeout);
  }, [active, result]);
  const item = (name: string, data: RuntimeItem) => {
    const stale = !!data.at && now - data.at > 30000;
    return (
      <section className="runtime-block">
        <h2>{name}</h2>
        <strong
          className={
            stale ? "muted" : data.state === "active" ? "positive" : ""
          }
        >
          {stale ? t("运行记录已过期") : t(data.label)}
        </strong>
        <p>
          {stale ? t("超过 30 秒没有新遥测，请刷新检测。") : t(data.detail)}
        </p>
        {data.requestedMode === 'dynamic' ? <p>{t("请求动态补帧")} · {t(data.appliedMode === 'dynamic' ? "组件已应用动态控制" : "尚未确认动态控制生效")}</p> : data.requestedMultiplier && (
          <p>
            {t("请求")}
            {data.requestedMultiplier}
            {t("× · 已应用请求")} {data.appliedMultiplier || "—"}×
          </p>
        )}
        {!stale && (!data.fpsAt || now - data.fpsAt <= 30000) && data.sourceFps !== undefined &&
          data.reportedOutputFps !== undefined && (
            <p>
              {t("插件报告：基础")}
              {data.sourceFps.toFixed(1)}
              {t("/ 输出")} {data.reportedOutputFps.toFixed(1)} FPS
            </p>
          )}
        {data.evidence && (
          <details>
            <summary>{t("判断依据")}</summary>
            <pre>{data.evidence}</pre>
          </details>
        )}
      </section>
    );
  };
  return (
    <>
      <div className="section-toolbar">
        <h2>{t("运行时检测")}</h2>
        <div className="inline-actions">
          <button disabled={busy} onClick={() => probeRef.current()}>
            <RefreshCw size={16} className={busy ? "refresh-spinning" : undefined} />
            {t(busy ? "检测中…" : "立即检测")}
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            {t("自动刷新")}
          </label>

        </div>
      </div>
      {result ? (
        <>
          {inv?.rows?.length ? (
            <details className="advanced">
              <summary>{t("管线组件")}</summary>
              <div className="pipeline-grid">
                {PIPELINE_GROUPS.map(([group, names]) => {
                  const rows = names
                    .map((n) => inv.rows.find((f) => f.present && baseName(f).toLowerCase() === n.toLowerCase()))
                    .filter(Boolean) as { present?: boolean; version?: string }[];
                  const present = rows.filter((r) => r.present);
                  return (
                    <div className="pipeline-row" key={group}>
                      <div className="pipeline-head">
                        <strong>{t(group)}</strong>
                        <span
                          className={present.length ? "positive" : "muted"}
                        >
                          {present.length}/{names.length}
                        </span>
                      </div>
                      <small>
                        {present.length
                          ? present
                              .map(
                                (r) =>
                                  `${baseName(r as never)}${
                                    r.version ? " " + r.version : ""
                                  }`,
                              )
                              .join(" · ")
                          : t("未部署")}
                      </small>
                    </div>
                  );
                })}
              </div>
              <p className="footnote">
                {t(
                  "这里只反映磁盘上的文件。是否真正加载由下方运行时检测判断。Streamline 由游戏自带时以游戏目录版本为准。",
                )}
              </p>
            </details>
          ) : null}
          {item(t("DLSS 神经渲染"), result.nr)}
          {item(t("DLSS-G / 多帧生成"), result.mfg)}
          {result.standalone && <section className="runtime-block"><h2>{t("独立加载实际参数")}</h2><StandaloneRuntimeFacts runtime={result} /></section>}
          <p className="muted">
            {t("检测于")}
            {new Date(result.checkedAt).toLocaleTimeString(locale())}
            {t("· DLL 加载不代表渲染已生效。")}
          </p>
          {!!result.modules?.length && (
            <details className="advanced">
              <summary>
                <ChevronRight size={16} />
                {t("已加载模块")}
              </summary>
              {result.modules.map((m) => (
                <p className="path" key={m.path}>
                  {m.path}
                </p>
              ))}
            </details>
          )}
        </>
      ) : (
        <Empty>
          {busy
            ? t("正在检查游戏进程和运行日志…")
            : <>{t("暂无本次检测结果，请重试。")} <button onClick={() => probeRef.current()}>{t("重试")}</button></>}
        </Empty>
      )}
      {status?.diagnostics && (
        <details className="advanced game-diagnostics">
          <summary>{t("文件、配置与显存估算")}</summary>
          <DiagnosticsPanel diagnostics={status.diagnostics} />
        </details>
      )}
    </>
  );
}
