/**
 * The voice changer's effects: what each one is called, how its single
 * "intensity" dial maps onto real parameters, the plain-array DSP that the
 * Web Audio node set cannot do on its own (pitch shift that keeps the length,
 * ring modulation, bit crushing, a noise vocoder) and the offline render that
 * strings it all together.
 *
 * Everything above `renderVoiceEffect` is pure — numbers in, numbers out — so
 * it runs under vitest without a browser.
 */
import { normalise, resample, timeStretch } from "./dsp";

export type VoiceEffectId =
  | "none"
  | "robot"
  | "chipmunk"
  | "deep"
  | "radio"
  | "alien"
  | "echo"
  | "hall"
  | "telephone"
  | "whisper";

export type VoiceEffect = {
  id: VoiceEffectId;
  /** Hebrew name on the card. */
  name: string;
  emoji: string;
  /** One short Hebrew line under the name. */
  blurb: string;
  /** Where the dial starts the first time the effect is chosen. */
  defaultIntensity: number;
};

/** The order here is the order of the cards. */
export const VOICE_EFFECTS: readonly VoiceEffect[] = [
  { id: "none", name: "ללא", emoji: "🎙️", blurb: "הקול המקורי", defaultIntensity: 0 },
  { id: "robot", name: "רובוט", emoji: "🤖", blurb: "מתכתי ומזמזם", defaultIntensity: 60 },
  { id: "chipmunk", name: "צ׳יפמאנק", emoji: "🐿️", blurb: "גבוה ומצחיק", defaultIntensity: 60 },
  { id: "deep", name: "קול עמוק", emoji: "🐻", blurb: "נמוך וכבד", defaultIntensity: 60 },
  { id: "radio", name: "רדיו ישן", emoji: "📻", blurb: "צר, צרוד ורחשי", defaultIntensity: 60 },
  { id: "alien", name: "חייזר", emoji: "👽", blurb: "רוטט ומוזר", defaultIntensity: 60 },
  { id: "echo", name: "הד", emoji: "⛰️", blurb: "חוזר מההרים", defaultIntensity: 50 },
  { id: "hall", name: "אולם", emoji: "🏛️", blurb: "מהדהד כמו בקתדרלה", defaultIntensity: 55 },
  { id: "telephone", name: "טלפון", emoji: "☎️", blurb: "כמו בשיחה", defaultIntensity: 60 },
  { id: "whisper", name: "לחישה", emoji: "🤫", blurb: "נשימתי ורך", defaultIntensity: 70 },
];

export const VOICE_EFFECT_IDS: readonly VoiceEffectId[] = VOICE_EFFECTS.map((effect) => effect.id);

export function isVoiceEffectId(value: unknown): value is VoiceEffectId {
  return typeof value === "string" && (VOICE_EFFECT_IDS as readonly string[]).includes(value);
}

export function voiceEffect(id: VoiceEffectId): VoiceEffect {
  return VOICE_EFFECTS.find((effect) => effect.id === id) ?? VOICE_EFFECTS[0];
}

// ---------------------------------------------------------------------------
// Intensity → parameters
// ---------------------------------------------------------------------------

export type RobotParams = {
  /** Carrier of the ring modulator; 50–120 Hz is the classic Dalek range. */
  ringHz: number;
  /** 0 = dry, 1 = pure ring modulation. */
  depth: number;
  bits: number;
  /** Sample-and-hold length: a cheap sample-rate reduction. */
  hold: number;
  combMs: number;
  combFeedback: number;
};
export type PitchParams = { semitones: number; shelfDb: number };
export type RadioParams = { lowHz: number; highHz: number; drive: number; noise: number; crackle: number };
export type AlienParams = {
  semitones: number;
  ringHz: number;
  ringMix: number;
  vibratoHz: number;
  /** Peak delay swing of the vibrato, in milliseconds. */
  vibratoMs: number;
  flangerMs: number;
  flangerFeedback: number;
  flangerMix: number;
};
export type EchoParams = { delayMs: number; feedback: number; wet: number };
export type HallParams = { seconds: number; decay: number; wet: number; preDelayMs: number };
export type TelephoneParams = { lowHz: number; highHz: number; drive: number; threshold: number; ratio: number };
export type WhisperParams = { bands: number; voiceMix: number };

export type EffectParamsMap = {
  none: Record<string, never>;
  robot: RobotParams;
  chipmunk: PitchParams;
  deep: PitchParams;
  radio: RadioParams;
  alien: AlienParams;
  echo: EchoParams;
  hall: HallParams;
  telephone: TelephoneParams;
  whisper: WhisperParams;
};

export function clampIntensity(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

/**
 * One dial per effect keeps the page simple; this is where "more" is decided
 * for each. Every mapping is monotonic, so pushing the dial right never makes
 * an effect milder.
 */
export function effectParams<Id extends VoiceEffectId>(id: Id, intensity: number): EffectParamsMap[Id] {
  const t = clampIntensity(intensity) / 100;
  const params: { [K in VoiceEffectId]: () => EffectParamsMap[K] } = {
    none: () => ({}),
    robot: () => ({
      ringHz: lerp(55, 115, t),
      depth: lerp(0.55, 1, t),
      bits: Math.round(lerp(12, 6, t)),
      hold: Math.round(lerp(1, 4, t)),
      combMs: 9,
      combFeedback: lerp(0.15, 0.55, t),
    }),
    chipmunk: () => ({ semitones: lerp(5, 12, t), shelfDb: lerp(0, 4, t) }),
    deep: () => ({ semitones: -lerp(3, 8, t), shelfDb: lerp(2, 6, t) }),
    radio: () => ({
      lowHz: lerp(300, 550, t),
      highHz: lerp(3400, 2600, t),
      drive: lerp(1.5, 7, t),
      noise: lerp(0.006, 0.035, t),
      crackle: lerp(2, 14, t),
    }),
    alien: () => ({
      semitones: lerp(3, 7, t),
      ringHz: lerp(280, 620, t),
      ringMix: lerp(0.15, 0.45, t),
      vibratoHz: lerp(5, 9, t),
      vibratoMs: lerp(0.6, 2.2, t),
      flangerMs: lerp(2, 5, t),
      flangerFeedback: lerp(0.35, 0.7, t),
      flangerMix: lerp(0.35, 0.6, t),
    }),
    echo: () => ({ delayMs: lerp(180, 420, t), feedback: lerp(0.25, 0.62, t), wet: lerp(0.3, 0.65, t) }),
    hall: () => ({ seconds: lerp(1.2, 4.5, t), decay: lerp(4, 2.2, t), wet: lerp(0.25, 0.7, t), preDelayMs: lerp(12, 45, t) }),
    telephone: () => ({
      lowHz: lerp(400, 700, t),
      highHz: lerp(3400, 2600, t),
      drive: lerp(1.2, 3.5, t),
      threshold: lerp(-20, -40, t),
      ratio: lerp(4, 14, t),
    }),
    whisper: () => ({ bands: Math.round(lerp(22, 12, t)), voiceMix: lerp(0.3, 0, t) }),
  };
  return params[id]() as EffectParamsMap[Id];
}

/** How far past the end the render has to run so a reverb or echo tail is not cut off. */
export function tailSeconds(id: VoiceEffectId, intensity: number) {
  if (id === "echo") {
    const { delayMs, feedback } = effectParams("echo", intensity);
    return feedbackTailSeconds(delayMs / 1000, feedback);
  }
  if (id === "hall") {
    const { seconds, preDelayMs } = effectParams("hall", intensity);
    return seconds + preDelayMs / 1000;
  }
  if (id === "robot") return 0.1;
  if (id === "alien") return 0.05;
  return 0;
}

/**
 * Time until a feedback delay's repeats fall below −60 dB. Each pass
 * multiplies by `feedback`, so that takes log(0.001)/log(feedback) passes;
 * capped so a feedback of 0.99 cannot ask for a minute of silence.
 */
export function feedbackTailSeconds(delaySeconds: number, feedback: number, maxSeconds = 8) {
  if (feedback <= 0 || delaySeconds <= 0) return delaySeconds > 0 ? delaySeconds : 0;
  const repeats = Math.ceil(Math.log(0.001) / Math.log(Math.min(0.999, feedback)));
  return Math.min(maxSeconds, delaySeconds * (repeats + 1));
}

// ---------------------------------------------------------------------------
// Pure DSP helpers
// ---------------------------------------------------------------------------

/** A tiny seeded generator, so the same effect renders the same noise twice. */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A soft-clipping curve for a WaveShaperNode: tanh scaled so ±1 in maps to
 * ±1 out. It is odd (negative half mirrors the positive), so it adds only odd
 * harmonics — the warm, tube-like grit of an old speaker rather than a buzz.
 */
export function makeDistortionCurve(amount: number, samples = 2048): Float32Array<ArrayBuffer> {
  const k = Math.max(0.001, amount);
  const norm = Math.tanh(k);
  const curve = new Float32Array(Math.max(2, samples));
  const last = curve.length - 1;
  for (let index = 0; index <= last; index += 1) {
    const x = (index * 2) / last - 1;
    curve[index] = Math.tanh(k * x) / norm;
  }
  // Pin exact symmetry: float rounding in x can otherwise differ by an ulp.
  for (let index = 0; index < curve.length / 2; index += 1) {
    const value = (curve[index] - curve[last - index]) / 2;
    curve[index] = value;
    curve[last - index] = -value;
  }
  return curve;
}

export type ImpulseOptions = {
  /** Steepness of the exponential decay; higher dies away faster. */
  decay?: number;
  channels?: number;
  seed?: number;
};

/**
 * A synthetic room: decorrelated noise per channel under an exponential
 * envelope, with a one-pole low-pass that closes over time because air and
 * walls soak up the highs faster than the lows. A final linear fade makes the
 * very last sample land on zero, so the convolver never clicks at the end.
 */
export function makeImpulseResponse(
  sampleRate: number,
  seconds: number,
  { decay = 3, channels = 2, seed = 7 }: ImpulseOptions = {},
): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  const random = mulberry32(seed);
  return Array.from({ length: channels }, () => {
    const data = new Float32Array(length);
    let smoothed = 0;
    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      const noise = random() * 2 - 1;
      // Bright at the start, darker towards the tail.
      const alpha = lerp(0.9, 0.15, progress);
      smoothed += alpha * (noise - smoothed);
      data[index] = smoothed * Math.exp(-decay * progress * 2.3) * (1 - progress);
    }
    return data;
  });
}

/**
 * Multiplies by a sine carrier. At full depth the voice's own pitch vanishes
 * and only sum and difference frequencies remain — that is the robot; less
 * depth keeps some of the original for intelligibility.
 */
export function ringModulate(
  input: Float32Array,
  sampleRate: number,
  frequency: number,
  depth = 1,
): Float32Array<ArrayBuffer> {
  const output = new Float32Array(input.length);
  const step = (2 * Math.PI * frequency) / sampleRate;
  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] * (1 - depth + depth * Math.sin(step * index));
  }
  return output;
}

/** Quantises to `bits` and holds each value for `hold` samples: lo-fi grit. */
export function bitcrush(input: Float32Array, bits: number, hold = 1): Float32Array<ArrayBuffer> {
  const levels = Math.pow(2, Math.max(1, Math.round(bits)) - 1);
  const step = Math.max(1, Math.round(hold));
  const output = new Float32Array(input.length);
  let held = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (index % step === 0) held = Math.round(input[index] * levels) / levels;
    output[index] = held;
  }
  return output;
}

/** Feedback comb: y[n] = x[n] + g·y[n−d]. A short d gives the metallic "tube" ring. */
export function combFilter(input: Float32Array, delaySamples: number, feedback: number): Float32Array<ArrayBuffer> {
  const delay = Math.max(1, Math.round(delaySamples));
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = input[index] + (index >= delay ? feedback * output[index - delay] : 0);
  }
  return output;
}

/**
 * Pitch shift that keeps the length: the site's overlap-add stretch makes
 * the clip longer (or shorter) by the pitch ratio, and resampling squeezes it
 * back, which moves the pitch. The result is trimmed or padded to the exact
 * input length so the voice lines up with the original.
 */
export function pitchShift(channel: Float32Array, sampleRate: number, semitones: number): Float32Array<ArrayBuffer> {
  const output = new Float32Array(channel.length);
  if (Math.abs(semitones) < 0.01) {
    output.set(channel);
    return output;
  }
  const ratio = Math.pow(2, semitones / 12);
  // The stretch only lays grains that fit whole inside its input, so the
  // last grain's worth (~60 ms) came out silent — and a clip shorter than a
  // grain came out as pure silence. A grain of padding lets every sample in.
  const grain = Math.max(256, Math.round(sampleRate * 0.06));
  const padded = new Float32Array(channel.length + grain);
  padded.set(channel);
  const shifted = resample(timeStretch(padded, sampleRate, 1 / ratio), ratio);
  output.set(shifted.subarray(0, Math.min(shifted.length, output.length)));
  return output;
}

export type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** RBJ band-pass with 0 dB peak gain, normalised so a0 = 1. */
export function bandPassCoefficients(sampleRate: number, frequency: number, q: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(frequency, sampleRate * 0.49)) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 };
}

export function applyBiquad(input: Float32Array, { b0, b1, b2, a1, a2 }: Biquad): Float32Array<ArrayBuffer> {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const x0 = input[index];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

/** Rectify-and-smooth follower with a fast attack and slower release, like a VU needle. */
export function envelope(input: Float32Array, sampleRate: number, attackMs = 5, releaseMs = 40): Float32Array<ArrayBuffer> {
  const attack = 1 - Math.exp(-1 / ((attackMs / 1000) * sampleRate));
  const release = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  const output = new Float32Array(input.length);
  let level = 0;
  for (let index = 0; index < input.length; index += 1) {
    const target = Math.abs(input[index]);
    level += (target > level ? attack : release) * (target - level);
    output[index] = level;
  }
  return output;
}

/** Log-spaced band centres and widths between `low` and `high`. */
export function vocoderBands(count: number, low: number, high: number) {
  const bands: { frequency: number; q: number }[] = [];
  const ratio = Math.pow(high / low, 1 / count);
  for (let index = 0; index < count; index += 1) {
    const from = low * Math.pow(ratio, index);
    const to = from * ratio;
    const frequency = Math.sqrt(from * to);
    bands.push({ frequency, q: frequency / (to - from) });
  }
  return bands;
}

/**
 * The whisper: a noise vocoder. The voice is split into bands, each band's
 * loudness contour is followed, and that contour gates the same band of white
 * noise. Pitch — the vocal cords — is gone, but the shape of the mouth, which
 * is what makes words words, survives; that is exactly what a whisper is.
 */
export function noiseVocode(
  input: Float32Array,
  sampleRate: number,
  bands: number,
  seed = 11,
): Float32Array<ArrayBuffer> {
  const random = mulberry32(seed);
  const noise = new Float32Array(input.length);
  for (let index = 0; index < noise.length; index += 1) noise[index] = random() * 2 - 1;

  const output = new Float32Array(input.length);
  const high = Math.min(8000, sampleRate * 0.45);
  const attack = 1 - Math.exp(-1 / ((4 / 1000) * sampleRate));
  const release = 1 - Math.exp(-1 / ((35 / 1000) * sampleRate));
  for (const { frequency, q } of vocoderBands(Math.max(1, Math.round(bands)), 180, high)) {
    // One pass per band doing what applyBiquad → envelope on the voice and
    // applyBiquad on the noise do in four, rounding to 32 bits at the same
    // points so the samples are identical: a few minutes of audio went
    // through a dozen bands of three full-length scratch arrays each.
    const { b0, b1, b2, a1, a2 } = bandPassCoefficients(sampleRate, frequency, q);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let n1 = 0;
    let n2 = 0;
    let m1 = 0;
    let m2 = 0;
    let level = 0;
    for (let index = 0; index < output.length; index += 1) {
      const x0 = input[index];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      const target = Math.abs(Math.fround(y0));
      level += (target > level ? attack : release) * (target - level);
      const noise0 = noise[index];
      const m0 = b0 * noise0 + b1 * n1 + b2 * n2 - a1 * m1 - a2 * m2;
      n2 = n1;
      n1 = noise0;
      m2 = m1;
      m1 = m0;
      output[index] += Math.fround(m0) * Math.fround(level);
    }
  }
  return output;
}

/**
 * Old-radio surface noise: a quiet hiss plus sparse, decaying pops, placed
 * `crackle` times a second on average.
 */
export function crackleNoise(length: number, sampleRate: number, hiss: number, crackle: number, seed = 5): Float32Array<ArrayBuffer> {
  const random = mulberry32(seed);
  const output = new Float32Array(length);
  const popChance = crackle / sampleRate;
  let pop = 0;
  for (let index = 0; index < length; index += 1) {
    if (random() < popChance) pop = (random() * 2 - 1) * hiss * 6;
    output[index] = (random() * 2 - 1) * hiss + pop;
    pop *= 0.92;
  }
  return output;
}

/**
 * The part of each effect that happens on plain arrays before the Web Audio
 * graph, for one channel: shifts, ring modulation, crushing and the vocoder.
 * `index` is the channel's place in the file, which seeds the whisper's
 * noise so the two sides of a stereo file are decorrelated. Returns a new
 * array; the input is left alone.
 */
export function preprocessChannel(
  id: VoiceEffectId,
  intensity: number,
  channel: Float32Array,
  sampleRate: number,
  index = 0,
): Float32Array<ArrayBuffer> {
  switch (id) {
    case "robot": {
      const p = effectParams("robot", intensity);
      return combFilter(
        bitcrush(ringModulate(channel, sampleRate, p.ringHz, p.depth), p.bits, p.hold),
        (p.combMs / 1000) * sampleRate,
        p.combFeedback,
      );
    }
    case "chipmunk":
    case "deep": {
      const { semitones } = effectParams(id, intensity);
      return pitchShift(channel, sampleRate, semitones);
    }
    case "alien": {
      const p = effectParams("alien", intensity);
      const shifted = pitchShift(channel, sampleRate, p.semitones);
      const ringed = ringModulate(shifted, sampleRate, p.ringHz, 1);
      for (let sample = 0; sample < shifted.length; sample += 1) {
        shifted[sample] = shifted[sample] * (1 - p.ringMix) + ringed[sample] * p.ringMix;
      }
      return shifted;
    }
    case "whisper": {
      const p = effectParams("whisper", intensity);
      const breath = noiseVocode(channel, sampleRate, p.bands, 11 + index);
      // The vocoder comes out far quieter than the voice; match their peaks
      // before blending so the mix knob means what it says.
      const breathPeak = peakOf(breath) || 1;
      const voicePeak = peakOf(channel) || 1;
      const scale = voicePeak / breathPeak;
      for (let sample = 0; sample < breath.length; sample += 1) {
        breath[sample] = breath[sample] * scale * (1 - p.voiceMix) + channel[sample] * p.voiceMix;
      }
      return breath;
    }
    default: {
      const output = new Float32Array(channel.length);
      output.set(channel);
      return output;
    }
  }
}

/** {@link preprocessChannel} for every channel of a file. */
export function preprocessChannels(
  id: VoiceEffectId,
  intensity: number,
  channels: Float32Array[],
  sampleRate: number,
): Float32Array<ArrayBuffer>[] {
  return channels.map((channel, index) => preprocessChannel(id, intensity, channel, sampleRate, index));
}

/** Effects whose array stage is heavy enough to freeze the page on a long file. */
export function needsArrayStage(id: VoiceEffectId) {
  return id === "robot" || id === "chipmunk" || id === "deep" || id === "alien" || id === "whisper";
}

export type VoiceFxRequest = { id: VoiceEffectId; intensity: number; channel: Float32Array<ArrayBuffer>; sampleRate: number; index: number };
export type VoiceFxResponse = { ok: true; channel: Float32Array<ArrayBuffer> } | { ok: false; message: string };

export class VoiceFxCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "VoiceFxCancelled";
  }
}

/**
 * One channel's array stage on a worker of its own, so the pitch shift and
 * the vocoder (seconds of work on a few minutes of audio) neither freeze the
 * page nor keep burning after the visitor has moved on — an abort terminates
 * the worker. Where a worker cannot start, the same function runs here, so
 * the result is the same either way.
 */
function preprocessOnWorker(request: VoiceFxRequest, signal?: AbortSignal): Promise<Float32Array<ArrayBuffer>> {
  const runHere = () => preprocessChannel(request.id, request.intensity, request.channel, request.sampleRate, request.index);
  if (signal?.aborted) return Promise.reject(new VoiceFxCancelled());
  let worker: Worker;
  try {
    worker = new Worker(new URL("../workers/voiceFx.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return Promise.resolve().then(runHere);
  }
  return new Promise((resolve, reject) => {
    let heard = false;
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new VoiceFxCancelled());
    };
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (event: MessageEvent<VoiceFxResponse>) => {
      heard = true;
      finish();
      if (event.data.ok) resolve(event.data.channel);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      // A worker that never answered most likely never loaded (a blocked
      // module); the page can still do the work itself.
      if (heard) reject(new Error("העיבוד נעצר באמצע."));
      else {
        try {
          resolve(runHere());
        } catch (caught) {
          reject(caught);
        }
      }
    };
    // A copy goes to the worker; the decoded file itself stays with the page.
    const copy = new Float32Array(request.channel.length);
    copy.set(request.channel);
    worker.postMessage({ ...request, channel: copy }, [copy.buffer]);
  });
}

export function peakOf(channel: Float32Array) {
  let peak = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const magnitude = Math.abs(channel[index]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

// ---------------------------------------------------------------------------
// The offline render (browser only)
// ---------------------------------------------------------------------------

function offlineContextClass(): typeof OfflineAudioContext {
  const scope = globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Context = scope.OfflineAudioContext || scope.webkitOfflineAudioContext;
  if (!Context) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  return Context;
}

/** Wires one effect's node graph between `source` and the destination. */
function buildGraph(context: OfflineAudioContext, source: AudioBufferSourceNode, id: VoiceEffectId, intensity: number) {
  const out = context.destination;
  const filter = (type: BiquadFilterType, frequency: number, q = Math.SQRT1_2, gain = 0) => {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    node.gain.value = gain;
    return node;
  };
  const gain = (value: number) => {
    const node = context.createGain();
    node.gain.value = value;
    return node;
  };
  const chain = (...nodes: AudioNode[]) => {
    for (let index = 0; index < nodes.length - 1; index += 1) nodes[index].connect(nodes[index + 1]);
    return nodes[nodes.length - 1];
  };
  const shaper = (amount: number) => {
    const node = context.createWaveShaper();
    node.curve = makeDistortionCurve(amount);
    // Oversampling keeps the added harmonics from folding back as aliasing.
    node.oversample = "2x";
    return node;
  };
  const lfo = (frequency: number, depth: number, target: AudioParam) => {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency;
    chain(oscillator, gain(depth)).connect(target);
    oscillator.start(0);
  };

  switch (id) {
    case "robot": {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.ratio.value = 4;
      chain(source, filter("highpass", 90), compressor, out);
      return;
    }
    case "chipmunk": {
      const p = effectParams("chipmunk", intensity);
      chain(source, filter("highpass", 140), filter("highshelf", 3500, Math.SQRT1_2, p.shelfDb), out);
      return;
    }
    case "deep": {
      const p = effectParams("deep", intensity);
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.ratio.value = 3;
      // A pitched-down voice loses its chest; the shelf gives some back.
      chain(source, filter("lowshelf", 180, Math.SQRT1_2, p.shelfDb), filter("lowpass", 7000), compressor, out);
      return;
    }
    case "radio": {
      const p = effectParams("radio", intensity);
      // Two cascaded filters on each side: a single 12 dB/oct slope still
      // sounds like a hi-fi with the treble turned down, not a tin speaker.
      chain(
        source,
        filter("highpass", p.lowHz),
        filter("highpass", p.lowHz),
        filter("lowpass", p.highHz),
        filter("lowpass", p.highHz),
        filter("peaking", 1800, 1, 4),
        shaper(p.drive),
        gain(0.8),
        out,
      );
      const noise = context.createBufferSource();
      const hiss = crackleNoise(context.length, context.sampleRate, p.noise, p.crackle);
      const noiseBuffer = context.createBuffer(1, context.length, context.sampleRate);
      noiseBuffer.getChannelData(0).set(hiss);
      noise.buffer = noiseBuffer;
      chain(noise, filter("bandpass", 1600, 0.6), out);
      noise.start(0);
      return;
    }
    case "alien": {
      const p = effectParams("alien", intensity);
      // Vibrato: a delay whose length wobbles bends the pitch up and down.
      const vibrato = context.createDelay(0.05);
      vibrato.delayTime.value = (p.vibratoMs * 1.5) / 1000;
      lfo(p.vibratoHz, p.vibratoMs / 1000, vibrato.delayTime);
      source.connect(vibrato);
      vibrato.connect(gain(1 - p.flangerMix * 0.5)).connect(out);
      // Flanger: a very short, slowly sweeping delay fed back into itself.
      const flanger = context.createDelay(0.05);
      flanger.delayTime.value = p.flangerMs / 1000;
      lfo(0.3, (p.flangerMs * 0.8) / 1000, flanger.delayTime);
      const feedback = gain(p.flangerFeedback);
      vibrato.connect(flanger);
      flanger.connect(feedback).connect(flanger);
      flanger.connect(gain(p.flangerMix)).connect(out);
      return;
    }
    case "echo": {
      const p = effectParams("echo", intensity);
      source.connect(out);
      const delay = context.createDelay(2);
      delay.delayTime.value = p.delayMs / 1000;
      // Each repeat passes the low-pass again, so later echoes get duller —
      // the way a real echo loses its edge over distance.
      const tone = filter("lowpass", 3800);
      const feedback = gain(p.feedback);
      source.connect(delay);
      delay.connect(tone);
      tone.connect(feedback).connect(delay);
      tone.connect(gain(p.wet)).connect(out);
      return;
    }
    case "hall": {
      const p = effectParams("hall", intensity);
      source.connect(gain(1 - p.wet * 0.5)).connect(out);
      const channels = makeImpulseResponse(context.sampleRate, p.seconds, { decay: p.decay, channels: 2 });
      const impulse = context.createBuffer(2, channels[0].length, context.sampleRate);
      channels.forEach((data, index) => impulse.getChannelData(index).set(data));
      const convolver = context.createConvolver();
      convolver.normalize = true;
      convolver.buffer = impulse;
      const preDelay = context.createDelay(0.2);
      preDelay.delayTime.value = p.preDelayMs / 1000;
      chain(source, preDelay, convolver, gain(p.wet * 1.4), out);
      return;
    }
    case "telephone": {
      const p = effectParams("telephone", intensity);
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = p.threshold;
      compressor.ratio.value = p.ratio;
      compressor.knee.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;
      chain(
        source,
        filter("highpass", p.lowHz),
        filter("highpass", p.lowHz),
        filter("lowpass", p.highHz),
        filter("lowpass", p.highHz),
        filter("peaking", 1500, 1.2, 6),
        shaper(p.drive),
        compressor,
        out,
      );
      return;
    }
    case "whisper": {
      chain(source, filter("highpass", 250), filter("highshelf", 4000, Math.SQRT1_2, 3), out);
      return;
    }
    default:
      source.connect(out);
  }
}

/**
 * Renders the voice through one effect: array DSP first, then the node graph
 * in an OfflineAudioContext (which runs faster than real time), then a peak
 * normalise so a loud echo or a quiet whisper both come out at a sensible
 * level. "none" hands back the original untouched.
 */
export async function renderVoiceEffect(buffer: AudioBuffer, id: VoiceEffectId, intensity: number, signal?: AbortSignal): Promise<AudioBuffer> {
  if (id === "none") return buffer;
  const Context = offlineContextClass();
  const sampleRate = buffer.sampleRate;
  const channelCount = Math.min(2, buffer.numberOfChannels);
  const input = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
  // The heavy array work runs one worker per channel, side by side.
  const processed = needsArrayStage(id)
    ? await Promise.all(
        input.map((channel, index) =>
          preprocessOnWorker({ id, intensity, channel: channel as Float32Array<ArrayBuffer>, sampleRate, index }, signal),
        ),
      )
    : preprocessChannels(id, intensity, input, sampleRate);
  if (signal?.aborted) throw new VoiceFxCancelled();

  const tail = Math.round(tailSeconds(id, intensity) * sampleRate);
  const length = buffer.length + tail;
  const context = new Context(channelCount, length, sampleRate);
  const prepared = context.createBuffer(channelCount, buffer.length, sampleRate);
  processed.forEach((data, index) => prepared.getChannelData(index).set(data));
  const source = context.createBufferSource();
  source.buffer = prepared;
  buildGraph(context, source, id, intensity);
  source.start(0);
  const rendered = await context.startRendering();
  if (signal?.aborted) throw new VoiceFxCancelled();

  const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index));
  normalise(channels, 0.9);

  // Drop the silent end of the tail allowance, but never cut into the voice.
  let last = buffer.length;
  for (const channel of channels) {
    for (let index = channel.length - 1; index > last; index -= 1) {
      if (Math.abs(channel[index]) > 0.001) {
        last = index;
        break;
      }
    }
  }
  const keep = Math.min(rendered.length, last + Math.round(sampleRate * 0.05));
  if (keep >= rendered.length) return rendered;
  const trimmed = context.createBuffer(channels.length, keep, sampleRate);
  channels.forEach((data, index) => trimmed.getChannelData(index).set(data.subarray(0, keep)));
  return trimmed;
}
