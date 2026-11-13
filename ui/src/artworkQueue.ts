import type { Game } from "./types";

export type ArtworkKind = "cover" | "tile" | "hero";
export type ArtworkOptions = { retry?: boolean; invalidUrl?: string };
type Artwork = Partial<Record<ArtworkKind, string>>;
type Snapshot = Artwork & { settled: Partial<Record<ArtworkKind, true>>; failed: readonly string[]; revision: number };
type Target = Pick<Game, "dir" | "name" | "appid">;
type FetchArtwork = (game: Target, kind: ArtworkKind, options?: ArtworkOptions) => Promise<Artwork>;
type Lease = { priority: number };
type Task = { game: Target; kind: ArtworkKind; epoch: number; options?: ArtworkOptions; leases: Set<Lease>; state: "queued" | "running" | "done" };
const kinds: ArtworkKind[] = ["cover", "tile", "hero"];
export const artworkIdentity = (game: Target) => JSON.stringify([
  game.dir.replace(/\\/g, "/").toLowerCase(), game.appid || "", game.name,
]);

// Artwork has its own small store: a completed image only renders the Artwork
// instances for that game, not the entire library, editor and mounted pages.
export function createArtworkQueue(fetch: FetchArtwork, concurrency = 4) {
  const records = new Map<string, ReturnType<typeof createRecord>>();
  const tasks = new Map<string, Task>();
  let active = 0;
  let scheduled = false;
  function createRecord(game: Target) {
    let value: Snapshot = { settled: {}, failed: [], revision: 0 };
    const listeners = new Set<() => void>();
    const views = new Set<Lease>();
    const epochs: Record<ArtworkKind, number> = { cover: 0, tile: 0, hero: 0 };
    const options: Partial<Record<ArtworkKind, ArtworkOptions>> = {};
    const lastBad: Partial<Record<ArtworkKind, string>> = {};
    const repaired = new Set<ArtworkKind>();
    const publish = () => { listeners.forEach(listener => listener()); };
    const invalidate = (kind: ArtworkKind) => {
      epochs[kind]++;
      options[kind] = { retry: true, ...(lastBad[kind] ? { invalidUrl: lastBad[kind] } : {}) };
      const key = artworkIdentity(game) + kind;
      if (tasks.get(key)?.state !== "running") tasks.delete(key);
      const settled = { ...value.settled };
      delete settled[kind];
      value = { ...value, settled, revision: value.revision + 1 };
    };
    return {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      visible: (priority: number) => {
        const view = { priority }; views.add(view);
        return () => { views.delete(view); };
      },
      epoch: (kind: ArtworkKind) => epochs[kind],
      options: (kind: ArtworkKind) => options[kind],
      touch: () => { value = { ...value, revision: value.revision + 1 }; publish(); },
      update: (patch: Artwork, kind: ArtworkKind, epoch: number) => {
        if (epochs[kind] !== epoch) return;
        // Kind-specific IPC reads may include metadata from the shared index.
        // Only this resource belongs to the checked epoch; an older banner
        // reply must never roll back a repaired portrait from a newer request.
        const valid = Object.fromEntries(Object.entries(patch).filter(([key, url]) => key === kind && typeof url === "string" && url));
        if (value.settled[kind] && !Object.entries(valid).some(([key, url]) => value[key as ArtworkKind] !== url)) return;
        value = { ...value, ...valid, settled: { ...value.settled, [kind]: true } };
        publish();
      },
      fail: (kind: ArtworkKind, url: string, repair: boolean) => {
        if (value.failed.includes(url)) return;
        value = { ...value, failed: [...value.failed, url] };
        lastBad[kind] = url;
        if (repair && !repaired.has(kind)) { repaired.add(kind); invalidate(kind); }
        publish();
      },
      resetMissing: (visibleOnly: boolean) => {
        if (visibleOnly && !Array.from(views).some(view => view.priority > 0)) return;
        let changed = false;
        for (const kind of kinds) {
          if (value[kind] && !value.failed.includes(value[kind]!)) continue;
          if (!value.settled[kind] && !lastBad[kind] && !tasks.has(artworkIdentity(game) + kind)) continue;
          repaired.delete(kind);
          invalidate(kind);
          changed = true;
        }
        if (changed) publish();
      },
    };
  }
  const record = (game: Target) => {
    const key = artworkIdentity(game);
    let value = records.get(key);
    if (!value) { value = createRecord(game); records.set(key, value); }
    return value;
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(pump, 0);
  };
  function pump() {
    scheduled = false;
    while (active < concurrency) {
      let next: Task | undefined;
      let priority = -1;
      for (const task of tasks.values()) {
        if (task.state !== "queued") continue;
        const score = Math.max(-1, ...Array.from(task.leases, lease => lease.priority));
        if (score > priority) { next = task; priority = score; }
      }
      if (!next) return;
      const task = next;
      const current = record(task.game);
      task.state = "running";
      active++;
      void Promise.resolve().then(() => fetch(task.game, task.kind, task.options))
        .then(value => current.update(value, task.kind, task.epoch))
        .catch(() => { current.update({}, task.kind, task.epoch); })
        .finally(() => {
          task.state = "done";
          active--;
          // A retry waits for an older in-flight read, then subscribers may
          // request the current epoch without two writes racing for one image.
          if (current.epoch(task.kind) !== task.epoch) {
            const key = artworkIdentity(task.game) + task.kind;
            if (tasks.get(key) === task) tasks.delete(key);
            current.touch();
          }
          schedule();
        });
    }
  }
  return {
    record,
    resetMissing: (visibleOnly = false) => records.forEach(value => value.resetMissing(visibleOnly)),
    reportFailure: (game: Target, kind: ArtworkKind, url: string, repair = true) => record(game).fail(kind, url, repair),
    request(game: Target, kind: ArtworkKind, priority: number) {
      const key = artworkIdentity(game) + kind;
      let task = tasks.get(key);
      if (!task) {
        const current = record(game);
        task = { game, kind, epoch: current.epoch(kind), options: current.options(kind), leases: new Set(), state: "queued" };
        tasks.set(key, task);
      }
      const lease = { priority };
      task.leases.add(lease);
      if (task.state === "queued") schedule();
      return () => {
        task.leases.delete(lease);
        // A retry may have replaced this queued task before its old view
        // detaches. That cleanup must not remove the current epoch's work.
        if (!task.leases.size && task.state === "queued" && tasks.get(key) === task) tasks.delete(key);
      };
    },
  };
}
