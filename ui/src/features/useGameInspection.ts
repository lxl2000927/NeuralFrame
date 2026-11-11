import { useLayoutEffect, useReducer } from "react";
import { getBridge } from "../bridge";
import { errorText } from "../domain";
import type { Details, Status } from "../types";

type Entry<T> = {
  dir: string;
  promise: Promise<void>;
  value?: T;
  error?: string;
  expiresAt: number;
  subscribers: number;
};
const detailsCache = new Map<string, Entry<Details>>();
const statusCache = new Map<string, Entry<Status>>();

export function invalidateGameInspection(dir: string) {
  for (const cache of [detailsCache, statusCache]) {
    for (const [key, entry] of cache) {
      if (entry.dir === dir) cache.delete(key);
    }
  }
}

function readDetails(dir: string) {
  return getBridge().details(dir, "selection");
}
function readStatus(dir: string, profile: string) {
  return getBridge().enhancedStatus(dir, profile || undefined, "selection");
}

function useInspection<T extends { ok: boolean }>(
  cache: Map<string, Entry<T>>, read: (dir: string, profile: string) => Promise<T>,
  dir: string, profile: string, active: boolean, revision: number, refreshToken: number,
) {
  const [, update] = useReducer((value: number) => value + 1, 0);
  const key = JSON.stringify([dir, profile, refreshToken]);
  useLayoutEffect(() => {
    if (!dir || !active) return;
    let subscribed = true;
    let entry = cache.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      // Expiry is checked on activation or refresh, never halfway through an
      // edit. A late response can only update its original, detached entry.
      const pending: Entry<T> = { dir, expiresAt: Infinity, subscribers: 0, promise: Promise.resolve() };
      pending.promise = Promise.resolve().then(() => read(dir, profile)).then(
        value => { pending.value = value; pending.expiresAt = value.ok ? Date.now() + 30_000 : 0; },
        error => { pending.error = errorText(error); pending.expiresAt = 0; },
      );
      cache.delete(key);
      cache.set(key, pending);
      if (cache.size > 32) cache.delete(cache.keys().next().value!);
      entry = pending;
      update();
    }
    const current = entry;
    current.subscribers++;
    void current.promise.then(() => { if (subscribed) update(); });
    return () => {
      subscribed = false;
      current.subscribers--;
      // Another view mounted in the same navigation can still join this read.
      // A later return to a superseded selection must enqueue it again.
      queueMicrotask(() => {
        if (!current.subscribers && current.expiresAt === Infinity && cache.get(key) === current) cache.delete(key);
      });
    };
  }, [cache, read, dir, profile, key, active, revision]);
  return cache.get(key);
}

export function useGameDetails(dir: string, active: boolean, revision: number, refreshToken: number) {
  return useInspection(detailsCache, readDetails, dir, "", active, revision, refreshToken);
}

export function useGameStatus(dir: string, profile: string, active: boolean, revision: number, refreshToken: number) {
  return useInspection(statusCache, readStatus, dir, profile, active, revision, refreshToken);
}
