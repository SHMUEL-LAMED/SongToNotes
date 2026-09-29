import { describe, expect, it } from "vitest";
import {
  declick,
  denoiseChannels,
  findQuietestRegion,
  humFrequencies,
  learnNoiseProfile,
  removedPart,
  removeHum,
  removeRumble,
  sanitiseSettings,
  spectralGate,
} from "./denoise";

const RATE = 44100;

/** Deterministic noise, so a failing run can be reproduced. */
function noise(length: number, amplitude: number, seed = 1) {
  let state = seed >>> 0 || 1;
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    // xorshift32 → uniform in [-1, 1), summed twice for a softer distribution.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const a = (state >>> 0) / 4294967296;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const b = (state >>> 0) / 4294967296;
    out[index] = (a + b - 1) * amplitude;
  }
  return out;
}

function sine(frequency: number, seconds: number, amplitude = 0.5) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE);
  }
  return out;
}

function power(data: Float32Array, from = 0, to = data.length) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += data[index] * data[index];
  return sum / Math.max(1, to - from);
}

/** Power of one frequency (Goertzel), normalised so a sine of amplitude A reads A²/4-ish. */
function tonePower(data: Float32Array, frequency: number, from: number, to: number) {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / RATE);
  let s1 = 0;
  let s2 = 0;
  for (let index = from; index < to; index += 1) {
    const s0 = data[index] + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const n = to - from;
  return (s1 * s1 + s2 * s2 - coefficient * s1 * s2) / (n * n);
}

const db = (ratio: number) => 10 * Math.log10(ratio);

describe("spectral gate", () => {
  it("passes a noise-free signal through unchanged at strength 0", () => {
    const signal = sine(440, 1, 0.4);
    signal.set(sine(1250, 0.5, 0.2), 10000);
    const profile = learnNoiseProfile(noise(RATE, 0.05), RATE, { start: 0, end: 1 });
    const out = spectralGate(signal, profile, 0);
    let worst = 0;
    for (let index = 0; index < signal.length; index += 1) {
      worst = Math.max(worst, Math.abs(out[index] - signal[index]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("cuts white noise by a large margin at strength 100", () => {
    const hiss = noise(RATE * 3, 0.1, 7);
    const profile = learnNoiseProfile(hiss, RATE, { start: 0, end: 1 });
    const out = spectralGate(hiss, profile, 1);
    expect(db(power(hiss) / power(out))).toBeGreaterThan(18);
  });

  it("keeps a strong tone while removing the hiss around it", () => {
    const hiss = noise(RATE * 3, 0.05, 3);
    const tone = sine(660, 2, 0.4);
    const mix = hiss.slice();
    for (let index = 0; index < tone.length; index += 1) mix[RATE + index] += tone[index];
    const profile = learnNoiseProfile(mix, RATE, { start: 0, end: 0.9 });
    const out = spectralGate(mix, profile, 1);
    const from = RATE + 4096;
    const to = RATE * 3 - 4096;
    // The tone survives within a decibel…
    expect(Math.abs(db(tonePower(out, 660, from, to) / tonePower(tone, 660, 4096, tone.length - 4096)))).toBeLessThan(1);
    // …while the noise-only lead-in is far quieter.
    expect(db(power(mix, 0, RATE - 4096) / power(out, 0, RATE - 4096))).toBeGreaterThan(15);
  });

  it("gets stronger as the strength rises", () => {
    const hiss = noise(RATE * 2, 0.1, 11);
    const profile = learnNoiseProfile(hiss, RATE, { start: 0, end: 1 });
    const light = power(spectralGate(hiss, profile, 0.3));
    const heavy = power(spectralGate(hiss, profile, 0.9));
    expect(heavy).toBeLessThan(light);
    expect(light).toBeLessThan(power(hiss));
  });
});

describe("noise region", () => {
  it("finds the quiet stretch and skips digital silence", () => {
    const length = RATE * 4;
    const data = noise(length, 0.3, 5);
    // Exact zeros at the start (to be skipped), a quiet noise bed at 2–3 s.
    data.fill(0, 0, RATE / 2);
    const quiet = noise(RATE, 0.01, 9);
    data.set(quiet, RATE * 2);
    const region = findQuietestRegion([data], RATE);
    expect(region.start).toBeGreaterThanOrEqual(1.95);
    expect(region.end).toBeLessThanOrEqual(3.05);
    expect(region.end - region.start).toBeGreaterThan(0.3);
  });
});

describe("hum removal", () => {
  it("lists harmonics up to about 1 kHz", () => {
    expect(humFrequencies(50, RATE)).toHaveLength(20);
    expect(humFrequencies(60, RATE).at(-1)).toBe(960);
  });

  it("notches the hum and its harmonics but keeps a note between them", () => {
    const seconds = 3;
    const hum = sine(50, seconds, 0.2);
    const third = sine(150, seconds, 0.1);
    const note = sine(440, seconds, 0.3);
    const mix = hum.map((value, index) => value + third[index] + note[index]);
    removeHum(mix, RATE, 50);
    const from = RATE;
    const to = RATE * 2;
    expect(db(tonePower(hum, 50, from, to) / tonePower(mix, 50, from, to))).toBeGreaterThan(25);
    expect(db(tonePower(third, 150, from, to) / tonePower(mix, 150, from, to))).toBeGreaterThan(25);
    expect(Math.abs(db(tonePower(mix, 440, from, to) / tonePower(note, 440, from, to)))).toBeLessThan(0.5);
  });
});

describe("rumble filter", () => {
  it("removes sub-bass and keeps the mids", () => {
    const low = sine(25, 2, 0.3);
    const mid = sine(1000, 2, 0.3);
    const mix = low.map((value, index) => value + mid[index]);
    removeRumble(mix, RATE);
    const from = RATE / 2;
    const to = RATE * 1.5;
    expect(db(tonePower(low, 25, from, to) / tonePower(mix, 25, from, to))).toBeGreaterThan(30);
    expect(Math.abs(db(tonePower(mix, 1000, from, to) / tonePower(mid, 1000, from, to)))).toBeLessThan(0.2);
  });
});

describe("de-click", () => {
  it("repairs isolated spikes", () => {
    const clean = sine(440, 1, 0.5);
    const clicked = clean.slice();
    const spots = [5000, 12345, 30000, 41000];
    spots.forEach((spot, index) => {
      clicked[spot] += index % 2 ? -0.7 : 0.8;
      clicked[spot + 1] += index % 2 ? -0.3 : 0.4;
    });
    const repaired = declick(clicked, RATE);
    expect(repaired).toBe(spots.length);
    let worst = 0;
    for (let index = 0; index < clean.length; index += 1) worst = Math.max(worst, Math.abs(clicked[index] - clean[index]));
    expect(worst).toBeLessThan(0.02);
  });

  it("leaves a clean tone and plain noise alone", () => {
    const tone = sine(440, 1, 0.5);
    const copy = tone.slice();
    expect(declick(copy, RATE)).toBe(0);
    expect(copy).toEqual(tone);
    expect(declick(noise(RATE, 0.2, 21), RATE)).toBe(0);
  });
});

describe("the whole pipeline", () => {
  it("cleans every channel, reports the region and leaves the input alone", () => {
    const left = noise(RATE * 2, 0.05, 1);
    const right = noise(RATE * 2, 0.05, 2);
    const voice = sine(300, 1, 0.3);
    left.set(voice.map((value, index) => value + left[RATE + index]), RATE);
    const leftCopy = left.slice();
    const progress: number[] = [];
    const result = denoiseChannels(
      [left, right],
      RATE,
      { strength: 100, hum: "50", declick: true, highpass: true },
      { kind: "auto" },
      (fraction) => progress.push(fraction),
    );
    expect(left).toEqual(leftCopy);
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]).toHaveLength(left.length);
    expect(result.region.end).toBeLessThanOrEqual(1.05);
    expect(result.reductionDb).toBeGreaterThan(15);
    expect(power(result.channels[1])).toBeLessThan(power(right) / 30);
    expect(progress.at(-1)).toBe(1);
    // What was removed plus what is left is the original.
    const removed = removedPart([left, right], result.channels);
    expect(Math.abs(removed[0][RATE] + result.channels[0][RATE] - left[RATE])).toBeLessThan(1e-6);
  });

  it("uses a region chosen by hand", () => {
    const data = noise(RATE * 2, 0.05, 4);
    const result = denoiseChannels([data], RATE, { strength: 50, hum: "off", declick: false, highpass: false }, { kind: "region", start: 0.5, end: 1.2 });
    expect(result.region).toEqual({ start: 0.5, end: 1.2 });
  });

  it("sanitises settings from outside", () => {
    expect(sanitiseSettings({ strength: 250, hum: 60, declick: "yes" })).toEqual({ strength: 100, hum: "60", declick: false, highpass: false });
    expect(sanitiseSettings(null).strength).toBe(60);
  });
});
