export const SCHEMA:'neuralframe-game-preset';
export const VERSION:1;
export function createPreset(input:{name:string;gameName:string;route:string;createdAt?:string;settings:Record<string,unknown>}):{
  schema:'neuralframe-game-preset';version:1;name:string;gameName:string;route:string;createdAt:string;settings:Record<string,unknown>
};
export function parsePreset(encoded:string):ReturnType<typeof createPreset>;
export function presetMatches(preset:ReturnType<typeof createPreset>,route:string,gameName:string):boolean;
