export interface RouteTarget {
  bitness: number;
  api: string;
  apiLabel: string;
  emulator?: unknown;
  hasNativeDlss?: boolean;
  hasNativeUpscaler?: boolean;
}
export function routesFor(target: RouteTarget, api?: string): string[];
export function optiReason(target: RouteTarget, api?: string): string | null;
