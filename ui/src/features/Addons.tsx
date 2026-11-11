import { t } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { getBridge } from "../bridge";
import { Empty, Loading, Modal } from "../components";
import { errorText, size } from "../domain";
import type { AddonPick, AddonRow } from "../types";

export function Addons({
  message,
  active = true,
  refreshToken = 0,
}: {
  message: (s: string) => void;
  active?: boolean;
  refreshToken?: number;
}) {
  const [rows, setRows] = useState<AddonRow[] | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<AddonPick | null>(null);
  const [name, setName] = useState(""),
    [tag, setTag] = useState(""),
    [description, setDescription] = useState(""),
    [saveError, setSaveError] = useState("");
  const locked = useRef(false),
    generation = useRef(0);
  const load = useCallback(async () => {
    const revision = ++generation.current;
    try {
      const entries = await getBridge().addons();
      if (revision === generation.current) {
        setRows(entries);
        setError("");
      }
    } catch (e) {
      if (revision === generation.current) setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    if (active) void load();
    return () => {
      ++generation.current;
    };
  }, [active, load, refreshToken]);
  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      message(errorText(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="page-scroll">
      <div className="section-toolbar">
        <h2>{t("组件文件")}{rows && <small className="section-count">{rows.length}</small>}</h2>
        <div className="inline-actions">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const picked = await getBridge().addonPick();
                if (!picked) return;
                if ("error" in picked) throw Error(picked.error);
                setPending(picked);
                setName(picked.suggestedName || "");
                setTag("");
                setDescription("");
                setSaveError("");
              })
            }
          >
            <Plus size={16} />
            {t("添加组件文件…")}
          </button>

        </div>
      </div>
      <p className="muted">
        {t(
          "附加组件是可切换的单文件构建（.addon / .addon64），与组件库中的运行库分开管理。同一时间只能启用一个同名文件。",
        )}
      </p>
      <p className="muted">
        {t("下次通过 64 位「原生 DLSS + ReShade」路线安装时，将附带已启用的组件。")}
      </p>
      {error && (
        <p className="error" role="alert">
          {t(error)} <button onClick={() => void load()}>{t("重试")}</button>
        </p>
      )}
      {!rows ? (
        !error && <Loading text={t("读取附加组件…")} skeleton="rows" />
      ) : rows.length ? (
        <div className="addon-list">
          {rows.map((row) => (
            <article className="addon-entry" key={row.path}>
              <div className="addon-info">
                <strong>{row.label}</strong>
                <p className="muted path" title={row.path}>
                  {row.missing ? row.path : <>{row.file} · {row.version || t("无版本信息")} · {size(row.size ?? 0)}</>}
                </p>
                {row.missing && <small className="addon-tag error">{t("源文件缺失")}</small>}
                {row.replaces && <small>{t("替换同名内置插件")}</small>}
                {row.warn && <span className="addon-tag">{row.custom ? row.warn : t(row.warn)}</span>}
                {row.caution && <p className="error">{t(row.caution)}</p>}
                {!!row.notes?.length && (
                  <details>
                    <summary>{t("组件说明与提示")}</summary>
                    <ul>
                      {row.notes.map((note, i) => (
                        <li key={i}>{row.custom ? note : t(note)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="inline-actions">
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={t("启用 {0}", [row.label])}
                    checked={row.active}
                    disabled={busy || (row.missing && !row.active)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      void run(async () => {
                        const result = await getBridge().addonToggle(
                          row.path,
                          on,
                        );
                        if (!result.ok)
                          throw Error(result.message || t("操作未完成"));
                        await load();
                        if (result.replaced)
                          message(
                            t("已替换同名启用项：{0}", [result.replaced]),
                          );
                      });
                    }}
                  />
                  {t("启用")}
                </label>
                {row.custom && (
                  <button
                    className="icon-button danger"
                    aria-label={t("移除 {0}", [row.label])}
                    title={t("从列表移除")}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!(await getBridge().addonRemove(row.path)))
                          throw Error(t("操作未完成"));
                        await load();
                        message(t("已移除"));
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </article>
          ))}
          <p className="footnote">
            {t(
              "已启用 {0} 个。组件是否真正生效取决于游戏安装路线，请在运行诊断中确认。",
              [rows.filter((row) => row.active && !row.missing).length],
            )}
          </p>
        </div>
      ) : (
        <Empty>{t("还没有附加组件。可添加 .addon 或 .addon64 文件。")}</Empty>
      )}
      {pending && (
        <Modal
          title={t("添加附加组件")}
          onClose={() => {
            if (!busy) setPending(null);
          }}
          footer={
            <>
              <button disabled={busy} onClick={() => setPending(null)}>
                {t("取消")}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setSaveError("");
                    try {
                      if (
                        !(await getBridge().addonSave({
                          path: pending.path,
                          name,
                          description,
                          tag,
                        }))
                      )
                        throw Error(t("保存失败"));
                      setPending(null);
                      await load();
                      message(t("已添加组件文件"));
                    } catch (e) {
                      setSaveError(errorText(e));
                    }
                  })
                }
              >
                {t("保存")}
              </button>
            </>
          }
        >
          <p className="path">{pending.path}</p>
          <p className="muted">
            {pending.version || t("无版本信息")} · {size(pending.size)}
          </p>
          <div className="form-stack">
            <label>
              {t("组件名称")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              {t("标签（可选）")}
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              {t("说明（每行一条）")}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                disabled={busy}
              />
            </label>
          </div>
          <p className="muted">
            {t(
              "保存后加入列表，启用状态需要单独选择。移除列表项不会删除原始文件。",
            )}
          </p>
          {saveError && (
            <p className="error" role="alert">
              {t(saveError)}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
