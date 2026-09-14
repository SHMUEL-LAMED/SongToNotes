/**
 * A small radix-2 FFT. Everything that looks at a spectrum — the note engine,
 * the vocal separator, the structure analyser — goes through this one
 * implementation so a song is never transformed by two different code paths.
 *
 * The instance caches its twiddle factors and bit-reversal table, so the cost
 * of a transform is the butterflies alone. Callers keep one instance per size
 * and reuse it across every frame of a song.
 */
export class Fft {
  readonly size: number;
  private readonly levels: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly reversed: Uint32Array;
  /** Scratch space, so a per-frame transform allocates nothing. */
  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.levels = Math.log2(size) | 0;
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let index = 0; index < size / 2; index += 1) {
      const angle = (-2 * Math.PI * index) / size;
      this.cos[index] = Math.cos(angle);
      this.sin[index] = Math.sin(angle);
    }
    this.reversed = new Uint32Array(size);
    for (let index = 0; index < size; index += 1) {
      let value = 0;
      for (let bit = 0; bit < this.levels; bit += 1) {
        value = (value << 1) | ((index >>> bit) & 1);
      }
      this.reversed[index] = value;
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /**
   * Transforms `input` (real, `size` samples) and writes the magnitude of each
   * of the first `size / 2` bins into `magnitudes`.
   */
  magnitudes(input: Float32Array, output: Float32Array) {
    const { size, re, im, reversed, cos, sin } = this;
    for (let index = 0; index < size; index += 1) {
      re[reversed[index]] = input[index] ?? 0;
      im[index] = 0;
    }

    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2;
      const step = size / width;
      for (let start = 0; start < size; start += width) {
        for (let offset = 0, twiddle = 0; offset < half; offset += 1, twiddle += step) {
          const a = start + offset;
          const b = a + half;
          const wr = cos[twiddle];
          const wi = sin[twiddle];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }

    const bins = size / 2;
    for (let bin = 0; bin < bins; bin += 1) {
      output[bin] = Math.hypot(re[bin], im[bin]);
    }
  }

  /**
   * Full complex transform in place. `inverse` divides by the size, so a
   * forward pass followed by an inverse one returns the original signal.
   */
  transform(re: Float32Array, im: Float32Array, inverse = false) {
    const { size, reversed, cos, sin } = this;
    for (let index = 0; index < size; index += 1) {
      const target = reversed[index];
      if (target > index) {
        let swap = re[index];
        re[index] = re[target];
        re[target] = swap;
        swap = im[index];
        im[index] = im[target];
        im[target] = swap;
      }
    }

    const sign = inverse ? -1 : 1;
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2;
      const step = size / width;
      for (let start = 0; start < size; start += width) {
        for (let offset = 0, twiddle = 0; offset < half; offset += 1, twiddle += step) {
          const a = start + offset;
          const b = a + half;
          const wr = cos[twiddle];
          const wi = sign * sin[twiddle];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }

    if (inverse) {
      for (let index = 0; index < size; index += 1) {
        re[index] /= size;
        im[index] /= size;
      }
    }
  }
}

/** Periodic Hann window — the right one for overlap-add resynthesis. */
export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  return window;
}
