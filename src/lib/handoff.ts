/**
 * A file passed from one tool to another — the audio pulled out of a video,
 * a converted file — without going through a download and a re-upload. The
 * file waits in IndexedDB under one well-known id; the next tool that opens
 * with an audio picker takes it, once.
 */
import { deleteFile, getFile, putFile } from "./fileStore";

const HANDOFF_ID = "handoff";
const NOTE_KEY = "musictools.handoff.v1";

export async function setHandoff(file: File, note?: string) {
  await putFile(HANDOFF_ID, file, file.name);
  try {
    sessionStorage.setItem(NOTE_KEY, JSON.stringify({ name: file.name, note: note ?? null, at: Date.now() }));
  } catch {
    // Without session storage the file still waits; only the note is lost.
  }
}

/** True when a file is waiting, without taking it. */
export function hasHandoff() {
  try {
    const raw = sessionStorage.getItem(NOTE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { at?: number };
    // A file left behind for an hour is stale, not a hand-off.
    return typeof parsed.at === "number" && Date.now() - parsed.at < 3_600_000;
  } catch {
    return false;
  }
}

/** The waiting file, and it stops waiting. */
export async function takeHandoff(): Promise<{ file: File; note: string | null } | null> {
  if (!hasHandoff()) return null;
  let note: string | null = null;
  try {
    const raw = sessionStorage.getItem(NOTE_KEY);
    note = raw ? ((JSON.parse(raw) as { note?: string | null }).note ?? null) : null;
    sessionStorage.removeItem(NOTE_KEY);
  } catch {
    // Fine.
  }
  const file = await getFile(HANDOFF_ID).catch(() => null);
  await deleteFile(HANDOFF_ID).catch(() => undefined);
  return file ? { file, note } : null;
}

/** Sends a file to a tool: stores it and navigates. */
export async function handOffTo(tool: string, file: File, note?: string) {
  await setHandoff(file, note);
  window.location.assign(`#/${tool}`);
}
