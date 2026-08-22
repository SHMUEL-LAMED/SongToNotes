import type { DetectedNote, Tempo } from "./types";

const MIN_BPM = 45;
const MAX_BPM = 220;
/** Tempi people actually pick cluster around this, which settles octave ties. */
const PRIOR_CENTER = 118;
const PRIOR_WIDTH = 0.95;

type Onset = { time: number; strength: number };

/**
 * Collapses simultaneous note starts into one accent, so a six-note chord does
 * not outvote six separate melody notes.
 */
export function collectOnsets(notes: DetectedNote[], window = 0.035): Onset[] {
  if (!notes.length) return [];
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const onsets: Onset[] = [];
  let current: Onset = { time: sorted[0].start, strength: 0 };
  let count = 0;

  const flush = () => {
    if (count > 0) onsets.push({ ...current });
  };

  for (const note of sorted) {
    if (note.start - current.time > window) {
      flush();
      current = { time: note.start, strength: 0 };
      count = 0;
    }
    // Extra voices in a chord add a little weight but not proportionally.
    current.strength += note.confidence / (1 + count * 0.7);
    count += 1;
  }
  flush();
  return onsets;
}

function tempoPrior(bpm: number) {
  const ratio = Math.log2(bpm / PRIOR_CENTER) / PRIOR_WIDTH;
  return Math.exp(-0.5 * ratio * ratio);
}

/**
 * Scores how well a beat grid of the given period and phase explains the
 * onsets. `fit` rewards accents landing on beats; `coverage` penalises grids
 * that are twice too slow and leave half their beats empty.
 */
function scoreGrid(
  onsets: Onset[],
  period: number,
  phase: number,
  from: number,
  to: number,
) {
  const tolerance = period * 0.14;
  let fit = 0;
  for (const onset of onsets) {
    const position = (onset.time - phase) / period;
    const distance = Math.abs(position - Math.round(position)) * period;
    if (distance > tolerance) continue;
    const shape = distance / tolerance;
    fit += onset.strength * (1 - shape * shape);
  }

  const firstBeat = Math.floor((from - phase) / period);
  const lastBeat = Math.ceil((to - phase) / period);
  const beatCount = Math.max(1, lastBeat - firstBeat);
  const hit = new Set<number>();
  for (const onset of onsets) {
    const position = (onset.time - phase) / period;
    const beat = Math.round(position);
    if (Math.abs(position - beat) * period <= tolerance) hit.add(beat);
  }
  const coverage = Math.min(1, hit.size / beatCount);

  return fit * (0.35 + 0.65 * coverage);
}

/**
 * Tempo is a global property, so a long take is measured from a representative
 * stretch rather than every onset in it. This keeps the estimate steady while
 * bounding the work, which matters because every settings change re-derives it.
 */
const MAX_SCORED_ONSETS = 900;

function scoringWindow(onsets: Onset[]) {
  if (onsets.length <= MAX_SCORED_ONSETS) return onsets;
  const start = Math.floor((onsets.length - MAX_SCORED_ONSETS) / 2);
  return onsets.slice(start, start + MAX_SCORED_ONSETS);
}

/**
 * Moves a beat phase by whole beats so bar 1 lands at, or just before, the
 * first note of the recording.
 */
function anchorPhase(phase: number, period: number, songStart: number) {
  const steps = Math.ceil((phase - songStart) / period);
  return phase - steps * period;
}

export function estimateTempo(notes: DetectedNote[]): Tempo {
  const all = collectOnsets(notes);
  if (all.length < 4) {
    return { bpm: 120, offset: 0, fit: 0 };
  }
  const onsets = scoringWindow(all);

  const from = onsets[0].time;
  const to = onsets[onsets.length - 1].time;
  const totalStrength = onsets.reduce((sum, onset) => sum + onset.strength, 0);

  let best = { bpm: 120, offset: from, score: -Infinity, raw: 0 };

  // Coarse sweep over a log-spaced tempo grid, then a local refinement, so the
  // search stays cheap without quantising the answer to whole BPM steps.
  const sweep = (candidates: number[], phaseSteps: number) => {
    for (const bpm of candidates) {
      if (bpm < MIN_BPM || bpm > MAX_BPM) continue;
      const period = 60 / bpm;
      const prior = tempoPrior(bpm);
      for (let step = 0; step < phaseSteps; step += 1) {
        const phase = from + (step / phaseSteps) * period;
        const raw = scoreGrid(onsets, period, phase, from, to);
        const score = raw * prior;
        if (score > best.score) {
          best = { bpm, offset: phase, score, raw };
        }
      }
    }
  };

  const coarse: number[] = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm *= 1.008) coarse.push(bpm);
  sweep(coarse, 16);

  const fine: number[] = [];
  for (let delta = -12; delta <= 12; delta += 1) {
    fine.push(best.bpm * (1 + delta * 0.0015));
  }
  sweep(fine, 64);

  return {
    bpm: Math.round(best.bpm * 10) / 10,
    // The winning phase may sit anywhere inside the scored window, so it is
    // shifted by whole beats back to the start of the recording.
    offset: anchorPhase(best.offset, 60 / best.bpm, all[0].time),
    fit: totalStrength > 0 ? Math.min(1, best.raw / totalStrength) : 0,
  };
}

/**
 * Re-locks the phase after the user overrides the tempo, so a manual BPM still
 * lands its barlines on real accents.
 */
export function alignOffset(notes: DetectedNote[], bpm: number): number {
  const all = collectOnsets(notes);
  if (!all.length) return 0;
  const onsets = scoringWindow(all);
  const period = 60 / bpm;
  const from = onsets[0].time;
  const to = onsets[onsets.length - 1].time;

  let bestPhase = from;
  let bestScore = -Infinity;
  for (let step = 0; step < 96; step += 1) {
    const phase = from + (step / 96) * period;
    const score = scoreGrid(onsets, period, phase, from, to);
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  return anchorPhase(bestPhase, period, all[0].time);
}
