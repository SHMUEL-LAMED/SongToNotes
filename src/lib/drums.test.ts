import { describe, expect, it } from "vitest";
import { PRESETS, STEPS, VOICES, barSeconds, countHits, emptyPattern, normalizePattern, randomPattern, stepOffset } from "./drums";

describe("patterns", () => {
  it("starts empty, one row per voice", () => {
    const pattern = emptyPattern();
    expect(Object.keys(pattern).sort()).toEqual(VOICES.map((voice) => voice.id).sort());
    expect(countHits(pattern)).toBe(0);
    for (const voice of VOICES) expect(pattern[voice.id]).toHaveLength(STEPS);
  });

  it("ships presets that are full bars with a downbeat", () => {
    for (const preset of PRESETS.filter((item) => item.id !== "empty")) {
      expect(preset.pattern.kick[0]).toBeGreaterThan(0);
      for (const voice of VOICES) expect(preset.pattern[voice.id]).toHaveLength(STEPS);
      expect(preset.bpm).toBeGreaterThanOrEqual(50);
    }
  });

  it("reads a stored pattern back, clamping what does not fit", () => {
    const pattern = normalizePattern({ kick: [2, "1", 7, -1, null], snare: "nope" })!;
    expect(pattern.kick.slice(0, 5)).toEqual([2, 1, 2, 0, 0]);
    expect(pattern.snare).toEqual(Array(STEPS).fill(0));
    expect(normalizePattern(null)).toBeNull();
  });

  it("makes a random groove that keeps a backbeat", () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const pattern = randomPattern(random);
    expect(pattern.kick[0]).toBe(2);
    expect(pattern.snare[4]).toBe(2);
    expect(pattern.snare[12]).toBe(2);
  });
});

describe("timing", () => {
  it("puts sixteen steps in a 4/4 bar", () => {
    expect(barSeconds(120)).toBe(2);
    expect(stepOffset(4, 120, 0)).toBeCloseTo(0.5);
  });

  it("swings only the off-beat sixteenths", () => {
    expect(stepOffset(2, 120, 0.5)).toBeCloseTo(stepOffset(2, 120, 0));
    expect(stepOffset(3, 120, 0.5)).toBeGreaterThan(stepOffset(3, 120, 0));
    expect(stepOffset(3, 120, 0.5)).toBeLessThan(stepOffset(4, 120, 0));
  });
});
