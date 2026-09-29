import { describe, expect, it } from "vitest";
import { BITRATES, SAMPLE_RATES, effectiveKbps, estimateBytes } from "./convert";

describe("conversion estimates", () => {
  const base = { trim: null, gain: 1, normalise: false, channels: "keep" as const };
  it("sizes a WAV from rate and channels", () => {
    expect(estimateBytes(10, { ...base, format: "wav", sampleRate: 44_100, kbps: 192 }, 2)).toBe(10 * 44_100 * 2 * 2 + 44);
    expect(estimateBytes(10, { ...base, format: "wav", sampleRate: 16_000, kbps: 192, channels: 1 }, 2)).toBe(10 * 16_000 * 2 + 44);
  });
  it("sizes an MP3 from the bitrate alone", () => {
    expect(estimateBytes(60, { ...base, format: "mp3", sampleRate: 44_100, kbps: 128 }, 2)).toBe(960_000);
  });
  it("caps the MP3 estimate at what MPEG-2 allows below 32 kHz", () => {
    expect(effectiveKbps(22_050, 320)).toBe(160);
    expect(effectiveKbps(16_000, 64)).toBe(64);
    expect(effectiveKbps(32_000, 320)).toBe(320);
    expect(estimateBytes(60, { ...base, format: "mp3", sampleRate: 22_050, kbps: 320 }, 2)).toBe(1_200_000);
  });
  it("offers sensible presets", () => {
    expect(SAMPLE_RATES.map((item) => item.value)).toContain(44_100);
    expect(BITRATES.map((item) => item.value)).toContain(192);
  });
});
