/**
 * The chord-changes drill: two chords, one minute, count how many times you
 * move cleanly between them. It is the fastest way a beginner gets chord
 * changes into their hands, and the number going up week by week is the
 * whole motivation — so every result is kept, per pair, on this device.
 */
import type { ChordQuality } from "./audioChords";
import { guitarShape } from "./guitarShapes";
import { GUITAR_STRINGS } from "./theory";

export type DrillChord = { id: string; root: number; quality: ChordQuality };

/** The open chords a beginner meets first, in roughly the order they meet them. */
export const DRILL_CHORDS: DrillChord[] = [
  { id: "Em", root: 4, quality: "m" },
  { id: "Am", root: 9, quality: "m" },
  { id: "D", root: 2, quality: "" },
  { id: "A", root: 9, quality: "" },
  { id: "E", root: 4, quality: "" },
  { id: "G", root: 7, quality: "" },
  { id: "C", root: 0, quality: "" },
  { id: "Dm", root: 2, quality: "m" },
  { id: "E7", root: 4, quality: "7" },
  { id: "A7", root: 9, quality: "7" },
  { id: "D7", root: 2, quality: "7" },
  { id: "G7", root: 7, quality: "7" },
  { id: "C7", root: 0, quality: "7" },
  { id: "Fmaj7", root: 5, quality: "maj7" },
  { id: "F", root: 5, quality: "" },
];

/** Pairs worth drilling, easy first. */
export const SUGGESTED_PAIRS: [string, string][] = [
  ["Em", "Am"],
  ["A", "D"],
  ["D", "E"],
  ["Am", "E"],
  ["G", "C"],
  ["C", "Am"],
  ["G", "D"],
  ["Em", "C"],
  ["Dm", "Am"],
  ["C", "Fmaj7"],
  ["C", "F"],
  ["G", "Em"],
];

export function findDrillChord(id: string) {
  return DRILL_CHORDS.find((chord) => chord.id === id) ?? null;
}

/** The same key for A→B and B→A: a change is a change either way. */
export function pairKey(a: string, b: string) {
  return [a, b].sort().join("|");
}

export type DrillResult = { pair: string; changes: number; seconds: number; at: string };

/** Changes per minute, whatever the drill's length. */
export function perMinute(result: Pick<DrillResult, "changes" | "seconds">) {
  return result.seconds > 0 ? Math.round((result.changes * 60) / result.seconds) : 0;
}

const HISTORY_KEY = "musictools.changes.v1";
const HISTORY_LIMIT = 400;

export function normalizeHistory(raw: unknown): DrillResult[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is DrillResult =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as DrillResult).pair === "string" &&
        Number.isFinite((item as DrillResult).changes) &&
        Number.isFinite((item as DrillResult).seconds) &&
        (item as DrillResult).seconds > 0 &&
        typeof (item as DrillResult).at === "string",
    )
    .slice(-HISTORY_LIMIT);
}

export function readHistory(): DrillResult[] {
  try {
    return normalizeHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function writeHistory(history: DrillResult[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    // Kept for this visit only.
  }
}

/** The best rate so far for a pair, and the last few results in order. */
export function pairStats(history: DrillResult[], pair: string, recent = 10) {
  const own = history.filter((item) => item.pair === pair);
  const best = own.reduce((max, item) => Math.max(max, perMinute(item)), 0);
  return { best, runs: own.length, recent: own.slice(-recent) };
}

/** MIDI notes of the chord as it is fingered, low string first, for a strum. */
export function strumNotes(chord: DrillChord) {
  const shape = guitarShape(chord.root, chord.quality);
  return shape.frets.flatMap((fret, string) => (fret < 0 ? [] : [GUITAR_STRINGS[string] + fret]));
}
