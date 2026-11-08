export interface RenderingTarget {
  api: string;
  apiLabel: string;
}
export const choices: { value: string; api: string; label: string }[];
export function valid(value: string): boolean;
export function resolve(target: RenderingTarget, value?: string): { api: string; label: string };
export function effective<T extends RenderingTarget>(target: T, value?: string): T & { dx12: boolean };
