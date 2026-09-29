import { describe, expect, it } from "vitest";
import {
  LATENCY_STORAGE_KEY,
  applyLatencyShift,
  assembleTake,
  clampBpm,
  clampCountIn,
  clampLatencyOffset,
  clicksInWindow,
  countInSeconds,
  describeMicError,
  estimateRoundTripSeconds,
  formatClock,
  miniPeaks,
  nextTrackName,
  peaksPath,
  playheadFraction,
  readLatencyOffset,
  totalLatencySeconds,
  writeLatencyOffset,
  type ClickPlan,
} from "./recorder";

const ramp = (length: number, start = 0) => Float32Array.from({ length }, (_, index) => start + index);

describe("count-in", () => {
  it("lasts bars × beats of the tempo", () => {
    expect(countInSeconds(120, 1, 4)).toBeCloseTo(2);
    expect(countInSeconds(60, 2, 3)).toBeCloseTo(6);
    expect(countInSeconds(100, 0, 4)).toBe(0);
  });
  it("clamps the bars and the tempo to what the tool offers", () => {
    expect(countInSeconds(120, 5, 4)).toBeCloseTo(4);
    expect(clampCountIn(-1)).toBe(0);
    expect(clampCountIn(Number.NaN)).toBe(1);
    expect(clampBpm(10)).toBe(40);
    expect(clampBpm(999)).toBe(240);
    expect(clampBpm(Number.NaN)).toBe(100);
  });
});

describe("click schedule", () => {
  const plan: ClickPlan = { bpm: 120, beatsPerBar: 4, countInBars: 1, takeStart: 10, clickDuringTake: true };

  it("places the count-in before the take and accents each bar's first beat", () => {
    const clicks = clicksInWindow(plan, 0, 11);
    expect(clicks.map((click) => click.time)).toEqual([8, 8.5, 9, 9.5, 10, 10.5]);
    expect(clicks.map((click) => click.countIn)).toEqual([true, true, true, true, false, false]);
    expect(clicks.map((click) => click.accent)).toEqual([true, false, false, false, true, false]);
  });
  it("hands each beat to exactly one window, even on the edges", () => {
    const windows = [
      [8, 8.5],
      [8.5, 9.2],
      [9.2, 10],
      [10, 10.25],
      [10.25, 12],
    ];
    const times = windows.flatMap(([from, to]) => clicksInWindow(plan, from, to).map((click) => click.time));
    expect(times).toEqual([8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5]);
  });
  it("stops after the count-in when the metronome is off", () => {
    const clicks = clicksInWindow({ ...plan, clickDuringTake: false }, 0, 20);
    expect(clicks).toHaveLength(4);
    expect(clicks.every((click) => click.countIn)).toBe(true);
    expect(clicksInWindow({ ...plan, countInBars: 0, clickDuringTake: false }, 0, 20)).toEqual([]);
  });
  it("does not drift over a long take", () => {
    const [click] = clicksInWindow({ ...plan, bpm: 97 }, 600, 601);
    const beat = 60 / 97;
    const index = Math.round((click.time - (10 - 4 * beat)) / beat);
    expect(click.time).toBeCloseTo(10 - 4 * beat + index * beat, 9);
    expect(clicksInWindow(plan, 5, 5)).toEqual([]);
  });
});

describe("latency", () => {
  it("adds the output and input sides of the round trip", () => {
    expect(estimateRoundTripSeconds({ baseLatency: 0.005, outputLatency: 0.02, inputLatency: 0.01 })).toBeCloseTo(0.035);
  });
  it("stands in typical figures for what the browser does not report", () => {
    expect(estimateRoundTripSeconds({})).toBeCloseTo(0.04);
    expect(estimateRoundTripSeconds({ outputLatency: Number.NaN, baseLatency: -1, inputLatency: 5 })).toBeCloseTo(0.04);
  });
  it("applies the user's offset and never goes below zero", () => {
    expect(totalLatencySeconds(0.04, 20)).toBeCloseTo(0.06);
    expect(totalLatencySeconds(0.04, -100)).toBe(0);
    expect(clampLatencyOffset(1000)).toBe(300);
  });
  it("shifts a take earlier by trimming its start", () => {
    expect(Array.from(applyLatencyShift(ramp(6), 2))).toEqual([2, 3, 4, 5]);
    expect(applyLatencyShift(ramp(3), 10)).toHaveLength(0);
  });
  it("shifts a take later by padding silence when the offset is negative", () => {
    expect(Array.from(applyLatencyShift(ramp(3, 1), -2))).toEqual([0, 0, 1, 2, 3]);
  });
  it("returns a copy even when there is nothing to shift", () => {
    const samples = ramp(3);
    const shifted = applyLatencyShift(samples, 0);
    expect(shifted).not.toBe(samples);
    expect(Array.from(shifted)).toEqual([0, 1, 2]);
  });
});

describe("assembling a take", () => {
  it("starts at the take's timeline zero plus the latency", () => {
    const chunks = [
      { frame: 100, data: ramp(4, 100) },
      { frame: 104, data: ramp(4, 104) },
      { frame: 108, data: ramp(4, 108) },
    ];
    const take = assembleTake(chunks, { startFrame: 103, latencyFrames: 2 });
    expect(Array.from(take)).toEqual([105, 106, 107, 108, 109, 110, 111]);
  });
  it("leaves silence where the browser dropped a chunk, and sorts late arrivals", () => {
    const chunks = [
      { frame: 8, data: ramp(2, 8) },
      { frame: 0, data: ramp(2, 0) },
    ];
    const take = assembleTake(chunks, { startFrame: 0, latencyFrames: 0 });
    expect(Array.from(take)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 8, 9]);
  });
  it("pads the start when the capture began after the take", () => {
    const take = assembleTake([{ frame: 5, data: ramp(2, 1) }], { startFrame: 3, latencyFrames: 0 });
    expect(Array.from(take)).toEqual([0, 0, 1, 2]);
  });
  it("respects the length cap and an empty capture", () => {
    expect(assembleTake([{ frame: 0, data: ramp(10) }], { startFrame: 0, latencyFrames: 0, maxFrames: 3 })).toHaveLength(3);
    expect(assembleTake([], { startFrame: 0, latencyFrames: 0 })).toHaveLength(0);
    expect(assembleTake([{ frame: 0, data: ramp(4) }], { startFrame: 10, latencyFrames: 0 })).toHaveLength(0);
  });
});

describe("waveform strip", () => {
  it("keeps the loudest sample of each slice across channels", () => {
    const left = Float32Array.from([0.1, -0.5, 0.2, 0.3]);
    const right = Float32Array.from([0, 0, -0.9, 0]);
    expect(Array.from(miniPeaks([left, right], 2)).map((value) => Number(value.toFixed(2)))).toEqual([0.5, 0.9]);
    expect(Array.from(miniPeaks([], 3))).toEqual([0, 0, 0]);
  });
  it("draws one closed bar per peak", () => {
    const path = peaksPath(Float32Array.from([1, 0]), 100, 20);
    expect(path.match(/z/g)).toHaveLength(2);
    expect(path.startsWith("M0.00 0.00")).toBe(true);
    expect(peaksPath(new Float32Array(0), 100, 20)).toBe("");
  });
});

describe("small helpers", () => {
  it("names the next track with the first free number", () => {
    expect(nextTrackName([])).toBe("ערוץ 1");
    expect(nextTrackName(["ערוץ 1", "גיטרה", "ערוץ 3"])).toBe("ערוץ 2");
  });
  it("formats the clock with tenths", () => {
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(3.27)).toBe("0:03.2");
    expect(formatClock(75.5)).toBe("1:15.5");
    expect(formatClock(-4)).toBe("0:00.0");
  });
  it("places the playhead as a fraction of the timeline", () => {
    expect(playheadFraction(5, 10)).toBe(0.5);
    expect(playheadFraction(20, 10)).toBe(1);
    expect(playheadFraction(1, 0)).toBe(0);
  });
  it("explains microphone failures in Hebrew by the browser's error name", () => {
    expect(describeMicError({ name: "NotAllowedError" })).toContain("הרשאה");
    expect(describeMicError({ name: "NotFoundError" })).toContain("לא נמצא מיקרופון");
    expect(describeMicError({ name: "NotReadableError" })).toContain("תפוס");
    expect(describeMicError({ name: "NotSupportedError" })).toContain("אינו תומך");
    expect(describeMicError(new Error("x"))).toContain("לא הצלחנו");
    expect(describeMicError(null)).toContain("לא הצלחנו");
  });
});

describe("stored latency offset", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
  };
  it("round-trips through storage, clamped", () => {
    const storage = memory();
    writeLatencyOffset(storage, 42.4);
    expect(storage.values.get(LATENCY_STORAGE_KEY)).toBe(JSON.stringify({ offsetMs: 42 }));
    expect(readLatencyOffset(storage)).toBe(42);
    writeLatencyOffset(storage, 5000);
    expect(readLatencyOffset(storage)).toBe(300);
  });
  it("falls back to zero on junk, absence or a throwing storage", () => {
    expect(readLatencyOffset(null)).toBe(0);
    expect(readLatencyOffset(memory())).toBe(0);
    expect(readLatencyOffset({ getItem: () => "{not json" })).toBe(0);
    expect(readLatencyOffset({ getItem: () => { throw new Error("blocked"); } })).toBe(0);
    expect(() => writeLatencyOffset({ setItem: () => { throw new Error("quota"); } }, 10)).not.toThrow();
  });
});
