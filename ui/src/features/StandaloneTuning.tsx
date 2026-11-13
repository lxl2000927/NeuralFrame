import { Select } from "../components";
import { t } from "../i18n";
import type { EngineInfo, MfgAdvanced } from "../types";

export function StandaloneTuning({value,engine,onChange,onReset,resetPending,enabled}: {
  value:MfgAdvanced;engine?:EngineInfo;onChange:(patch:MfgAdvanced)=>void;
  onReset:()=>void;resetPending:boolean;enabled:boolean;
}) {
  const fields:[keyof MfgAdvanced,string,number,number,number][] = [
    ["structure","结构强度",0,2,1],["tone","色调强度",0,2,1],["character","人物强度",-1,2,-1],
  ];
  return <details className="module-compat">
    <summary>{t("神经渲染高级参数")}</summary>
    <p className="footnote">{t("保留游戏内调整的外观参数。以下修改在预览并应用后写入，需重启游戏。")}</p>
    <div className="module-fields">
      <div className="module-field"><span>{t("神经渲染模型策略")}</span>
        <Select label={t("神经渲染模型策略")} value={String(value.model ?? 0)}
          options={[["0","Model A"],["1","Model B"],["2","Model C"]]} onChange={v=>onChange({model:Number(v)})}/></div>
      {fields.map(([key,label,min,max,fallback])=><label className="module-field" key={key}>
        <span>{t(label)}</span><input type="number" min={min} max={max} step={0.05} aria-label={t(label)}
          value={Number(value[key] ?? fallback)} onChange={e=>onChange({[key]:Number(e.target.value)})}/>
      </label>)}
      <label><input type="checkbox" checked={value.characterMask ?? true} onChange={e=>onChange({characterMask:e.target.checked})}/>{t("人物遮罩")}</label>
      <label><input type="checkbox" disabled={!engine?.capabilities?.diagnosticLogging} checked={value.diagnosticLogging ?? false}
        onChange={e=>onChange({diagnosticLogging:e.target.checked})}/>{t("插件诊断日志")}</label>
      {!engine?.capabilities?.diagnosticLogging && <p className="footnote">{t("插件诊断日志需要已适配的 MFG 1.7.1 或更高版本。")}</p>}
      <button disabled={!enabled || resetPending} onClick={onReset}>{t(resetPending ? "重置待应用" : "重置神经渲染调校")}</button>
      {resetPending && <p className="footnote">{t("应用时恢复当前硬件档位的神经渲染默认参数。")}</p>}
    </div>
  </details>;
}
