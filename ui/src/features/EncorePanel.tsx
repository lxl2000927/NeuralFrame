import { Select } from "../components";
import { t } from "../i18n";
import { modelArchitectureLimit } from "../domain";
import type { ReactNode } from "react";
import type { EncoreSettings, Status, EngineInfo } from "../types";

export const defaultEncore: EncoreSettings = {mfgMode:"off",neuralMode:"off",neuralModelId:"310.8.SF-v2",
  upscaling:"off",motion:"game",nrResolution:"custom",nrScale:75,nrPasses:1};

export function encoreSettingsIssue(value:EncoreSettings,status:Status,hasNativeDlss?:boolean,engine?:EngineInfo,baseline?:EncoreSettings):string | null {
  if (hasNativeDlss && value.upscaling !== 'off') return "游戏已有原生 DLSS，请先关闭附加超分。";
  if (!['off','dlss'].includes(value.upscaling) || !['off','x2','x3','x4','x5','x6'].includes(value.mfgMode))
    return "当前配置使用了未适配的引擎或补帧模式，请重新选择。";
  if (!['game','encore','shader','quality','fast'].includes(value.motion)) return "Encore 参数包含尚未适配的值，请重新选择。";
  if (engine?.compatible === false) return "所选引擎尚未适配，请选择已适配版本。";
  const switchingEngine = !!status.encore?.installed && !!engine?.version && status.encore.version !== engine.version;
  const scaleChanged = value.dlssRenderScale !== baseline?.dlssRenderScale || value.dlssCustomScale !== baseline?.dlssCustomScale;
  if ((scaleChanged || switchingEngine) && value.dlssRenderScale === 'custom' && (!Number.isInteger(value.dlssCustomScale) ||
      Number(value.dlssCustomScale) < (engine?.capabilities?.dlssCustomScaleMin || 50) || Number(value.dlssCustomScale) > 100))
    return "DLSS 自定义比例超出所选引擎支持范围。";
  for (const key of ['nrPass1Placement','nrPass2Placement','nrPass3Placement','nrPass4Placement'] as const) {
    const changed = value[key] !== undefined && value[key] !== baseline?.[key];
    if (value[key] !== undefined && (changed || switchingEngine && value.neuralMode !== 'off') &&
        ((!engine?.capabilities?.nrPassPlacement && (changed || value[key] !== 'inherit')) || !['inherit','before-sr','after-sr','present'].includes(value[key]!)))
      return "所选引擎不支持此逐遍处理位置，请调整设置或选择新版引擎。";
  }
  if (value.neuralMode !== 'off') {
    if (!['legacy','latest_compatible'].includes(value.neuralMode) || !Number.isInteger(value.nrPasses) || value.nrPasses < 1 || value.nrPasses > 4 ||
        !['render','output','quality','balanced','performance','ultra-performance','custom'].includes(value.nrResolution))
      return "Encore 参数包含尚未适配的值，请重新选择。";
    if (!Number.isInteger(value.nrScale) || value.nrScale < 33 || value.nrScale > 100)
      return "NR 分辨率比例必须是 33–100 之间的整数。";
    const model = status.neural?.availableModels?.find(item=>item.id===value.neuralModelId);
    if (model?.version && !/^310\.(?:8\.0|9\.16)(?:\.0)?$/.test(model.version)) return "此模型版本尚未适配 Encore，请重新选择。";
    if (model && modelArchitectureLimit(model,status.hardware?.gpu?.architecture?.sm)) return "此模型与本机显卡架构不匹配，请重新选择。";
  }
  return null;
}

export function EncorePanel({value,status,hasNativeDlss,issue,onChange,onModels,onApply,engine,engineControl}: {
  value:EncoreSettings;status:Status;hasNativeDlss?:boolean;issue?:string | null;onChange:(value:EncoreSettings)=>void;onModels:()=>void;onApply:()=>void;
  engine?:EngineInfo;engineControl?:ReactNode;
}) {
  const change = (patch:Partial<EncoreSettings>) => onChange({...value,...patch});
  const models = status.neural?.availableModels || [];
  const mfgModes = [["off",t("关闭")],...[2,3,4,5,6].map(n=>["x"+n,n+"×"+(n>4?" · "+t("实验性"):"")])];
  if (!mfgModes.some(([id])=>id===value.mfgMode)) mfgModes.push([value.mfgMode,t("游戏内使用了其他模式，请重新选择")]);
  return <div>
    <p className="footnote">{t("Encore 首批适配没有原生帧生成的游戏。参数写入后需重启游戏，Insert 打开游戏内面板。")}</p>
    {issue && <p className="error" role="alert">{t(issue)}</p>}
    <div className="graphics-modules">
      <section className="graphics-module" aria-label={t("Encore 帧生成配置")}>
        <header className="module-heading"><div><span className="module-eyebrow">RTX Encore {engine?.version || status.encore?.version || ''}</span><h2>{t("新增帧生成")}</h2></div>
          <span className="module-badge">{t(status.encore?.installed ? status.encore.filesPresent ? "已部署 · 待运行验证" : "配套文件缺失 · 可重新应用" : "尚未部署")}</span></header>
        <div className="module-fields">
          {engineControl}
          <div className="module-field"><span>{t("DLSS 帧生成倍率")}</span>
            <Select label={t("DLSS 帧生成倍率")} value={value.mfgMode} options={mfgModes} onChange={mfgMode=>change({mfgMode})}/></div>
          <div className="module-field"><span>{t("运动估计来源")}</span>
            <Select label={t("运动估计来源")} value={value.motion} onChange={motion=>change({motion})} options={[
              ["game",t("优先游戏运动矢量，缺失时估计")],["encore","RTX Encore"],["shader","Shader (vort)"],
              ["quality","Optical Flow · "+t("质量")],["fast","Optical Flow · "+t("速度")]]}/></div>
          <p className="footnote">{t("使用配套 Streamline 2.14.16 / DLSS-G 310.9.16；原生帧生成和未知文件不会被覆盖。")}</p>
          <p className="footnote">{t("新增帧生成属于实验性功能；HUD 可能参与插帧，倍率选择不代表实际输出倍率。")}</p>
        </div>
      </section>
      <section className="graphics-module" aria-label={t("Encore 图像配置")}>
        <header className="module-heading"><div><span className="module-eyebrow">RTX Encore · NR / SR</span><h2>{t("图像处理")}</h2></div></header>
        <div className="module-fields">
          <div className="module-field"><span>{t("附加 DLSS 超分")}</span>
            <Select label={t("附加 DLSS 超分")} value={value.upscaling} disabled={hasNativeDlss && value.upscaling === 'off'}
              options={[["off",t("关闭（保留游戏设置）")],...(!hasNativeDlss ? [["dlss",t("启用（游戏分辨率 / DLAA）")]] : [])]} onChange={upscaling=>change({upscaling})}/></div>
          {hasNativeDlss && <p className="footnote">{t("游戏已有原生 DLSS 超分，请在游戏中设置。")}</p>}
          {hasNativeDlss && <>
            <div className="module-field"><span>{t("原生 DLSS 超分比例")}</span>
              <Select label={t("原生 DLSS 超分比例")} value={value.dlssRenderScale || 'game'} onChange={dlssRenderScale=>change({dlssRenderScale,
                ...(dlssRenderScale === 'custom' && value.dlssCustomScale == null ? {dlssCustomScale:67} : {})})}
                options={[["game",t("跟随游戏")],["dlaa","DLAA"],["ultra",t("极高质量")],["quality",t("质量")],
                  ["balanced",t("平衡")],["performance",t("性能")],["ultra-performance",t("超高性能")],["custom",t("自定义")]]}/>
            </div>
            {value.dlssRenderScale === 'custom' && <label className="module-field"><span>{t("DLSS 自定义比例（{0}–100%）",[engine?.capabilities?.dlssCustomScaleMin || 50])}</span>
              <input aria-label={t("DLSS 自定义比例")} type="number" min={engine?.capabilities?.dlssCustomScaleMin || 50} max={100} step={1}
                value={value.dlssCustomScale ?? 67} onChange={e=>change({dlssCustomScale:Number(e.target.value)})}/></label>}
          </>}
          <div className="module-field"><span>{t("神经渲染")}</span>
            <Select label={t("Encore 神经渲染")} value={value.neuralMode === "legacy" ? "latest_compatible" : value.neuralMode}
              options={[["off",t("关闭")],["latest_compatible",t("启用")]]} onChange={neuralMode=>change({neuralMode})}/></div>
          {value.neuralMode !== "off" && <>
            <div className="module-field"><span>{t("神经渲染模型")}</span>
              <Select label={t("神经渲染模型")} value={value.neuralModelId} options={models.length
                ? models.map(m=>[m.id,[m.name || m.id,
                  m.version && !/^310\.(?:8\.0|9\.16)(?:\.0)?$/.test(m.version) ? t("Encore 版本未适配") : modelArchitectureLimit(m,status.hardware?.gpu?.architecture?.sm) ? t("本机显卡不支持") : '',
                  t(m.availableOnDisk ? "已入库" : m.downloadable ? "按需下载" : "未导入")].filter(Boolean).join(' · ')]) : [[value.neuralModelId,value.neuralModelId]]}
                onChange={neuralModelId=>change({neuralModelId})}/></div>
            <button onClick={onModels}>{t("从模型库选择")}</button>
            <div className="module-field"><span>{t("NR 工作分辨率")}</span>
              <Select label={t("NR 工作分辨率")} value={value.nrResolution} onChange={nrResolution=>change({nrResolution})} options={[
                ["render",t("跟随渲染分辨率")],["output",t("输出分辨率")],["quality",t("质量")],["balanced",t("平衡")],
                ["performance",t("性能")],["ultra-performance",t("超高性能")],["custom",t("自定义")]]}/></div>
            {value.nrResolution === "custom" && <label className="module-field"><span>{t("NR 分辨率比例（33–100%）")}</span>
              <input type="number" min={33} max={100} step={1} value={value.nrScale} onChange={e=>change({nrScale:Number(e.target.value)})}/></label>}
            <div className="module-field"><span>{t("NR 处理次数")}</span>
              <Select label={t("NR 处理次数")} value={String(value.nrPasses)} options={[1,2,3,4].map(n=>[String(n),String(n)])}
                onChange={v=>change({nrPasses:Number(v)})}/></div>
            <details className="module-compat"><summary>{t("逐遍处理位置")}</summary>
              {!engine?.capabilities?.nrPassPlacement && <p className="footnote">{t("需要已适配的 Encore 2.4.1 或更高版本；现有配置值保持不变。")}</p>}
              {([1,2,3,4] as const).slice(0,value.nrPasses).map(n=>{
                const key = `nrPass${n}Placement` as 'nrPass1Placement';
                const options = [["inherit",t("跟随全局")],["before-sr",t("超分前（实验性）")],["after-sr",t("超分后")],["present",t("最终画面")]];
                if (value[key] && !options.some(([id])=>id===value[key])) options.push([value[key]!,t("游戏内自定义值（保留）")]);
                return <div className="module-field" key={n}><span>{t("第 {0} 遍",[n])}</span>
                  <Select label={t("第 {0} 遍处理位置",[n])} value={value[key] || 'inherit'} disabled={!engine?.capabilities?.nrPassPlacement}
                    options={options} onChange={v=>change({[key]:v})}/></div>;
              })}
              <p className="footnote">{t("混合处理位置需要兼容的原生 DLSS；超分前路径不支持 RR / DLAA。设置仍需在游戏中验证，修改后重启游戏。")}</p>
            </details>
          </>}
          <p className="footnote">{t("保留游戏内设置的处理顺序、曝光、风格、菜单和其他参数。模型仍需通过指纹与显卡架构检查。")}</p>
        </div>
        <div className="module-actions"><button className="module-command" disabled={!!issue} onClick={onApply}>{t("预览并应用 Encore 配置")}</button></div>
      </section>
    </div>
  </div>;
}
