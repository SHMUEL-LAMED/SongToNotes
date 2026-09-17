import { describe, expect, it } from "vitest";
import {
  centsOff,
  detectPitch,
  frequencyToMidi,
  lowPass,
  midiToFrequency,
  normalise,
  resample,
} from "./dsp";

const SAMPLE_RATE = 44100;

/** A tone with a couple of harmonics, so the tests are not pure sine cases. */
function tone(frequency: number, seconds = 0.1, harmonics = [1, 0.5, 0.25]) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < samples.length; index += 1) {
    const t = index / SAMPLE_RATE;
    let value = 0;
    harmonics.forEach((gain, harmonic) => {
      value += gain * Math.sin(2 * Math.PI * frequency * (harmonic + 1) * t);
    });
    samples[index] = value * 0.3;
  }
  return samples;
}

describe("pitch conversion", () => {
  it("anchors on A4 = 440", () => {
    expect(frequencyToMidi(440)).toBeCloseTo(69, 10);
    expect(midiToFrequency(69)).toBeCloseTo(440, 10);
  });

  it("round-trips every note on a piano", () => {
    for (let midi = 21; midi <= 108; midi += 1) {
      expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 9);
    }
  });

  it("follows a moved reference pitch", () => {
    expect(midiToFrequency(69, 432)).toBeCloseTo(432, 10);
    expect(frequencyToMidi(432, 432)).toBeCloseTo(69, 10);
  });

  it("measures how far a note is out of tune", () => {
    expect(centsOff(440)).toBeCloseTo(0, 6);
    // A quarter tone up is 50 cents sharp; the reading stays inside ±50.
    expect(centsOff(440 * Math.pow(2, 25 / 1200))).toBeCloseTo(25, 4);
    expect(centsOff(440 * Math.pow(2, -25 / 1200))).toBeCloseTo(-25, 4);
    for (let cents = -49; cents <= 49; cents += 7) {
      const reading = centsOff(440 * Math.pow(2, cents / 1200));
      expect(Math.abs(reading)).toBeLessThanOrEqual(50);
    }
  });
});

describe("detectPitch", () => {
  it.each([110, 220, 440, 880])("hears a %i Hz tone within a few cents", (frequency) => {
    const reading = detectPitch(tone(frequency), SAMPLE_RATE);
    expect(Math.abs(centsOff(reading.frequency))).toBeLessThan(12);
    expect(reading.frequency).toBeCloseTo(frequency, 0);
    expect(reading.clarity).toBeGreaterThan(0.8);
  });

  it("does not guess at silence", () => {
    const reading = detectPitch(new Float32Array(2048), SAMPLE_RATE);
    expect(reading.frequency).toBe(0);
    expect(reading.clarity).toBe(0);
  });

  it("does not guess at noise", () => {
    const noise = new Float32Array(4096);
    let seed = 7;
    for (let index = 0; index < noise.length; index += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      noise[index] = (seed / 2147483648) * 2 - 1;
    }
    expect(detectPitch(noise, SAMPLE_RATE).frequency).toBe(0);
  });
});

describe("normalise", () => {
  it("lifts a quiet take to the ceiling", () => {
    const channel = Float32Array.from([0.1, -0.05, 0.02]);
    normalise([channel], 0.98);
    expect(Math.max(...channel.map(Math.abs))).toBeCloseTo(0.98, 5);
  });

  it("keeps the two channels in proportion", () => {
    const left = Float32Array.from([0.5, 0]);
    const right = Float32Array.from([0.25, 0]);
    normalise([left, right], 1);
    expect(left[0] / right[0]).toBeCloseTo(2, 5);
  });

  it("leaves silence alone instead of amplifying nothing", () => {
    const channel = new Float32Array(8);
    normalise([channel]);
    expect(Array.from(channel).every((value) => value === 0)).toBe(true);
  });
});

describe("resample", () => {
  it("reads the source at `ratio` samples a step", () => {
    const channel = Float32Array.from({ length: 100 }, (_, index) => index / 100);
    // Stepping twice as fast leaves half as many samples, which is the pitch
    // shift up an octave the speed tool combines with a time stretch.
    expect(resample(channel, 2).length).toBe(50);
    expect(resample(channel, 0.5).length).toBe(200);
  });

  it("returns a copy, not the same buffer, at ratio 1", () => {
    const channel = Float32Array.from([0.25, 0.5]);
    const same = resample(channel, 1);
    expect(Array.from(same)).toEqual([0.25, 0.5]);
    expect(same).not.toBe(channel);
  });

  it("keeps the shape of a ramp", () => {
    const channel = Float32Array.from({ length: 64 }, (_, index) => index / 63);
    const slowed = resample(channel, 0.5);
    expect(slowed[0]).toBeCloseTo(0, 3);
    expect(slowed[slowed.length - 1]).toBeCloseTo(1, 1);
    // Interpolation must not invent values outside the source range.
    expect(Math.min(...slowed)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...slowed)).toBeLessThanOrEqual(1);
  });
});

describe("lowPass", () => {
  it("passes the low tone and holds back the high one", () => {
    const low = lowPass(tone(100, 0.2, [1]), SAMPLE_RATE, 400);
    const high = lowPass(tone(8000, 0.2, [1]), SAMPLE_RATE, 400);
    const energy = (channel: Float32Array) =>
      channel.reduce((sum, value) => sum + value * value, 0) / channel.length;
    expect(energy(high)).toBeLessThan(energy(low) * 0.2);
  });
});
