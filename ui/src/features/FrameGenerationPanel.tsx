import type { ReactNode } from "react";
import { Select } from "../components";
import { frameRouteLabels } from "../domain";
import { t } from "../i18n";
import type { GraphicsRouteStatus } from "../types";

export function FrameSettingsReadout({ installed }: { installed: GraphicsRouteStatus }) {
  const flag = (value?:boolean|null) => t(value == null ? "未记录" : value ? "开启" : "关闭");
  const optiFg = installed.route === "optifg";
  return <dl className="module-facts">
    <div><dt>{t(optiFg ? "已识别宿主" : "已部署的补帧插件")}</dt><dd>{optiFg ? "OptiScaler" : "MFG Unlocker"} · {installed.providerVersion || t("版本待核验")}</dd></div>
    {optiFg ? <>
      <div><dt>{t("已保存的 OptiFG 开关")}</dt><dd>{flag(installed.enabled)}</dd></div>
      <div><dt>{t("补帧设置")}</dt><dd>{t("OptiScaler 游戏内菜单")}</dd></div>
    </> : installed.route === "xemfg-optiscaler" ? <div><dt>{t("倍率设置")}</dt><dd>{t("OptiScaler 游戏内菜单")}</dd></div> : <>
      <div><dt>{t("已保存的 XeMFG 开关")}</dt><dd>{flag(installed.enabled)}</dd></div>
      <div><dt>{t("已保存的动态补帧")}</dt><dd>{flag(installed.dynamic)}</dd></div>
      <div><dt>{t("已保存的固定倍率")}</dt><dd>{installed.multiplier ? installed.multiplier + "×" : t("未记录")}</dd></div>
    </>}
    <div><dt>{t("目标程序")}</dt><dd className="path">{installed.exePath}</dd></div>
  </dl>;
}

const inputNames:Record<string,string> = {dlss:"DLSS",xess:"XeSS",ffx:"FidelityFX",fsr2:"FSR 2",fsr3:"FSR 3"};

export function FrameGenerationPanel({ installed, route, engineChoice, controls, optiFgInputs, draftMultiplier, blocked, issue, vulkan, nativeMode, change, apply }: {
  installed?:GraphicsRouteStatus; engineChoice:ReactNode; draftMultiplier?:number; blocked:boolean;
  optiFgInputs?:string[]; controls?:ReactNode; nativeMode?:"auto"|"compatibility";
  issue?:string|null; vulkan:boolean; route:keyof typeof frameRouteLabels; change:(multiplier:number)=>void; apply:()=>void;
}) {
  const multiplier = draftMultiplier ?? installed?.multiplier ?? 2;
  const title = t(frameRouteLabels[route]);
  const optiFg = route === "optifg";
  const detectedInputs = optiFgInputs?.map(id=>inputNames[id]).filter(Boolean).join(" / ");
  const badge = optiFg
    ? installed ? installed.filesPresent && !installed.error ? "已配置 · 待游戏内验证" : "宿主配置或配套文件需检查" : "尚未配置"
    : installed ? installed.filesPresent ? "已部署 · 待运行验证" : "配套文件缺失 · 可重新应用" : "尚未部署";
  return <section className="graphics-module frame-generation-panel" data-module="mfg" aria-label={title}>
    <header className="module-heading">
      <div><span className="module-eyebrow">{optiFg ? "OptiScaler · AMD FidelityFX" : "MFG Unlocker · Intel XeFG"}</span><h2>{title}</h2></div>
      <span className="module-badge">{t(badge)}</span>
    </header>
    {engineChoice}
    {installed && <FrameSettingsReadout installed={installed}/>}
    {issue && <p className="error" role="alert">{t(issue)}</p>}
    {installed?.error && <p className="error" role="alert">{t(installed.error)}</p>}
    <div className="module-fields">
      {optiFg ? <>
        <p className="module-note">{t("使用游戏已有的 OptiScaler 和 AMD FSR 帧生成运行库。首次应用会在 OptiScaler.ini 中启用帧生成，选择 Upscaler 输入和 FSR FG 输出。")}</p>
        <p className="footnote">{t("应用时会关闭宿主已启用的 DLSS 神经渲染，并将自动或 DLSS 超分后端切换为 FidelityFX。")}</p>
        {detectedInputs && <p className="footnote">{t("可识别的游戏超分输入 · {0}",[detectedInputs])}</p>}
        <p className="footnote">{t("在游戏中开启宿主可读取的时间超分，例如已识别的 FSR 2 或 FSR 3。重启后打开 OptiScaler 菜单（默认 Insert），查看 Frame Gen、FG Active 和 HUD Fix。")}</p>
        {optiFgInputs?.length === 1 && optiFgInputs[0] === "dlss" && <p className="footnote">{t("游戏需要允许当前显卡开启 DLSS 超分，部分游戏仅向 NVIDIA 显卡提供此选项。")}</p>}
      </> : route === "xemfg-optiscaler" ? <>
        <p className="module-note">{t("使用游戏目录中已识别的 OptiScaler 10 宿主，安装时会选择 Upscaler 输入和 XeFG 输出。重启游戏后，在 OptiScaler 菜单中设置补帧倍率。")}</p>
        <p className="footnote">{t("先在游戏中启用可用的超分输入。AMD 显卡可优先尝试游戏提供的 XeSS 或 FSR 3.1 及更新版超分。")}</p>
      </> : <>
      <label className="setup-field"><span>{t("XeMFG 固定倍率")}</span>
        <Select label={t("XeMFG 固定倍率")} value={String(multiplier)}
          options={[2,3,4,5,6].map(n=>[String(n),n+"×"])} onChange={v=>change(Number(v))}/>
      </label>
      {installed && (installed.dynamic || installed.enabled === false) && draftMultiplier == null &&
        <button onClick={()=>change(multiplier)}>{t("切换为固定 {0}×", [multiplier])}</button>}
      {draftMultiplier != null && <p className="footnote">{t("应用后会启用 XeMFG，并使用所选固定倍率。")}</p>}
      {nativeMode ? <p className="module-note">{t(nativeMode === "auto"
        ? "在游戏设置中切换 DLSS 帧生成，可以启停所选固定倍率的 XeMFG。"
        : "兼容模式通过交换链输出 XeMFG，可在游戏开关无法启用补帧时使用。")}</p> :
        <p className="module-note">{t(vulkan
          ? "Vulkan 下需在游戏中启用原生 DLSS 超分或光线重建。部分游戏在 AMD 显卡上不提供这些选项。"
          : "在游戏中启用受支持的输入。AMD 显卡优先选择 XeSS 或 FSR 3.1 及更新版超分；有些游戏仅向 NVIDIA 显卡开放 DLSS。")}</p>}
      <p className="footnote">{t("关闭游戏自带的 FSR 或 XeFG 帧生成。重启后按 Backspace，在 XeMFG 菜单查看输入和运行状态。独立版需要游戏能加载 version.dll。")}</p>
      </>}
      {controls}
    </div>
    <div className="module-actions"><button className="module-command" disabled={blocked} onClick={apply}>{t("预览帧生成设置")}</button></div>
  </section>;
}
