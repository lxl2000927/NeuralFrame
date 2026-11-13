export interface RouteTarget {
  bitness: number;
  api: string;
  apiLabel: string;
  emulator?: unknown;
  hasNativeDlss?: boolean;
  hasNativeUpscaler?: boolean;
  hasNativeFg?: boolean;
  launcherProtected?: boolean;
}
export function routesFor(target: RouteTarget, api?: string): string[];
export function optiReason(target: RouteTarget, api?: string): string | null;
export function encoreReason(target: RouteTarget, api?: string): string | null;
