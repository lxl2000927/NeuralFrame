export type Game = {
  key: string;
  name: string;
  dir: string;
  launcher: string;
  poster: string | { url: string; custom?: boolean; tall?: boolean } | null;
  appid?: string | null;
  hero?: string | null;
  tile?: string | null;
  cached?: { api?: string | null; apiLabel?: string; ok?: boolean; installable?: boolean; dx12?: boolean; reason?: string; dlss?: string | null; hasDlss?: boolean; addon?: boolean; optiscaler?: boolean; managed?: boolean } | null;
};
export type Model = {
  id: string;
  name: string;
  version?: string;
  catalogDate?: string;
  catalogAliases?: string[];
  importedAt?: string;
  availableOnDisk?: boolean;
  role?: string;
  sha256?: string | null;
  size?: number;
  architectures?: string[];
  smCounts?: Record<string, number>;
  compatStatus?: string;
  compatBadge?: string;
  compatReason?: string;
  sourceType?: string;
  description?: string;
  bundled?: boolean;
  downloadable?: boolean;
};
export type CoCheck = {
  ok: boolean;
  badge?: string;
  message: string;
  [key: string]: unknown;
};
export type VramBudget = {
  resolution?: string;
  estimatedTotalMB?: number;
  vramTotalMB?: number | null;
  headroomMB?: number | null;
  usagePercent?: number | null;
  level?: string;
  totalAddedOverheadMB?: number;
  neuralOverheadMB?: number;
  mfgOverheadMB?: number;
  summary?: string;
};
export type StatusDiagnostics = {
  gameName?: string;
  graphicsApi?: string;
  hardwareProfile?: string;
  hardwareProfileLabel?: string;
  neuralStatus?: string;
  mfgStatus?: string;
  dllConflicts?: { severity?: string; message?: string; code?: string }[];
  errorLogs?: string[];
  backupStatus?: string;
  combinedStatus?: string;
  combinedBadge?: string;
  coExecution?: {
    bothActive?: boolean;
    dllConflicts?: unknown[];
    slChainCheck?: CoCheck;
    motionVectorCheck?: CoCheck;
    hudFlickerCheck?: CoCheck;
    reflexCheck?: CoCheck;
    backupCheck?: CoCheck;
    vramBudget?: VramBudget;
    dlssCompat?: {
      mode?: string;
      summary?: string;
      hook?: string;
      avoidedConflict?: string;
    };
  };
};
export type Status = {
  configuredRuntimeStack?: string | null;
  ok: boolean;
  message?: string;
  exePath?: string;
  graphicsApi?: string;
  hardwareProfile?: string;
  hardwareProfileSource?: HardwareProfileSource;
  hardwareProfileInfo?: HardwareProfile;
  hardwareProfiles?: Record<string, HardwareProfile>;
  gameName?: string;
  bitness?: number;
  diagnostics?: StatusDiagnostics;
  hardware?: { gpu?: { name?: string; architecture?: { family?: string; sm?: string | null } } };
  neural?: {
    installed?: boolean;
    runtimeVersion?: string;
    overallStatus?: string;
    overallBadge?: string;
    dependencies?: { hasNeuralDll?: boolean };
    gpuCompatibility?: { compatible?: boolean; status?: string; reason?: string; badge?: string };
    mode?: string;
    currentModel?: Model;
    latestCompatibleModel?: Model | null;
    availableModels?: Model[];
    configuredRuntimeStack?: string;
    runtimeStacks?: RuntimeStack[];
    runtimeStack?: string;
  };
  mfg?: {
    status?: string;
    statusBadge?: string;
    dlssg?: { version?: string; exists?: boolean; valid?: boolean };
    streamline?: { interposerVersion?: string | null };
    knownGame?: { title?: string; notes?: string };
    gpuSupport?: { nativeX2?: boolean; nativeX3X4?: boolean; unlockRequiredForX3X4?: boolean; modeBadges?: Record<string, { status: string; badge: string }> };
    runtimeVerification?: { effectiveMultiplier?: number | null };
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
  exes?: GameExecutable[];
  recommendedRoute?: string;
  installedRoute?: string;
  installedExe?: string;
  installedApi?: string;
  antiCheatWarning?: boolean;
  antiCheatComponents?: string[];
};
export type GameExecutable = {
  path: string; rel: string; api: string; apiLabel: string; bitness: number; size: number;
  apiOverride?: string; reshadeProxy?: string; hasNativeDlss?: boolean; hasNativeUpscaler?: boolean;
  emulator?: { name: string; system?: string; hint?: string }; installIssue?: string;
  antiCheatWarning?: boolean;
  antiCheatComponents?: string[];
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
  fpsAt?: number;
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
    before?: { version?: string | null; sha256?: string } | null;
    after?: { version?: string | null; sha256?: string } | null;
    source?: string;
    backup?: { version?: string | null; create?: boolean } | null;
  }[];
  conflicts: string[];
  antiCheat?: { components: string[] };
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
  mfgResult?: { skipped?: boolean } | null;
};
export type Progress = {
  name: string;
  stage: string;
  loaded?: number;
  total?: number;
};
export type Library = {
  ok: boolean;
  code?: string;
  message?: string;
  root: string;
  definitions: Record<string, { name: string; internal?: boolean; pinned?: boolean; files?: string[] }>;
  packages: {
    id: string;
    component: string;
    version: string;
    source: string;
    present: boolean;
    compatibility: { ready: boolean; label: string; reason: string };
  }[];
  warnings?: string[];
  runtimePacks: {
    id: string;
    name: string;
    version: string;
    size: number;
    downloaded: boolean;
  }[];
  profile?: { selected: Record<string, string> };
  inventory?: Inventory;
  rollback?: { id: string } | null;
  updates?: Updates;
};
export type Updates = {
  checkedAt: string | null;
  nextCheckAt?: number;
  cached?: boolean;
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
  hidden?: string[];
  stateFile: string;
  closeToTray: boolean;
  autoScanDrives: boolean;
  safeGraphics: boolean;
  rememberWindow: boolean;
  groupGamesByStore: boolean;
  roots: string[];
  excludedRoots: string[];
  posterDir: string;
  posterCount: number;
};
export type HistoryRow = {
  id: string;
  name: string;
  dir: string;
  date: string;
  action: string;
  route?: string;
  exe?: string;
  api?: string;
  added: number;
  replaced: number;
  imported?: boolean;
  files?: { rel: string; action: string; before?: string; after?: string; beforeHash?: string; afterHash?: string }[];
  configuration?: Record<string, string | null>;
};
export type OverlayPrefs = {
  enabled: boolean;
  theme: string;
  hotkey: { key: number; mods: number };
  custom?: { name: string; accent: string } | null;
};
export type OverlayResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type OverlayEntry = { id: string; name: string; builtin?: boolean; architecture: number; ready: boolean; sha256?: string | null };
export type OverlayInstallation = { id: string; overlayId: string; name: string; directory: string; file: string; architecture: number; sha256: string };
export type OverlayLibrary = { overlays: OverlayEntry[]; installations: OverlayInstallation[]; errors: string[] };
export type OverlayBridgeState = { listening: boolean; connected: boolean; game: boolean; addon: boolean; addonFile?: string | null };
export interface Lab {
  boot(): Promise<{
    version: string;
    theme: string;
    lang?: string;
    safeGraphics?: boolean;
    groupGamesByStore?: boolean;
  }>;
  window(action: string): Promise<void>;
  library(): Promise<Game[]>;
  artFetch(
    dir: string,
    name: string,
    appid?: string | null,
    kind?: "tile",
  ): Promise<{ cover?: string; hero?: string; tile?: string; error?: string }>;
  scan(dir: string): Promise<NonNullable<Game["cached"]>>;
  details(dir: string, priority?: "selection"): Promise<Details>;
  enhancedStatus(dir: string, profileId?: string, priority?: "selection"): Promise<Status>;
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
  onJob(fn: (event: { dir?: string; code: string; params?: unknown; data?: unknown }) => void): () => void;
  restoreGame(dir: string, token?: string): Promise<Result>;
  restoreStatus(dir: string): Promise<{ canRestore: boolean }>;
  libraryComponents(dir?: string): Promise<Library>;
  libraryCheck(): Promise<Updates & Result>;
  libraryDownload(id: string): Promise<Result>;
  libraryCancel(): Promise<unknown>;
  onLibraryProgress(fn: (p: Progress) => void): () => void;
  librarySelect(
    dir: string,
    selection: Record<string, string>,
  ): Promise<Result>;
  libraryApply(dir: string, token?: string, selection?: Record<string, string>): Promise<Result>;
  libraryCheckRuntime(id: string): Promise<Result>;
  libraryRollback(dir: string, id: string, token?: string): Promise<Result>;
  libraryImport(component: string): Promise<Result>;
  addGame(): Promise<{ dir?: string; ok?: boolean } | string | null>;
  addFolder(): Promise<unknown>;
  setPoster(dir: string): Promise<string | null>;
  hide(dir: string): Promise<boolean>;
  unhide(dir: string): Promise<boolean>;
  removeFolder(dir: string): Promise<unknown>;
  launchGame(dir: string): Promise<Result>;
  open(dir: string): Promise<unknown>;
  openProject(dest: string): Promise<unknown>;
  settings(): Promise<Settings>;
  setTheme(theme: string): Promise<unknown>;
  setLang(lang: string): Promise<string>;
  setTrayLabels(labels: { show: string; quit: string }): Promise<unknown>;
  setSafeGraphics(on: boolean): Promise<{ ok: boolean; on: boolean }>;
  setRememberWindow(on: boolean): Promise<boolean>;
  setGroupGamesByStore(on: boolean): Promise<boolean>;
  excludeRoot(dir: string): Promise<unknown>;
  restoreScanRoot(dir: string): Promise<boolean>;
  resetLibrary(): Promise<boolean>;
  setCloseToTray(on: boolean): Promise<unknown>;
  setAutoScanDrives(on: boolean): Promise<unknown>;
  history(): Promise<{ rows: HistoryRow[]; warning?: boolean }>;
  clearHistory(): Promise<Result>;
  overlayPreferences(): Promise<{
    ok: boolean;
    value: OverlayPrefs;
    error?: string;
  }>;
  saveOverlayPreferences(
    patch: Partial<OverlayPrefs>,
  ): Promise<{ ok: boolean; value: OverlayPrefs; error?: string }>;
  overlays(): Promise<OverlayResult<OverlayLibrary>>;
  overlayBridge(): Promise<OverlayResult<OverlayBridgeState>>;
  overlayAdd(): Promise<OverlayResult<OverlayEntry | null>>;
  overlayRemove(id: string): Promise<OverlayResult<void>>;
  overlaySource(): Promise<OverlayResult<void>>;
  overlayInstall(id: string): Promise<OverlayResult<OverlayInstallation | null>>;
  overlayUninstall(id: string): Promise<OverlayResult<void>>;
  saveDiagnostics(dir: string, activity: string): Promise<Result>;
  /* ---- 补齐：preload 已暴露、UI 此前未声明的接口 ---- */
  checkUpdate(refresh?: boolean): Promise<UpdateInfo>;
  copyText(text: string): Promise<boolean>;
  enhancedHardware(forceRefresh?: boolean): Promise<HardwareResult>;
  enhancedSetProfile(profileId: string): Promise<Result & { hardwareProfile: string; hardwareProfiles: Record<string, HardwareProfile> }>;
  enhancedModels(profileId?: string): Promise<Result & { models: Model[]; runtimeStacks: RuntimeStack[] }>;
  install(dir: string, exePath: string, route: string, api: string, token?: string): Promise<Result>;
  setApiOverride(dir: string, exePath: string, value: string): Promise<Result>;
  setReshadeProxy(dir: string, exePath: string, value: string): Promise<Result>;
  optiscalerBuilds(dir: string): Promise<{ builds: { version: string; label: string }[]; current: string }>;
  setOptiscalerBuild(dir: string, version: string): Promise<string | null>;
  addons(): Promise<AddonRow[]>;
  addonToggle(file: string, on: boolean): Promise<Result & { replaced?: string }>;
  addonPick(): Promise<AddonPick | { error: string } | null>;
  addonRemove(file: string): Promise<boolean>;
  addonSave(payload: { path: string; name: string; description: string; tag: string }): Promise<boolean>;
  recents(): Promise<{ dir: string; at: number }[]>;
  addGameByPath(dir: string): Promise<string | null>;
  pathForFile(file: File): string | null;
  gameMenu(dir: string, options?: unknown): Promise<unknown>;
  reset(): Promise<boolean>;
  setSkin(skin: string): Promise<unknown>;
  setRail(rail: string): Promise<unknown>;
}
export type UpdateInfo = {
  current: string;
  latest: string | null;
  newer: boolean;
  status?: string;
  message?: string;
  notes?: string;
  title?: string;
  publishedAt?: string;
  channel?: string;
};

export type HardwareProfile = {
  id: string;
  label?: string;
  shortLabel: string;
  gpuSeries: string;
  sm: string;
  ngxArch?: string;
  vramBudgetMB?: number;
  targetResolution: string;
  nrResolutionScale: number;
  nrHookPoint: number;
  nrPasses: number;
  nrMaxWorksets: number;
  mfgStrategy: string;
  mfgLabel?: string;
  nrLabel?: string;
  description?: string;
};
export type HardwareProfileSource = "selected" | "manifest" | "default" | "detected" | "blackwell-mobile" | "low-vram" | "fallback";
export type HardwareInfo = { cpu: string; cpuCores: number; ramGB: number; os: string; gpu: { name: string; driver: string; detected?: boolean; vramTotalMB: number | null; vramUsedMB: number | null; powerDefaultW: number | null; powerMaxW: number | null }; display?: { resolution?: string; refreshRateHz?: number } | null };
export type HardwareResult = Result & { hardwareProfile: string; hardwareProfileSource?: HardwareProfileSource; hardwareProfiles: Record<string, HardwareProfile>; hardware: HardwareInfo };
export type RuntimeStack = { id: string; name: string; dlssVersion: string; dlssgVersion?: string; streamlineVersion: string; feederVersion: string };

export type NeuralModelInfo = {
  id: string;
  name?: string;
  availableOnDisk?: boolean;
  version?: string;
  size?: number;
  [key: string]: unknown;
};

export type AddonRow = {
  path: string;
  label: string;
  file: string;
  size?: number;
  missing?: boolean;
  version?: string;
  active: boolean;
  custom?: boolean;
  notes?: string[];
  warn?: string | null;
  replaces?: boolean;
  caution?: string;
};
export type AddonPick = { path: string; file: string; size: number; version?: string; suggestedName?: string };

declare global {
  interface Window {
    lab?: Lab;
  }
}
