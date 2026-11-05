import { useCallback, useSyncExternalStore } from "react";

/** Whether the desktop sidebar is folded to its icon rail: "1" or "0". */
export const RAIL_KEY = "musictools.rail.v1";

const listeners = new Set<() => void>();
// Storage can be blocked (private modes, embedded browsers): the choice then
// lasts for the visit.
let memory: boolean | null = null;

/** The stored choice; the full sidebar when nothing was chosen. */
export function readRail(): boolean {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeRail(rail: boolean) {
  memory = rail;
  try {
    localStorage.setItem(RAIL_KEY, rail ? "1" : "0");
    // Stored: other tabs and later reads go by storage again.
    memory = null;
  } catch {
    // Kept in memory for the visit.
  }
  listeners.forEach((listener) => listener());
}

/** Calls back when the choice changes, here or in another tab. */
export function subscribeRail(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === RAIL_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** The rail preference and its setter (a value or a toggle). */
export function useRail(): [boolean, (next: boolean | ((rail: boolean) => boolean)) => void] {
  const rail = useSyncExternalStore(subscribeRail, readRail, () => false);
  const set = useCallback((next: boolean | ((rail: boolean) => boolean)) => {
    writeRail(typeof next === "function" ? next(readRail()) : next);
  }, []);
  return [rail, set];
}
