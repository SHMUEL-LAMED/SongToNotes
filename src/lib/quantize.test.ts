import { describe, expect, it } from "vitest";
import { gridTime, nearestStep, quantizeNotes } from "./quantize";

const base = { bpm: 120, offset: 0, stepsPerBeat: 2, swing: 0 };
const note = (start: number, duration: number) => ({ midi: 60, start, duration, confidence: 1 });

describe("quantizeNotes", () => {
  it("snaps fully at strength 1", () => {
    const [out] = quantizeNotes([note(0.27, 0.2)], { ...base, strength: 1 });
    expect(out.start).toBeCloseTo(0.25);
    expect(out.start + out.duration).toBeCloseTo(0.5);
  });

  it("moves halfway at strength 0.5", () => {
    const [out] = quantizeNotes([note(0.29, 0.21)], { ...base, strength: 0.5 });
    expect(out.start).toBeCloseTo(0.27);
  });

  it("leaves notes alone at strength 0", () => {
    const notes = [note(0.31, 0.1)];
    expect(quantizeNotes(notes, { ...base, strength: 0 })).toBe(notes);
  });

  it("never collapses a note to nothing", () => {
    const [out] = quantizeNotes([note(0.24, 0.02)], { ...base, strength: 1 });
    expect(out.duration).toBeGreaterThan(0);
  });

  it("follows the offset of the first downbeat", () => {
    const [out] = quantizeNotes([note(0.14, 0.2)], { ...base, offset: 0.1, strength: 1 });
    expect(out.start).toBeCloseTo(0.1);
  });
});

describe("swing", () => {
  it("delays the off-steps", () => {
    expect(gridTime(1, { ...base, swing: 1 / 3 })).toBeCloseTo(0.25 + 0.25 / 3);
    expect(gridTime(2, { ...base, swing: 1 / 3 })).toBeCloseTo(0.5);
  });

  it("finds a late off-beat as the swung step", () => {
    expect(nearestStep(0.33, { ...base, swing: 1 / 3 })).toBe(1);
    const [out] = quantizeNotes([note(0.3, 0.1)], { ...base, swing: 1 / 3, strength: 1 });
    expect(out.start).toBeCloseTo(0.25 + 0.25 / 3);
  });
});
