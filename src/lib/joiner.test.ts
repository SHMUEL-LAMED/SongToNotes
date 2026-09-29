import { describe, expect, it } from "vitest";
import { clampTrim, clipFrameRange, crossfadeGains, joinPcm, layoutTimeline, moveItem, mp3SampleRate, outputFormat } from "./joiner";

const constant = (length: number, value: number) => new Float32Array(length).fill(value);

describe("layoutTimeline", () => {
  it("lays clips end to end with no transition", () => {
    const layout = layoutTimeline([3, 2, 5], { kind: "none", seconds: 4 });
    expect(layout.starts).toEqual([0, 3, 5]);
    expect(layout.overlaps).toEqual([0, 0]);
    expect(layout.gaps).toEqual([0, 0]);
    expect(layout.total).toBe(10);
  });

  it("inserts a gap at every boundary", () => {
    const layout = layoutTimeline([3, 2, 5], { kind: "gap", seconds: 1.5 });
    expect(layout.starts).toEqual([0, 4.5, 8]);
    expect(layout.gaps).toEqual([1.5, 1.5]);
    expect(layout.total).toBe(13);
  });

  it("overlaps neighbours for a crossfade", () => {
    const layout = layoutTimeline([10, 10, 10], { kind: "crossfade", seconds: 2 });
    expect(layout.starts).toEqual([0, 8, 16]);
    expect(layout.total).toBe(26);
  });

  it("clamps a crossfade to half of the shorter neighbour", () => {
    const layout = layoutTimeline([10, 3, 10], { kind: "crossfade", seconds: 5 });
    expect(layout.overlaps).toEqual([1.5, 1.5]);
    expect(layout.total).toBe(23 - 3);
  });

  it("clamps the requested seconds to 0..10", () => {
    expect(layoutTimeline([30, 30], { kind: "gap", seconds: 25 }).gaps).toEqual([10]);
    expect(layoutTimeline([30, 30], { kind: "gap", seconds: -3 }).gaps).toEqual([0]);
    expect(layoutTimeline([30, 30], { kind: "crossfade", seconds: Number.NaN }).overlaps).toEqual([0]);
  });

  it("works in whole frames", () => {
    const layout = layoutTimeline([101, 7], { kind: "crossfade", seconds: 1 }, { integer: true, sampleRate: 100 });
    // Half of 7 frames, floored.
    expect(layout.overlaps).toEqual([3]);
    expect(layout.starts).toEqual([0, 98]);
    expect(layout.total).toBe(105);
  });

  it("handles no clips and one clip", () => {
    expect(layoutTimeline([], { kind: "gap", seconds: 1 }).total).toBe(0);
    const single = layoutTimeline([4], { kind: "crossfade", seconds: 1 });
    expect(single.starts).toEqual([0]);
    expect(single.overlaps).toEqual([]);
    expect(single.total).toBe(4);
  });
});

describe("crossfadeGains", () => {
  it("keeps constant power across the whole overlap", () => {
    for (let index = 0; index < 64; index += 1) {
      const { fadeIn, fadeOut } = crossfadeGains(index, 64);
      expect(fadeIn ** 2 + fadeOut ** 2).toBeCloseTo(1, 10);
    }
  });

  it("fades out as it fades in, symmetrically", () => {
    const first = crossfadeGains(0, 10);
    const last = crossfadeGains(9, 10);
    expect(first.fadeOut).toBeGreaterThan(0.95);
    expect(first.fadeIn).toBeLessThan(0.2);
    expect(last.fadeIn).toBeCloseTo(first.fadeOut, 10);
    expect(last.fadeOut).toBeCloseTo(first.fadeIn, 10);
  });
});

describe("joinPcm", () => {
  it("concatenates with no transition", () => {
    const [out] = joinPcm([{ channels: [constant(3, 0.5)] }, { channels: [constant(2, -0.25)] }], { kind: "none", seconds: 0 }, 10);
    expect(Array.from(out)).toEqual([0.5, 0.5, 0.5, -0.25, -0.25]);
  });

  it("inserts exact silence for a gap", () => {
    const [out] = joinPcm([{ channels: [constant(4, 1)] }, { channels: [constant(4, 1)] }], { kind: "gap", seconds: 0.3 }, 10);
    expect(out.length).toBe(11);
    expect(Array.from(out.subarray(0, 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(out.subarray(4, 7))).toEqual([0, 0, 0]);
    expect(Array.from(out.subarray(7))).toEqual([1, 1, 1, 1]);
  });

  it("blends a crossfade of two constant signals at constant power", () => {
    const rate = 100;
    const a = 0.6;
    const b = 0.8;
    const [out] = joinPcm([{ channels: [constant(200, a)] }, { channels: [constant(200, b)] }], { kind: "crossfade", seconds: 0.5 }, rate);
    expect(out.length).toBe(350);
    for (let index = 0; index < 50; index += 1) {
      const { fadeIn, fadeOut } = crossfadeGains(index, 50);
      expect(out[150 + index]).toBeCloseTo(a * fadeOut + b * fadeIn, 6);
      // Each side's share of its own power, summed, never moves.
      const outgoing = out[150 + index] - b * fadeIn;
      expect((outgoing / a) ** 2 + fadeIn ** 2).toBeCloseTo(1, 5);
    }
    expect(out[149]).toBeCloseTo(a, 6);
    expect(out[200]).toBeCloseTo(b, 6);
  });

  it("applies trims and per-clip gain", () => {
    const source = Float32Array.from([0, 1, 2, 3, 4, 5]);
    const [out] = joinPcm([{ channels: [source], start: 2, end: 5, gain: 0.5 }], { kind: "none", seconds: 0 }, 10);
    expect(Array.from(out)).toEqual([1, 1.5, 2]);
  });

  it("upmixes a mono clip into a stereo join", () => {
    const out = joinPcm(
      [{ channels: [constant(2, 0.5)] }, { channels: [constant(2, 0.1), constant(2, 0.2)] }],
      { kind: "none", seconds: 0 },
      10,
    );
    expect(out.length).toBe(2);
    expect(Array.from(out[0])).toEqual([0.5, 0.5, 0.1, 0.1].map(Math.fround));
    expect(Array.from(out[1])).toEqual([0.5, 0.5, 0.2, 0.2].map(Math.fround));
  });

  it("matches the frame layout in length", () => {
    const lengths = [4410, 1000, 8000];
    const transition = { kind: "crossfade" as const, seconds: 0.05 };
    const out = joinPcm(lengths.map((length) => ({ channels: [constant(length, 0.1)] })), transition, 44_100);
    const layout = layoutTimeline(lengths, transition, { integer: true, sampleRate: 44_100 });
    expect(out[0].length).toBe(layout.total);
    // 0.05 s is 2205 frames, but both boundaries clamp to half of the 1000-frame clip.
    expect(layout.overlaps).toEqual([500, 500]);
    expect(layout.total).toBe(4410 + 1000 + 8000 - 500 - 500);
  });
});

describe("helpers", () => {
  it("picks the highest rate and stereo when any clip is stereo", () => {
    expect(outputFormat([{ sampleRate: 22_050, numberOfChannels: 1 }, { sampleRate: 48_000, numberOfChannels: 1 }])).toEqual({ sampleRate: 48_000, channels: 1 });
    expect(outputFormat([{ sampleRate: 44_100, numberOfChannels: 2 }, { sampleRate: 32_000, numberOfChannels: 1 }])).toEqual({ sampleRate: 44_100, channels: 2 });
  });

  it("maps any rate onto one an MP3 can carry", () => {
    expect(mp3SampleRate(96_000)).toBe(48_000);
    expect(mp3SampleRate(44_100)).toBe(44_100);
    expect(mp3SampleRate(40_000)).toBe(32_000);
  });

  it("keeps trims inside the file and never shorter than the minimum", () => {
    expect(clampTrim(-1, 50, 10)).toEqual({ start: 0, end: 10 });
    expect(clampTrim(5, 5, 10, "end")).toEqual({ start: 5, end: 5.1 });
    expect(clampTrim(5, 5, 10, "start").start).toBeCloseTo(4.9, 10);
    expect(clampTrim(9.99, 10, 10, "end")).toEqual({ start: 9.9, end: 10 });
  });

  it("bounds a clip's frame range", () => {
    expect(clipFrameRange({ channels: [new Float32Array(10)], start: -4, end: 99 })).toEqual({ start: 0, end: 10, length: 10 });
    expect(clipFrameRange({ channels: [new Float32Array(10)], start: 8, end: 3 })).toEqual({ start: 8, end: 8, length: 0 });
  });

  it("moves an item within a list", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 5)).toEqual(["a", "b", "c"]);
  });
});
