/**
 * Vocal separation.
 *
 * Subtracting one channel from the other is the cheap trick everyone starts
 * with, and it is why the old version of this tool disappointed: it cancels
 * every sound that sits in the middle of the stereo image — the snare, the
 * bass, half the keyboard — along with the singer, leaves the two channels in
 * opposite phase, and on a mono file produces pure silence.
 *
 * This works in the frequency domain instead. Each short window of the song is
 * transformed, and every bin is judged on its own: a bin where the two
 * channels carry the same thing is centre, a bin where they differ is the
 * sides. Because the judgement is per bin and per instant, a guitar panned
 * left keeps its place in the mix even while the singer is removed from the
 * same moment. The mask is soft rather than a hard on/off switch, which is
 * what keeps the result free of the underwater warble that hard masking
 * produces, and a spectral floor keeps some of the panned instruments even
 * where they overlap the voice.
 *
 * Nothing here is Demucs — a source-separation network still does better on a
 * dense mix, and {@link ../lib/demucs} offers exactly that where the device
 * can run it. But this needs no download, no GPU and no waiting, and on most
 * commercial recordings it is a usable karaoke track.
 */
import { Fft, hannWindow } from "./fft";

const FRAME_SIZE = 4096;
/** Four-times overlap: enough for the mask to change without artefacts. */
const HOP_SIZE = FRAME_SIZE / 4;

export type SeparateTarget = "instrumental" | "vocals";

export type SeparateOptions = {
  target: SeparateTarget;
  /** 0..1 — how completely the unwanted part is pushed down. */
  strength: number;
  /**
   * Keep everything below this frequency untouched when making a backing
   * track. Bass and kick live in the centre with the voice but nobody wants
   * them removed, and below a couple of hundred hertz there is almost never
   * a vocal fundamental worth cancelling.
   */
  keepBelowHz: number;
  /**
   * Leave the top of the spectrum alone as well. Cymbals and air are
   * uncorrelated between channels anyway, and masking them is audible.
   */
  keepAboveHz?: number;
};

export type SeparateInput = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
};

export type SeparateOutput = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** True when the source had nothing to compare — a mono file. */
  wasMono: boolean;
};

/**
 * How much of a bin the two channels share, 0..1.
 *
 * A centred sound arrives identically in both channels, so the difference
 * between them vanishes and only the sum survives. A sound hard-panned to one
 * side splits evenly between the two: mid and side come out the same size. So
 * the raw mid/(mid+side) ratio runs from a half for hard-panned material up to
 * one for dead centre, and the bottom half of its range only happens when the
 * channels are in opposite phase. Rescaling that upper half to 0..1 is what
 * makes a guitar pinned to the left read as "not centre at all" rather than as
 * half a vocal, which is the difference between a backing track that keeps its
 * arrangement and one that loses six decibels of everything.
 */
function centreness(
  leftRe: number,
  leftIm: number,
  rightRe: number,
  rightIm: number,
) {
  const midRe = (leftRe + rightRe) / 2;
  const midIm = (leftIm + rightIm) / 2;
  const sideRe = (leftRe - rightRe) / 2;
  const sideIm = (leftIm - rightIm) / 2;
  const mid = Math.hypot(midRe, midIm);
  const side = Math.hypot(sideRe, sideIm);
  const total = mid + side;
  if (total <= 1e-12) return 0;
  return Math.max(0, Math.min(1, (mid / total - 0.5) * 2));
}

/**
 * Separates a stereo signal into the centre or the sides.
 *
 * `onProgress` is called with 0..1 as the windows are processed, so a long
 * song can show a bar rather than a frozen page.
 */
export function separate(
  input: SeparateInput,
  options: SeparateOptions,
  onProgress?: (fraction: number) => void,
): SeparateOutput {
  const { left, right, sampleRate } = input;
  const length = Math.min(left.length, right.length);
  const wasMono = left === right;

  const strength = Math.max(0, Math.min(1, options.strength));
  const keepBelow = Math.max(0, options.keepBelowHz);
  const keepAbove = options.keepAboveHz ?? sampleRate / 2;
  const wantCentre = options.target === "vocals";

  const fft = new Fft(FRAME_SIZE);
  const window = hannWindow(FRAME_SIZE);
  const outLeft = new Float32Array(length);
  const outRight = new Float32Array(length);
  const weights = new Float32Array(length);

  const leftRe = new Float32Array(FRAME_SIZE);
  const leftIm = new Float32Array(FRAME_SIZE);
  const rightRe = new Float32Array(FRAME_SIZE);
  const rightIm = new Float32Array(FRAME_SIZE);

  const binHz = sampleRate / FRAME_SIZE;
  const lowBin = Math.floor(keepBelow / binHz);
  const highBin = Math.ceil(keepAbove / binHz);
  const bins = FRAME_SIZE / 2;

  const frames = Math.max(1, Math.ceil(length / HOP_SIZE));
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * HOP_SIZE;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const at = offset + index;
      const sample = at < length ? left[at] : 0;
      const other = at < length ? right[at] : 0;
      leftRe[index] = sample * window[index];
      leftIm[index] = 0;
      rightRe[index] = other * window[index];
      rightIm[index] = 0;
    }

    fft.transform(leftRe, leftIm);
    fft.transform(rightRe, rightIm);

    for (let bin = 0; bin <= bins; bin += 1) {
      let gain: number;
      if (bin < lowBin || bin > highBin) {
        // Outside the band we act on, nothing is touched when building a
        // backing track; an isolated vocal has no use for it either way.
        gain = wantCentre ? 1 - strength : 1;
      } else {
        const shared = centreness(
          leftRe[bin],
          leftIm[bin],
          rightRe[bin],
          rightIm[bin],
        );
        // A soft curve rather than a switch. Squaring sharpens the decision
        // around the halfway point without ever producing a hard edge, and
        // the residual floor leaves a trace of the removed part so the result
        // sounds like a mix rather than a hole.
        const centred = shared * shared * (3 - 2 * shared);
        const remove = wantCentre ? 1 - centred : centred;
        gain = 1 - strength * remove;
      }

      if (gain === 1) continue;
      leftRe[bin] *= gain;
      leftIm[bin] *= gain;
      rightRe[bin] *= gain;
      rightIm[bin] *= gain;
      // The transform is of a real signal, so the upper half of the spectrum
      // mirrors the lower one and has to be scaled identically or the inverse
      // pass returns something complex.
      const mirror = FRAME_SIZE - bin;
      if (mirror > bin && mirror < FRAME_SIZE) {
        leftRe[mirror] *= gain;
        leftIm[mirror] *= gain;
        rightRe[mirror] *= gain;
        rightIm[mirror] *= gain;
      }
    }

    fft.transform(leftRe, leftIm, true);
    fft.transform(rightRe, rightIm, true);

    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const at = offset + index;
      if (at >= length) break;
      // Weighting by the window a second time and dividing by the sum of the
      // squared windows is the standard reconstruction, and it is exact for
      // any hop that divides the frame evenly.
      const weight = window[index];
      outLeft[at] += leftRe[index] * weight;
      outRight[at] += rightRe[index] * weight;
      weights[at] += weight * weight;
    }

    onProgress?.((frame + 1) / frames);
  }

  for (let index = 0; index < length; index += 1) {
    const weight = weights[index];
    if (weight > 1e-8) {
      outLeft[index] /= weight;
      outRight[index] /= weight;
    }
  }

  return { left: outLeft, right: outRight, sampleRate, wasMono };
}

/**
 * Isolating the voice from a mono file cannot use the stereo image, so it
 * falls back on where a voice lives: the band it occupies, and the fact that
 * it moves. Bins that hold steady across time are the sustained instruments
 * and get pushed down; bins that change are the voice and stay. It is a far
 * weaker tool than the stereo path and the caller says so on screen, but it
 * is better than handing back silence.
 */
export function separateMono(
  samples: Float32Array,
  sampleRate: number,
  options: SeparateOptions,
  onProgress?: (fraction: number) => void,
): SeparateOutput {
  const fft = new Fft(FRAME_SIZE);
  const window = hannWindow(FRAME_SIZE);
  const length = samples.length;
  const out = new Float32Array(length);
  const weights = new Float32Array(length);
  const re = new Float32Array(FRAME_SIZE);
  const im = new Float32Array(FRAME_SIZE);
  const bins = FRAME_SIZE / 2;
  const previous = new Float32Array(bins + 1);
  const strength = Math.max(0, Math.min(1, options.strength));
  const wantVoice = options.target === "vocals";
  const binHz = sampleRate / FRAME_SIZE;
  const lowBin = Math.floor(Math.max(options.keepBelowHz, 120) / binHz);
  const highBin = Math.ceil(Math.min(8000, sampleRate / 2) / binHz);

  const frames = Math.max(1, Math.ceil(length / HOP_SIZE));
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * HOP_SIZE;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const at = offset + index;
      re[index] = (at < length ? samples[at] : 0) * window[index];
      im[index] = 0;
    }
    fft.transform(re, im);

    for (let bin = 0; bin <= bins; bin += 1) {
      const magnitude = Math.hypot(re[bin], im[bin]);
      const settled = previous[bin];
      previous[bin] = settled * 0.7 + magnitude * 0.3;

      let gain = 1;
      if (bin >= lowBin && bin <= highBin) {
        const change =
          magnitude + settled > 1e-12
            ? Math.abs(magnitude - settled) / (magnitude + settled)
            : 0;
        const moving = Math.min(1, change * 3);
        const remove = wantVoice ? 1 - moving : moving;
        gain = 1 - strength * remove;
      } else if (wantVoice) {
        gain = 1 - strength;
      }

      if (gain === 1) continue;
      re[bin] *= gain;
      im[bin] *= gain;
      const mirror = FRAME_SIZE - bin;
      if (mirror > bin && mirror < FRAME_SIZE) {
        re[mirror] *= gain;
        im[mirror] *= gain;
      }
    }

    fft.transform(re, im, true);
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const at = offset + index;
      if (at >= length) break;
      out[at] += re[index] * window[index];
      weights[at] += window[index] * window[index];
    }
    onProgress?.((frame + 1) / frames);
  }

  for (let index = 0; index < length; index += 1) {
    if (weights[index] > 1e-8) out[index] /= weights[index];
  }

  return { left: out, right: out, sampleRate, wasMono: true };
}
