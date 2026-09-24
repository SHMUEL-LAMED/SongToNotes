/**
 * Pulls played notes toward the beat grid. Strength 1 snaps them onto it
 * exactly, the way a notation program would; anything less keeps part of
 * the player's feel, which is how producers quantize. Swing delays every
 * second step of the grid, so straight eighths become a shuffle.
 */
import type { DetectedNote } from "./types";

export type QuantizeOptions = {
  bpm: number;
  /** Seconds before the first downbeat. */
  offset: number;
  stepsPerBeat: number;
  /** 0..1 — how far each note moves toward the grid. */
  strength: number;
  /** 0..0.6 — how late the off-steps land, as a share of a step. */
  swing: number;
};

/** Where grid step `step` falls, in seconds, with swing on the odd steps. */
export function gridTime(step: number, options: Pick<QuantizeOptions, "bpm" | "offset" | "stepsPerBeat" | "swing">) {
  const stepSeconds = 60 / options.bpm / options.stepsPerBeat;
  const odd = Math.abs(step % 2) === 1;
  return options.offset + step * stepSeconds + (odd ? options.swing * stepSeconds : 0);
}

/** The grid step nearest to a time, allowing for swing. */
export function nearestStep(time: number, options: Pick<QuantizeOptions, "bpm" | "offset" | "stepsPerBeat" | "swing">) {
  const stepSeconds = 60 / options.bpm / options.stepsPerBeat;
  const guess = Math.round((time - options.offset) / stepSeconds);
  let best = guess;
  let bestDistance = Infinity;
  for (const step of [guess - 1, guess, guess + 1]) {
    const distance = Math.abs(gridTime(step, options) - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = step;
    }
  }
  return best;
}

export function quantizeNotes(notes: DetectedNote[], options: QuantizeOptions): DetectedNote[] {
  const strength = Math.max(0, Math.min(1, options.strength));
  if (strength === 0 || !(options.bpm > 0) || !(options.stepsPerBeat > 0)) return notes;
  const minimum = (60 / options.bpm / options.stepsPerBeat) * 0.5;
  return notes.map((note) => {
    const startStep = nearestStep(note.start, options);
    const endStep = Math.max(startStep + 1, nearestStep(note.start + note.duration, options));
    const targetStart = gridTime(startStep, options);
    const targetEnd = gridTime(endStep, options);
    const start = Math.max(0, note.start + (targetStart - note.start) * strength);
    const end = note.start + note.duration + (targetEnd - note.start - note.duration) * strength;
    return { ...note, start, duration: Math.max(Math.min(minimum, note.duration), end - start) };
  });
}
