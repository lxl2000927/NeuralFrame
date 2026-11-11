import { useEffect, useState } from "react";
import { getBridge } from "../bridge";
import { errorText } from "../domain";
import type { Model } from "../types";
import { useGameStatus } from "./useGameInspection";

export function useProfileTarget(
  dir: string,
  profile: string,
  active: boolean,
  revision: number,
  refreshToken: number,
) {
  const inspection = useGameStatus(dir, profile, active, revision, refreshToken);
  const value = inspection?.value;
  const status = value?.ok ? value : undefined;
  const models = status?.neural?.availableModels;
  const statusError = inspection?.error || (value && !value.ok
    ? value.message || "未识别到可配置的游戏程序，请核对游戏目录。" : "");
  const needsCatalog = !models && (dir ? !!(value || statusError) : !!profile);
  const key = JSON.stringify([dir, profile, revision, refreshToken]);
  const [catalog, setCatalog] = useState<{ key: string; models: Model[]; error?: string }>();
  useEffect(() => {
    if (!active || !needsCatalog) return;
    let current = true;
    void Promise.resolve().then(() => getBridge().enhancedModels(profile || undefined)).then(result => {
      if (current) setCatalog({ key, models: result.ok ? result.models : [],
        error: result.ok ? undefined : result.message || "读取模型库失败" });
    }).catch(error => {
      if (current) setCatalog({ key, models: [], error: errorText(error) });
    });
    return () => { current = false; };
  }, [active, needsCatalog, key, profile]);
  if (models) return { status, models, errors: [] };
  if (needsCatalog && catalog?.key === key) {
    return { status, models: catalog.models, errors: [statusError, catalog.error].filter((s): s is string => !!s) };
  }
}
