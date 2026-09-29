/**
 * Noise reduction for a recording: a spectral gate that learns what the
 * background sounds like, notch filters for mains hum, a de-clicker for
 * impulsive pops and an optional rumble filter. Pure number crunching — no
 * DOM, no Web Audio — so the same code runs on a worker, on the page when a
 * worker is not available, and under vitest.
 */
import { Fft, hannWindow } from "./fft";

/** STFT size: 46 ms at 44.1 kHz, fine enough in frequency to sit between harmonics of a voice. */
export const FRAME_SIZE = 2048;
/** 75% overlap: a Hann window squared still sums to a constant at this hop. */
export const HOP_SIZE = FRAME_SIZE / 4;
const BINS = FRAME_SIZE / 2 + 1;

/** How many frames either side of the current one the gain mask is averaged over. */
const TIME_SMOOTH = 2;
const TIME_WEIGHTS = [1, 2, 4, 2, 1];
/** How many bins either side the gain mask is averaged over (triangular). */
const FREQ_SMOOTH = 2;
/** The deepest cut, at full strength. Beyond this the gate starts eating the voice itself. */
const MAX_REDUCTION_DB = 32;

export type HumSetting = "off" | "50" | "60";

export type DenoiseSettings = {
  /** 0..100 — how hard the spectral gate works; 0 leaves the spectrum untouched. */
  strength: number;
  hum: HumSetting;
  declick: boolean;
  highpass: boolean;
};

export const DEFAULT_DENOISE_SETTINGS: DenoiseSettings = {
  strength: 60,
  hum: "off",
  declick: false,
  highpass: false,
};

/** Where the noise profile comes from. Times are in seconds. */
export type NoiseSource = { kind: "auto" } | { kind: "region"; start: number; end: number };

export type TimeRegion = { start: number; end: number };

export type DenoiseResult = {
  channels: Float32Array[];
  /** How many clicks were repaired, across all channels. */
  clicks: number;
  /** The stretch the noise profile was learned from. */
  region: TimeRegion;
  /** How much quieter that stretch became, in dB; null when it was silent to begin with. */
  reductionDb: number | null;
};

export type DenoiseProgress = (fraction: number) => void;

// ---------------------------------------------------------------- biquads --

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** RBJ-cookbook notch: unity gain everywhere except a narrow hole at `frequency`. */
export function notchCoefficients(frequency: number, sampleRate: number, bandwidth: number): Biquad {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const q = frequency / bandwidth;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return { b0: 1 / a0, b1: (-2 * cos) / a0, b2: 1 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Second-order Butterworth high-pass. */
export function highpassCoefficients(cutoff: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** One pass of a biquad, in place, in either direction (transposed direct form II, double state). */
function runBiquad(data: Float32Array, { b0, b1, b2, a1, a2 }: Biquad, reverse: boolean) {
  let z1 = 0;
  let z2 = 0;
  const length = data.length;
  for (let step = 0; step < length; step += 1) {
    const index = reverse ? length - 1 - step : step;
    const x = data[index];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    data[index] = y;
  }
}

/**
 * Forward then backward. Running each filter both ways cancels its phase
 * shift, which matters here for two reasons: a high-pass would otherwise smear
 * the low end of a voice in time, and "what was removed" is computed as
 * original minus cleaned — with a phase-shifting filter that difference would
 * be full of perfectly good audio that merely moved.
 */
export function filtfilt(data: Float32Array, coefficients: Biquad) {
  runBiquad(data, coefficients, false);
  runBiquad(data, coefficients, true);
}

/** The notch frequencies for mains hum: the fundamental and every harmonic up to about 1 kHz. */
export function humFrequencies(mains: 50 | 60, sampleRate: number): number[] {
  const list: number[] = [];
  const limit = Math.min(1000, sampleRate * 0.45);
  for (let frequency = mains; frequency <= limit + 1; frequency += mains) list.push(frequency);
  return list;
}

/**
 * A cascade of narrow notches on the hum and its harmonics. The notches widen
 * a little as they climb because the mains frequency drifts (±0.1 Hz at the
 * fundamental becomes ±2 Hz by the 20th harmonic), yet stay a few hertz wide
 * so a note that happens to sit near a harmonic barely loses anything.
 */
export function removeHum(data: Float32Array, sampleRate: number, mains: 50 | 60) {
  for (const frequency of humFrequencies(mains, sampleRate)) {
    filtfilt(data, notchCoefficients(frequency, sampleRate, 2 + frequency * 0.005));
  }
}

/**
 * Rumble filter. One Butterworth section run both ways is a zero-phase
 * fourth-order response (-6 dB at the cutoff, 24 dB per octave below it) —
 * enough for handling noise, air conditioning and wind without thinning a
 * low voice.
 */
export function removeRumble(data: Float32Array, sampleRate: number, cutoff = 80) {
  filtfilt(data, highpassCoefficients(cutoff, sampleRate));
}

// --------------------------------------------------------------- de-click --

/** The median of every `stride`-th value of |values[from..to)| — a robust level that one click cannot move. */
function medianAbs(values: Float32Array, from: number, to: number, stride: number, scratch: Float32Array) {
  let count = 0;
  for (let index = from; index < to; index += stride) scratch[count++] = Math.abs(values[index]);
  if (count === 0) return 0;
  const view = scratch.subarray(0, count);
  view.sort();
  return view[count >> 1];
}

/**
 * Finds short impulsive outliers — vinyl pops, mouth clicks, digital glitches
 * — and redraws the samples under them with a cubic through the good samples
 * on either side. Returns how many were repaired.
 *
 * Detection looks at the second difference (how far a sample leaves the line
 * through its neighbours), which is tiny for anything band-limited and huge
 * for a spike. The threshold is a multiple of the local median of that value,
 * so a loud passage does not trigger it and a quiet one still catches small
 * clicks. Anything longer than a couple of milliseconds is left alone: that
 * is a drum hit or a consonant, not a click, and interpolating over it would
 * do more harm than the click.
 */
export function declick(data: Float32Array, sampleRate: number, threshold = 10): number {
  const length = data.length;
  if (length < 16) return 0;
  const diff = new Float32Array(length);
  for (let index = 1; index < length - 1; index += 1) {
    diff[index] = data[index] - 0.5 * (data[index - 1] + data[index + 1]);
  }

  const block = 1024;
  const blocks = Math.ceil(length / block);
  const scratch = new Float32Array(block);
  const levels = new Float32Array(blocks);
  for (let b = 0; b < blocks; b += 1) {
    levels[b] = medianAbs(diff, b * block, Math.min(length, (b + 1) * block), 2, scratch);
  }

  // Absolute floor: in near-silence the median is almost zero and dither
  // alone would look like a click.
  const floor = 0.004;
  const maxRun = Math.max(8, Math.round(sampleRate * 0.002));
  const pad = 2;
  const mergeGap = 4;
  let repaired = 0;

  let index = 2;
  while (index < length - 2) {
    const b = Math.floor(index / block);
    // The neighbouring blocks' levels guard the edge of a loud passage.
    const level = Math.max(levels[b], b > 0 ? levels[b - 1] * 0.5 : 0, b + 1 < blocks ? levels[b + 1] * 0.5 : 0);
    const limit = Math.max(floor, threshold * level);
    if (Math.abs(diff[index]) <= limit) {
      index += 1;
      continue;
    }
    // Grow the run while flagged samples keep arriving within a few samples.
    let end = index;
    let probe = index + 1;
    while (probe < length - 2 && probe - end <= mergeGap) {
      if (Math.abs(diff[probe]) > limit) end = probe;
      probe += 1;
    }
    const start = Math.max(2, index - pad);
    const stop = Math.min(length - 3, end + pad);
    if (stop - start + 1 <= maxRun && start >= 2 && stop <= length - 3) {
      repairGap(data, start, stop);
      repaired += 1;
    }
    index = end + mergeGap + 1;
  }
  return repaired;
}

/** Cubic Hermite from data[start-1] to data[stop+1], matching the slope on each side. */
function repairGap(data: Float32Array, start: number, stop: number) {
  const p1 = data[start - 1];
  const p2 = data[stop + 1];
  const m1 = data[start - 1] - data[start - 2];
  const m2 = data[stop + 2] - data[stop + 1];
  const span = stop - start + 2;
  for (let index = start; index <= stop; index += 1) {
    const t = (index - (start - 1)) / span;
    const t2 = t * t;
    const t3 = t2 * t;
    data[index] =
      (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * span * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * span * m2;
  }
}

// --------------------------------------------------------- noise profile --

/**
 * The quietest stretch of the file — where, in a typical recording, only the
 * background is left. Blocks of pure digital silence are skipped: a file that
 * begins with exact zeros would otherwise "learn" that the noise is nothing
 * and then remove nothing.
 */
export function findQuietestRegion(channels: Float32Array[], sampleRate: number, seconds = 0.6): TimeRegion {
  const length = channels[0]?.length ?? 0;
  const block = 1024;
  const blocks = Math.floor(length / block);
  const duration = length / sampleRate;
  if (blocks < 2) return { start: 0, end: duration };

  const energy = new Float64Array(blocks);
  for (let b = 0; b < blocks; b += 1) {
    let sum = 0;
    for (const channel of channels) {
      for (let index = b * block; index < (b + 1) * block; index += 1) sum += channel[index] * channel[index];
    }
    energy[b] = sum / (block * channels.length);
  }

  // A short file gets a proportionally short window, but never less than a
  // few STFT frames, or the profile is too noisy to trust.
  const wanted = Math.min(seconds, duration * 0.25);
  const span = Math.max(Math.ceil((FRAME_SIZE * 2) / block), Math.round((wanted * sampleRate) / block));
  const window = Math.min(blocks, span);
  const dead = 1e-10; // mean square of ~-100 dBFS

  let best = -1;
  let bestEnergy = Infinity;
  let fallback = 0;
  let fallbackEnergy = Infinity;
  let sum = 0;
  let deadCount = 0;
  for (let b = 0; b < blocks; b += 1) {
    sum += energy[b];
    if (energy[b] < dead) deadCount += 1;
    if (b >= window) {
      sum -= energy[b - window];
      if (energy[b - window] < dead) deadCount -= 1;
    }
    if (b < window - 1) continue;
    const first = b - window + 1;
    if (sum < fallbackEnergy) {
      fallbackEnergy = sum;
      fallback = first;
    }
    if (deadCount === 0 && sum < bestEnergy) {
      bestEnergy = sum;
      best = first;
    }
  }
  const first = best >= 0 ? best : fallback;
  return { start: (first * block) / sampleRate, end: ((first + window) * block) / sampleRate };
}

/**
 * The average power of each frequency bin over a stretch of the signal —
 * the "fingerprint" of the noise that the gate then subtracts. Measured with
 * the same window and frame size as the gate itself, so the two agree.
 */
export function learnNoiseProfile(data: Float32Array, sampleRate: number, region: TimeRegion): Float32Array {
  const profile = new Float32Array(BINS);
  const length = data.length;
  let from = Math.max(0, Math.floor(region.start * sampleRate));
  let to = Math.min(length, Math.ceil(region.end * sampleRate));
  // A selection shorter than one frame is widened around its centre.
  if (to - from < FRAME_SIZE) {
    const centre = Math.round((from + to) / 2);
    from = Math.max(0, Math.min(length - FRAME_SIZE, centre - FRAME_SIZE / 2));
    to = Math.min(length, from + FRAME_SIZE);
  }
  const fft = new Fft(FRAME_SIZE);
  const window = hannWindow(FRAME_SIZE);
  const re = new Float32Array(FRAME_SIZE);
  const im = new Float32Array(FRAME_SIZE);
  let frames = 0;
  for (let start = from; start + FRAME_SIZE <= Math.max(to, from + FRAME_SIZE); start += HOP_SIZE) {
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      re[index] = (data[start + index] ?? 0) * window[index];
      im[index] = 0;
    }
    fft.transform(re, im);
    for (let bin = 0; bin < BINS; bin += 1) profile[bin] += re[bin] * re[bin] + im[bin] * im[bin];
    frames += 1;
    if (start + FRAME_SIZE >= to) break;
  }
  if (frames > 0) for (let bin = 0; bin < BINS; bin += 1) profile[bin] /= frames;
  return profile;
}

// ----------------------------------------------------------- spectral gate --

/**
 * The spectral gate. Each STFT frame gets a Wiener-style gain per bin —
 * how much of that bin's power is signal rather than noise — and the gain
 * mask is then smoothed across neighbouring bins and frames before it is
 * applied. Without that smoothing the random dips and peaks of the noise
 * turn into isolated tones that flicker on and off ("musical noise"), which
 * sounds worse than the hiss did. A floor keeps some of the background, so
 * the pauses sound like a quiet room rather than a vacuum.
 *
 * Frames start before the signal and run past its end, so every sample is
 * covered by the same four windows and the overlap-add normalisation is
 * exact everywhere — with strength 0 the output is the input.
 */
export function spectralGate(
  data: Float32Array,
  profile: Float32Array,
  strength: number,
  onProgress?: DenoiseProgress,
): Float32Array {
  const length = data.length;
  const output = new Float32Array(length);
  if (length === 0) return output;

  const amount = Math.max(0, Math.min(1, strength));
  // Over-subtraction: estimating the noise from a few seconds always misses
  // some of its peaks, so a stronger setting subtracts more than was measured.
  const oversubtract = 1 + 1.5 * amount;
  const floorGain = Math.pow(10, (-MAX_REDUCTION_DB * amount) / 20);

  const N = FRAME_SIZE;
  const fft = new Fft(N);
  const window = hannWindow(N);
  // The sum of the squared windows that overlap any one sample; constant
  // (1.5) for a periodic Hann at 75% overlap, measured rather than assumed.
  const norm = new Float32Array(HOP_SIZE);
  for (let phase = 0; phase < HOP_SIZE; phase += 1) {
    let sum = 0;
    for (let at = phase; at < N; at += HOP_SIZE) sum += window[at] * window[at];
    norm[phase] = sum;
  }

  // One slot more than the smoothing needs: frames are analysed two at a
  // time, so the next frame lands in the ring one step early.
  const ring = 2 * TIME_SMOOTH + 2;
  const ringRe = Array.from({ length: ring }, () => new Float32Array(BINS));
  const ringIm = Array.from({ length: ring }, () => new Float32Array(BINS));
  const ringGain = Array.from({ length: ring }, () => new Float32Array(BINS));
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const timeGain = new Float32Array(BINS);
  const gain = new Float32Array(BINS);
  // The gained spectrum of an even output frame, waiting for its odd partner.
  const heldRe = new Float32Array(BINS);
  const heldIm = new Float32Array(BINS);
  let held = -1;
  const oddRe = new Float32Array(BINS);
  const oddIm = new Float32Array(BINS);

  const firstStart = -(N - HOP_SIZE);
  const frameCount = Math.ceil((length - firstStart) / HOP_SIZE);
  const progressEvery = Math.max(1, Math.floor(frameCount / 50));

  const fill = (target: Float32Array, frame: number) => {
    const start = firstStart + frame * HOP_SIZE;
    if (frame >= frameCount) {
      target.fill(0);
      return;
    }
    for (let index = 0; index < N; index += 1) {
      const at = start + index;
      target[index] = at >= 0 && at < length ? data[at] * window[index] : 0;
    }
  };

  /** The raw Wiener gain of one kept spectrum. */
  const rawGain = (slot: number) => {
    const sRe = ringRe[slot];
    const sIm = ringIm[slot];
    const raw = ringGain[slot];
    let previous = sRe[1] * sRe[1] + sIm[1] * sIm[1];
    let current = sRe[0] * sRe[0] + sIm[0] * sIm[0];
    for (let bin = 0; bin < BINS; bin += 1) {
      const nextBin = bin < BINS - 1 ? bin + 1 : bin - 1;
      const next = sRe[nextBin] * sRe[nextBin] + sIm[nextBin] * sIm[nextBin];
      // Power lightly smoothed across frequency, so a single bin's random
      // dip does not decide its gain on its own.
      const smoothed = 0.25 * (previous + next) + 0.5 * current;
      const value = smoothed > 0 ? 1 - (oversubtract * profile[bin]) / smoothed : 0;
      raw[bin] = value > 0 ? value : 0;
      previous = current;
      current = next;
    }
  };

  /** Overlap-adds a windowed time frame. */
  const addFrame = (source: Float32Array, frame: number) => {
    const start = firstStart + frame * HOP_SIZE;
    for (let index = 0; index < N; index += 1) {
      const at = start + index;
      if (at >= 0 && at < length) output[at] += source[index] * window[index];
    }
  };

  /**
   * Inverse of two gained frames in one complex FFT: the first spectrum
   * becomes the real part of the signal and the second the imaginary part.
   * Both are Hermitian (they came from real signals and the gains are real),
   * so the halves are rebuilt here and the results come out cleanly apart.
   */
  const synthesisePair = (aRe: Float32Array, aIm: Float32Array, bRe: Float32Array | null, bIm: Float32Array | null, frame: number) => {
    for (let bin = 0; bin < BINS; bin += 1) {
      const br = bRe ? bRe[bin] : 0;
      const bi = bIm ? bIm[bin] : 0;
      re[bin] = aRe[bin] - bi;
      im[bin] = aIm[bin] + br;
      if (bin > 0 && bin < N / 2) {
        re[N - bin] = aRe[bin] + bi;
        im[N - bin] = br - aIm[bin];
      }
    }
    fft.transform(re, im, true);
    addFrame(re, frame);
    if (bRe) addFrame(im, frame + 1);
  };

  for (let step = 0; step < frameCount + TIME_SMOOTH; step += 1) {
    // Analysis, two frames per FFT: frame `step` as the real input and the
    // next one as the imaginary input, separated afterwards by symmetry.
    // Half the transforms for the same result, on the slowest part of the job.
    if (step < frameCount && step % 2 === 0) {
      fill(re, step);
      fill(im, step + 1);
      fft.transform(re, im);
      const aRe = ringRe[step % ring];
      const aIm = ringIm[step % ring];
      const bRe = ringRe[(step + 1) % ring];
      const bIm = ringIm[(step + 1) % ring];
      for (let bin = 0; bin < BINS; bin += 1) {
        const mirror = (N - bin) % N;
        aRe[bin] = 0.5 * (re[bin] + re[mirror]);
        aIm[bin] = 0.5 * (im[bin] - im[mirror]);
        bRe[bin] = 0.5 * (im[bin] + im[mirror]);
        bIm[bin] = -0.5 * (re[bin] - re[mirror]);
      }
      rawGain(step % ring);
      if (step + 1 < frameCount) rawGain((step + 1) % ring);
    }

    const frame = step - TIME_SMOOTH;
    if (frame < 0) continue;

    // Time smoothing: a weighted average of the raw masks of the frames
    // around this one (only those that exist, at the edges of the file).
    timeGain.fill(0);
    let weightSum = 0;
    for (let offset = -TIME_SMOOTH; offset <= TIME_SMOOTH; offset += 1) {
      const neighbour = frame + offset;
      if (neighbour < 0 || neighbour >= frameCount) continue;
      const weight = TIME_WEIGHTS[offset + TIME_SMOOTH];
      const raw = ringGain[neighbour % ring];
      for (let bin = 0; bin < BINS; bin += 1) timeGain[bin] += weight * raw[bin];
      weightSum += weight;
    }
    // Frequency smoothing (triangular), then the floor.
    for (let bin = 0; bin < BINS; bin += 1) {
      let sum = 0;
      let weights = 0;
      for (let offset = -FREQ_SMOOTH; offset <= FREQ_SMOOTH; offset += 1) {
        const neighbour = bin + offset;
        if (neighbour < 0 || neighbour >= BINS) continue;
        const weight = FREQ_SMOOTH + 1 - Math.abs(offset);
        sum += weight * timeGain[neighbour];
        weights += weight;
      }
      gain[bin] = floorGain + ((1 - floorGain) * sum) / (weights * weightSum);
    }

    // Synthesis: gain the kept spectrum; even frames wait for their partner.
    const keepRe = ringRe[frame % ring];
    const keepIm = ringIm[frame % ring];
    if (frame % 2 === 0) {
      for (let bin = 0; bin < BINS; bin += 1) {
        heldRe[bin] = keepRe[bin] * gain[bin];
        heldIm[bin] = keepIm[bin] * gain[bin];
      }
      held = frame;
      if (frame === frameCount - 1) {
        synthesisePair(heldRe, heldIm, null, null, frame);
        held = -1;
      }
    } else {
      for (let bin = 0; bin < BINS; bin += 1) {
        oddRe[bin] = keepRe[bin] * gain[bin];
        oddIm[bin] = keepIm[bin] * gain[bin];
      }
      synthesisePair(heldRe, heldIm, oddRe, oddIm, held);
      held = -1;
    }

    if (onProgress && frame % progressEvery === 0) onProgress(frame / frameCount);
  }

  for (let index = 0; index < length; index += 1) {
    output[index] /= norm[(index - firstStart) % HOP_SIZE];
  }
  onProgress?.(1);
  return output;
}

// ------------------------------------------------------------- the whole --

function energyIn(data: Float32Array, from: number, to: number) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += data[index] * data[index];
  return sum;
}

/**
 * The full clean-up, channel by channel: clicks first (a filter would smear
 * a click into a ringing burst that no longer looks like one), then the
 * rumble and hum filters, and last the spectral gate — which learns its
 * profile from the filtered signal, so it is not spent on hum that is
 * already gone. The inputs are not modified.
 */
export function denoiseChannels(
  input: Float32Array[],
  sampleRate: number,
  settings: DenoiseSettings,
  source: NoiseSource,
  onProgress?: DenoiseProgress,
): DenoiseResult {
  const report = onProgress ?? (() => undefined);
  const channels = input.map((channel) => channel.slice());
  const length = channels[0]?.length ?? 0;
  const duration = length / sampleRate;
  const gateOn = settings.strength > 0;
  // The filters are quick; the gate takes the lion's share of the time.
  const filterShare = gateOn ? 0.12 : 1;

  let clicks = 0;
  channels.forEach((channel, index) => {
    if (settings.declick) clicks += declick(channel, sampleRate);
    if (settings.highpass) removeRumble(channel, sampleRate);
    if (settings.hum !== "off") removeHum(channel, sampleRate, settings.hum === "50" ? 50 : 60);
    report(((index + 1) / channels.length) * filterShare);
  });

  const region =
    source.kind === "region"
      ? {
          start: Math.max(0, Math.min(source.start, duration)),
          end: Math.max(0, Math.min(Math.max(source.end, source.start), duration)),
        }
      : findQuietestRegion(channels, sampleRate);

  const from = Math.floor(region.start * sampleRate);
  const to = Math.min(length, Math.ceil(region.end * sampleRate));
  const before = input.reduce((sum, channel) => sum + energyIn(channel, from, to), 0);

  const output = gateOn
    ? channels.map((channel, index) => {
        const profile = learnNoiseProfile(channel, sampleRate, region);
        return spectralGate(channel, profile, settings.strength / 100, (fraction) =>
          report(filterShare + ((index + fraction) / channels.length) * (1 - filterShare)),
        );
      })
    : channels;

  const after = output.reduce((sum, channel) => sum + energyIn(channel, from, to), 0);
  const reductionDb = before > 1e-12 ? 10 * Math.log10(before / Math.max(after, before * 1e-9)) : null;
  report(1);
  return { channels: output, clicks, region, reductionDb };
}

/** original − cleaned: what the process took out, for listening to on its own. */
export function removedPart(original: Float32Array[], cleaned: Float32Array[]): Float32Array[] {
  return original.map((channel, index) => {
    const result = new Float32Array(channel.length);
    const other = cleaned[index];
    for (let at = 0; at < channel.length; at += 1) result[at] = channel[at] - (other?.[at] ?? 0);
    return result;
  });
}

/** Clamps and validates settings that arrive from storage or from the assistant. */
export function sanitiseSettings(value: Partial<Record<keyof DenoiseSettings, unknown>> | null | undefined): DenoiseSettings {
  const base = DEFAULT_DENOISE_SETTINGS;
  if (!value) return { ...base };
  const strength = Number(value.strength);
  const hum = String(value.hum ?? base.hum);
  return {
    strength: Number.isFinite(strength) ? Math.round(Math.max(0, Math.min(100, strength))) : base.strength,
    hum: hum === "50" || hum === "60" ? hum : "off",
    declick: typeof value.declick === "boolean" ? value.declick : base.declick,
    highpass: typeof value.highpass === "boolean" ? value.highpass : base.highpass,
  };
}

// ----------------------------------------------------------- worker wire --

export type DenoiseRequest = {
  jobId: number;
  channels: Float32Array[];
  sampleRate: number;
  settings: DenoiseSettings;
  source: NoiseSource;
};

export type DenoiseResponse =
  | { type: "progress"; jobId: number; fraction: number }
  | { type: "done"; jobId: number; result: DenoiseResult }
  | { type: "error"; jobId: number; message: string };
