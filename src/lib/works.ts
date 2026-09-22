/**
 * The personal area's model: every piece of work a tool can save, in one shape.
 *
 * Two of the tools were already saving — transcriptions and ringtones, each in
 * a table of its own, and the Ringtones site reads that second table as well.
 * Rather than migrate them, this module reads all three sources and presents
 * a single list, with `origin` recording where each entry lives so a rename or
 * a delete goes back to the right table. The seven tools that had nothing to
 * save into write to `works`, whose tool-specific part is jsonb.
 *
 * Saving is local first, exactly the way ringtones already worked: the entry
 * is written to this device before anything is sent, so a visitor without an
 * account keeps a history, an offline save still succeeds, and signing in
 * later uploads whatever this device made in the meantime. The audio a tool
 * produced goes up with the work, into the visitor's private folder in the
 * cloud ({@link ./cloudFiles}), and a copy stays on the device that made it
 * ({@link ./fileStore}) for the fast, offline path.
 */
import {
  UploadTooLargeError,
  deleteWorkFile,
  uploadWorkFile,
} from "./cloudFiles";
import { deleteFile, getFile, listFiles, putFile } from "./fileStore";
import { deleteTranscription, listTranscriptions, type SavedTranscription } from "./history";
import {
  deleteRingtone,
  listLocalRingtones,
  listRingtones,
  setRingtoneFilePath,
  type SavedRingtone,
} from "./ringtoneHistory";
import { supabase } from "./supabase";

export const WORK_KINDS = [
  "notes",
  "ringtone",
  "vocals",
  "speed",
  "piano",
  "analysis",
  "ear",
  "metronome",
  "tuner",
  "transcript",
  "chords",
  "song",
  "convert",
  "rhythm",
  "mix",
  "lyrics",
  "tts",
] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export type WorkOrigin = "works" | "transcriptions" | "ringtones";

export type SavedWork = {
  /** Stable across devices: the id the creating device gave the work. */
  id: string;
  kind: WorkKind;
  title: string;
  sourceName: string | null;
  /** What the card shows: counts, tempo, key, duration. Small and flat. */
  summary: Record<string, unknown>;
  /** What the tool needs to open the work again. */
  payload: Record<string, unknown>;
  /** The result file's name, when the tool produced one. */
  fileName: string | null;
  /** The device holding a copy of that file. */
  deviceId: string | null;
  /** Where the file sits in the cloud, once it has gone up. */
  filePath: string | null;
  createdAt: string;
  updatedAt: string;
  origin: WorkOrigin;
  /** The server's own row id, for the two older tables. */
  rowId: string | null;
  /** True while this device is the only place the entry exists. */
  localOnly: boolean;
};

export type NewWork = {
  kind: WorkKind;
  title: string;
  sourceName?: string | null;
  summary?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

export const WORKS_KEY = "music-tools.works.v1";
const DEVICE_KEY = "music-tools.device.v1";
const LOCAL_LIMIT = 200;
const SERVER_LIMIT = 300;

export const KIND_LABELS: Record<WorkKind, string> = {
  notes: "תווים",
  ringtone: "צלצול",
  vocals: "הסרת שירה",
  speed: "גרסה לתרגול",
  piano: "הקלטת פסנתר",
  analysis: "קצב וסולם",
  ear: "אימון שמיעה",
  metronome: "קצב שמור",
  tuner: "כיוון כלי",
  transcript: "תמלול לטקסט",
  chords: "אקורדים",
  song: "שיר בשירון",
  convert: "קובץ מומר",
  rhythm: "אימון קצב",
  mix: "מיקס",
  lyrics: "מילים מסונכרנות",
  tts: "הקראה",
};

/** Which tool opens each kind. */
export const KIND_TOOL: Record<WorkKind, string> = {
  notes: "notes",
  ringtone: "ringtone",
  vocals: "vocals",
  speed: "speed",
  piano: "piano",
  analysis: "analyze",
  ear: "ear",
  metronome: "metronome",
  tuner: "tuner",
  transcript: "transcript",
  chords: "chords",
  song: "songbook",
  convert: "convert",
  rhythm: "rhythm",
  mix: "mixer",
  lyrics: "lyrics",
  tts: "tts",
};

export function isWorkKind(value: unknown): value is WorkKind {
  return typeof value === "string" && (WORK_KINDS as readonly string[]).includes(value);
}

export function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

/** A random id for this browser, so a card can say which device holds its file. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh = newId();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "this-device";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

/** Reads one stored entry, dropping anything that is not a work. */
export function normalizeWork(value: unknown): SavedWork | null {
  const item = asRecord(value);
  if (typeof item.id !== "string" || !item.id || !isWorkKind(item.kind)) return null;
  const createdAt = asString(item.createdAt, "");
  return {
    id: item.id,
    kind: item.kind,
    title: asString(item.title, KIND_LABELS[item.kind]),
    sourceName: typeof item.sourceName === "string" ? item.sourceName : null,
    summary: asRecord(item.summary),
    payload: asRecord(item.payload),
    fileName: typeof item.fileName === "string" ? item.fileName : null,
    deviceId: typeof item.deviceId === "string" ? item.deviceId : null,
    filePath: typeof item.filePath === "string" ? item.filePath : null,
    createdAt,
    updatedAt: asString(item.updatedAt, createdAt),
    origin: "works",
    rowId: null,
    localOnly: item.localOnly !== false,
  };
}

/** The works this device made, including any made without an account. */
export function listLocalWorks(): SavedWork[] {
  try {
    const value = JSON.parse(localStorage.getItem(WORKS_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .map(normalizeWork)
      .filter((item): item is SavedWork => item !== null)
      .slice(0, LOCAL_LIMIT);
  } catch {
    return [];
  }
}

function writeLocalWorks(items: SavedWork[]) {
  try {
    localStorage.setItem(WORKS_KEY, JSON.stringify(items.slice(0, LOCAL_LIMIT)));
  } catch {
    // Storage blocked; the profile copy is the one that matters then.
  }
}

// ---------------------------------------------------------------------------
// The server shape
// ---------------------------------------------------------------------------

type WorkRow = {
  id: string;
  client_id: string;
  kind: string;
  title: string;
  source_name: string | null;
  summary: unknown;
  payload: unknown;
  file_name: string | null;
  device_id: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
};

const WORK_COLUMNS =
  "id, client_id, kind, title, source_name, summary, payload, file_name, device_id, file_path, created_at, updated_at";

function fromRow(row: WorkRow): SavedWork | null {
  if (!isWorkKind(row.kind)) return null;
  return {
    id: row.client_id,
    kind: row.kind,
    title: row.title,
    sourceName: row.source_name,
    summary: asRecord(row.summary),
    payload: asRecord(row.payload),
    fileName: row.file_name,
    deviceId: row.device_id,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    origin: "works",
    rowId: row.id,
    localOnly: false,
  };
}

function toRow(item: SavedWork, userId: string) {
  return {
    user_id: userId,
    client_id: item.id,
    kind: item.kind,
    title: item.title,
    source_name: item.sourceName,
    summary: item.summary,
    payload: item.payload,
    file_name: item.fileName,
    device_id: item.deviceId,
    file_path: item.filePath,
    created_at: item.createdAt,
  };
}

// ---------------------------------------------------------------------------
// The two older tables, read into the same shape
// ---------------------------------------------------------------------------

export function fromTranscription(row: SavedTranscription): SavedWork {
  const notes = Array.isArray(row.raw_notes) ? row.raw_notes : [];
  return {
    id: row.id,
    kind: "notes",
    title: row.title,
    sourceName: row.source_name,
    summary: {
      noteCount: row.note_count,
      duration: row.duration_seconds,
      bpm: row.bpm,
      keyName: row.key_name,
    },
    payload: {
      notes,
      analysisOffset: row.analysis_offset,
      settings: asRecord(row.settings),
    },
    fileName: null,
    deviceId: null,
    filePath: null,
    createdAt: row.created_at,
    updatedAt: row.created_at,
    origin: "transcriptions",
    rowId: row.id,
    localOnly: false,
  };
}

export function fromRingtone(item: SavedRingtone, localOnly: boolean): SavedWork {
  return {
    id: item.id,
    kind: "ringtone",
    title: item.title,
    sourceName: item.sourceName || null,
    summary: { start: item.startSeconds, duration: item.durationSeconds },
    payload: { start: item.startSeconds, duration: item.durationSeconds },
    // The ringtone tool keeps its file under the ringtone's own id; whether
    // a copy is on this device is read from the file store, not from here.
    fileName: `${item.title}-ringtone.wav`,
    deviceId: null,
    filePath: item.filePath ?? null,
    createdAt: item.createdAt,
    updatedAt: item.createdAt,
    origin: "ringtones",
    rowId: null,
    localOnly,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export function sortNewestFirst(items: SavedWork[]) {
  return [...items].sort((a, b) =>
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
}

/**
 * Uploads what this device made while signed out, or while the server could
 * not be reached. Returns the entries now known to be on the server.
 */
export async function syncLocalWorks(userId: string): Promise<SavedWork[]> {
  const local = listLocalWorks();
  const pending = local.filter((item) => item.localOnly);
  let synced: SavedWork[] = [];
  if (pending.length > 0) {
    const { error } = await supabase
      .from("works")
      .upsert(
        pending.map((item) => toRow(item, userId)),
        { onConflict: "user_id,client_id" },
      );
    if (error) {
      console.warn("Local works could not be uploaded", error);
    } else {
      const uploaded = new Set(pending.map((item) => item.id));
      writeLocalWorks(
        local.map((item) => (uploaded.has(item.id) ? { ...item, localOnly: false } : item)),
      );
      synced = pending.map((item) => ({ ...item, localOnly: false }));
    }
  }
  await syncLocalFiles(userId);
  return synced;
}

/**
 * Sends up the files that are still only on this device — made while
 * signed out, or whose upload failed — and records where they went. Files
 * marked too large stay here for good.
 */
export async function syncLocalFiles(userId: string) {
  const waiting = listLocalWorks().filter(
    (item) => !item.localOnly && !item.filePath && item.fileName && !item.summary.fileTooLarge,
  );
  for (const item of waiting) {
    const file = await getFile(item.id);
    if (!file) continue;
    try {
      const filePath = await uploadWorkFile(userId, item.id, file);
      const { error } = await supabase
        .from("works")
        .update({ file_path: filePath })
        .eq("user_id", userId)
        .eq("client_id", item.id);
      if (error) throw error;
      writeLocalWorks(
        listLocalWorks().map((entry) => (entry.id === item.id ? { ...entry, filePath } : entry)),
      );
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        writeLocalWorks(
          listLocalWorks().map((entry) =>
            entry.id === item.id
              ? { ...entry, summary: { ...entry.summary, fileTooLarge: true } }
              : entry,
          ),
        );
      } else {
        console.warn("Work file could not be uploaded", error);
      }
    }
  }
  // Ringtones made before signing in: their rows go up in listRingtones;
  // their audio goes up here.
  const ringtones = listLocalRingtones().filter((item) => !item.filePath);
  for (const item of ringtones) {
    const file = await getFile(item.id);
    if (!file || file.size > 60 * 1024 * 1024) continue;
    try {
      const filePath = await uploadWorkFile(userId, item.id, file);
      await setRingtoneFilePath(item.id, filePath, userId);
    } catch (error) {
      console.warn("Ringtone file could not be uploaded", error);
    }
  }
}

/**
 * Everything the visitor saved, newest first: the works on the server plus
 * anything this device holds that the server does not yet, the older
 * transcriptions and ringtones, and — without an account, or when the server
 * cannot be reached — the local history alone.
 */
export async function listWorks(userId?: string | null): Promise<SavedWork[]> {
  const local = listLocalWorks();
  if (!userId) {
    const ringtones = listLocalRingtones().map((item) => fromRingtone(item, true));
    return sortNewestFirst([...local, ...ringtones]);
  }

  // Ringtone rows made while signed out go up inside listRingtones, and the
  // file sync that follows needs those rows to exist.
  const ringtones = await listRingtones(userId)
    .then((rows) => rows.map((item) => fromRingtone(item, false)))
    .catch(() => listLocalRingtones().map((item) => fromRingtone(item, true)));
  const [uploaded, remote, transcriptions] = await Promise.all([
    syncLocalWorks(userId).catch(() => [] as SavedWork[]),
    supabase
      .from("works")
      .select(WORK_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(SERVER_LIMIT)
      .then(({ data, error }) => {
        if (error) throw error;
        return ((data ?? []) as WorkRow[])
          .map(fromRow)
          .filter((item): item is SavedWork => item !== null);
      }),
    listTranscriptions(userId).then((rows) => rows.map(fromTranscription)),
  ]);
  // The file sync may have recorded cloud paths for ringtones since.
  const ringtonePaths = new Map(listLocalRingtones().map((item) => [item.id, item.filePath ?? null]));
  for (const item of ringtones) {
    if (!item.filePath && ringtonePaths.get(item.id)) item.filePath = ringtonePaths.get(item.id) ?? null;
  }

  // Whatever the server holds wins over the local copy of the same work,
  // except that the local index knows which entries are still unsynced.
  const byId = new Map<string, SavedWork>();
  for (const item of local) byId.set(item.id, item);
  for (const item of uploaded) byId.set(item.id, item);
  for (const item of remote) byId.set(item.id, item);
  // The server's copies refresh the local index so a rename made elsewhere
  // shows here after one visit.
  writeLocalWorks(
    sortNewestFirst(Array.from(byId.values())).filter((item) => item.origin === "works"),
  );

  return sortNewestFirst([...byId.values(), ...transcriptions, ...ringtones]);
}

// ---------------------------------------------------------------------------
// Saving, renaming, deleting
// ---------------------------------------------------------------------------

/**
 * Records a piece of work. It is written to this device first, then mirrored
 * to the profile when there is one — the result file included, into the
 * visitor's private folder in the cloud, with a copy kept here.
 */
export async function saveWork(
  input: NewWork,
  userId?: string | null,
  file?: File | Blob | null,
): Promise<SavedWork> {
  const now = new Date().toISOString();
  const fileName = file ? (file instanceof File ? file.name : `${input.title}.wav`) : null;
  const entry: SavedWork = {
    id: newId(),
    kind: input.kind,
    title: input.title.trim() || KIND_LABELS[input.kind],
    sourceName: input.sourceName ?? null,
    summary: input.summary ?? {},
    payload: input.payload ?? {},
    fileName,
    deviceId: fileName ? deviceId() : null,
    filePath: null,
    createdAt: now,
    updatedAt: now,
    origin: "works",
    rowId: null,
    localOnly: true,
  };

  if (file) {
    entry.summary = { ...entry.summary, fileBytes: file.size };
    const stored = await putFile(entry.id, file, fileName ?? undefined);
    if (!stored) entry.deviceId = null;
  }
  writeLocalWorks([entry, ...listLocalWorks()]);
  if (!userId) return entry;

  if (file) {
    try {
      entry.filePath = await uploadWorkFile(userId, entry.id, file);
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        entry.summary = { ...entry.summary, fileTooLarge: true };
      } else {
        // The device copy holds it; the next sign-in or profile read retries.
        console.warn("Work file could not be uploaded", error);
      }
    }
  }
  const { error } = await supabase
    .from("works")
    .upsert([toRow(entry, userId)], { onConflict: "user_id,client_id" });
  if (error) {
    // The local copy already holds it; the next profile read uploads it again.
    console.warn("Work could not be saved to the profile", error);
    writeLocalWorks(listLocalWorks().map((item) => (item.id === entry.id ? entry : item)));
    return entry;
  }
  const synced = { ...entry, localOnly: false };
  writeLocalWorks(listLocalWorks().map((item) => (item.id === entry.id ? synced : item)));
  return synced;
}

export async function renameWork(
  work: SavedWork,
  title: string,
  userId?: string | null,
): Promise<SavedWork> {
  const clean = title.trim().slice(0, 120);
  if (!clean) return work;
  const updated = { ...work, title: clean, updatedAt: new Date().toISOString() };

  if (work.origin === "works") {
    writeLocalWorks(listLocalWorks().map((item) => (item.id === work.id ? updated : item)));
  }
  if (!userId) return updated;

  const table =
    work.origin === "transcriptions"
      ? supabase.from("transcriptions").update({ title: clean }).eq("id", work.rowId ?? "").eq("user_id", userId)
      : work.origin === "ringtones"
        ? supabase.from("ringtones").update({ title: clean }).eq("client_id", work.id).eq("user_id", userId)
        : supabase.from("works").update({ title: clean }).eq("client_id", work.id).eq("user_id", userId);
  const { error } = await table;
  if (error) throw error;
  return updated;
}

export async function deleteWork(work: SavedWork, userId?: string | null): Promise<void> {
  await deleteFile(work.id);
  if (userId && work.filePath) {
    // A file that will not go is left for the next delete; the row is what
    // the visitor asked to remove.
    await deleteWorkFile(work.filePath).catch((error) =>
      console.warn("Work file could not be deleted", error),
    );
  }
  if (work.origin === "ringtones") {
    await deleteRingtone(work.id, userId);
    return;
  }
  if (work.origin === "transcriptions") {
    if (userId && work.rowId) await deleteTranscription(work.rowId, userId);
    return;
  }
  writeLocalWorks(listLocalWorks().filter((item) => item.id !== work.id));
  if (!userId) return;
  const { error } = await supabase
    .from("works")
    .delete()
    .eq("user_id", userId)
    .eq("client_id", work.id);
  if (error) throw error;
}

/**
 * Puts a deleted entry back, under its own id, as a plain work. The audio it
 * had is gone with the delete — the recycle bin keeps the record, not the
 * file — so the restored work opens from its payload and says so.
 */
export async function restoreWork(work: SavedWork, userId?: string | null): Promise<SavedWork> {
  const summary = { ...work.summary };
  delete summary.fileBytes;
  delete summary.fileTooLarge;
  const entry: SavedWork = {
    ...work,
    summary,
    fileName: null,
    deviceId: null,
    filePath: null,
    updatedAt: new Date().toISOString(),
    origin: "works",
    rowId: null,
    localOnly: true,
  };
  writeLocalWorks([entry, ...listLocalWorks().filter((item) => item.id !== entry.id)]);
  if (!userId) return entry;
  const { error } = await supabase
    .from("works")
    .upsert([toRow(entry, userId)], { onConflict: "user_id,client_id" });
  if (error) return entry;
  const synced = { ...entry, localOnly: false };
  writeLocalWorks(listLocalWorks().map((item) => (item.id === entry.id ? synced : item)));
  return synced;
}

/** The ids of works whose result file is on this device. */
export async function localFileIds(): Promise<Set<string>> {
  return new Set((await listFiles()).map((item) => item.id));
}

export { getFile as getWorkFile, listFiles as listWorkFiles };
export { downloadWorkFile, workFileUrl } from "./cloudFiles";

/**
 * One line for the card under the title — what the work is, in the terms of
 * the tool that made it.
 */
export function describeWork(work: SavedWork): string {
  const s = work.summary;
  const num = (key: string) => (typeof s[key] === "number" ? (s[key] as number) : null);
  const str = (key: string) => (typeof s[key] === "string" ? (s[key] as string) : null);
  const seconds = (value: number | null) =>
    value === null ? null : `${Math.round(value)} שניות`;
  const parts: (string | null)[] = [];

  switch (work.kind) {
    case "notes":
      parts.push(num("noteCount") !== null ? `${num("noteCount")} תווים` : null);
      parts.push(num("bpm") ? `${Math.round(num("bpm")!)} BPM` : null);
      parts.push(str("keyName"));
      break;
    case "ringtone":
      parts.push(seconds(num("duration")));
      parts.push(
        num("start") !== null ? `מ־${formatClock(num("start")!)}` : null,
      );
      break;
    case "vocals":
      parts.push(str("target") === "vocals" ? "שירה בלבד" : "קריוקי");
      parts.push(s.usedAi ? "הפרדת AI" : num("strength") !== null ? `עוצמה ${num("strength")}%` : null);
      parts.push(seconds(num("duration")));
      break;
    case "speed":
      parts.push(num("speed") !== null ? `${num("speed")}% מהירות` : null);
      parts.push(
        num("semitones")
          ? `${num("semitones")! > 0 ? "+" : ""}${num("semitones")} חצאי טונים`
          : null,
      );
      parts.push(seconds(num("duration")));
      break;
    case "piano":
      parts.push(num("noteCount") !== null ? `${num("noteCount")} תווים` : null);
      parts.push(seconds(num("duration")));
      parts.push(str("timbre") === "organ" ? "אורגן" : str("timbre") === "synth" ? "סינת׳" : null);
      break;
    case "analysis":
      parts.push(num("bpm") ? `${Math.round(num("bpm")!)} BPM` : null);
      parts.push(str("keyName"));
      parts.push(str("camelot") ? `Camelot ${str("camelot")}` : null);
      break;
    case "ear":
      parts.push(str("modeLabel"));
      parts.push(str("levelLabel"));
      parts.push(
        num("asked") !== null ? `${num("correct") ?? 0}/${num("asked")} נכונות` : null,
      );
      parts.push(num("accuracy") !== null ? `${num("accuracy")}% דיוק` : null);
      break;
    case "metronome":
      parts.push(num("bpm") !== null ? `${num("bpm")} BPM` : null);
      parts.push(str("meter"));
      parts.push(str("subdivisionLabel"));
      break;
    case "tuner":
      parts.push(str("presetLabel"));
      parts.push(num("referenceA4") !== null ? `לה = ${num("referenceA4")} Hz` : null);
      break;
    case "transcript":
      parts.push(num("words") !== null ? `${num("words")} מילים` : null);
      parts.push(str("languageLabel"));
      parts.push(seconds(num("duration")));
      break;
    case "chords":
      parts.push(num("chordCount") !== null ? `${num("chordCount")} אקורדים` : null);
      parts.push(str("unique"));
      parts.push(num("capo") ? `קאפו ${num("capo")}` : null);
      parts.push(seconds(num("duration")));
      break;
    case "song":
      parts.push(num("lines") !== null ? `${num("lines")} שורות` : null);
      parts.push(str("chords"));
      parts.push(num("transpose") ? `טרנספוזיציה ${num("transpose")! > 0 ? "+" : ""}${num("transpose")}` : null);
      break;
    case "convert":
      parts.push(str("format")?.toUpperCase() ?? null);
      parts.push(num("sampleRate") ? `${Math.round(num("sampleRate")! / 1000)} kHz` : null);
      parts.push(seconds(num("duration")));
      break;
    case "rhythm":
      parts.push(str("levelLabel"));
      parts.push(num("accuracy") !== null ? `${num("accuracy")}% דיוק` : null);
      parts.push(num("bpm") ? `${num("bpm")} BPM` : null);
      break;
    case "mix":
      parts.push(num("tracks") !== null ? `${num("tracks")} ערוצים` : null);
      parts.push(seconds(num("duration")));
      break;
    case "lyrics":
      parts.push(num("lines") !== null ? `${num("lines")} שורות` : null);
      parts.push(str("languageLabel"));
      parts.push(seconds(num("duration")));
      break;
    case "tts":
      parts.push(num("characters") !== null ? `${num("characters")} תווים` : null);
      parts.push(str("voice"));
      parts.push(seconds(num("duration")));
      break;
  }
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
