import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { t } from "../i18n";
import { getBridge } from "../bridge";
import { Select } from "../components";
import { errorText, size } from "../domain";
import type { Details, Status } from "../types";
import * as installRoutes from "../../../src/shared/install-routes.js";
import * as renderingApi from "../../../src/shared/rendering-api.js";

const routes: Record<string, string> = {
  native: "原生 DLSS（RenoDX）", feeder: "Feeder + ReShade",
  renodx: "RenoDX DLSS Tool", optiscaler: "OptiScaler DLSS-NR",
};
export type SetupSelection = { exePath: string; route: string };
export function resolveSetup(details: Details, selection: SetupSelection | null) {
  const exes = details.exes || [];
  const exe = exes.find(item => item.path === selection?.exePath) ||
    exes.find(item => item.rel === details.installedExe) ||
    exes.find(item => item.path === details.exePath) || exes[0];
  const target = exe ? renderingApi.effective(exe, exe.apiOverride || "auto") : null;
  const available: string[] = target ? installRoutes.routesFor(target) : [];
  const wanted = selection?.route || details.installedRoute || details.recommendedRoute || "";
  const route = available.includes(wanted) ? wanted : available.includes(details.recommendedRoute || "")
    ? details.recommendedRoute! : available[0] || "";
  return { exe, target, available, route };
}

export function GameSetup({ dir, details, status, busy, selection, onChange, message, onUpdated }: {
  dir: string; details: Details; status?: Status; busy: boolean;
  selection: SetupSelection | null; onChange: (selection: SetupSelection) => void;
  message: (s: string) => void; onUpdated: () => void;
}) {
  const { exe, target, available, route } = resolveSetup(details, selection);
  const protectedGame = details.launcherProtected || status?.launcherProtected;
  const [saving, setSaving] = useState(false);
  const [builds, setBuilds] = useState<{ builds: { version: string; label: string }[]; current: string } | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (route !== "optiscaler" || protectedGame) return;
    let alive = true;
    getBridge().optiscalerBuilds(dir).then(result => { if (alive) setBuilds(result); })
      .catch(e => { if (alive) message(errorText(e)); });
    return () => { alive = false; };
  }, [dir, route, protectedGame]);
  const save = async (fn: () => Promise<void>) => {
    if (lock.current || busy) return;
    lock.current = true; setSaving(true);
    try { await fn(); onUpdated(); } catch (e) { message(errorText(e)); }
    finally { lock.current = false; setSaving(false); }
  };
  const chooseRoute = (value: string) => { if (exe) onChange({ exePath: exe.path, route: value }); };
  const reshadeRoutes = available.filter(id => id !== "optiscaler");
  const backend = protectedGame ? "native" : route === "optiscaler" ? "optiscaler" : "reshade";
  const currentVersion = protectedGame ? status?.nativeRuntimeStack?.sr?.version || details.currentDlss?.version : details.currentDlss?.version;
  const installedBackend = details.installedRoute === "wuwa-proxy" ? "version.dll"
    : details.optiscaler?.installed ? "OptiScaler"
    : details.reshade?.installed ? "ReShade" : t("无");
  const files = details.files || [];
  return <section className="settings-section game-setup" aria-label={t("安装与运行环境")}>
    <h2>{t("安装与运行环境")}</h2>
    <fieldset disabled={busy || saving}>
      <div className="setup-fields">
        <label className="setup-field setup-wide"><span>{t("可执行文件")}</span>
          <Select label={t("可执行文件")} value={exe?.path || ""} disabled={!exe || protectedGame}
            onChange={exePath => onChange({ exePath, route })}
            options={(details.exes || []).map(item => [item.path,
              `${item.rel} — ${item.apiLabel} — ${item.bitness}-bit — ${size(item.size)}`])} />
        </label>
        <label className="setup-field setup-wide"><span>{t("渲染 API")}</span>
          <Select label={t("渲染 API")} value={exe?.apiOverride || "auto"} disabled={!exe}
            options={[["auto", t("自动（检测到：{0}）", [exe?.apiLabel || t("未知")])], ...renderingApi.choices.map(item => [item.value, item.label])]}
            onChange={value => void save(async () => {
              if (!exe) return;
              const result = await getBridge().setApiOverride(dir, exe.path, value);
              if (!result.ok) throw Error(result.message || result.code || t("保存失败"));
            })} />
        </label>
        <label className="setup-field"><span>{t("渲染后端")}</span>
          <Select label={t("渲染后端")} value={backend} disabled={!available.length || protectedGame}
            options={protectedGame ? [["native", t("游戏原生运行库")]] : [
              ...(reshadeRoutes.length ? [["reshade", t("ReShade（默认）")]] : []),
              ...(available.includes("optiscaler") ? [["optiscaler", "OptiScaler"]] : []),
            ]}
            onChange={value => chooseRoute(value === "optiscaler" ? value : reshadeRoutes[0])} />
        </label>
        <label className="setup-field"><span>{t("安装方式")}</span>
          <Select label={t("安装方式")} value={protectedGame ? "wuwa-proxy" : route}
            disabled={!available.length || protectedGame}
            options={protectedGame ? [["wuwa-proxy", t("鸣潮兼容路线（version.dll）")]]
              : (backend === "optiscaler" ? ["optiscaler"] : reshadeRoutes).map(id => [id, t(routes[id])])}
            onChange={chooseRoute} />
        </label>
        {!protectedGame && route !== "optiscaler" && target && ["dxgi", "d3d8", "d3d9", "ddraw"].includes(target.api) && target.apiLabel !== "DirectX 12" &&
          <label className="setup-field setup-wide"><span>{t("ReShade 加载文件")}</span>
            <Select label={t("ReShade 加载文件")} value={exe?.reshadeProxy || "dxgi"} options={[["dxgi", "dxgi.dll"], ["d3d11", "d3d11.dll"]]}
              onChange={value => void save(async () => {
                if (!exe) return;
                const result = await getBridge().setReshadeProxy(dir, exe.path, value);
                if (!result.ok) throw Error(result.message || result.code || t("保存失败"));
              })} />
          </label>}
        {!protectedGame && route === "optiscaler" &&
          <label className="setup-field setup-wide"><span>{t("OptiScaler 构建版本")}</span>
            <Select label={t("OptiScaler 构建版本")} value={builds?.current || ""} disabled={!builds}
              options={(builds?.builds || []).map(item => [item.version, item.label])}
              onChange={value => void save(async () => {
                const current = await getBridge().setOptiscalerBuild(dir, value);
                if (!current) throw Error(t("保存失败"));
                setBuilds(previous => previous ? { ...previous, current } : previous);
              })} />
          </label>}
      </div>
    </fieldset>
    <dl className="setup-status">
      <div><dt>{t("架构")}</dt><dd>{exe?.bitness ? `${exe.bitness}-bit` : t("未知")}</dd></div>
      <div><dt>{t("渲染 API")}</dt><dd className="setup-positive">{target?.apiLabel || t("未知")}</dd></div>
      <div><dt>{t("已安装的后端")}</dt><dd>{installedBackend}</dd></div>
      <div><dt>DLSS</dt><dd>{currentVersion || t("未检测到")}
        {protectedGame ? <span className="setup-version-note">{t("保留游戏原版")}</span>
          : details.newDlss && details.newDlss !== currentVersion && selection && route !== "optiscaler"
            ? <><span className="setup-version-arrow">→</span><span className="setup-positive">{details.newDlss}</span></> : null}</dd></div>
      <div><dt>{t("神经渲染插件")}</dt><dd>{details.addon || status?.neural?.installed ? t("已安装") : t("未安装")}</dd></div>
      <div><dt>ReShade</dt><dd>{details.reshade?.installed ? details.reshade.version || t("已安装") : t("未安装")}</dd></div>
    </dl>
    <details className="setup-files" open>
      <summary><span>{t("检测到的组件文件")}</span><span>{t("{0} 个", [files.length])}</span><ChevronDown size={15} /></summary>
      <div className="setup-file-list">
        {files.length ? files.map(file => <div className="setup-file" key={file.rel}>
          <code>{file.rel}</code><span>{file.version || "—"}</span>
        </div>) : <p className="setup-empty">{t("未检测到组件文件")}</p>}
      </div>
    </details>
    {!available.length && <p className="error">{t("当前 API 或程序位数没有可用路线，可核对程序或手动指定 API。")}</p>}
    {exe?.installIssue && <p className="error">{t(exe.installIssue)}</p>}
  </section>;
}
