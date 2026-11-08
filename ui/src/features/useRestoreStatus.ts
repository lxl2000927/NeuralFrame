import { useEffect, useState } from "react";
import { getBridge } from "../bridge";
import { errorText } from "../domain";

export function useRestoreStatus(
  dir: string,
  active: boolean,
  revision: number,
  refreshToken: number,
) {
  const [result, setResult] = useState<{
    dir: string;
    revision: number;
    refreshToken: number;
    canRestore: boolean;
    error?: string;
  }>();
  useEffect(() => {
    if (!active || !dir) return;
    let current = true;
    const read = async () => {
      try {
        const { canRestore } = await getBridge().restoreStatus(dir);
        if (current) setResult({ dir, revision, refreshToken, canRestore });
      } catch (error) {
        if (current)
          setResult({
            dir,
            revision,
            refreshToken,
            canRestore: false,
            error: errorText(error),
          });
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, [dir, active, revision, refreshToken]);
  if (
    result?.dir === dir &&
    result.revision === revision &&
    result.refreshToken === refreshToken
  )
    return result;
}
