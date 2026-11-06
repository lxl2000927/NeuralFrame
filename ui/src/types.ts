export type Game = {
  key: string;
  name: string;
  dir: string;
  launcher: string;
  poster: string | { url: string; custom?: boolean; tall?: boolean } | null;
  appid?: string | null;
  cached?: { api?: string; apiLabel?: string } | null;
};
export type Model = {
  id: string;
  name: string;
  version?: string;
  availableOnDisk?: boolean;
  role?: string;
};
export type Status = {
  ok: boolean;
  message?: string;
  exePath?: string;
  graphicsApi?: string;
  hardwareProfile?: string;
  hardware?: { gpu?: { name?: string } };
  neural?: {
    mode?: string;
    currentModel?: Model;
    availableModels?: Model[];
    configuredRuntimeStack?: string;
    runtimeStack?: string;
  };
  mfg?: {
    currentConfig?: { mode?: string; settings?: { qualityGuardMode?: number } };
  };
};
export type Details = {
  ok: boolean;
  reason?: string;
  exePath?: string;
  api?: string;
  hasBackup?: boolean;
  files?: { name: string; version?: string; rel: string }[];
};
export type Draft = {
  neuralMode: string;
  neuralModelId: string;
  mfgMode: string;
  hardwareProfile: string;
  runtimeStack: string;
  hdrCompatibility: boolean;
};
export type RuntimeItem = {
  state: string;
  label: string;
  detail: string;
  at?: number;
  requestedMultiplier?: number;
  appliedMultiplier?: number;
  sourceFps?: number;
  reportedOutputFps?: number;
  source?: string;
  evidence?: string;
};
export type Runtime = {
  ok: boolean;
  message?: string;
  checkedAt: number;
  processState: string;
  nr: RuntimeItem;
  mfg: RuntimeItem;
  warnings?: string[];
  modules?: { name: string; path: string }[];
};
export type FileRow = {
  name: string;
  rel: string;
  version?: string;
  category: string;
  present: boolean;
  size: number;
  source?: string;
  sha256?: string;
  lockState?: string;
};
export type Inventory = {
  ok: boolean;
  message?: string;
  rows: FileRow[];
  lock?: { at: string } | null;
};
export type Preview = {
  token: string;
  dir: string;
  kind: string;
  rows: {
    rel: string;
    action: string;
    before?: { version?: string };
    after?: { version?: string };
  }[];
  conflicts: { message?: string; rel?: string }[];
  externalSteps?: { file: string; args: string[] }[];
};
export type Result = {
  ok: boolean;
  message?: string;
  code?: string;
  cancelled?: boolean;
  preview?: Preview;
  dependencies?: string[];
  downloads?: { name: string; size: number }[];
  recordWarning?: string;
};
export type Progress = {
  name: string;
  stage: string;
  loaded?: number;
  total?: number;
};
export type Library = {
  ok: boolean;
  message?: string;
  root: string;
  definitions: Record<string, { name: string; internal?: boolean }>;
  packages: {
    id: string;
    component: string;
    version: string;
    source: string;
    present: boolean;
    compatibility: { ready: boolean; label: string; reason: string };
  }[];
  runtimePacks: {
    id: string;
    name: string;
    version: string;
    size: number;
    downloaded: boolean;
  }[];
  profile?: { selected: Record<string, string> };
  rollback?: { id: string } | null;
  updates?: Updates;
};
export type Updates = {
  checkedAt: string | null;
  candidates: {
    id: string;
    component: string;
    tag: string;
    name: string;
    size: number;
    repo: string;
    downloadable: boolean;
    stale?: boolean;
  }[];
  errors: { provider: string; message: string }[];
};
export type Settings = {
  folders: string[];
  stateFile: string;
  closeToTray: boolean;
  autoScanDrives: boolean;
  safeGraphics: boolean;
};
export type OverlayPrefs = {
  enabled: boolean;
  theme: string;
  hotkey: { key: number; mods: number };
  custom?: { name: string; accent: string } | null;
};
export interface Lab {
  boot(): Promise<{ version: string; theme: string }>;
  window(action: string): Promise<void>;
  library(): Promise<Game[]>;
  artFetch(
    dir: string,
    name: string,
    appid?: string | null,
  ): Promise<{ cover?: string; hero?: string; error?: string }>;
  scan(dir: string): Promise<unknown>;
  details(dir: string): Promise<Details>;
  enhancedStatus(dir: string): Promise<Status>;
  enhancedApply(
    dir: string,
    config: Partial<Draft>,
    token?: string,
  ): Promise<Result>;
  enhancedImportModel(): Promise<Result>;
  componentInventory(dir: string): Promise<Inventory>;
  componentRuntime(dir: string): Promise<Runtime>;
  componentLock(dir: string, on: boolean): Promise<Result>;
  componentPrepare(ids: string[]): Promise<Result>;
  componentCancelPrepare(): Promise<void>;
  onComponentProgress(fn: (p: Progress) => void): () => void;
  restoreGame(dir: string, token?: string): Promise<Result>;
  libraryComponents(dir?: string): Promise<Library>;
  libraryCheck(): Promise<Updates & Result>;
  libraryDownload(id: string): Promise<Result>;
  libraryCancel(): Promise<unknown>;
  onLibraryProgress(fn: (p: Progress) => void): () => void;
  librarySelect(
    dir: string,
    selection: Record<string, string>,
  ): Promise<Result>;
  libraryApply(dir: string, token?: string): Promise<Result>;
  libraryRollback(dir: string, id: string, token?: string): Promise<Result>;
  libraryImport(component: string): Promise<Result>;
  addGame(): Promise<{ dir?: string; ok?: boolean } | string | null>;
  addFolder(): Promise<unknown>;
  removeFolder(dir: string): Promise<unknown>;
  launchGame(dir: string): Promise<Result>;
  open(dir: string): Promise<unknown>;
  openProject(dest: string): Promise<unknown>;
  settings(): Promise<Settings>;
  setTheme(theme: string): Promise<unknown>;
  setCloseToTray(on: boolean): Promise<unknown>;
  setAutoScanDrives(on: boolean): Promise<unknown>;
  history(): Promise<{ rows: Record<string, unknown>[]; warning?: boolean }>;
  clearHistory(): Promise<Result>;
  overlayPreferences(): Promise<{
    ok: boolean;
    value: OverlayPrefs;
    error?: string;
  }>;
  saveOverlayPreferences(
    patch: Partial<OverlayPrefs>,
  ): Promise<{ ok: boolean; value: OverlayPrefs; error?: string }>;
  overlayBridge(): Promise<unknown>;
  overlayInstall(id: string): Promise<{ ok: boolean; error?: string }>;
  saveDiagnostics(dir: string, activity: unknown[]): Promise<Result>;
}
declare global {
  interface Window {
    lab?: Lab;
  }
}
