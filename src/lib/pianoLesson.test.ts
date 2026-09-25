import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAD_IN, clearPianoLesson, fitKeyboard, lessonFromScore, lessonSteps, readPianoLesson, savePianoLesson, type LessonNote } from "./pianoLesson";
import type { Score, ScoreEvent } from "./score";

const ev = (offset: number, length: number, midis: number[], extra: Partial<ScoreEvent> = {}): ScoreEvent => ({ offset, length, midis, tiedFrom: false, tiedTo: false, ...extra });

/** 4/4 at 120 BPM, a step per beat: half a second a step. */
function score(measures: ScoreEvent[][], bass?: ScoreEvent[][]): Score {
  return {
    title: "שיר",
    key: { fifths: 0, mode: "major", tonicPitchClass: 0, fit: 1 },
    meter: { beats: 4, beatType: 4 },
    bpm: 120,
    stepsPerBeat: 1,
    stepsPerMeasure: 4,
    measureCount: measures.length,
    staves: [{ clef: "treble", measures }, ...(bass ? [{ clef: "bass" as const, measures: bass }] : [])],
    offsetSeconds: 0,
    truncated: false,
  };
}

describe("lessonFromScore", () => {
  it("times the notes in seconds, after the lead-in", () => {
    const notes = lessonFromScore(score([[ev(0, 1, []), ev(1, 1, [60]), ev(2, 2, [64, 67])]]));
    expect(notes).toEqual([
      { midi: 60, start: LEAD_IN, duration: 0.5 },
      { midi: 64, start: LEAD_IN + 0.5, duration: 1 },
      { midi: 67, start: LEAD_IN + 0.5, duration: 1 },
    ]);
  });

  it("joins a held note across its tie, into the next bar", () => {
    const notes = lessonFromScore(score([[ev(0, 2, []), ev(2, 2, [62], { tiedTo: true })], [ev(0, 1, [62], { tiedFrom: true }), ev(1, 3, [])]]));
    expect(notes).toEqual([{ midi: 62, start: LEAD_IN, duration: 1.5 }]);
  });

  it("takes both staves", () => {
    const notes = lessonFromScore(score([[ev(0, 4, [72])]], [[ev(0, 4, [48])]]));
    expect(notes.map((note) => note.midi)).toEqual([48, 72]);
  });
});

describe("lessonSteps", () => {
  it("groups what starts together, in order", () => {
    const notes: LessonNote[] = [
      { midi: 67, start: 3, duration: 1 },
      { midi: 60, start: 2, duration: 1 },
      { midi: 64, start: 3.02, duration: 1 },
      { midi: 62, start: 4, duration: 1 },
    ];
    expect(lessonSteps(notes)).toEqual([
      { start: 2, midis: [60] },
      { start: 3, midis: [67, 64] },
      { start: 4, midis: [62] },
    ]);
  });
});

describe("fitKeyboard", () => {
  const at = (midis: number[]): LessonNote[] => midis.map((midi, index) => ({ midi, start: index, duration: 0.5 }));

  it("starts at the C below the lowest note, two octaves when they suffice", () => {
    expect(fitKeyboard(at([64, 67, 72, 79]))).toMatchObject({ octave: 4, octaves: 2 });
    expect(fitKeyboard(at([50, 64, 79]))).toMatchObject({ octave: 3, octaves: 3 });
  });

  it("moves notes beyond three octaves onto the keys", () => {
    const fitted = fitKeyboard(at([30, 60, 62, 64, 65, 67, 69, 71, 72, 100]));
    const lowest = (fitted.octave + 1) * 12;
    for (const note of fitted.notes) {
      expect(note.midi).toBeGreaterThanOrEqual(lowest);
      expect(note.midi).toBeLessThanOrEqual(lowest + fitted.octaves * 12);
    }
    // Most notes keep their own octave.
    expect(fitted.notes.filter((note, index) => note.midi === at([30, 60, 62, 64, 65, 67, 69, 71, 72, 100])[index].midi)).toHaveLength(8);
  });
});

describe("handing the lesson to the piano", () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps it for the tab, and lets it go", () => {
    savePianoLesson({ title: "שיר השמחה", notes: [{ midi: 64, start: 2, duration: 0.5 }] });
    expect(readPianoLesson()).toEqual({ title: "שיר השמחה", notes: [{ midi: 64, start: 2, duration: 0.5 }] });
    clearPianoLesson();
    expect(readPianoLesson()).toBeNull();
  });

  it("refuses a damaged one", () => {
    sessionStorage.setItem("musictools.piano-lesson.v1", JSON.stringify({ title: 1, notes: [{ midi: "x" }] }));
    expect(readPianoLesson()).toBeNull();
    sessionStorage.setItem("musictools.piano-lesson.v1", "{");
    expect(readPianoLesson()).toBeNull();
  });
});
