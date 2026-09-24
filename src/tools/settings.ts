import type { NoteEngineId } from "../lib/useTranscriber";
import type { DetectedNote, ViewMode } from "../lib/types";

const SETTINGS_KEY = "songtonotes.settings.v1";

export type Settings = {
  sensitivity: number;
  harmonicCleanup: number;
  minDuration: number;
  mode: ViewMode;
  stepsPerBeat: number;
  beatsPerMeasure: number;
  transpose: number;
  withChords: boolean;
  /** Which detector runs: the instant one, or the slow neural model. */
  engine: NoteEngineId;
  /** 0..1 — how far notes are pulled onto the beat grid. */
  quantize: number;
  /** 0..0.6 — how late every second grid step lands. */
  swing: number;
};

const DEFAULT_SETTINGS: Settings = {
  sensitivity: 62,
  harmonicCleanup: 0.6,
  minDuration: 0.08,
  mode: "melody",
  stepsPerBeat: 4,
  beatsPerMeasure: 4,
  transpose: 0,
  withChords: true,
  engine: "fast",
  quantize: 0,
  swing: 0,
};

/** Persists the detection settings so a return visit starts where it left off. */
export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing blocks storage; the settings simply do not persist.
  }
}

export function normalizeSettings(parsed: Partial<Settings> | null | undefined): Settings {
  if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS;
  const numberInRange = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(minimum, Math.min(maximum, value))
      : fallback;
  const stepsPerBeat = [1, 2, 3, 4, 8].includes(parsed.stepsPerBeat ?? 0)
    ? (parsed.stepsPerBeat as number)
    : DEFAULT_SETTINGS.stepsPerBeat;
  const beatsPerMeasure = [2, 3, 4, 6].includes(parsed.beatsPerMeasure ?? 0)
    ? (parsed.beatsPerMeasure as number)
    : DEFAULT_SETTINGS.beatsPerMeasure;
  return {
    sensitivity: numberInRange(parsed.sensitivity, DEFAULT_SETTINGS.sensitivity, 20, 90),
    harmonicCleanup: numberInRange(parsed.harmonicCleanup, DEFAULT_SETTINGS.harmonicCleanup, 0, 1),
    minDuration: numberInRange(parsed.minDuration, DEFAULT_SETTINGS.minDuration, 0.02, 0.3),
    mode: parsed.mode === "full" ? "full" : "melody",
    stepsPerBeat,
    beatsPerMeasure,
    transpose: Math.round(numberInRange(parsed.transpose, DEFAULT_SETTINGS.transpose, -12, 12)),
    withChords:
      typeof parsed.withChords === "boolean" ? parsed.withChords : DEFAULT_SETTINGS.withChords,
    engine: parsed.engine === "deep" ? "deep" : DEFAULT_SETTINGS.engine,
    quantize: numberInRange(parsed.quantize, DEFAULT_SETTINGS.quantize, 0, 1),
    swing: numberInRange(parsed.swing, DEFAULT_SETTINGS.swing, 0, 0.6),
  };
}

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(stored) as Partial<Settings> | null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type PendingTranscription = {
  title: string;
  notes: DetectedNote[];
  analysisOffset: number;
  settings: Settings;
};

