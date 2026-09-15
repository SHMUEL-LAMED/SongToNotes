import { describe, expect, it } from "vitest";
import { buildScore, decompose, DEFAULT_METER, noteValue } from "./score";
import type { DetectedNote } from "./types";

const SIXTEENTHS = 4;
const STEPS_PER_MEASURE = SIXTEENTHS * 4;

function melody(bpm: number, midis: number[]): DetectedNote[] {
  const beat = 60 / bpm;
  return midis.map((midi, index) => ({
    midi,
    start: index * beat,
    duration: beat * 0.95,
    confidence: 0.9,
  }));
}

const OPTIONS = {
  title: "בדיקה",
  tempo: { bpm: 120, offset: 0, fit: 1 },
  meter: DEFAULT_METER,
  stepsPerBeat: SIXTEENTHS,
  mode: "melody" as const,
  transpose: 0,
};

describe("decompose", () => {
  it("leaves a notatable value alone", () => {
    expect(decompose(0, 4, SIXTEENTHS, STEPS_PER_MEASURE, 4)).toEqual([{ offset: 0, length: 4 }]);
    expect(decompose(0, 16, SIXTEENTHS, STEPS_PER_MEASURE, 4)).toEqual([{ offset: 0, length: 16 }]);
  });

  it("ties a span that no single note value can write", () => {
    // Five sixteenths is a quarter tied to a sixteenth, not one unwritable note.
    const parts = decompose(0, 5, SIXTEENTHS, STEPS_PER_MEASURE, 4);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.reduce((sum, part) => sum + part.length, 0)).toBe(5);
  });

  it("never lets a note other than a whole note cross the middle of the bar", () => {
    const half = STEPS_PER_MEASURE / 2;
    for (let offset = 0; offset < STEPS_PER_MEASURE; offset += 1) {
      for (let length = 1; length <= STEPS_PER_MEASURE - offset; length += 1) {
        for (const part of decompose(offset, length, SIXTEENTHS, STEPS_PER_MEASURE, 4)) {
          const crosses = part.offset < half && part.offset + part.length > half;
          if (crosses) {
            expect({ ...part }).toEqual({ offset: 0, length: STEPS_PER_MEASURE });
          }
        }
      }
    }
  });

  it("always accounts for every step it was given", () => {
    for (let offset = 0; offset < STEPS_PER_MEASURE; offset += 1) {
      for (let length = 1; length <= STEPS_PER_MEASURE - offset; length += 1) {
        const parts = decompose(offset, length, SIXTEENTHS, STEPS_PER_MEASURE, 4);
        expect(parts.reduce((sum, part) => sum + part.length, 0)).toBe(length);
        expect(parts[0].offset).toBe(offset);
      }
    }
  });
});

describe("noteValue", () => {
  it("names the common values at a sixteenth grid", () => {
    expect(noteValue(16, SIXTEENTHS, 4)).toMatchObject({ type: "whole" });
    expect(noteValue(8, SIXTEENTHS, 4)).toMatchObject({ type: "half" });
    expect(noteValue(4, SIXTEENTHS, 4)).toMatchObject({ type: "quarter" });
    expect(noteValue(1, SIXTEENTHS, 4)).toMatchObject({ type: "16th" });
  });

  it("marks a dotted value as dotted", () => {
    expect(noteValue(6, SIXTEENTHS, 4)).toMatchObject({ type: "quarter", dots: 1 });
  });
});

describe("buildScore", () => {
  it("fills every measure exactly, rests included", () => {
    const score = buildScore(melody(120, [60, 62, 64, 65, 67, 69, 71, 72]), OPTIONS);
    expect(score.measureCount).toBeGreaterThan(0);
    for (const staff of score.staves) {
      expect(staff.measures).toHaveLength(score.measureCount);
      for (const measure of staff.measures) {
        const filled = measure.reduce((sum, event) => sum + event.length, 0);
        expect(filled).toBe(score.stepsPerMeasure);
        // Events run end to end with no gap and no overlap.
        let cursor = 0;
        for (const event of measure) {
          expect(event.offset).toBe(cursor);
          cursor += event.length;
        }
      }
    }
  });

  it("caps very long takes and says that it did", () => {
    const long = melody(120, Array.from({ length: 200 }, () => 60));
    const score = buildScore(long, { ...OPTIONS, maxMeasures: 4 });
    expect(score.measureCount).toBe(4);
    expect(score.truncated).toBe(true);
  });

  it("does not claim truncation when everything fits", () => {
    expect(buildScore(melody(120, [60, 62, 64, 65]), OPTIONS).truncated).toBe(false);
  });

  it("transposes every pitch by the requested amount", () => {
    const plain = buildScore(melody(120, [60, 64, 67]), OPTIONS);
    const up = buildScore(melody(120, [60, 64, 67]), { ...OPTIONS, transpose: 2 });
    const pitches = (score: ReturnType<typeof buildScore>) =>
      score.staves.flatMap((staff) => staff.measures.flat().flatMap((event) => event.midis));
    expect(up.staves.length).toBe(plain.staves.length);
    expect(pitches(up)).toEqual(pitches(plain).map((midi) => midi + 2));
  });

  it("splits onto a grand staff only when both hands are really used", () => {
    const oneHand = buildScore(melody(120, [60, 62, 64, 65]), { ...OPTIONS, mode: "full" });
    expect(oneHand.staves).toHaveLength(1);

    const twoHands = buildScore(melody(120, [40, 72, 43, 76, 45, 79]), {
      ...OPTIONS,
      mode: "full",
    });
    expect(twoHands.staves).toHaveLength(2);
    expect(twoHands.staves.map((staff) => staff.clef)).toEqual(["treble", "bass"]);
  });
});
