/**
 * The undo behind a delete.
 *
 * Deleting a work in the personal area removes it from the account, but a copy
 * of the entry waits here for thirty days first, in this browser, so a slip of
 * the finger is a slip and not a loss. The audio file itself is not kept — it
 * can be large, and the entry is what people actually mourn.
 */
import { normalizeWork, type SavedWork } from "./works";

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
    const entries: TrashEntry[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || typeof (entry as TrashEntry).deletedAt !== "string") continue;
      // A stored entry is read like any other work, so one with a missing
      // title or summary cannot take the recycle bin down when it renders.
      const raw = (entry as TrashEntry).work as unknown;
      const work = normalizeWork(raw);
      if (!work) continue;
      const origin = (raw as SavedWork).origin;
      entries.push({
        work: { ...work, origin: origin === "transcriptions" || origin === "ringtones" ? origin : "works" },
        deletedAt: (entry as TrashEntry).deletedAt,
      });
    }
    return pruneTrash(entries, now);
  } catch {
    return [];
  }
}

export function listTrash(now: Date = new Date()): TrashEntry[] {
  return parseTrash(store()?.getItem(TRASH_KEY) ?? null, now);
}

function write(entries: TrashEntry[]) {
  try {
    store()?.setItem(TRASH_KEY, JSON.stringify(entries));
  } catch {
    // A full or blocked storage loses the undo, never the delete itself.
  }
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
