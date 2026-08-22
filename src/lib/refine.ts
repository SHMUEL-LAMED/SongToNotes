import type { DetectedNote, ViewMode } from "./types";

export type RefineOptions = {
  /** 0..1 — drops notes the model was least sure about. */
  minConfidence: number;
  /** 0..1 — how hard to push on removing overtones of louder notes. */
  harmonicCleanup: number;
  /** Notes shorter than this are treated as detection noise, in seconds. */
  minDuration: number;
  /** Inclusive MIDI range to keep. */
  lowestMidi: number;
  highestMidi: number;
  mode: ViewMode;
};

export const DEFAULT_REFINE: RefineOptions = {
  minConfidence: 0.3,
  harmonicCleanup: 0.6,
  minDuration: 0.08,
  lowestMidi: 21,
  highestMidi: 108,
  mode: "melody",
};

/**
 * Intervals, in semitones, at which a partial of a sounding note is mistaken
 * for a note of its own: octave, octave+fifth, two octaves, and so on up the
 * harmonic series.
 */
const HARMONIC_INTERVALS = [12, 19, 24, 28, 31, 34, 36];

const noteEnd = (note: DetectedNote) => note.start + note.duration;

/** Re-joins fragments the model split inside one sustained note. */
export function mergeFragments(
  notes: DetectedNote[],
  maxGap = 0.035,
): DetectedNote[] {
  const byPitch = new Map<number, DetectedNote[]>();
  notes.forEach((note) => {
    const bucket = byPitch.get(note.midi);
    if (bucket) bucket.push(note);
    else byPitch.set(note.midi, [note]);
  });

  const merged: DetectedNote[] = [];
  byPitch.forEach((bucket) => {
    bucket.sort((a, b) => a.start - b.start);
    let current = { ...bucket[0] };
    for (let index = 1; index < bucket.length; index += 1) {
      const next = bucket[index];
      const gap = next.start - noteEnd(current);
      const adjacent = gap <= maxGap && gap > -0.5 * current.duration;

      if (!adjacent) {
        merged.push(current);
        current = { ...next };
        continue;
      }

      // A brief, faint blip immediately before a solid note is the model
      // hearing the attack twice. Keeping it would put a grace note in front
      // of the first beat, so the sliver is dropped and the real note stands.
      if (current.duration < 0.1 && current.confidence < 0.5) {
        current = { ...next };
        continue;
      }

      // A tail is a sliver, a piece much shorter than what it follows, or a
      // clearly quieter continuation. Anything more substantial is a genuine
      // re-attack and must stay a separate note — merging those is what used
      // to turn two repeated quarter notes into one half note.
      const isTail =
        next.duration < 0.1 ||
        next.duration < current.duration * 0.45 ||
        next.confidence < current.confidence * 0.6;

      if (isTail) {
        const end = Math.max(noteEnd(current), noteEnd(next));
        const weight = current.duration + next.duration || 1;
        current.confidence =
          (current.confidence * current.duration +
            next.confidence * next.duration) /
          weight;
        current.duration = end - current.start;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  });

  return merged.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Removes notes that are really overtones of a louder note sounding at the
 * same moment. A partial is only dropped when it starts with its fundamental
 * and is clearly quieter, so genuine octave doublings survive.
 */
export function suppressHarmonics(
  notes: DetectedNote[],
  strength: number,
): DetectedNote[] {
  if (strength <= 0 || notes.length < 2) return notes;

  // A partial is expected to be far weaker than its fundamental. At full
  // strength anything below 72% of the fundamental goes; at low strength only
  // the very faint ghosts do.
  const ratio = 0.32 + strength * 0.4;
  const onsetTolerance = 0.03 + strength * 0.05;

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const removed = new Set<number>();
  let windowStart = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const note = sorted[index];
    while (
      windowStart < index &&
      noteEnd(sorted[windowStart]) < note.start - 0.01
    ) {
      windowStart += 1;
    }

    for (let other = windowStart; other < sorted.length; other += 1) {
      if (other === index) continue;
      const parent = sorted[other];
      if (parent.start > note.start + onsetTolerance) break;
      if (removed.has(other)) continue;

      const interval = note.midi - parent.midi;
      if (!HARMONIC_INTERVALS.includes(interval)) continue;
      if (note.confidence > parent.confidence * ratio) continue;
      // The fundamental has to still be sounding where the partial begins.
      if (noteEnd(parent) < note.start + Math.min(0.08, note.duration * 0.5)) {
        continue;
      }

      removed.add(index);
      break;
    }
  }

  return sorted.filter((_, index) => !removed.has(index));
}

/**
 * Reduces overlapping notes to a single line. Scores each candidate on how
 * confident the model was and how high it sits, then smooths the choice over
 * time so the melody does not flicker between neighbouring voices.
 */
export function extractMelody(notes: DetectedNote[]): DetectedNote[] {
  if (notes.length < 2) return notes;

  const FRAME = 0.02;
  const span = notes.reduce((max, note) => Math.max(max, noteEnd(note)), 0);
  const frameCount = Math.ceil(span / FRAME) + 1;
  if (frameCount <= 0) return notes;

  const active: number[][] = Array.from({ length: frameCount }, () => []);
  notes.forEach((note, index) => {
    const from = Math.max(0, Math.floor(note.start / FRAME));
    const to = Math.min(frameCount - 1, Math.ceil(noteEnd(note) / FRAME));
    for (let frame = from; frame <= to; frame += 1) active[frame].push(index);
  });

  const chosen = new Int32Array(frameCount).fill(-1);
  let previous = -1;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const candidates = active[frame];
    if (!candidates.length) {
      previous = -1;
      continue;
    }
    let lowest = Infinity;
    let highest = -Infinity;
    candidates.forEach((index) => {
      lowest = Math.min(lowest, notes[index].midi);
      highest = Math.max(highest, notes[index].midi);
    });
    const range = Math.max(1, highest - lowest);

    let best = candidates[0];
    let bestScore = -Infinity;
    candidates.forEach((index) => {
      const note = notes[index];
      const height = (note.midi - lowest) / range;
      // Melodies usually sit on top, but a strong inner voice still wins over
      // a faint high partial.
      let score = note.confidence * 0.55 + height * 0.45;
      if (index === previous) score += 0.22;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    chosen[frame] = best;
    previous = best;
  }

  const melody: DetectedNote[] = [];
  let runIndex = chosen[0];
  let runStart = 0;
  for (let frame = 1; frame <= frameCount; frame += 1) {
    const value = frame < frameCount ? chosen[frame] : -2;
    if (value === runIndex) continue;
    if (runIndex >= 0) {
      const source = notes[runIndex];
      const start = Math.max(source.start, runStart * FRAME);
      const end = Math.min(noteEnd(source), frame * FRAME);
      if (end - start > 0.03) {
        melody.push({ ...source, start, duration: end - start });
      }
    }
    runIndex = value;
    runStart = frame;
  }

  return mergeFragments(melody, 0.04).sort((a, b) => a.start - b.start);
}

export function refineNotes(
  raw: DetectedNote[],
  options: RefineOptions,
): DetectedNote[] {
  if (!raw.length) return [];

  let notes = raw.filter(
    (note) =>
      note.confidence >= options.minConfidence &&
      note.duration >= options.minDuration &&
      note.midi >= options.lowestMidi &&
      note.midi <= options.highestMidi,
  );

  notes = mergeFragments(notes);
  notes = suppressHarmonics(notes, options.harmonicCleanup);
  if (options.mode === "melody") notes = extractMelody(notes);

  return notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

export function noteSpan(notes: DetectedNote[]) {
  let end = 0;
  for (const note of notes) {
    const value = note.start + note.duration;
    if (value > end) end = value;
  }
  return end;
}
