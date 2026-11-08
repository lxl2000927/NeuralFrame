import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { getBridge } from "../bridge";
import { Row, Select } from "../components";
import { errorText } from "../domain";
import type { Details } from "../types";
import type { Run } from "./Games";
// Use the installer's policy instead of maintaining a second route matrix.
import * as installRoutes from "../../../src/shared/install-routes.js";
import * as renderingApi from "../../../src/shared/rendering-api.js";
const policy = { installRoutes, renderingApi };
const routes: Record<string, string> = {
  native: "原生 DLSS + ReShade",
  feeder: "Feeder + ReShade",
  renodx: "RenoDX DLSS Tool",
  optiscaler: "OptiScaler DLSS-NR",
};

export function GameSetup({
  dir,
  details,
  busy,
  run,
  message,
  onUpdated,
}: {
  dir: string;
  details: Details;
  busy: boolean;
  run: Run;
  message: (s: string) => void;
  onUpdated: () => void;
}) {
  const exes = details.exes || [];
  const [exePath, setExePath] = useState(
      exes.find((item) => item.rel === details.installedExe)?.path ||
        details.exePath ||
        "",
    ),
    [route, setRoute] = useState(
      details.installedRoute || details.recommendedRoute || "",
    );
  const [saving, setSaving] = useState(false),
    [builds, setBuilds] = useState<{
      builds: { version: string; label: string }[];
      current: string;
    } | null>(null);
  const lock = useRef(false);
  const exe = exes.find((item) => item.path === exePath) || exes[0];
  const target = exe
    ? policy.renderingApi.effective(exe, exe.apiOverride || "auto")
    : null;
  const available = target ? policy.installRoutes.routesFor(target) : [];
  const selectedRoute = available.includes(route)
    ? route
    : available.includes(details.recommendedRoute || "")
      ? details.recommendedRoute!
      : available[0] || "";
  const disabled = busy || saving;
  useEffect(() => {
    if (selectedRoute !== "optiscaler") return;
    let alive = true;
    getBridge()
      .optiscalerBuilds(dir)
      .then((result) => {
        if (alive) setBuilds(result);
      })
      .catch((e) => {
        if (alive) message(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [dir, selectedRoute]);
  const save = async (fn: () => Promise<void>) => {
    if (lock.current || busy) return;
    lock.current = true;
    setSaving(true);
    try {
      await fn();
      onUpdated();
    } catch (e) {
      message(errorText(e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  return (
    <section className="settings-section">
      <h2>{t("安装路线与目标程序")}</h2>
      <p className="muted">
        {t(
          "按原版安装流程选择程序、图形 API 和插件路线。确认变更预览后才会写入游戏目录。",
        )}
      </p>
      <fieldset disabled={disabled}>
        <Row
          label={t("实际游戏程序")}
          hint={t("有多个程序时，请选择实际运行游戏的程序。")}
        >
          <Select
            label={t("实际游戏程序")}
            value={exe?.path || ""}
            onChange={setExePath}
            options={exes.map((item) => [
              item.path,
              `${item.rel} · ${item.bitness}-bit · ${item.apiLabel}`,
            ])}
            disabled={!exes.length}
          />
        </Row>
        {exe && (
          <>
            <Row
              label={t("图形 API")}
              hint={t("覆盖自动识别结果，不会更改游戏自身的渲染设置。")}
            >
              <Select
                label={t("图形 API")}
                value={exe.apiOverride || "auto"}
                options={[
                  ["auto", t("自动识别 · {0}", [exe.apiLabel])],
                  ...policy.renderingApi.choices.map((item) => [
                    item.value,
                    item.label,
                  ]),
                ]}
                onChange={(value) =>
                  void save(async () => {
                    const result = await getBridge().setApiOverride(
                      dir,
                      exe.path,
                      value,
                    );
                    if (!result.ok)
                      throw Error(
                        result.message || result.code || t("保存失败"),
                      );
                  })
                }
              />
            </Row>
            <Row label={t("安装路线")}>
              <Select
                label={t("安装路线")}
                value={selectedRoute}
                onChange={setRoute}
                options={available.map((id) => [id, t(routes[id])])}
                disabled={!available.length}
              />
            </Row>
            {selectedRoute !== "optiscaler" &&
              target &&
              ["dxgi", "d3d8", "d3d9", "ddraw"].includes(target.api) &&
              target.apiLabel !== "DirectX 12" && (
                <Row label={t("ReShade 加载文件")}>
                  <Select
                    label={t("ReShade 加载文件")}
                    value={exe.reshadeProxy || "dxgi"}
                    options={[
                      ["dxgi", "dxgi.dll"],
                      ["d3d11", "d3d11.dll"],
                    ]}
                    onChange={(value) =>
                      void save(async () => {
                        const result = await getBridge().setReshadeProxy(
                          dir,
                          exe.path,
                          value,
                        );
                        if (!result.ok)
                          throw Error(
                            result.message || result.code || t("保存失败"),
                          );
                      })
                    }
                  />
                </Row>
              )}
            {selectedRoute === "optiscaler" && (
              <Row label={t("OptiScaler 构建版本")}>
                <Select
                  label={t("OptiScaler 构建版本")}
                  value={builds?.current || ""}
                  disabled={!builds}
                  options={(builds?.builds || []).map((item) => [
                    item.version,
                    item.label,
                  ])}
                  onChange={(value) =>
                    void save(async () => {
                      const current = await getBridge().setOptiscalerBuild(
                        dir,
                        value,
                      );
                      if (!current) throw Error(t("保存失败"));
                      setBuilds((previous) =>
                        previous ? { ...previous, current } : previous,
                      );
                    })
                  }
                />
              </Row>
            )}
          </>
        )}
        <div className="inline-actions">
          <button
            className="primary"
            disabled={!selectedRoute || !exe}
            onClick={() =>
              void run((token) =>
                getBridge().install(
                  dir,
                  exe.path,
                  selectedRoute,
                  exe.apiOverride || "auto",
                  token,
                ),
              ).then((ok) => {
                if (ok) onUpdated();
              })
            }
          >
            {t("预览并安装所选路线")}
          </button>
        </div>
      </fieldset>
      {!available.length && (
        <p className="muted">
          {t("当前 API 或程序位数没有可用路线，可核对程序或手动指定 API。")}
        </p>
      )}
      {target && !available.includes("optiscaler") && (
        <p className="muted">
          {t(
            "OptiScaler 需要受支持的 64 位图形 API，以及游戏原生的 DLSS 或其他超分接口。",
          )}
        </p>
      )}
      {selectedRoute === "native" && (
        <p className="muted">
          {t(
            "原生路线使用游戏提供的 DLSS 数据；没有原生接口时可选 Feeder 或 RenoDX。",
          )}
        </p>
      )}
      {selectedRoute === "feeder" && (
        <p className="muted">
          {t("Feeder 路线提供额外的深度与运动数据管线，效果仍取决于游戏。")}
        </p>
      )}
      {exe?.installIssue && <p className="error">{t(exe.installIssue)}</p>}
      <p className="footnote">
        {t(
          "画质与补帧页使用自动识别的主程序；本页的程序选择只用于此处的基础路线安装。",
        )}
      </p>
    </section>
  );
}
