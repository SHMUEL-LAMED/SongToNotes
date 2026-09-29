import { describe, expect, it } from "vitest";
import {
  VOICE_EFFECTS,
  VOICE_EFFECT_IDS,
  applyBiquad,
  bandPassCoefficients,
  bitcrush,
  clampIntensity,
  combFilter,
  crackleNoise,
  effectParams,
  envelope,
  feedbackTailSeconds,
  isVoiceEffectId,
  makeDistortionCurve,
  makeImpulseResponse,
  mulberry32,
  noiseVocode,
  peakOf,
  pitchShift,
  preprocessChannels,
  ringModulate,
  tailSeconds,
  vocoderBands,
  voiceEffect,
  type VoiceEffectId,
} from "./voiceFx";

const RATE = 16000;

function sine(frequency: number, seconds: number, amplitude = 0.5) {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < data.length; index += 1) {
    data[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE);
  }
  return data;
}

function rms(data: Float32Array, from = 0, to = data.length) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += data[index] * data[index];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Upward zero crossings per second — a rough pitch meter for a pure tone. */
function crossingsPerSecond(data: Float32Array, from = 0, to = data.length) {
  let count = 0;
  for (let index = from + 1; index < to; index += 1) {
    if (data[index - 1] < 0 && data[index] >= 0) count += 1;
  }
  return (count * RATE) / (to - from);
}

const ALL: VoiceEffectId[] = ["none", "robot", "chipmunk", "deep", "radio", "alien", "echo", "hall", "telephone", "whisper"];

describe("effect table", () => {
  it("defines every effect the assistant can ask for, once", () => {
    expect([...VOICE_EFFECT_IDS].sort()).toEqual([...ALL].sort());
    expect(new Set(VOICE_EFFECT_IDS).size).toBe(VOICE_EFFECT_IDS.length);
    for (const id of ALL) {
      const effect = voiceEffect(id);
      expect(effect.id).toBe(id);
      expect(effect.name.length).toBeGreaterThan(0);
      expect(effect.emoji.length).toBeGreaterThan(0);
      expect(effect.defaultIntensity).toBeGreaterThanOrEqual(0);
      expect(effect.defaultIntensity).toBeLessThanOrEqual(100);
      expect(() => effectParams(id, 50)).not.toThrow();
    }
    expect(VOICE_EFFECTS[0].id).toBe("none");
  });

  it("recognises effect ids", () => {
    expect(isVoiceEffectId("robot")).toBe(true);
    expect(isVoiceEffectId("banana")).toBe(false);
    expect(isVoiceEffectId(3)).toBe(false);
  });

  it("clamps intensity to 0..100", () => {
    expect(clampIntensity(-5)).toBe(0);
    expect(clampIntensity(140)).toBe(100);
    expect(clampIntensity(Number.NaN)).toBe(0);
    expect(clampIntensity(42.4)).toBe(42);
  });
});

describe("intensity → parameters", () => {
  it("keeps the robot's carrier in the 50–120 Hz range and crushes harder with intensity", () => {
    const soft = effectParams("robot", 0);
    const hard = effectParams("robot", 100);
    expect(soft.ringHz).toBeGreaterThanOrEqual(50);
    expect(hard.ringHz).toBeLessThanOrEqual(120);
    expect(hard.bits).toBeLessThan(soft.bits);
    expect(hard.depth).toBeGreaterThan(soft.depth);
  });

  it("shifts the chipmunk up and the deep voice down, further at higher intensity", () => {
    expect(effectParams("chipmunk", 100).semitones).toBeCloseTo(12);
    expect(effectParams("chipmunk", 60).semitones).toBeGreaterThanOrEqual(7);
    expect(effectParams("chipmunk", 100).semitones).toBeGreaterThan(effectParams("chipmunk", 0).semitones);
    expect(effectParams("deep", 60).semitones).toBeLessThanOrEqual(-5);
    expect(effectParams("deep", 100).semitones).toBeGreaterThanOrEqual(-8);
    expect(effectParams("deep", 100).semitones).toBeLessThan(effectParams("deep", 0).semitones);
  });

  it("keeps the radio and telephone inside the voice band, narrowing with intensity", () => {
    for (const id of ["radio", "telephone"] as const) {
      const soft = effectParams(id, 0);
      const hard = effectParams(id, 100);
      expect(soft.lowHz).toBeGreaterThanOrEqual(300);
      expect(soft.highHz).toBeLessThanOrEqual(3400);
      expect(hard.highHz - hard.lowHz).toBeLessThan(soft.highHz - soft.lowHz);
    }
  });

  it("makes echo and hall wetter and longer, and clamps out-of-range dials", () => {
    expect(effectParams("echo", 100).feedback).toBeGreaterThan(effectParams("echo", 0).feedback);
    expect(effectParams("echo", 100).feedback).toBeLessThan(1);
    expect(effectParams("hall", 100).seconds).toBeGreaterThan(effectParams("hall", 0).seconds);
    expect(effectParams("hall", 250)).toEqual(effectParams("hall", 100));
    expect(effectParams("whisper", 100).bands).toBeLessThan(effectParams("whisper", 0).bands);
  });

  it("asks for a tail long enough for the echo and the hall", () => {
    const echo = effectParams("echo", 50);
    expect(tailSeconds("echo", 50)).toBeGreaterThan(echo.delayMs / 1000);
    expect(tailSeconds("hall", 50)).toBeGreaterThanOrEqual(effectParams("hall", 50).seconds);
    expect(tailSeconds("chipmunk", 50)).toBe(0);
    // 0.5 feedback: 0.5^10 < 0.001, so ten repeats plus the first.
    expect(feedbackTailSeconds(0.3, 0.5)).toBeCloseTo(0.3 * 11);
    expect(feedbackTailSeconds(1, 0.999)).toBe(8);
  });
});

describe("impulse response", () => {
  it("has the requested length and channels", () => {
    const ir = makeImpulseResponse(RATE, 1.5, { channels: 2 });
    expect(ir).toHaveLength(2);
    expect(ir[0].length).toBe(Math.round(RATE * 1.5));
    expect(ir[1].length).toBe(ir[0].length);
  });

  it("decays: each quarter is quieter than the one before, ending at silence", () => {
    const [ir] = makeImpulseResponse(RATE, 2, { decay: 3 });
    const quarter = ir.length / 4;
    const levels = [0, 1, 2, 3].map((part) => rms(ir, part * quarter, (part + 1) * quarter));
    for (let part = 1; part < 4; part += 1) expect(levels[part]).toBeLessThan(levels[part - 1]);
    expect(levels[3]).toBeLessThan(levels[0] * 0.1);
    expect(Math.abs(ir[ir.length - 1])).toBeLessThan(1e-3);
  });

  it("decorrelates the two channels and is repeatable with the same seed", () => {
    const [left, right] = makeImpulseResponse(RATE, 0.5, { seed: 3 });
    const [again] = makeImpulseResponse(RATE, 0.5, { seed: 3 });
    expect(Array.from(left.subarray(0, 50))).not.toEqual(Array.from(right.subarray(0, 50)));
    expect(Array.from(again)).toEqual(Array.from(left));
  });
});

describe("distortion curve", () => {
  it("is odd-symmetric and bounded by ±1", () => {
    for (const amount of [0.5, 2, 8, 40]) {
      const curve = makeDistortionCurve(amount, 1024);
      expect(curve.length).toBe(1024);
      for (let index = 0; index < curve.length; index += 1) {
        expect(Math.abs(curve[index])).toBeLessThanOrEqual(1 + 1e-6);
        expect(curve[index]).toBeCloseTo(-curve[curve.length - 1 - index], 6);
      }
      expect(curve[0]).toBeCloseTo(-1, 5);
      expect(curve[curve.length - 1]).toBeCloseTo(1, 5);
    }
  });

  it("is monotonic and saturates harder with more drive", () => {
    const soft = makeDistortionCurve(1, 513);
    const hard = makeDistortionCurve(10, 513);
    for (let index = 1; index < soft.length; index += 1) expect(soft[index]).toBeGreaterThanOrEqual(soft[index - 1]);
    // A quarter of the way up from the centre, harder drive is already near the ceiling.
    const probe = Math.round(513 * 0.625);
    expect(hard[probe]).toBeGreaterThan(soft[probe]);
  });
});

describe("ring modulation", () => {
  it("turns a constant into the carrier at full depth", () => {
    const input = new Float32Array(400).fill(1);
    const output = ringModulate(input, RATE, 100);
    for (let index = 0; index < input.length; index += 1) {
      expect(output[index]).toBeCloseTo(Math.sin((2 * Math.PI * 100 * index) / RATE), 5);
    }
  });

  it("leaves the signal alone at zero depth", () => {
    const input = sine(300, 0.05);
    expect(Array.from(ringModulate(input, RATE, 80, 0))).toEqual(Array.from(input));
  });

  it("moves a tone to the sum and difference frequencies", () => {
    // 1000 Hz × 200 Hz carrier = ½(cos 800 − cos 1200): no energy left at 1000.
    const output = ringModulate(sine(1000, 1, 1), RATE, 200);
    const correlate = (frequency: number) => {
      let re = 0;
      let im = 0;
      for (let index = 0; index < output.length; index += 1) {
        const phase = (2 * Math.PI * frequency * index) / RATE;
        re += output[index] * Math.cos(phase);
        im += output[index] * Math.sin(phase);
      }
      return Math.hypot(re, im) / output.length;
    };
    expect(correlate(800)).toBeCloseTo(0.25, 2);
    expect(correlate(1200)).toBeCloseTo(0.25, 2);
    expect(correlate(1000)).toBeLessThan(0.01);
  });
});

describe("bitcrush and comb", () => {
  it("quantises to the bit grid and holds samples", () => {
    const input = sine(440, 0.02);
    const output = bitcrush(input, 3, 4);
    const levels = 4;
    for (let index = 0; index < output.length; index += 1) {
      expect(Math.abs(output[index] * levels - Math.round(output[index] * levels))).toBeLessThan(1e-6);
      if (index % 4 !== 0) expect(output[index]).toBe(output[index - 1]);
    }
  });

  it("repeats an impulse every delay with decaying feedback", () => {
    const input = new Float32Array(40);
    input[0] = 1;
    const output = combFilter(input, 10, 0.5);
    expect(output[0]).toBe(1);
    expect(output[10]).toBeCloseTo(0.5);
    expect(output[20]).toBeCloseTo(0.25);
    expect(output[30]).toBeCloseTo(0.125);
    expect(output[5]).toBe(0);
  });
});

describe("pitch shift", () => {
  it("raises a tone an octave without changing its length", () => {
    const input = sine(220, 1);
    const output = pitchShift(input, RATE, 12);
    expect(output.length).toBe(input.length);
    const middle = [Math.round(RATE * 0.2), Math.round(RATE * 0.7)] as const;
    const ratio = crossingsPerSecond(output, ...middle) / crossingsPerSecond(input, ...middle);
    expect(ratio).toBeGreaterThan(1.85);
    expect(ratio).toBeLessThan(2.15);
  });

  it("lowers a tone and keeps the length", () => {
    const input = sine(440, 1);
    const output = pitchShift(input, RATE, -7);
    expect(output.length).toBe(input.length);
    const middle = [Math.round(RATE * 0.2), Math.round(RATE * 0.7)] as const;
    const ratio = crossingsPerSecond(output, ...middle) / crossingsPerSecond(input, ...middle);
    expect(ratio).toBeCloseTo(Math.pow(2, -7 / 12), 1);
  });

  it("copies the input untouched at zero semitones", () => {
    const input = sine(300, 0.1);
    const output = pitchShift(input, RATE, 0);
    expect(Array.from(output)).toEqual(Array.from(input));
    expect(output).not.toBe(input);
  });
});

describe("filters and the whisper vocoder", () => {
  it("band-pass passes its centre and rejects far frequencies", () => {
    const coefficients = bandPassCoefficients(RATE, 1000, 4);
    const at = (frequency: number) => {
      const output = applyBiquad(sine(frequency, 0.5, 1), coefficients);
      return rms(output, RATE * 0.1, output.length);
    };
    expect(at(1000)).toBeGreaterThan(0.6);
    expect(at(100)).toBeLessThan(0.1);
    expect(at(6000)).toBeLessThan(0.1);
  });

  it("follows a signal's loudness", () => {
    const burst = new Float32Array(RATE);
    burst.set(sine(500, 0.25, 0.8), RATE / 2);
    const contour = envelope(burst, RATE);
    expect(contour[RATE / 4]).toBe(0);
    expect(contour[Math.round(RATE * 0.6)]).toBeGreaterThan(0.3);
  });

  it("spaces vocoder bands logarithmically across the range", () => {
    const bands = vocoderBands(8, 200, 6400);
    expect(bands).toHaveLength(8);
    expect(bands[0].frequency).toBeGreaterThan(200);
    expect(bands[7].frequency).toBeLessThan(6400);
    const ratios = bands.slice(1).map((band, index) => band.frequency / bands[index].frequency);
    for (const ratio of ratios) expect(ratio).toBeCloseTo(ratios[0], 6);
  });

  it("follows the voice's envelope with noise: silent where the voice is silent", () => {
    const voice = new Float32Array(RATE);
    voice.set(sine(400, 0.3, 0.7), Math.round(RATE * 0.4));
    const whisper = noiseVocode(voice, RATE, 12);
    const quiet = rms(whisper, 0, Math.round(RATE * 0.35));
    const loud = rms(whisper, Math.round(RATE * 0.45), Math.round(RATE * 0.65));
    expect(loud).toBeGreaterThan(quiet * 20);
    // Noise, not a tone: the zero-crossing rate is nowhere near 400 Hz.
    expect(crossingsPerSecond(whisper, Math.round(RATE * 0.45), Math.round(RATE * 0.65))).not.toBeCloseTo(400, -1);
  });

  it("makes crackle that is quiet, bounded and seeded", () => {
    const noise = crackleNoise(RATE, RATE, 0.01, 10, 2);
    expect(peakOf(noise)).toBeLessThan(0.1);
    expect(peakOf(noise)).toBeGreaterThan(0);
    expect(Array.from(crackleNoise(100, RATE, 0.01, 10, 2))).toEqual(Array.from(noise.subarray(0, 100)));
  });

  it("gives a uniform-looking seeded random stream", () => {
    const random = mulberry32(1);
    let sum = 0;
    for (let index = 0; index < 10000; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });
});

describe("preprocessChannels", () => {
  it("returns same-length, finite, non-silent channels for every effect and leaves the input alone", () => {
    const input = sine(220, 0.4);
    const before = Array.from(input);
    for (const id of ALL) {
      const [output] = preprocessChannels(id, 70, [input], RATE);
      expect(output.length).toBe(input.length);
      expect(output).not.toBe(input);
      expect(output.every(Number.isFinite)).toBe(true);
      expect(peakOf(output)).toBeGreaterThan(0.01);
    }
    expect(Array.from(input)).toEqual(before);
  });
});
