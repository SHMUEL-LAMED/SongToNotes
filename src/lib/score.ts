import { detectKey } from "./key";
import type { DetectedNote, KeySignature, Meter, Tempo, ViewMode } from "./types";

export type ScoreEvent = {
  /** Step offset from the start of its measure. */
  offset: number;
  /** Length in grid steps. */
  length: number;
  /** Empty for a rest. */
  midis: number[];
  /** Continues a note that began in an earlier event. */
  tiedFrom: boolean;
  /** Continues into the next event. */
  tiedTo: boolean;
};

export type ScoreStaff = {
  clef: "treble" | "bass";
  /** One array of events per measure, each filling the measure exactly. */
  measures: ScoreEvent[][];
};

export type Score = {
  title: string;
  key: KeySignature;
  meter: Meter;
  bpm: number;
  stepsPerBeat: number;
  stepsPerMeasure: number;
  measureCount: number;
  staves: ScoreStaff[];
  /** Seconds of silence dropped before the first barline. */
  offsetSeconds: number;
  /** Notes that fell outside the rendered range, if the score was capped. */
  truncated: boolean;
};

export type ScoreOptions = {
  title: string;
  tempo: Tempo;
  meter: Meter;
  /** Grid resolution: 4 = sixteenths, 2 = eighths, 3 = triplet eighths. */
  stepsPerBeat: number;
  mode: ViewMode;
  transpose: number;
  key?: KeySignature;
  maxMeasures?: number;
};

export const DEFAULT_METER: Meter = { beats: 4, beatType: 4 };
const DEFAULT_MAX_MEASURES = 400;

/** Step counts that map onto a single written note value, largest first. */
function allowedValues(stepsPerBeat: number, beatType: number) {
  const whole = stepsPerBeat * beatType;
  const values: { steps: number; dots: number; divisor: number }[] = [];
  for (const divisor of [1, 2, 4, 8, 16, 32, 64]) {
    const base = whole / divisor;
    if (Number.isInteger(base) && base >= 1) {
      values.push({ steps: base, dots: 0, divisor });
      const dotted = base * 1.5;
      if (Number.isInteger(dotted) && dotted >= 1) {
        values.push({ steps: dotted, dots: 1, divisor });
      }
    }
  }
  return values.sort((a, b) => b.steps - a.steps);
}

/**
 * Standard beaming/readability rules: a value may stay inside one beat, span
 * whole beats from a beat, be a dotted beat, or fill a half measure from its
 * half — and only a full-measure note may cross the middle of the bar.
 */
function isReadable(
  offset: number,
  steps: number,
  stepsPerBeat: number,
  stepsPerMeasure: number,
) {
  const end = offset + steps;
  if (end > stepsPerMeasure) return false;

  const half = stepsPerMeasure / 2;
  const crossesMiddle = offset < half && end > half;
  if (crossesMiddle && !(offset === 0 && steps === stepsPerMeasure)) {
    return false;
  }

  const withinOneBeat =
    Math.floor(offset / stepsPerBeat) === Math.floor((end - 1) / stepsPerBeat);
  if (withinOneBeat) return true;

  const onBeat = offset % stepsPerBeat === 0;
  if (onBeat && steps % stepsPerBeat === 0) return true;
  if (onBeat && steps === stepsPerBeat * 1.5) return true;
  if (offset % half === 0 && steps <= half) return true;

  return false;
}

/**
 * Splits a span into written note values, tying them together. Replaces the
 * old behaviour where a 5- or 11-step span was emitted as a single note with
 * no notatable duration.
 */
export function decompose(
  offset: number,
  length: number,
  stepsPerBeat: number,
  stepsPerMeasure: number,
  beatType: number,
): { offset: number; length: number }[] {
  const values = allowedValues(stepsPerBeat, beatType);
  const parts: { offset: number; length: number }[] = [];
  let position = offset;
  let remaining = length;

  while (remaining > 0) {
    const pick =
      values.find(
        (value) =>
          value.steps <= remaining &&
          isReadable(position, value.steps, stepsPerBeat, stepsPerMeasure),
      ) ?? null;
    const steps = pick ? pick.steps : 1;
    parts.push({ offset: position, length: steps });
    position += steps;
    remaining -= steps;
  }

  return parts;
}

export function noteValue(
  steps: number,
  stepsPerBeat: number,
  beatType: number,
) {
  const names: Record<number, string> = {
    1: "whole",
    2: "half",
    4: "quarter",
    8: "eighth",
    16: "16th",
    32: "32nd",
    64: "64th",
  };
  for (const value of allowedValues(stepsPerBeat, beatType)) {
    if (value.steps === steps) {
      return { type: names[value.divisor], dots: value.dots };
    }
  }
  return { type: undefined, dots: 0 };
}

type QuantizedNote = { startStep: number; endStep: number; midi: number };

function quantize(
  notes: DetectedNote[],
  tempo: Tempo,
  stepsPerBeat: number,
  transpose: number,
): QuantizedNote[] {
  const stepSeconds = 60 / tempo.bpm / stepsPerBeat;
  return notes
    .map((note) => {
      const startStep = Math.max(
        0,
        Math.round((note.start - tempo.offset) / stepSeconds),
      );
      const rawEnd = Math.round(
        (note.start + note.duration - tempo.offset) / stepSeconds,
      );
      return {
        startStep,
        endStep: Math.max(startStep + 1, rawEnd),
        midi: note.midi + transpose,
      };
    })
    .sort((a, b) => a.startStep - b.startStep || a.midi - b.midi);
}

/**
 * Turns overlapping notes into a readable single line of chords and rests.
 * Every detected onset stays its own event, which is what stops two repeated
 * quarter notes from collapsing into one half note.
 */
function buildTimeline(
  notes: QuantizedNote[],
  totalSteps: number,
): { start: number; length: number; midis: number[] }[] {
  if (!notes.length) return [];

  const byStart = new Map<number, QuantizedNote[]>();
  notes.forEach((note) => {
    const bucket = byStart.get(note.startStep);
    if (bucket) bucket.push(note);
    else byStart.set(note.startStep, [note]);
  });

  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const events: { start: number; length: number; midis: number[] }[] = [];

  starts.forEach((start, index) => {
    if (start >= totalSteps) return;
    const group = byStart.get(start)!;
    const nextStart = index + 1 < starts.length ? starts[index + 1] : totalSteps;
    const longest = group.reduce((max, note) => Math.max(max, note.endStep), 0);
    const length = Math.max(1, Math.min(longest, nextStart, totalSteps) - start);
    const midis = [...new Set(group.map((note) => note.midi))].sort(
      (a, b) => a - b,
    );
    events.push({ start, length, midis });
  });

  return events;
}

function fillMeasures(
  timeline: { start: number; length: number; midis: number[] }[],
  measureCount: number,
  stepsPerBeat: number,
  stepsPerMeasure: number,
  beatType: number,
): ScoreEvent[][] {
  const measures: ScoreEvent[][] = Array.from(
    { length: measureCount },
    () => [],
  );
  const totalSteps = measureCount * stepsPerMeasure;

  const spans: { start: number; length: number; midis: number[] }[] = [];
  let cursor = 0;
  for (const event of timeline) {
    if (event.start > cursor) {
      spans.push({ start: cursor, length: event.start - cursor, midis: [] });
    }
    spans.push(event);
    cursor = event.start + event.length;
  }
  if (cursor < totalSteps) {
    spans.push({ start: cursor, length: totalSteps - cursor, midis: [] });
  }

  for (const span of spans) {
    let position = span.start;
    let remaining = span.length;
    let continues = false;

    while (remaining > 0 && position < totalSteps) {
      const measureIndex = Math.floor(position / stepsPerMeasure);
      const offset = position - measureIndex * stepsPerMeasure;
      const room = Math.min(remaining, stepsPerMeasure - offset);

      const parts = decompose(
        offset,
        room,
        stepsPerBeat,
        stepsPerMeasure,
        beatType,
      );
      parts.forEach((part, index) => {
        const isLastPart = index === parts.length - 1;
        const willContinue = !isLastPart || room < remaining;
        measures[measureIndex].push({
          offset: part.offset,
          length: part.length,
          midis: span.midis,
          tiedFrom: span.midis.length > 0 && continues,
          tiedTo: span.midis.length > 0 && willContinue,
        });
        continues = span.midis.length > 0 && willContinue;
      });

      position += room;
      remaining -= room;
    }
  }

  measures.forEach((measure) => measure.sort((a, b) => a.offset - b.offset));
  return measures;
}

function chooseStaves(notes: DetectedNote[], mode: ViewMode) {
  if (!notes.length) return { split: false, clef: "treble" as const };
  const pitches = notes.map((note) => note.midi).sort((a, b) => a - b);
  const median = pitches[Math.floor(pitches.length / 2)];
  const lowest = pitches[0];
  const highest = pitches[pitches.length - 1];

  if (mode === "melody") {
    return { split: false, clef: median >= 56 ? ("treble" as const) : ("bass" as const) };
  }
  // A grand staff only earns its keep when the music really uses both hands.
  const split = lowest < 55 && highest > 64;
  return {
    split,
    clef: median >= 58 ? ("treble" as const) : ("bass" as const),
  };
}

export function buildScore(
  notes: DetectedNote[],
  options: ScoreOptions,
): Score {
  const { tempo, meter, stepsPerBeat, mode, transpose } = options;
  const stepsPerMeasure = stepsPerBeat * meter.beats;
  const key = options.key ?? detectKey(notes);
  const maxMeasures = options.maxMeasures ?? DEFAULT_MAX_MEASURES;

  const quantized = quantize(notes, tempo, stepsPerBeat, transpose);
  const lastStep = quantized.reduce((max, note) => Math.max(max, note.endStep), 1);
  const wanted = Math.max(1, Math.ceil(lastStep / stepsPerMeasure));
  const measureCount = Math.min(maxMeasures, wanted);
  const totalSteps = measureCount * stepsPerMeasure;

  const layout = chooseStaves(notes, mode);
  const groups: { clef: "treble" | "bass"; notes: QuantizedNote[] }[] =
    layout.split
      ? [
          { clef: "treble", notes: quantized.filter((note) => note.midi >= 60) },
          { clef: "bass", notes: quantized.filter((note) => note.midi < 60) },
        ]
      : [{ clef: layout.clef, notes: quantized }];

  const staves: ScoreStaff[] = groups.map((group) => ({
    clef: group.clef,
    measures: fillMeasures(
      buildTimeline(group.notes, totalSteps),
      measureCount,
      stepsPerBeat,
      stepsPerMeasure,
      meter.beatType,
    ),
  }));

  return {
    title: options.title,
    key,
    meter,
    bpm: tempo.bpm,
    stepsPerBeat,
    stepsPerMeasure,
    measureCount,
    staves,
    offsetSeconds: tempo.offset,
    truncated: wanted > measureCount,
  };
}
