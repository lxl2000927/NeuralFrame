import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getBridge } from "./bridge";
import { artworkIdentity, createArtworkQueue, type ArtworkKind } from "./artworkQueue";
import type { Game } from "./types";

const queue = createArtworkQueue((game, kind, options) => getBridge().artFetch(game.dir, game.name, game.appid, kind, options));
export const retryMissingArtwork = (visibleOnly = false) => queue.resetMissing(visibleOnly);
type RootPool = { root: Element; visible: boolean; members: Set<Element>; observer: IntersectionObserver };
type Visibility = { element: Element; visible: boolean; near: boolean; pool?: RootPool; update: (priority: number) => void };
const observed = new Map<Element, Visibility>();
const pools = new Map<Element, RootPool>();
let visibleObserver: IntersectionObserver | undefined;
let nearObserver: IntersectionObserver | undefined;
let rootsObserver: IntersectionObserver | undefined;
function publish(state: Visibility) {
  const active = state.element.getClientRects().length > 0 && (!state.pool || state.pool.visible);
  state.update(active ? state.visible ? 2 : state.near ? 1 : 0 : 0);
}
function scrollingParent(element: Element) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflowX + style.overflowY)) return parent;
  }
  return null;
}
function observe(element: Element, update: (priority: number) => void) {
  const changes = (kind: "visible" | "near") => (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      const state = observed.get(entry.target);
      if (!state) continue;
      state[kind] = entry.isIntersecting;
      publish(state);
    }
  };
  visibleObserver ||= new IntersectionObserver(changes("visible"));
  nearObserver ||= new IntersectionObserver(changes("near"), { rootMargin: "160px" });
  rootsObserver ||= new IntersectionObserver(entries => {
    for (const entry of entries) {
      const pool = pools.get(entry.target);
      if (!pool) continue;
      pool.visible = entry.isIntersecting;
      pool.members.forEach(member => { const state = observed.get(member); if (state) publish(state); });
    }
  });
  const root = scrollingParent(element);
  let pool: RootPool | undefined;
  if (root) {
    pool = pools.get(root);
    if (!pool) {
      pool = { root, visible: false, members: new Set(), observer: new IntersectionObserver(changes("near"), { root, rootMargin: "160px" }) };
      pools.set(root, pool);
      rootsObserver.observe(root);
    }
    pool.members.add(element);
  }
  observed.set(element, { element, visible: false, near: false, pool, update });
  visibleObserver.observe(element);
  (pool?.observer || nearObserver).observe(element);
  return () => {
    observed.delete(element);
    visibleObserver?.unobserve(element);
    (pool?.observer || nearObserver)?.unobserve(element);
    if (pool) {
      pool.members.delete(element);
      if (!pool.members.size) { pool.observer.disconnect(); rootsObserver?.unobserve(pool.root); pools.delete(pool.root); }
    }
  };
}

export function useArtwork(game: Game, layout: "thumbnail" | "cover" | "banner") {
  const ref = useRef<HTMLSpanElement>(null);
  const [priority, setPriority] = useState(0);
  const identity = artworkIdentity(game);
  const record = queue.record(game);
  const artwork = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const custom = typeof game.poster === "object" && game.poster?.custom;
  const original = typeof game.poster === "string" ? game.poster : game.poster?.url;
  const usable = (source?: string | null) => source && !artwork.failed.includes(source) ? source : undefined;
  const portrait = usable(original) && !(typeof game.poster === "object" && game.poster?.tall === false);
  const url = custom ? usable(original) : portrait ? usable(original) : usable(artwork.cover) || usable(original);
  const tile = usable(game.tile) || usable(artwork.tile);
  const hero = usable(game.hero) || usable(artwork.hero);
  // A title with no portrait can still have a usable horizontal illustration.
  const kind: ArtworkKind = layout === "thumbnail" ? (!url && artwork.settled.cover ? "hero" : "cover")
    : layout === "cover" ? (!tile && !hero && !url && artwork.settled.tile ? "hero" : "tile") : "hero";
  const needed = !custom && (kind === "cover" ? !portrait && !usable(artwork.cover) : kind === "tile" ? !tile : !hero && !tile);
  useEffect(() => {
    const element = ref.current;
    if (element) return observe(element, setPriority);
  }, []);
  useEffect(() => record.visible(priority), [record, priority]);
  useEffect(() => {
    if (!needed || !priority) return;
    return queue.request(game, kind, priority + (layout === "banner" ? 2 : 0));
  }, [identity, kind, priority, needed, layout, artwork.revision]);
  const failed = (source: string) => {
    const sourceKind = source === tile ? "tile" : source === hero || (source === original && typeof game.poster === "object" && game.poster?.tall === false) ? "hero" : "cover";
    queue.reportFailure(game, sourceKind, source, !custom);
  };
  return { ref, url, tile, hero, custom, failed };
}
