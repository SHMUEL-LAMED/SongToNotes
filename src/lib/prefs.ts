import { useCallback, useSyncExternalStore } from "react";

/**
 * Small per-device preferences the shell keeps: the tools someone pinned and
 * the ones they opened last. They live in localStorage, and every hook that
 * reads them re-renders together when one of them changes — in this tab or,
 * through the storage event, in another.
 */

const FAVORITES_KEY = "musictools.favorites.v1";
const RECENT_KEY = "musictools.recent-tools.v1";
const RECENT_LIMIT = 8;

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: string[] }>();

function readList(key: string): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage blocked: the list is empty for this visit.
  }
  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.value;
  let value: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    value = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    value = [];
  }
  cache.set(key, { raw, value });
  return value;
}

function writeList(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept in memory only.
    cache.set(key, { raw: JSON.stringify(value), value });
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === FAVORITES_KEY || event.key === RECENT_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: string[] = [];

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, () => readList(FAVORITES_KEY), () => EMPTY);
  const toggle = useCallback((id: string) => {
    const current = readList(FAVORITES_KEY);
    writeList(FAVORITES_KEY, current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }, []);
  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);
  return { favorites, toggle, isFavorite };
}

export function useRecentTools() {
  return useSyncExternalStore(subscribe, () => readList(RECENT_KEY), () => EMPTY);
}

/** Puts a tool at the front of the recently-opened list. */
export function recordToolVisit(id: string) {
  const current = readList(RECENT_KEY);
  if (current[0] === id) return;
  writeList(RECENT_KEY, [id, ...current.filter((item) => item !== id)].slice(0, RECENT_LIMIT));
}

export function clearRecentTools() {
  writeList(RECENT_KEY, []);
}
