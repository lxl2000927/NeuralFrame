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
  if (!value && !inspection?.error) return;
  const statusError = inspection?.error || (value && !value.ok
    ? value.message || "未识别到可配置的游戏程序，请核对游戏目录。" : "");
  return { status: value?.ok ? value : undefined, errors: statusError ? [statusError] : [] };
}
