import { useEffect, useState } from "react";
import { getBridge } from "../bridge";
import { errorText } from "../domain";
import type { Model, Status } from "../types";

type Target = {
  dir: string;
  profile: string;
  revision: number;
  refreshToken: number;
  status?: Status;
  models: Model[];
  errors: string[];
};

export function useProfileTarget(
  dir: string,
  profile: string,
  active: boolean,
  revision: number,
  refreshToken: number,
  priority?: "selection",
) {
  const [result, setResult] = useState<Target>();
  useEffect(() => {
    if (!active || (!dir && !profile)) return;
    let current = true;
    const read = async () => {
      const target: Target = {
        dir,
        profile,
        revision,
        refreshToken,
        models: [],
        errors: [],
      };
      if (dir) {
        try {
          const status = await getBridge().enhancedStatus(dir, profile || undefined, priority);
          if (status.ok) target.status = status;
          else
            target.errors.push(
              status.message || "未识别到可配置的游戏程序，请核对游戏目录。",
            );
        } catch (e) {
          target.errors.push(errorText(e));
        }
      }
      if (!current) return;
      // A valid inspection already includes the catalog for this hardware profile.
      if (target.status?.neural?.availableModels)
        target.models = target.status.neural.availableModels;
      else {
        try {
          const catalog = await getBridge().enhancedModels(profile || undefined);
          if (catalog.ok) target.models = catalog.models;
          else target.errors.push(catalog.message || "读取模型库失败");
        } catch (e) {
          target.errors.push(errorText(e));
        }
      }
      if (current) setResult(target);
    };
    void read();
    return () => {
      current = false;
    };
  }, [dir, profile, active, revision, refreshToken, priority]);
  if (
    result?.dir === dir &&
    result.profile === profile &&
    result.revision === revision &&
    result.refreshToken === refreshToken
  )
    return result;
}
