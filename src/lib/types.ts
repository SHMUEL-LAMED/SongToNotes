export type DetectedNote = {
  midi: number;
  start: number;
  duration: number;
  confidence: number;
};

export type ViewMode = "melody" | "full";

export type Meter = { beats: number; beatType: number };

export type Tempo = {
  bpm: number;
  /** Seconds before the first downbeat of bar 1. */
  offset: number;
  /** 0..1 — how convincingly the onsets fit this grid. */
  fit: number;
};

export type KeySignature = {
  /** Position on the circle of fifths, -7..7. */
  fifths: number;
  mode: "major" | "minor";
  tonicPitchClass: number;
  /** 0..1 — correlation strength of the winning profile. */
  fit: number;
};
