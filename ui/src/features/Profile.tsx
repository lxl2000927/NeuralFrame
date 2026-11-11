import { t } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cpu,
  Monitor,
  Zap,
  RefreshCw,
  FolderOpen,
} from "lucide-react";
import { getBridge } from "../bridge";
import { Loading, Select } from "../components";
import {
  applyPatch,
  changedFields,
  defaultStack,
  errorText,
  profiles,
  readDraft,
} from "../domain";
import type { Draft, Game, HardwareResult, UpdateInfo } from "../types";
import { DiagnosticsPanel, ModelTable } from "./GameReports";
import { GraphicsActions } from "./GraphicsActions";
import { GraphicsPanels } from "./GraphicsPanels";
import { useProfileTarget } from "./useProfileTarget";
import { invalidateGameInspection } from "./useGameInspection";
import { useRestoreStatus } from "./useRestoreStatus";
import type { Run } from "./Games";
import { openProjectLink, releaseText } from "./About";
import { HardwareProfileChoices, hardwareProfileNotes } from "./HardwareProfileChoices";
import "./Profile.css";

export function Profile({
  onBrowseModels,
  onImportModel,
  onDownloadModel,
  message,
  refreshToken = 0,
  active = true,
  onChanged,
  games,
  dir,
  onSelect,
  onAddGame,
  savedDraft,
  setDraft,
  operationBusy,
  ask,
  run,
}: {
  onBrowseModels: () => void;
  onImportModel: (id: string) => void;
  onDownloadModel: (id: string) => void;
  message: (s: string) => void;
  refreshToken?: number;
  active?: boolean;
  onChanged?: () => void;
  games: Game[];
  dir: string;
  onSelect: (dir: string) => void;
  onAddGame: () => Promise<void>;
  savedDraft?: Draft;
  setDraft: (dir: string, draft?: Draft) => void;
  operationBusy: boolean;
  ask: (title: string, body: string, confirm?: string) => Promise<boolean>;
  run: Run;
}) {
  const [data, setData] = useState<HardwareResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const hardwareToken = useRef<number | undefined>(undefined),
    generation = useRef(0),
    locked = useRef(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo>();
  const load = useCallback(async (force: boolean) => {
    const revision = ++generation.current;
    hardwareToken.current = undefined;
    setBusy(true);
    try {
      const result = await getBridge().enhancedHardware(force);
      if (!result.ok) throw Error(result.message || t("硬件检测失败"));
      if (revision === generation.current) {
        hardwareToken.current = refreshToken;
        setData(result);
        setError("");
      }
    } catch (e) {
      if (revision === generation.current) setError(errorText(e));
    } finally {
      if (revision === generation.current) setBusy(false);
    }
  }, [refreshToken]);
  useEffect(() => {
    if (active && hardwareToken.current !== refreshToken) void load(false);
    return () => {
      ++generation.current;
    };
  }, [active, refreshToken, load]);
  const hardware = data?.hardware,
    gpu = hardware?.gpu;
  const baseline = useProfileTarget(
    dir,
    dir ? "" : data?.hardwareProfile || "",
    active && (!!dir || !!data),
    revision,
    refreshToken,
  );
  // A draft contains every field, including the original hardware preset.
  // Only a changed preset needs its own compatibility inspection.
  const base = baseline?.status && readDraft(baseline.status);
  const profileOverride = base && savedDraft && savedDraft.hardwareProfile !== base.hardwareProfile
    ? savedDraft.hardwareProfile : "";
  const projected = useProfileTarget(dir, profileOverride, active && !!profileOverride, revision, refreshToken);
  const target = profileOverride ? projected : baseline;
  const status = target?.status;
  const recovery = useRestoreStatus(dir, active, revision, refreshToken);
  const profileId =
    savedDraft?.hardwareProfile ||
    status?.hardwareProfile ||
    data?.hardwareProfile ||
    "";
  const profileCatalog = data?.hardwareProfiles || status?.hardwareProfiles;
  const profile = profileCatalog?.[profileId];
  const profileNotes = hardwareProfileNotes(profile);
  const profileName = t(profiles.find(([id]) => id === profileId)?.[1] || profile?.shortLabel || "未识别");
  const draft = savedDraft || base;
  const disabled = operationBusy || pending;
  const refreshTarget = () => {
    invalidateGameInspection(dir);
    setRevision((value) => value + 1);
  };
  const perform = async (action: () => Promise<void>) => {
    if (locked.current || operationBusy) return;
    locked.current = true;
    setPending(true);
    try {
      await action();
    } catch (e) {
      message(errorText(e));
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  const choose = (id: string) =>
    perform(async () => {
      const result = await getBridge().enhancedSetProfile(id);
      if (!result.ok) throw Error(result.message || t("保存失败"));
      setData(
        (old) => old && { ...old, hardwareProfile: result.hardwareProfile, hardwareProfileSource: "default" },
      );
      if (dir && draft)
        setDraft(dir, {
          ...draft,
          hardwareProfile: id,
          runtimeStack: defaultStack(id),
        });
      onChanged?.();
      message(t("默认档位已保存，应用到游戏后才会改变游戏配置。"));
    });
  const modelSection = useRef<HTMLDivElement>(null);
  const graphicsSection = useRef<HTMLFieldSetElement>(null);
  const apply = (scope: NonNullable<Parameters<typeof applyPatch>[2]>) =>
    perform(async () => {
      if (!dir || !base || !draft) return;
      const config = applyPatch(base, draft, scope, status?.launcherProtected);
      if (await run((token) => getBridge().enhancedApply(dir, config, token))) {
        if (scope === "both" || scope === "enableBoth" || scope === "changed") setDraft(dir, undefined);
        refreshTarget();
      }
    });
  const restore = () =>
    perform(async () => {
      if (
        !dir ||
        !recovery?.canRestore ||
        !(await ask(
          t("卸载并恢复游戏原始状态"),
          t(
            "将删除本次部署的文件，并从 _DLSS5_Backup 还原原始文件。游戏需要处于关闭状态。",
          ),
          t("恢复"),
        ))
      )
        return;
      if (await run((token) => getBridge().restoreGame(dir, token))) {
        setDraft(dir, undefined);
        refreshTarget();
      }
    });
  return (
    <div className="page-scroll profile-page">
      <div className="section-toolbar">
        <div>
          <p className="muted">
            {t(
              "为 RTX 40 系列笔记本、RTX 40 系列桌面显卡和 RTX 50 系列桌面显卡选择神经渲染与补帧档位。",
            )}
          </p>
        </div>

      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button onClick={() => void load(true)}>{t("重试")}</button>
        </p>
      )}
      {!data ? (
        !error && <Loading text={t("读取硬件信息…")} skeleton="table" />
      ) : (
        <section className="hw-grid" aria-label={t("本机硬件")}>
          <div className="hw-card">
            <span className="hw-label">
              <Monitor size={14} />
              {t("本机物理显卡")}
            </span>
            <strong>
              {gpu?.detected === false ? t("未识别") : gpu?.name || "—"}
            </strong>
            <small>
              {gpu?.vramTotalMB
                ? `${gpu.vramTotalMB} MiB VRAM`
                : t("显存信息不可用")}
            </small>
          </div>
          <div className="hw-card">
            <span className="hw-label">
              <Zap size={14} />
              {t("显卡驱动与功耗上限")}
            </span>
            <strong>
              {t("驱动")} {gpu?.driver || "—"}
            </strong>
            <small>
              {gpu?.powerDefaultW || gpu?.powerMaxW
                ? t("默认 {0} W / 最高 {1} W", [gpu?.powerDefaultW || "—", gpu?.powerMaxW || "—"])
                : t("功耗信息不可用")}
            </small>
          </div>
          <div className="hw-card">
            <span className="hw-label">
              <Cpu size={14} />
              {t("处理器与系统内存")}
            </span>
            <strong>{hardware?.cpu || "—"}</strong>
            <small>
              {hardware?.cpuCores || "—"} {t("逻辑核心")} ·{" "}
              {hardware?.ramGB || "—"} GB RAM
            </small>
          </div>
          <div className="hw-card">
            <span className="hw-label">
              <Monitor size={14} />
              {t("当前显示器")}
            </span>
            <strong>{[
              hardware?.display?.resolution?.replace("x", " × "),
              hardware?.display?.refreshRateHz && `${hardware.display.refreshRateHz} Hz`,
            ].filter(Boolean).join(" · ") || t("显示器信息不可用")}</strong>
            <small>{t("档位目标分辨率")} · {profile?.targetResolution?.replace("x", " × ") || "—"}</small>
          </div>
        </section>
      )}
      <div className="profile-target-toolbar">
        <div className="profile-target-select">
          <span>{t("目标游戏目录")}</span>
          <Select
            label={t("目标游戏目录")}
            disabled={pending || operationBusy || !games.length}
            value={dir}
            onChange={onSelect}
            options={
              games.length
                ? games.map((game) => [game.dir, `${game.name} (${game.dir})`])
                : [["", t("请先添加游戏目录")]]
            }
          />
        </div>
        <div className="inline-actions">
          <button disabled={disabled} aria-label={t("浏览并添加游戏目录…")} title={t("浏览并添加游戏目录…")} onClick={() => void perform(onAddGame)}>
            <FolderOpen size={15} aria-hidden="true" />
            <span>{t("浏览并添加游戏目录…")}</span>
          </button>

          <button
            disabled={disabled}
            aria-label={t("检查软件更新")}
            title={t("检查软件更新")}
            onClick={() =>
              void perform(async () => {
                setUpdate(undefined);
                setUpdate(await getBridge().checkUpdate(true));
              })
            }
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>{t("检查软件更新")}</span>
          </button>
        </div>
      </div>
      {update && (
        <div className="inline-actions" role="status">
          <span>{releaseText(update)}</span>
          {update.newer && (
            <button
              onClick={() =>
                void perform(async () => {
                  await openProjectLink("releases", message);
                })
              }
            >
              {t("打开发布页")}
            </button>
          )}
        </div>
      )}
      {profileCatalog && (
        <section className="profile-picker" aria-label={t("硬件专属优化档位")}>
          <header className="profile-picker-heading">
            <h2>{t("硬件专属优化档位")}</h2>
            <p className="muted">
              {data && data.hardwareProfile !== profileId && (
                <>
                  {t("默认硬件档位")} ·{" "}
                  {t(
                    profiles.find(([id]) => id === data.hardwareProfile)?.[1] ||
                      "未识别",
                  )}
                  。{" "}
                </>
              )}
              {t("按显卡选择神经渲染和多帧生成的默认策略，应用到游戏后生效。")}
            </p>
          </header>
          <HardwareProfileChoices standalone={status?.launcherProtected} catalog={profileCatalog} profileId={profileId}
            source={dir ? (profileOverride ? "selected" : status?.hardwareProfileSource) : data?.hardwareProfileSource}
            disabled={disabled || busy || !target} onSelect={choose} />
        </section>
      )}
      {data && !target && <Loading text={t("读取游戏配置…")} />}
      {target?.errors.map((detail, i) => (
        <p className="error" role="alert" key={i}>
          {t(detail)} <button onClick={refreshTarget}>{t("重试")}</button>
        </p>
      ))}
      {status && draft && (
        <fieldset ref={graphicsSection} disabled={disabled}>
          <GraphicsPanels
            active={active}
            profileNotes={profileNotes}
            gameDir={dir}
            status={status}
            exePath={status.exePath}
            draft={draft}
            onChange={(patch) => setDraft(dir, { ...draft, ...patch })}
            onApply={scope => void apply(scope)}
            onBrowseModels={() => modelSection.current?.scrollIntoView({ block: "start" })}
          />
        </fieldset>
      )}
      {recovery?.error && (
        <p className="error" role="alert">
          {t(recovery.error)}{" "}
          <button onClick={refreshTarget}>{t("重试")}</button>
        </p>
      )}
      {dir && (status || recovery?.canRestore) && (
        <div className="profile-diagnostics">
          <div className="profile-game-actions">
            <GraphicsActions draft={draft} status={status} changed={!!(base && draft && changedFields(base, draft).length)}
              busy={disabled} canRestore={!!recovery?.canRestore} undo={() => setDraft(dir, undefined)}
              apply={apply} restore={restore} />
          </div>
          {status?.diagnostics && <DiagnosticsPanel diagnostics={status.diagnostics} />}
        </div>
      )}
      {target && <div ref={modelSection}><ModelTable profileView models={target.models} profileSm={profile?.sm} gpuSm={status?.hardware?.gpu?.architecture?.sm || gpu?.architecture?.sm} profileName={profile ? profileName : undefined} message={message} onImport={onImportModel} onChoose={dir && draft ? id => {
          setDraft(dir, { ...draft, neuralModelId: id, neuralMode: id === "310.8.0-RTX40" ? "legacy" : "latest_compatible" });
          graphicsSection.current?.scrollIntoView({ block: "start" });
        } : undefined} onBrowseModels={onBrowseModels} onDownload={onDownloadModel} busy={disabled} /></div>}
    </div>
  );
}
