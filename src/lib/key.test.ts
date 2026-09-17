import { describe, expect, it } from "vitest";
import { detectKey, keyName, keyToAbc, pitchClassHistogram, scientificName, spellPitch } from "./key";
import type { DetectedNote } from "./types";

function note(midi: number, start: number, duration = 0.5, confidence = 0.9): DetectedNote {
  return { midi, start, duration, confidence };
}

/** One octave of a scale starting on `tonic`, as steady quarter notes. */
function scale(tonic: number, steps: number[]): DetectedNote[] {
  return steps.map((step, index) => note(tonic + step, index * 0.5));
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11, 12];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10, 12];

describe("pitchClassHistogram", () => {
  it("weights a long note above a short one of the same pitch", () => {
    const histogram = pitchClassHistogram([note(60, 0, 2), note(62, 2, 0.1)]);
    expect(histogram[0]).toBeGreaterThan(histogram[2]);
  });

  it("folds octaves onto one pitch class", () => {
    const histogram = pitchClassHistogram([note(60, 0), note(72, 1), note(48, 2)]);
    expect(histogram[0]).toBeGreaterThan(0);
    expect(histogram.filter((value) => value > 0)).toHaveLength(1);
  });
});

describe("detectKey", () => {
  it("falls back to C major when there is almost nothing to go on", () => {
    const key = detectKey([note(60, 0), note(62, 1)]);
    expect(key).toEqual({ fifths: 0, mode: "major", tonicPitchClass: 0, fit: 0 });
  });

  it("reads a C major scale as C major", () => {
    const key = detectKey(scale(60, MAJOR_STEPS));
    expect(key.tonicPitchClass).toBe(0);
    expect(key.mode).toBe("major");
    expect(key.fifths).toBe(0);
  });

  it("reads a G major scale as G major, one sharp", () => {
    const key = detectKey(scale(67, MAJOR_STEPS));
    expect(key.tonicPitchClass).toBe(7);
    expect(key.mode).toBe("major");
    expect(key.fifths).toBe(1);
  });

  it("reads an A minor scale as a minor key", () => {
    const key = detectKey(scale(69, MINOR_STEPS));
    expect(key.mode).toBe("minor");
    expect(key.tonicPitchClass).toBe(9);
  });

  it("reports a fit that is never negative", () => {
    const noise = Array.from({ length: 12 }, (_, index) => note(60 + index, index * 0.25));
    expect(detectKey(noise).fit).toBeGreaterThanOrEqual(0);
  });
});

describe("spellPitch", () => {
  it("spells the naturals of C major", () => {
    expect(spellPitch(60, 0)).toEqual({ letter: "C", alter: 0, octave: 4 });
    expect(spellPitch(71, 0)).toEqual({ letter: "B", alter: 0, octave: 4 });
  });

  it("prefers sharps in sharp keys and flats in flat keys", () => {
    // The same sounding pitch, spelled to suit the key it sits in.
    expect(spellPitch(66, 6)).toMatchObject({ letter: "F", alter: 1 });
    expect(spellPitch(66, -5)).toMatchObject({ letter: "G", alter: -1 });
  });

  it("numbers octaves from C, so B sits below the C above it", () => {
    expect(spellPitch(59, 0)).toEqual({ letter: "B", alter: 0, octave: 3 });
    expect(spellPitch(60, 0)).toEqual({ letter: "C", alter: 0, octave: 4 });
  });

  it("never reaches for a double accidental", () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (let midi = 21; midi <= 108; midi += 1) {
        expect(Math.abs(spellPitch(midi, fifths).alter)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("always spells back to the pitch it was given", () => {
    const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (let midi = 21; midi <= 108; midi += 1) {
        const { letter, alter, octave } = spellPitch(midi, fifths);
        expect((octave + 1) * 12 + natural[letter] + alter).toBe(midi);
      }
    }
  });
});

describe("naming", () => {
  it("writes ABC key fields", () => {
    expect(keyToAbc({ fifths: 0, mode: "major", tonicPitchClass: 0, fit: 1 })).toBe("C");
    expect(keyToAbc({ fifths: -2, mode: "major", tonicPitchClass: 10, fit: 1 })).toBe("Bb");
    expect(keyToAbc({ fifths: 3, mode: "minor", tonicPitchClass: 6, fit: 1 })).toBe("F#m");
  });

  it("names keys in Hebrew", () => {
    expect(keyName({ fifths: 0, mode: "major", tonicPitchClass: 0, fit: 1 })).toBe("דו מז׳ור");
    expect(keyName({ fifths: 0, mode: "minor", tonicPitchClass: 9, fit: 1 })).toBe("לה מינור");
  });

  it("writes scientific pitch names", () => {
    expect(scientificName(69, 0)).toBe("A4");
    expect(scientificName(61, 5)).toBe("C#4");
    expect(scientificName(61, -4)).toBe("Db4");
  });
});
