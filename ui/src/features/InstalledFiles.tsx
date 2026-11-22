import { Fragment, useState } from "react";
import { getBridge } from "../bridge";
import { t } from "../i18n";
import { errorText } from "../domain";
import type { FileRow, Library } from "../types";

function status(row: FileRow) {
  if (!row.present) return t("文件缺失");
  if (row.lockState === "drift") return t("偏离锁定");
  if (row.featureMismatch) return t("组件身份与文件名不符");
  return t("已安装");
}

export function InstalledFiles({dir, rows, packages, selection, message}: {
  dir: string; rows: FileRow[]; packages: Library["packages"]; selection: Record<string, string>;
  message: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const selectedFiles = new Map<string, NonNullable<Library["packages"][number]["files"]>[number]>();
  const selectedNames = new Set<string>();
  for (const pkg of packages) {
    if (pkg.id !== selection[pkg.component] || !pkg.present || !pkg.compatibility.ready) continue;
    for (const file of pkg.files || []) {
      selectedFiles.set(file.rel.toLowerCase() + "/" + file.bitness, file);
      selectedNames.add(file.rel.toLowerCase());
    }
  }
  const groups = new Map<string, FileRow[]>();
  for (const row of rows) {
    const name = row.name.toLowerCase(), group = groups.get(name);
    if (group) group.push(row);
    else groups.set(name, [row]);
  }
  function target(row: FileRow) {
    const selected = row.present && row.selectionTarget && selectedFiles.get(row.name.toLowerCase() + "/" + row.bitness);
    if (selected) {
      if (selected.version && selected.version === row.version && row.sha256 && selected.sha256 !== row.sha256)
        return t("{0}（文件不同，SHA-256 {1}）", [selected.version, selected.sha256.slice(0, 12)]);
      return selected.version || "SHA-256 " + selected.sha256.slice(0, 12);
    }
    if (row.present && row.selectionTarget && selectedNames.has(row.name.toLowerCase())) return t("所选文件位数不匹配");
    if (row.routeSha256) {
      const value = row.routeSha256 === row.sha256 && row.version || "SHA-256 " + row.routeSha256.slice(0, 12);
      return t("{0}（安装记录）", [value]);
    }
    if (row.recordedVersion) return t("{0}（安装记录）", [row.recordedVersion]);
    return t("未选择替换");
  }
  async function openFolder(row: FileRow) {
    try {
      const result = await getBridge().openComponentFolder(dir, row.rel, row.scope || "game");
      if (!result.ok) message(t(result.message || "无法打开文件夹"));
    } catch (error) { message(errorText(error)); }
  }
  function location(row: FileRow) {
    return <>
      <p className="path">{row.rel}</p>
      <p>{t(row.source)}</p>
      {row.sha256 && <p><code className="path">{row.sha256}</code></p>}
      {row.present && <button type="button" onClick={() => void openFolder(row)}>{t("打开所在文件夹")}</button>}
    </>;
  }
  function toggle(name: string) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  const onDisk = (row: FileRow) => row.version || t(row.present ? "无版本信息" : "文件缺失");
  const summarize = (group: FileRow[], read: (row: FileRow) => string) => [...new Set(group.map(read))].join(" / ");
  return <div className="table-wrap"><table>
    <thead><tr><th>{t("组件 / 文件")}</th><th>{t("磁盘版本")}</th><th>{t("目标版本")}</th><th>{t("状态")}</th></tr></thead>
    <tbody>{Array.from(groups, ([name, group]) => {
      const row = group[0], multiple = group.length > 1;
      return <Fragment key={name}><tr>
        <td><strong>{t(row.name)}</strong>
          {multiple
            ? <div><button type="button" aria-expanded={expanded.has(name)} onClick={() => toggle(name)}>{t("{0} 个文件位置", [group.length])}</button></div>
            : <details><summary>{t("路径与来源")}</summary>{location(row)}</details>}
        </td>
        <td>{summarize(group, onDisk)}</td><td>{summarize(group, target)}</td><td>{summarize(group, status)}</td>
      </tr>{multiple && expanded.has(name) && group.map(copy =>
        <tr key={copy.rel}><td>{location(copy)}</td><td>{onDisk(copy)}</td><td>{target(copy)}</td><td>{status(copy)}</td></tr>
      )}</Fragment>;
    })}</tbody>
  </table></div>;
}
