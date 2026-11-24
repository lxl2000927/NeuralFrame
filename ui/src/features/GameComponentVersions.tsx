import { ChevronRight } from "lucide-react";
import { Row, Select } from "../components";
import { t } from "../i18n";
import type { FileRow, Library } from "../types";

type Package = Library["packages"][number];

function fitsGame(pkg: Package, targetFiles: Set<string>, gpuSm?: string | null, nvidiaPresent?: boolean | null) {
  if (!pkg.present || !pkg.compatibility.ready) return false;
  if (pkg.component === "dlss-nr" && nvidiaPresent === false) return false;
  const architectures = pkg.modelRequirements?.architectures;
  if (gpuSm && architectures?.length && !architectures.includes(gpuSm)) return false;
  return pkg.files?.some(file => targetFiles.has(file.rel.toLowerCase() + "/" + file.bitness));
}

function versionOptions(packages: Package[]) {
  const options = packages.map(pkg => [pkg.id, pkg.source ? pkg.version + " · " + t(pkg.source) : pkg.version]);
  const labels = new Set<string>(), duplicates = new Set<string>();
  for (const [,label] of options) {
    if (labels.has(label)) duplicates.add(label);
    labels.add(label);
  }
  return options.sort((a,b) => b[1].localeCompare(a[1],undefined,{numeric:true}))
    .map(([id,label]) => [id,duplicates.has(label) ? label + " · " + id.slice(0,12) : label]);
}

export function GameComponentVersions({library, rows, selection, pending, combination, gpuSm, nvidiaPresent, busy,
  onChange, onConfigure, onBrowse, onPreview, onRollback}: {
  library: Library; rows: FileRow[]; selection: Record<string,string>; pending: Record<string,string>;
  combination: string[]; gpuSm?: string | null; nvidiaPresent?: boolean | null; busy: boolean;
  onChange: (pending: Record<string,string>) => void; onConfigure: () => void;
  onBrowse: () => void; onPreview: () => void; onRollback?: () => void;
}) {
  const saved = library.profile?.selected || {};
  const targets = rows.filter(row => row.present && row.selectionTarget && (row.bitness === 32 || row.bitness === 64));
  const targetFiles = new Set(targets.map(row => row.name.toLowerCase() + "/" + row.bitness));
  const eligible = library.packages.filter(pkg => fitsGame(pkg,targetFiles,gpuSm,nvidiaPresent));
  // A saved or drafted override must remain clearable after a game update or cache removal.
  const components = new Set([...eligible.map(pkg => pkg.component), ...Object.keys(saved), ...Object.keys(pending)]);
  const count = Object.keys(selection).length;
  const invalid = Object.entries(selection).some(([component,id]) => !eligible.some(pkg => pkg.component === component && pkg.id === id));
  function change(component: string, id: string) {
    const next = {...pending};
    if (id === (saved[component] || "")) delete next[component]; else next[component] = id;
    onChange(next);
  }
  return <section className="game-version-settings" aria-label={t("组件版本设置")}>
    <div className="game-combination">
      <div>
        <h2>{t("推荐组件组合")}</h2>
        {combination.length > 0 && <p className="combination-context">{combination.join(" · ")}</p>}
        <p className="muted">{t("在「画质与补帧」选择功能。预览时会列出缺少的组件，确认后下载并校验。")}</p>
      </div>
      <button type="button" disabled={busy} onClick={onConfigure}>{t("配置组合")}<ChevronRight size={14}/></button>
    </div>
    <details className="advanced game-version-overrides">
      <summary><ChevronRight size={16}/><span>{t("自定义组件版本")}</span>
        <small>{count ? t("已指定 {0} 项",[count]) : t("跟随推荐组合")}</small>
      </summary>
      <p className="muted">{t("可为当前游戏指定已入库的版本。改回「跟随推荐组合」后，下次应用配置时使用组合版本。需要立即还原磁盘文件时，请使用回滚。")}</p>
      {[...components].map(id => {
        const packages = eligible.filter(pkg => pkg.component === id);
        const value = selection[id] || "";
        const unavailable = value && !packages.some(pkg => pkg.id === value);
        const options = [["", t("跟随推荐组合")], ...versionOptions(packages)];
        if (unavailable) {
          const version = library.packages.find(pkg => pkg.id === value)?.version;
          options.push([value, version ? t("{0}（当前不可用）",[version]) : t("原指定版本已不可用")]);
        }
        const name = t(library.definitions[id]?.name || id);
        const filenames = new Set(packages.flatMap(pkg => (pkg.files || []).map(file => file.rel.toLowerCase())));
        const diskVersions = [...new Set(targets.filter(row => filenames.has(row.name.toLowerCase())).flatMap(row => row.version ? [row.version] : []))];
        const hint = unavailable ? t("文件或适用条件已变化，请重新选择。")
          : diskVersions.length ? t("磁盘版本") + " · " + diskVersions.join(" / ") : undefined;
        return <Row key={id} label={name} hint={hint}>
          <Select label={name} value={value} disabled={busy || options.length === 1} options={options} onChange={value => change(id,value)}/>
        </Row>;
      })}
      {!components.size && <p>{t("当前没有可单独替换的已入库版本。")}</p>}
      <div className="inline-actions">
        <button type="button" disabled={busy} onClick={onBrowse}>{t("打开组件库")}</button>
        {!!count && <button type="button" disabled={busy} onClick={() =>
          onChange(Object.fromEntries(Object.keys(saved).map(id => [id,""])))}>{t("全部跟随推荐")}</button>}
        <button type="button" className="primary" disabled={busy || invalid || (!count && !Object.keys(saved).length)}
          onClick={onPreview}>{t("预览版本变更")}</button>
        {onRollback && <button type="button" disabled={busy} onClick={onRollback}>{t("回滚上次组件更新")}</button>}
      </div>
    </details>
  </section>;
}
