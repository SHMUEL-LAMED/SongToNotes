import { describe, expect, it } from "vitest";
import { CLIP_SECONDS, MAX_CLIPS, clipStarts, newSession, soundStart } from "./identifyClips";

describe("soundStart", () => {
  it("skips the silence before the song", () => {
    const rate = 1000;
    const samples = new Float32Array(rate * 10);
    for (let index = rate * 3; index < samples.length; index += 1) samples[index] = Math.sin(index / 5) * 0.5;
    expect(soundStart(samples, rate)).toBeCloseTo(3, 1);
  });

  it("is zero for silence or sound from the first moment", () => {
    expect(soundStart(new Float32Array(1000), 1000)).toBe(0);
    expect(soundStart(new Float32Array(1000).fill(0.4), 1000)).toBe(0);
  });
});

describe("clipStarts", () => {
  it("tries the start after the opening, about 35% and about 65% of a song", () => {
    const starts = clipStarts(200, 2);
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBeCloseTo(2 + 8, 1);
    expect(starts[1] + CLIP_SECONDS / 2).toBeCloseTo(70, 1);
    expect(starts[2] + CLIP_SECONDS / 2).toBeCloseTo(130, 1);
  });

  it("keeps every clip inside the song", () => {
    for (const duration of [25, 40, 61, 180, 600]) {
      for (let round = 0; round < 4; round += 1) {
        for (const start of clipStarts(duration, 1, round)) {
          expect(start).toBeGreaterThanOrEqual(1);
          expect(start + CLIP_SECONDS).toBeLessThanOrEqual(duration + 1e-9);
        }
      }
    }
  });

  it("never sends more than three, nor the same part twice", () => {
    for (const duration of [20, 30, 45, 90, 240]) {
      const starts = clipStarts(duration, 0);
      expect(starts.length).toBeLessThanOrEqual(MAX_CLIPS);
      for (let a = 0; a < starts.length; a += 1) {
        for (let b = a + 1; b < starts.length; b += 1) expect(Math.abs(starts[a] - starts[b])).toBeGreaterThanOrEqual(CLIP_SECONDS / 2);
      }
    }
  });

  it("gives a short file one clip from where its sound starts", () => {
    expect(clipStarts(15, 2)).toEqual([2]);
    expect(clipStarts(0, 0)).toEqual([]);
  });

  it("moves to other parts when asked to try again", () => {
    const first = clipStarts(240, 0, 0);
    const second = clipStarts(240, 0, 1);
    expect(second).not.toEqual(first);
    expect(second.some((start) => first.every((other) => Math.abs(other - start) >= CLIP_SECONDS / 2))).toBe(true);
  });
});

describe("newSession", () => {
  it("is a fresh id the server accepts", () => {
    const one = newSession();
    expect(one).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(newSession()).not.toBe(one);
  });
});
