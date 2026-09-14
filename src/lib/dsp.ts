/**
 * Signal processing shared by the tools that listen to audio without loading
 * the transcription model: the tuner, the BPM and key detector, the practice
 * slow-downer and the vocal remover. Everything here is plain arithmetic on
 * sample buffers, so it runs anywhere the Web Audio API does.
 */

const A4_MIDI = 69;

export type PitchReading = {
  /** Hertz, or 0 when nothing pitched was found. */
  frequency: number;
  /** 0..1 — how periodic the window was. */
  clarity: number;
  rms: number;
};

/**
 * Normalised autocorrelation (the McLeod pitch method, simplified). It beats a
 * raw FFT peak on a single voice or string because it locks onto the period
 * rather than the loudest harmonic, which is what makes an octave error.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  minFrequency = 55,
  maxFrequency = 1600,
): PitchReading {
  const size = samples.length;
  let sumSquares = 0;
  for (let index = 0; index < size; index += 1) {
    sumSquares += samples[index] * samples[index];
  }
  const rms = Math.sqrt(sumSquares / size);
  if (rms < 0.005) return { frequency: 0, clarity: 0, rms };

  const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.min(size - 2, Math.ceil(sampleRate / minFrequency));
  if (maxLag <= minLag) return { frequency: 0, clarity: 0, rms };

  const correlation = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index < size - lag; index += 1) {
      const a = samples[index];
      const b = samples[index + lag];
      sum += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denominator = Math.sqrt(energyA * energyB);
    correlation[lag] = denominator > 0 ? sum / denominator : 0;
  }

  // The first peak above a share of the global maximum is the true period;
  // taking the global maximum alone drops an octave on rich timbres.
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (correlation[lag] > best) best = correlation[lag];
  }
  if (best < 0.3) return { frequency: 0, clarity: best, rms };

  const threshold = best * 0.92;
  let chosen = -1;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (
      correlation[lag] >= threshold &&
      correlation[lag] >= correlation[lag - 1] &&
      correlation[lag] >= correlation[lag + 1]
    ) {
      chosen = lag;
      break;
    }
  }
  if (chosen < 0) return { frequency: 0, clarity: best, rms };

  // Parabolic interpolation over the three points around the peak turns a
  // whole-sample lag into a fraction of one, worth a few cents of accuracy.
  const previous = correlation[chosen - 1];
  const current = correlation[chosen];
  const next = correlation[chosen + 1];
  const divisor = 2 * (2 * current - previous - next);
  const shift = divisor !== 0 ? (next - previous) / divisor : 0;
  const period = chosen + Math.max(-1, Math.min(1, shift));

  return { frequency: sampleRate / period, clarity: current, rms };
}

export function frequencyToMidi(frequency: number, referenceA4 = 440) {
  return A4_MIDI + 12 * Math.log2(frequency / referenceA4);
}

export function midiToFrequency(midi: number, referenceA4 = 440) {
  return referenceA4 * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Distance from the nearest equal-tempered note, in cents (-50..50). */
export function centsOff(frequency: number, referenceA4 = 440) {
  const exact = frequencyToMidi(frequency, referenceA4);
  return (exact - Math.round(exact)) * 100;
}

// ---- offline analysis of a whole file ----

function downmix(buffer: AudioBuffer): Float32Array {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
  const mono = new Float32Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index];
    mono[index] = sum / channels.length;
  }
  return mono;
}

/**
 * Spectral-flux onset envelope: the frame-to-frame rise in energy per band.
 * Rises mark note attacks and drum hits, which is what the tempo search needs.
 */
function onsetEnvelope(mono: Float32Array, sampleRate: number, hop = 512) {
  const window = 1024;
  const frames = Math.max(1, Math.floor((mono.length - window) / hop));
  const envelope = new Float32Array(Math.max(1, frames));
  const bands = 24;
  let previous = new Float32Array(bands);

  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * hop;
    const current = new Float32Array(bands);
    // A bank of band energies is enough here and far cheaper than a full FFT
    // per frame: each band sums the squared difference of neighbouring
    // samples at its own stride, which rises with energy at that rate.
    for (let band = 0; band < bands; band += 1) {
      const stride = band + 1;
      let energy = 0;
      for (let index = offset; index < offset + window - stride; index += stride) {
        const delta = mono[index + stride] - mono[index];
        energy += delta * delta;
      }
      current[band] = Math.log1p(energy * 40);
    }
    let flux = 0;
    for (let band = 0; band < bands; band += 1) {
      const rise = current[band] - previous[band];
      if (rise > 0) flux += rise;
    }
    envelope[frame] = flux;
    previous = current;
  }

  // Subtracting a moving average removes the loudness of the section, so a
  // quiet verse and a loud chorus contribute onsets equally.
  const smoothed = new Float32Array(envelope.length);
  const radius = 8;
  for (let index = 0; index < envelope.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const at = index + offset;
      if (at < 0 || at >= envelope.length) continue;
      sum += envelope[at];
      count += 1;
    }
    smoothed[index] = Math.max(0, envelope[index] - sum / count);
  }
  return { envelope: smoothed, frameRate: sampleRate / hop };
}

export type AudioTempo = {
  bpm: number;
  /** 0..1 — how strongly the winning tempo stood out from the rest. */
  confidence: number;
};

/** Autocorrelates the onset envelope and picks the strongest musical tempo. */
export function detectTempoFromAudio(buffer: AudioBuffer): AudioTempo {
  const mono = downmix(buffer);
  const { envelope, frameRate } = onsetEnvelope(mono, buffer.sampleRate);
  if (envelope.length < 16) return { bpm: 0, confidence: 0 };

  const minLag = Math.max(1, Math.floor((frameRate * 60) / 210));
  const maxLag = Math.min(envelope.length - 1, Math.ceil((frameRate * 60) / 45));
  if (maxLag <= minLag) return { bpm: 0, confidence: 0 };

  let bestLag = 0;
  let bestScore = 0;
  let total = 0;
  let count = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index + lag < envelope.length; index += 1) {
      sum += envelope[index] * envelope[index + lag];
    }
    let score = sum / (envelope.length - lag);
    // Human tempo perception clusters around 120 BPM; a gentle preference
    // there stops the search from settling on a half- or double-time lag.
    const bpm = (frameRate * 60) / lag;
    score *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    total += score;
    count += 1;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!bestLag || bestScore <= 0) return { bpm: 0, confidence: 0 };
  const mean = total / Math.max(1, count);
  const bpm = (frameRate * 60) / bestLag;
  const confidence = Math.max(0, Math.min(1, 1 - mean / bestScore));
  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

export type AudioKey = {
  tonicPitchClass: number;
  mode: "major" | "minor";
  /** 0..1 — correlation of the winning profile. */
  confidence: number;
  chroma: number[];
};

/**
 * Chroma from a bank of Goertzel filters, one per semitone across five
 * octaves, correlated against the Krumhansl key profiles. Far cheaper than
 * running the transcription model when all the visitor wants is the key.
 */
export function detectKeyFromAudio(buffer: AudioBuffer): AudioKey {
  const mono = downmix(buffer);
  const sampleRate = buffer.sampleRate;
  const chroma = new Array<number>(12).fill(0);

  const window = 4096;
  const maxWindows = 220;
  const step = Math.max(window, Math.floor(mono.length / maxWindows));

  const lowestMidi = 36;
  const highestMidi = 96;
  const frequencies: { midi: number; frequency: number }[] = [];
  for (let midi = lowestMidi; midi <= highestMidi; midi += 1) {
    frequencies.push({ midi, frequency: midiToFrequency(midi) });
  }

  for (let offset = 0; offset + window <= mono.length; offset += step) {
    for (const { midi, frequency } of frequencies) {
      // Goertzel: one bin of a DFT, without paying for the whole transform.
      const omega = (2 * Math.PI * frequency) / sampleRate;
      const coefficient = 2 * Math.cos(omega);
      let s1 = 0;
      let s2 = 0;
      for (let index = 0; index < window; index += 1) {
        const s0 = mono[offset + index] + coefficient * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
      chroma[midi % 12] += Math.sqrt(Math.max(0, power));
    }
  }

  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return { tonicPitchClass: 0, mode: "major", confidence: 0, chroma };
  }
  const normalised = chroma.map((value) => value / total);

  const correlate = (profile: number[], rotation: number) => {
    const profileMean = profile.reduce((a, b) => a + b, 0) / 12;
    const chromaMean = normalised.reduce((a, b) => a + b, 0) / 12;
    let numerator = 0;
    let profileVariance = 0;
    let chromaVariance = 0;
    for (let index = 0; index < 12; index += 1) {
      const p = profile[index] - profileMean;
      const c = normalised[(index + rotation) % 12] - chromaMean;
      numerator += p * c;
      profileVariance += p * p;
      chromaVariance += c * c;
    }
    const denominator = Math.sqrt(profileVariance * chromaVariance);
    return denominator > 0 ? numerator / denominator : 0;
  };

  let best: { tonicPitchClass: number; mode: "major" | "minor"; score: number } = {
    tonicPitchClass: 0,
    mode: "major",
    score: -2,
  };
  for (let rotation = 0; rotation < 12; rotation += 1) {
    const major = correlate(MAJOR_PROFILE, rotation);
    if (major > best.score) {
      best = { tonicPitchClass: rotation, mode: "major", score: major };
    }
    const minor = correlate(MINOR_PROFILE, rotation);
    if (minor > best.score) {
      best = { tonicPitchClass: rotation, mode: "minor", score: minor };
    }
  }

  return {
    tonicPitchClass: best.tonicPitchClass,
    mode: best.mode,
    confidence: Math.max(0, Math.min(1, best.score)),
    chroma: normalised,
  };
}

/** Loudness of the file as a 0..1 value, for the "energy" readout. */
export function averageLoudness(buffer: AudioBuffer) {
  const mono = downmix(buffer);
  let sum = 0;
  for (let index = 0; index < mono.length; index += 1) {
    sum += mono[index] * mono[index];
  }
  const rms = Math.sqrt(sum / Math.max(1, mono.length));
  // -40 dBFS reads as silence, 0 dBFS as full scale.
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.max(0, Math.min(1, (db + 40) / 40));
}

// ---- transforms that hand a new buffer back ----

/**
 * Removes what both channels share, which on most mixes is the lead vocal,
 * the bass and the kick. `keep` flips it around to isolate the centre instead.
 */
export function midSideSplit(
  buffer: AudioBuffer,
  amount: number,
  keep: "sides" | "centre",
): Float32Array[] {
  const left = buffer.getChannelData(0);
  const right =
    buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);
  const outLeft = new Float32Array(buffer.length);
  const outRight = new Float32Array(buffer.length);

  for (let index = 0; index < buffer.length; index += 1) {
    const mid = (left[index] + right[index]) / 2;
    const side = (left[index] - right[index]) / 2;
    if (keep === "sides") {
      outLeft[index] = left[index] - mid * amount;
      outRight[index] = right[index] - mid * amount;
    } else {
      outLeft[index] = mid + side * (1 - amount);
      outRight[index] = mid + side * (1 - amount);
    }
  }
  return [outLeft, outRight];
}

/**
 * Overlap-add time stretch. Grains are re-laid at a new spacing and
 * cross-faded, so the tempo changes while every grain keeps its original
 * pitch — the trick that lets a practice loop slow down without dropping
 * an octave.
 */
export function timeStretch(
  channel: Float32Array,
  sampleRate: number,
  rate: number,
): Float32Array {
  if (Math.abs(rate - 1) < 0.001) return channel.slice();

  const grain = Math.max(256, Math.round(sampleRate * 0.06));
  const overlap = Math.floor(grain / 2);
  const analysisHop = Math.max(1, Math.round(overlap * rate));
  const outputLength = Math.max(
    1,
    Math.ceil(channel.length / rate) + grain,
  );
  const output = new Float32Array(outputLength);
  const weights = new Float32Array(outputLength);

  const window = new Float32Array(grain);
  for (let index = 0; index < grain; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (grain - 1));
  }

  let readPosition = 0;
  let writePosition = 0;
  while (readPosition + grain < channel.length && writePosition + grain < outputLength) {
    for (let index = 0; index < grain; index += 1) {
      const value = channel[readPosition + index] * window[index];
      output[writePosition + index] += value;
      weights[writePosition + index] += window[index];
    }
    readPosition += analysisHop;
    writePosition += overlap;
  }

  const used = Math.min(outputLength, writePosition + grain);
  const result = new Float32Array(used);
  for (let index = 0; index < used; index += 1) {
    result[index] = weights[index] > 0.0001 ? output[index] / weights[index] : 0;
  }
  return result;
}

/** Linear resample — used together with the stretch to shift pitch. */
export function resample(channel: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 0.0001) return channel.slice();
  const length = Math.max(1, Math.floor(channel.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const low = Math.floor(position);
    const high = Math.min(channel.length - 1, low + 1);
    const fraction = position - low;
    output[index] = channel[low] * (1 - fraction) + channel[high] * fraction;
  }
  return output;
}

/**
 * Speed and pitch as two independent dials: the stretch sets the length, the
 * resample sets the pitch, and combining them cancels whichever the visitor
 * did not ask to change.
 */
export function changeSpeedAndPitch(
  buffer: AudioBuffer,
  speed: number,
  semitones: number,
): Float32Array[] {
  const pitchRatio = Math.pow(2, semitones / 12);
  return Array.from({ length: buffer.numberOfChannels }, (_, index) => {
    const channel = buffer.getChannelData(index);
    // Stretch by the combined factor first, then resample back: the resample
    // shortens by `pitchRatio`, so the stretch has to account for it.
    const stretched = timeStretch(channel, buffer.sampleRate, speed / pitchRatio);
    return resample(stretched, pitchRatio);
  });
}

/** Two cascaded one-pole low-passes: cheap, stable, and enough to keep a bass line. */
export function lowPass(channel: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const output = channel.slice();
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  for (let pass = 0; pass < 2; pass += 1) {
    let previous = 0;
    for (let index = 0; index < output.length; index += 1) {
      previous += alpha * (output[index] - previous);
      output[index] = previous;
    }
  }
  return output;
}

/**
 * Vocal removal with the bass put back: the centre is cancelled, but its
 * low end — kick and bass, which also sit in the middle — is filtered out
 * of the cancellation and returned to the mix.
 */
export function removeVocals(
  buffer: AudioBuffer,
  amount: number,
  keepBassBelowHz: number,
): Float32Array[] {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const mid = new Float32Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    mid[index] = (left[index] + right[index]) / 2;
  }
  const bass = keepBassBelowHz > 0 ? lowPass(mid, buffer.sampleRate, keepBassBelowHz) : null;
  const outLeft = new Float32Array(buffer.length);
  const outRight = new Float32Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    const removed = (mid[index] - (bass ? bass[index] : 0)) * amount;
    outLeft[index] = left[index] - removed;
    outRight[index] = right[index] - removed;
  }
  return [outLeft, outRight];
}

/** Peak-normalises in place to the requested ceiling (0..1). */
export function normalise(channels: Float32Array[], ceiling = 0.98) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const magnitude = Math.abs(channel[index]);
      if (magnitude > peak) peak = magnitude;
    }
  }
  if (peak <= 0) return channels;
  const scale = ceiling / peak;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] *= scale;
  }
  return channels;
}

export function channelsToBuffer(
  context: BaseAudioContext,
  channels: Float32Array[],
  sampleRate: number,
): AudioBuffer {
  const buffer = context.createBuffer(
    channels.length,
    Math.max(1, channels[0]?.length ?? 1),
    sampleRate,
  );
  channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
  return buffer;
}
