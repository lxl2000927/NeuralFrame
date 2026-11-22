type SpatialSettings = {
  upscaling:string; spatialSharpness?:number; spatialAa?:string; spatialAaPlacement?:string; spatialAaQuality?:string;
};
export const engines: string[];
export const defaults: Required<Omit<SpatialSettings,'upscaling'>>;
export function settingsIssue(settings:SpatialSettings,supported:boolean,baseline?:SpatialSettings,switching?:boolean):string|null;
