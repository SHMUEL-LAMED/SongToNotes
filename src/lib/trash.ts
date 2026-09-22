/**
 * The undo behind a delete.
 *
 * Deleting a work in the personal area removes it from the account, but a copy
 * of the entry waits here for thirty days first, in this browser, so a slip of
 * the finger is a slip and not a loss. The audio file itself is not kept — it
 * can be large, and the entry is what people actually mourn.
 */
import type { SavedWork } from "./works";

export type TrashEntry = { work: SavedWork; deletedAt: string };

export const TRASH_KEY = "music-tools.trash.v1";
export const TRASH_DAYS = 30;
const MAX_ENTRIES = 60;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Entries still within their thirty days, newest first. */
export function pruneTrash(entries: readonly TrashEntry[], now: Date = new Date()): TrashEntry[] {
  const floor = now.getTime() - TRASH_DAYS * 86_400_000;
  return entries
    .filter((entry) => {
      const at = new Date(entry.deletedAt).getTime();
      return Number.isFinite(at) && at >= floor;
    })
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    .slice(0, MAX_ENTRIES);
}

export function parseTrash(raw: string | null, now: Date = new Date()): TrashEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const entries = value.filter(
      (entry): entry is TrashEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as TrashEntry).deletedAt === "string" &&
        Boolean((entry as TrashEntry).work?.id),
    );
    return pruneTrash(entries, now);
  } catch {
    return [];
  }
}

export function listTrash(now: Date = new Date()): TrashEntry[] {
  return parseTrash(store()?.getItem(TRASH_KEY) ?? null, now);
}

function write(entries: TrashEntry[]) {
  store()?.setItem(TRASH_KEY, JSON.stringify(entries));
}

export function pushToTrash(work: SavedWork, now: Date = new Date()) {
  const entries = pruneTrash(
    [{ work, deletedAt: now.toISOString() }, ...listTrash(now).filter((entry) => entry.work.id !== work.id)],
    now,
  );
  write(entries);
  return entries;
}

export function removeFromTrash(id: string) {
  const entries = listTrash().filter((entry) => entry.work.id !== id);
  write(entries);
  return entries;
}

export function clearTrash() {
  write([]);
}
