import { describe, expect, it } from "vitest";
import { BITRATES, SAMPLE_RATES, estimateBytes } from "./convert";

describe("conversion estimates", () => {
  const base = { trim: null, gain: 1, normalise: false, channels: "keep" as const };
  it("sizes a WAV from rate and channels", () => {
    expect(estimateBytes(10, { ...base, format: "wav", sampleRate: 44_100, kbps: 192 }, 2)).toBe(10 * 44_100 * 2 * 2 + 44);
    expect(estimateBytes(10, { ...base, format: "wav", sampleRate: 16_000, kbps: 192, channels: 1 }, 2)).toBe(10 * 16_000 * 2 + 44);
  });
  it("sizes an MP3 from the bitrate alone", () => {
    expect(estimateBytes(60, { ...base, format: "mp3", sampleRate: 44_100, kbps: 128 }, 2)).toBe(960_000);
  });
  it("offers sensible presets", () => {
    expect(SAMPLE_RATES.map((item) => item.value)).toContain(44_100);
    expect(BITRATES.map((item) => item.value)).toContain(192);
  });
});
