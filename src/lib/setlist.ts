/**
 * The setlist's model: named lists of songs and breaks for a gig, with the
 * arithmetic a band needs on the night — how long each item runs, when it
 * starts, how long the whole set is and whether it fits the slot.
 *
 * Everything here is pure so it can be tested without a browser; the only
 * side effects are the two thin localStorage wrappers at the bottom, which
 * take the storage as a parameter for the same reason.
 */
import { transposeChord } from "./songbook";

export const SETLIST_STORAGE_KEY = "musictools.setlists.v1";

/** A song imported without a known length gets a typical pop-song length, so the total is useful from the start. */
export const DEFAULT_SONG_SECONDS = 4 * 60;
export const DEFAULT_BREAK_SECONDS = 15 * 60;
/** Within this many seconds of the target the set counts as "on time"; a band cannot plan tighter than that. */
export const TARGET_TOLERANCE_SECONDS = 60;

const MAX_DURATION = 5 * 60 * 60;
const MAX_TEXT = 200;
const MAX_NOTES = 500;
// A song body is only a snapshot for the stage view; cap it so one pasted novel cannot fill the storage quota.
const MAX_BODY = 20_000;
const MAX_ENTRIES = 300;
const MAX_SETLISTS = 60;

export type EntryType = "song" | "break";

export type SetEntry = {
  id: string;
  type: EntryType;
  title: string;
  /** Free text: "Am", "F#", "דו מז'ור" — whatever the band calls it. */
  key: string;
  bpm: number | null;
  /** Seconds. */
  duration: number;
  notes: string;
  /** The saved songbook song this entry came from, when it came from one. */
  workId: string | null;
  /** A copy of that song's text, so the stage can show it offline and after the song was deleted. */
  songBody: string | null;
  songTranspose: number;
};

export type Setlist = {
  id: string;
  name: string;
  entries: SetEntry[];
  /** The slot the band was given, in minutes; null when there is none. */
  targetMinutes: number | null;
  /** "HH:MM" when the set starts, so each song gets a clock time; null shows offsets instead. */
  startTime: string | null;
  updatedAt: string;
};

export type SetlistStore = {
  version: 1;
  activeId: string;
  setlists: Setlist[];
};

export function newSetlistId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Older browsers without randomUUID fall through to the timestamp id.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * "3:45" → 225, "1:02:30" → 3750, "4" → 240 (a bare number is minutes, the
 * way musicians say it), "3.5" → 210. Anything else — empty, negative,
 * seconds over 59 — is null, so a typo never turns into a silent zero.
 */
export function parseDuration(text: string): number | null {
  const value = text.trim().replace(/[׳']/g, ":").replace(/\s+/g, "");
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const seconds = Math.round(Number(value) * 60);
    return seconds <= MAX_DURATION ? seconds : null;
  }
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  // Only the leading field may exceed 59; "3:75" is a typo, not 4:15.
  if (numbers.slice(1).some((part) => part > 59)) return null;
  const seconds = parts.length === 3 ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2] : numbers[0] * 60 + numbers[1];
  return seconds <= MAX_DURATION ? seconds : null;
}

/** 225 → "3:45", 3750 → "1:02:30". Negative values are shown by magnitude; callers say "over"/"under" in words. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.round(Math.abs(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

// ---------------------------------------------------------------------------
// Entries and totals
// ---------------------------------------------------------------------------

export function makeSong(fields: Partial<Omit<SetEntry, "type">> & { title: string }, id = newSetlistId()): SetEntry {
  return {
    id,
    type: "song",
    title: fields.title.slice(0, MAX_TEXT),
    key: (fields.key ?? "").slice(0, 40),
    bpm: normalizeBpm(fields.bpm),
    duration: clampDuration(fields.duration ?? DEFAULT_SONG_SECONDS),
    notes: (fields.notes ?? "").slice(0, MAX_NOTES),
    workId: fields.workId ?? null,
    songBody: fields.songBody ? fields.songBody.slice(0, MAX_BODY) : null,
    songTranspose: clampTranspose(fields.songTranspose ?? 0),
  };
}

export function makeBreak(duration = DEFAULT_BREAK_SECONDS, id = newSetlistId(), title = ""): SetEntry {
  return { id, type: "break", title: title.slice(0, MAX_TEXT), key: "", bpm: null, duration: clampDuration(duration), notes: "", workId: null, songBody: null, songTranspose: 0 };
}

export function makeSetlist(name: string, id = newSetlistId(), now = new Date().toISOString()): Setlist {
  return { id, name: name.slice(0, MAX_TEXT), entries: [], targetMinutes: null, startTime: null, updatedAt: now };
}

/** A copy with fresh ids everywhere, so editing the copy never touches the original. */
export function duplicateSetlist(source: Setlist, name: string, makeId: () => string = newSetlistId, now = new Date().toISOString()): Setlist {
  return { ...source, id: makeId(), name: name.slice(0, MAX_TEXT), entries: source.entries.map((entry) => ({ ...entry, id: makeId() })), updatedAt: now };
}

export type SetTotals = { songs: number; breaks: number; total: number; songCount: number; breakCount: number };

export function setTotals(entries: SetEntry[]): SetTotals {
  const totals: SetTotals = { songs: 0, breaks: 0, total: 0, songCount: 0, breakCount: 0 };
  for (const entry of entries) {
    if (entry.type === "break") {
      totals.breaks += entry.duration;
      totals.breakCount += 1;
    } else {
      totals.songs += entry.duration;
      totals.songCount += 1;
    }
  }
  totals.total = totals.songs + totals.breaks;
  return totals;
}

/** How far into the set each entry starts, in seconds. */
export function runningStarts(entries: SetEntry[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const entry of entries) {
    starts.push(at);
    at += entry.duration;
  }
  return starts;
}

/**
 * The number shown next to each entry. Breaks are not numbered — on a band's
 * printed list "song 7" means the seventh song, whatever breaks came before.
 */
export function songNumbers(entries: SetEntry[]): (number | null)[] {
  let count = 0;
  return entries.map((entry) => (entry.type === "song" ? ++count : null));
}

/** Validates "HH:MM" (24h); anything else is null. */
export function normalizeStartTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/** "20:30" plus 45 minutes → "21:15"; wraps past midnight because gigs do. */
export function clockAt(startTime: string, offsetSeconds: number): string {
  const start = normalizeStartTime(startTime);
  if (!start) return "";
  const [hours, minutes] = start.split(":").map(Number);
  const total = Math.floor((hours * 3600 + minutes * 60 + Math.max(0, offsetSeconds)) / 60);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

export type TargetStatus = { state: "over" | "under" | "on"; diff: number };

/** Compares the set with the slot; diff is total minus target, in seconds. */
export function targetStatus(totalSeconds: number, targetMinutes: number | null): TargetStatus | null {
  if (targetMinutes === null || !(targetMinutes > 0)) return null;
  const diff = totalSeconds - targetMinutes * 60;
  if (Math.abs(diff) <= TARGET_TOLERANCE_SECONDS) return { state: "on", diff };
  return { state: diff > 0 ? "over" : "under", diff };
}

/** A new array with one item moved; out-of-range indexes leave the list as it was. */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Importing from the songbook
// ---------------------------------------------------------------------------

/**
 * A guess at the key from the first chord of the sheet (moved by the saved
 * transposition): most songs open on their tonic. The field stays editable,
 * so a wrong guess costs one tap rather than a wrong number on stage.
 */
export function guessSongKey(body: string, transpose = 0): string {
  for (const match of body.matchAll(/\[([^\]]+)\]/g)) {
    const name = match[1].trim();
    const chord = name.match(/^([A-G][#b]?)(m(?!aj))?/);
    if (!chord) continue;
    const root = transposeChord(chord[1], transpose);
    return `${root}${chord[2] ? "m" : ""}`;
  }
  return "";
}

/** The subset of a saved work that the importer reads, so tests need not build a whole SavedWork. */
export type SongSource = { id: string; title: string; payload: Record<string, unknown>; summary?: Record<string, unknown> };

export function entryFromSong(work: SongSource, id = newSetlistId()): SetEntry {
  const body = typeof work.payload.body === "string" ? work.payload.body : "";
  const transpose = typeof work.payload.transpose === "number" ? work.payload.transpose : 0;
  // The songbook does not store a tempo yet; take one if a future version does.
  const bpm = typeof work.payload.bpm === "number" ? work.payload.bpm : typeof work.summary?.bpm === "number" ? work.summary.bpm : null;
  const duration = typeof work.payload.duration === "number" && work.payload.duration > 0 ? work.payload.duration : DEFAULT_SONG_SECONDS;
  return makeSong({ title: work.title || "שיר", key: guessSongKey(body, transpose), bpm, duration, workId: work.id, songBody: body || null, songTranspose: transpose }, id);
}

/**
 * Refreshes the song text of linked entries from the saved songs, keeping
 * whatever the band typed (title, key, notes). Returns the same array when
 * nothing changed so React can skip a render and a storage write.
 */
export function refreshLinkedSongs(entries: SetEntry[], songs: SongSource[]): SetEntry[] {
  const byId = new Map(songs.map((song) => [song.id, song]));
  let changed = false;
  const next = entries.map((entry) => {
    const song = entry.workId ? byId.get(entry.workId) : undefined;
    if (!song) return entry;
    const body = typeof song.payload.body === "string" ? song.payload.body.slice(0, MAX_BODY) : null;
    const transpose = typeof song.payload.transpose === "number" ? clampTranspose(song.payload.transpose) : 0;
    if (body === entry.songBody && transpose === entry.songTranspose) return entry;
    changed = true;
    return { ...entry, songBody: body, songTranspose: transpose };
  });
  return changed ? next : entries;
}

/** Hebrew counts read "שיר אחד", not "1 שירים". */
export function songCountLabel(count: number): string {
  return count === 1 ? "שיר אחד" : `${count} שירים`;
}

export function breakCountLabel(count: number): string {
  return count === 1 ? "הפסקה אחת" : `${count} הפסקות`;
}

// ---------------------------------------------------------------------------
// Text export
// ---------------------------------------------------------------------------

/**
 * The list as plain text for a WhatsApp message to the band: numbered songs
 * with key and tempo, breaks on their own line, and the total at the end.
 */
export function setlistToText(setlist: Setlist): string {
  const numbers = songNumbers(setlist.entries);
  const starts = runningStarts(setlist.entries);
  const lines: string[] = [setlist.name.trim() || "סט־ליסט"];
  if (setlist.startTime) lines.push(`התחלה: ${setlist.startTime}`);
  lines.push("");
  setlist.entries.forEach((entry, index) => {
    const clock = setlist.startTime ? `${clockAt(setlist.startTime, starts[index])} ` : "";
    if (entry.type === "break") {
      lines.push(`${clock}— ${entry.title.trim() || "הפסקה"} (${formatDuration(entry.duration)}) —`);
      return;
    }
    const details = [entry.key.trim(), entry.bpm ? `${entry.bpm} BPM` : ""].filter(Boolean).join(", ");
    const notes = entry.notes.trim() ? ` · ${entry.notes.trim().replace(/\s*\n\s*/g, " ")}` : "";
    lines.push(`${clock}${numbers[index]}. ${entry.title.trim() || "ללא שם"}${details ? ` (${details})` : ""} ${formatDuration(entry.duration)}${notes}`);
  });
  const totals = setTotals(setlist.entries);
  lines.push("");
  lines.push(`סה״כ ${formatDuration(totals.total)} · ${songCountLabel(totals.songCount)}${totals.breakCount ? ` · ${breakCountLabel(totals.breakCount)}` : ""}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Storage: parse with validation, serialise
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampDuration(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(MAX_DURATION, number));
}

function clampTranspose(value: number): number {
  return Number.isFinite(value) ? Math.max(-11, Math.min(11, Math.round(value))) : 0;
}

export function normalizeBpm(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(20, Math.min(400, Math.round(value)));
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** One stored entry, or null when it is not recognisably an entry. */
export function normalizeEntry(value: unknown): SetEntry | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
  if (value.type !== "song" && value.type !== "break") return null;
  if (typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0) return null;
  if (value.type === "break") return makeBreak(value.duration, value.id, text(value.title, MAX_TEXT));
  if (typeof value.title !== "string") return null;
  return {
    id: value.id,
    type: "song",
    title: text(value.title, MAX_TEXT),
    key: text(value.key, 40),
    bpm: normalizeBpm(value.bpm),
    duration: clampDuration(value.duration),
    notes: text(value.notes, MAX_NOTES),
    workId: typeof value.workId === "string" && value.workId ? value.workId : null,
    songBody: typeof value.songBody === "string" && value.songBody ? value.songBody.slice(0, MAX_BODY) : null,
    songTranspose: typeof value.songTranspose === "number" ? clampTranspose(value.songTranspose) : 0,
  };
}

export function normalizeSetlist(value: unknown): Setlist | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !Array.isArray(value.entries)) return null;
  const seen = new Set<string>();
  const entries: SetEntry[] = [];
  for (const raw of value.entries.slice(0, MAX_ENTRIES)) {
    const entry = normalizeEntry(raw);
    // Duplicate ids would confuse React keys and drag targets; drop the repeat.
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  const target = typeof value.targetMinutes === "number" && Number.isFinite(value.targetMinutes) && value.targetMinutes > 0 ? Math.min(600, Math.round(value.targetMinutes)) : null;
  return {
    id: value.id,
    name: text(value.name, MAX_TEXT),
    entries,
    targetMinutes: target,
    startTime: normalizeStartTime(value.startTime),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

/**
 * Reads what was stored. Returns null for anything that is not a version-1
 * store with at least one valid setlist — the caller then starts fresh rather
 * than rendering half a broken object. Individual bad entries are dropped.
 */
export function parseStore(raw: string | null): SetlistStore | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.setlists)) return null;
  const seen = new Set<string>();
  const setlists: Setlist[] = [];
  for (const item of data.setlists.slice(0, MAX_SETLISTS)) {
    const setlist = normalizeSetlist(item);
    if (!setlist || seen.has(setlist.id)) continue;
    seen.add(setlist.id);
    setlists.push(setlist);
  }
  if (!setlists.length) return null;
  const activeId = typeof data.activeId === "string" && seen.has(data.activeId) ? data.activeId : setlists[0].id;
  return { version: 1, activeId, setlists };
}

export function serializeStore(store: SetlistStore): string {
  return JSON.stringify(store);
}

export function initialStore(name = "ההופעה הבאה"): SetlistStore {
  const first = makeSetlist(name);
  return { version: 1, activeId: first.id, setlists: [first] };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some privacy modes throw on the mere access.
    return null;
  }
}

export function loadStore(storage: StorageLike | null = defaultStorage()): SetlistStore {
  try {
    return parseStore(storage?.getItem(SETLIST_STORAGE_KEY) ?? null) ?? initialStore();
  } catch {
    return initialStore();
  }
}

/** Returns false when the write failed (quota, private mode) so the page can say so. */
export function saveStore(store: SetlistStore, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETLIST_STORAGE_KEY, serializeStore(store));
    return true;
  } catch {
    return false;
  }
}
