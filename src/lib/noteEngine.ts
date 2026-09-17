/**
 * The note detector.
 *
 * This is a signal-processing engine rather than a neural one, and that is a
 * deliberate trade. The model it replaces as the default needed twenty to
 * sixty seconds of GPU time per minute of audio — and on a phone, where there
 * is often no usable WebGL inside a worker at all, several minutes — which is
 * indistinguishable from a page that has simply stopped working. This runs at
 * roughly a hundred times real time on the same phone, with no download and
 * no GPU, so a three-minute song is a two-second wait.
 *
 * The method is harmonic summation over interpolated spectral peaks, the
 * classic melody-extraction pipeline: every peak in the spectrum votes for the
 * fundamentals it could be a harmonic of, the votes are collected on a
 * fine-grained pitch axis, and the winning pitch per frame is tracked through
 * time. Deep mode still runs the neural model for anyone who wants polyphonic
 * detail and is willing to wait for it.
 */
import { Fft, hannWindow } from "./fft";
import type { DetectedNote, ViewMode } from "./types";

/** The rate `prepareForModel` resamples to; both engines share it. */
export const ENGINE_SAMPLE_RATE = 22_050;

const FRAME_SIZE = 2048;
/** 11.6 ms — the same frame rate the neural model reports, so the tempo and
 * key estimators downstream see notes of the same granularity either way. */
const HOP_SIZE = 256;

/** C2 to B6: below is rumble, above is almost always a harmonic. */
const MIDI_LOW = 36;
const MIDI_HIGH = 95;
const BINS_PER_SEMITONE = 5;
const PITCH_BINS = (MIDI_HIGH - MIDI_LOW) * BINS_PER_SEMITONE + 1;

/** How many harmonics of a candidate fundamental are collected. */
const HARMONICS = 10;
/** Each successive harmonic counts for less; 0.8^9 ≈ 0.13 at the tenth. */
const HARMONIC_DECAY = 0.8;
/** Peaks this far below the loudest one in the frame carry no information. */
const PEAK_FLOOR_DB = 70;

function binToMidi(bin: number) {
  return MIDI_LOW + bin / BINS_PER_SEMITONE;
}

function midiToBin(midi: number) {
  return (midi - MIDI_LOW) * BINS_PER_SEMITONE;
}

export type Salience = {
  /** frames × PITCH_BINS, row-major. */
  data: Float32Array;
  /**
   * The same grid, but fed only by peaks taken at face value — the first
   * harmonic. A pitch an octave below a real note collects a full set of
   * votes from that note's harmonics and looks convincing in `data`; what
   * gives it away is that nothing is actually sounding at its own frequency,
   * which is exactly what this measures.
   */
  direct: Float32Array;
  frames: number;
  /** Per-frame RMS of the windowed samples. */
  energy: Float32Array;
  /** Per-frame rise in spectral energy — the onset envelope. */
  flux: Float32Array;
  frameRate: number;
};

/**
 * Builds the pitch-salience map: for every frame, how much evidence there is
 * for a fundamental at every twentieth of a semitone between C2 and B6.
 */
export function computeSalience(
  samples: Float32Array,
  onProgress?: (fraction: number) => void,
): Salience {
  const fft = new Fft(FRAME_SIZE);
  const window = hannWindow(FRAME_SIZE);
  const frames = Math.max(
    1,
    Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1,
  );
  const data = new Float32Array(frames * PITCH_BINS);
  const direct = new Float32Array(frames * PITCH_BINS);
  const energy = new Float32Array(frames);
  const flux = new Float32Array(frames);

  const windowed = new Float32Array(FRAME_SIZE);
  const spectrum = new Float32Array(FRAME_SIZE / 2);
  const previousSpectrum = new Float32Array(FRAME_SIZE / 2);
  const binHz = ENGINE_SAMPLE_RATE / FRAME_SIZE;
  const peakFloor = Math.pow(10, -PEAK_FLOOR_DB / 20);
  // The vote a peak casts is spread over ±1 semitone so that a slightly
  // detuned singer still lands on the note rather than between two of them.
  const spread = BINS_PER_SEMITONE;

  let reported = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * HOP_SIZE;
    let sumSquares = 0;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const sample = samples[offset + index] ?? 0;
      sumSquares += sample * sample;
      windowed[index] = sample * window[index];
    }
    energy[frame] = Math.sqrt(sumSquares / FRAME_SIZE);
    fft.magnitudes(windowed, spectrum);

    let rise = 0;
    let loudest = 0;
    for (let bin = 0; bin < spectrum.length; bin += 1) {
      const magnitude = spectrum[bin];
      if (magnitude > loudest) loudest = magnitude;
      const change = magnitude - previousSpectrum[bin];
      if (change > 0) rise += change;
    }
    flux[frame] = rise;

    const row = frame * PITCH_BINS;
    if (loudest > 0) {
      const threshold = loudest * peakFloor;
      // Bin 0 and the last bin have no neighbours to interpolate against.
      for (let bin = 1; bin < spectrum.length - 1; bin += 1) {
        const magnitude = spectrum[bin];
        if (
          magnitude < threshold ||
          magnitude <= spectrum[bin - 1] ||
          magnitude < spectrum[bin + 1]
        ) {
          continue;
        }
        // Quadratic interpolation over the log magnitudes recovers the true
        // peak position to a fraction of a bin, which is what makes 10 Hz
        // wide bins good enough to tell one semitone from the next.
        const left = Math.log(spectrum[bin - 1] + 1e-12);
        const centre = Math.log(magnitude + 1e-12);
        const right = Math.log(spectrum[bin + 1] + 1e-12);
        const divisor = left - 2 * centre + right;
        const shift = divisor !== 0 ? (0.5 * (left - right)) / divisor : 0;
        const frequency = (bin + Math.max(-0.5, Math.min(0.5, shift))) * binHz;
        if (frequency <= 0) continue;

        for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
          const fundamental = frequency / harmonic;
          const midi = 69 + 12 * Math.log2(fundamental / 440);
          if (midi < MIDI_LOW - 1 || midi > MIDI_HIGH + 1) {
            // Harmonics are ordered, so once the candidate drops below the
            // lowest note we track, every later one does too.
            if (midi < MIDI_LOW - 1) break;
            continue;
          }
          const centreBin = midiToBin(midi);
          const weight = magnitude * Math.pow(HARMONIC_DECAY, harmonic - 1);
          const from = Math.max(0, Math.ceil(centreBin - spread));
          const to = Math.min(PITCH_BINS - 1, Math.floor(centreBin + spread));
          for (let target = from; target <= to; target += 1) {
            const distance = (target - centreBin) / spread;
            // cos² falls to zero exactly a semitone away, so neighbouring
            // notes never bleed into one another.
            const kernel = Math.cos((distance * Math.PI) / 2);
            const vote = weight * kernel * kernel;
            data[row + target] += vote;
            if (harmonic === 1) direct[row + target] += vote;
          }
        }
      }
    }

    previousSpectrum.set(spectrum);

    if (onProgress) {
      const percent = Math.floor((frame / frames) * 100);
      if (percent > reported) {
        reported = percent;
        onProgress(frame / frames);
      }
    }
  }

  // Discount every pitch that no peak actually landed on. Without this the
  // octave below each real note scores almost as highly as the note itself,
  // and both the melody tracker and the chord reader fall for it.
  for (let frame = 0; frame < frames; frame += 1) {
    const row = frame * PITCH_BINS;
    let loudestDirect = 0;
    for (let bin = 0; bin < PITCH_BINS; bin += 1) {
      if (direct[row + bin] > loudestDirect) loudestDirect = direct[row + bin];
    }
    if (loudestDirect <= 0) continue;
    const reference = loudestDirect * 0.1;
    for (let bin = 0; bin < PITCH_BINS; bin += 1) {
      const support = Math.min(1, direct[row + bin] / reference);
      data[row + bin] *= 0.25 + 0.75 * support;
    }
  }

  return {
    data,
    direct,
    frames,
    energy,
    flux,
    frameRate: ENGINE_SAMPLE_RATE / HOP_SIZE,
  };
}

/** Frames whose flux stands out from its neighbours — a note was struck. */
function findOnsets(flux: Float32Array): Uint8Array {
  const onsets = new Uint8Array(flux.length);
  if (flux.length < 5) return onsets;

  // A local mean over roughly a fifth of a second is the reference: it tracks
  // the arrangement's density, so a busy chorus does not drown out its own
  // attacks and a sparse intro does not report one on every breath.
  const radius = 9;
  // A local mean alone is not enough: inside a note that is quietly dying
  // away, the mean falls with it and the smallest ripple then clears the bar,
  // which would chop every held note into pieces. The absolute floor, taken
  // from the song's own distribution of attacks, keeps that from happening.
  const sorted = Float32Array.from(flux).sort();
  const middle = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const strong = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const floor = middle + (strong - middle) * 0.3;

  const threshold = new Float32Array(flux.length);
  for (let index = 0; index < flux.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const at = index + offset;
      if (at < 0 || at >= flux.length) continue;
      sum += flux[at];
      count += 1;
    }
    threshold[index] = Math.max((sum / count) * 1.35, floor);
  }

  let lastOnset = -99;
  for (let index = 2; index < flux.length - 2; index += 1) {
    if (flux[index] < threshold[index]) continue;
    if (flux[index] < flux[index - 1] || flux[index] < flux[index + 1]) continue;
    // 50 ms of silence between attacks; closer than that is one attack seen
    // twice, not two notes.
    if (index - lastOnset < 4) continue;
    onsets[index] = 1;
    lastOnset = index;
  }
  return onsets;
}

/** The strongest pitch bin in a frame, and how strong it was. */
function framePeak(data: Float32Array, row: number) {
  let bestBin = 0;
  let best = 0;
  for (let bin = 0; bin < PITCH_BINS; bin += 1) {
    const value = data[row + bin];
    if (value > best) {
      best = value;
      bestBin = bin;
    }
  }
  return { bin: bestBin, value: best };
}

type Track = {
  midi: Float32Array;
  strength: Float32Array;
  voiced: Uint8Array;
};

/**
 * Follows one melodic line through the salience map.
 *
 * Taking the loudest bin per frame independently produces octave jumps
 * wherever a harmonic briefly outweighs its fundamental, so this walks the
 * frames with a Viterbi pass over the strongest few candidates in each,
 * charging for pitch leaps. The result is the line a listener would hum.
 */
function trackMelody(salience: Salience, sensitivity: number): Track {
  const { data, frames } = salience;
  const CANDIDATES = 6;
  const candidateBins = new Int32Array(frames * CANDIDATES).fill(-1);
  const candidateScores = new Float32Array(frames * CANDIDATES);
  const peaks = new Float32Array(frames);

  for (let frame = 0; frame < frames; frame += 1) {
    const row = frame * PITCH_BINS;
    const { value: peak } = framePeak(data, row);
    peaks[frame] = peak;
    if (peak <= 0) continue;
    // Only local maxima are real candidates; the shoulders of a peak are the
    // same note, and treating them as alternatives just blurs the track.
    const floor = peak * 0.25;
    const found: { bin: number; score: number }[] = [];
    for (let bin = 1; bin < PITCH_BINS - 1; bin += 1) {
      const value = data[row + bin];
      if (value < floor) continue;
      if (value < data[row + bin - 1] || value < data[row + bin + 1]) continue;
      found.push({ bin, score: value });
    }
    found.sort((a, b) => b.score - a.score);
    for (let index = 0; index < Math.min(CANDIDATES, found.length); index += 1) {
      candidateBins[frame * CANDIDATES + index] = found[index].bin;
      candidateScores[frame * CANDIDATES + index] = found[index].score / peak;
    }
  }

  // ---- Viterbi over the candidates ----
  const cost = new Float32Array(frames * CANDIDATES).fill(-Infinity);
  const back = new Int32Array(frames * CANDIDATES).fill(-1);
  // Half a semitone of movement between adjacent frames is free; a leap of an
  // octave costs about as much as halving the pitch's own evidence.
  const LEAP_PENALTY = 0.055;

  for (let index = 0; index < CANDIDATES; index += 1) {
    if (candidateBins[index] >= 0) cost[index] = candidateScores[index];
  }
  for (let frame = 1; frame < frames; frame += 1) {
    for (let index = 0; index < CANDIDATES; index += 1) {
      const slot = frame * CANDIDATES + index;
      const bin = candidateBins[slot];
      if (bin < 0) continue;
      let best = -Infinity;
      let bestPrevious = -1;
      for (let previous = 0; previous < CANDIDATES; previous += 1) {
        const previousSlot = (frame - 1) * CANDIDATES + previous;
        const previousBin = candidateBins[previousSlot];
        if (previousBin < 0 || cost[previousSlot] === -Infinity) continue;
        const semitones =
          Math.abs(bin - previousBin) / BINS_PER_SEMITONE;
        const value =
          cost[previousSlot] - LEAP_PENALTY * Math.min(semitones, 24);
        if (value > best) {
          best = value;
          bestPrevious = previous;
        }
      }
      if (bestPrevious < 0) {
        cost[slot] = candidateScores[slot];
      } else {
        cost[slot] = best + candidateScores[slot];
        back[slot] = bestPrevious;
      }
    }
  }

  // Backtracking walks from the end, but a song rarely ends mid-note: the
  // final frames are usually silence with no candidates at all. So each run
  // of frames that does have candidates is backtracked from its own last
  // frame, which also keeps the chain from being dragged across a rest.
  const path = new Int32Array(frames).fill(-1);
  let frame = frames - 1;
  while (frame >= 0) {
    if (candidateBins[frame * CANDIDATES] < 0) {
      frame -= 1;
      continue;
    }
    let index = 0;
    let bestCost = -Infinity;
    for (let candidate = 0; candidate < CANDIDATES; candidate += 1) {
      const slot = frame * CANDIDATES + candidate;
      if (candidateBins[slot] >= 0 && cost[slot] > bestCost) {
        bestCost = cost[slot];
        index = candidate;
      }
    }
    while (frame >= 0 && index >= 0) {
      path[frame] = candidateBins[frame * CANDIDATES + index];
      index = back[frame * CANDIDATES + index];
      frame -= 1;
    }
  }

  // ---- voicing ----
  // A frame carries a note when both its loudness and its pitch evidence rise
  // above the song's own background, so a quiet recording is not silenced and
  // a noisy one does not turn into a wall of notes.
  const sortedPeaks = Float32Array.from(peaks).sort();
  const median = sortedPeaks[Math.floor(sortedPeaks.length * 0.5)] || 0;
  const loud = sortedPeaks[Math.floor(sortedPeaks.length * 0.92)] || 1;
  const sortedEnergy = Float32Array.from(salience.energy).sort();
  const energyFloor = sortedEnergy[Math.floor(sortedEnergy.length * 0.12)] || 0;
  const energyLoud = sortedEnergy[Math.floor(sortedEnergy.length * 0.9)] || 1;

  // sensitivity 0..1 slides the bar between "only the obvious notes" and
  // "anything that might be one".
  const strictness = 1 - sensitivity;
  const peakGate = median * 0.35 + (loud - median) * 0.28 * strictness;
  const energyGate =
    energyFloor + (energyLoud - energyFloor) * 0.06 * (0.4 + strictness);

  const midi = new Float32Array(frames);
  const strength = new Float32Array(frames);
  const voiced = new Uint8Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const bin = path[frame];
    if (bin < 0) continue;
    midi[frame] = binToMidi(bin);
    strength[frame] = loud > 0 ? Math.min(1, peaks[frame] / loud) : 0;
    voiced[frame] =
      peaks[frame] >= peakGate && salience.energy[frame] >= energyGate ? 1 : 0;
  }

  // Single-frame gaps and single-frame notes are both artefacts of the gate
  // sitting near the signal, not things anybody played.
  for (let frame = 1; frame < frames - 1; frame += 1) {
    if (!voiced[frame] && voiced[frame - 1] && voiced[frame + 1]) voiced[frame] = 1;
  }
  for (let frame = 1; frame < frames - 1; frame += 1) {
    if (voiced[frame] && !voiced[frame - 1] && !voiced[frame + 1]) voiced[frame] = 0;
  }

  return { midi, strength, voiced };
}

/** Median of the tracked pitch over a short window, to iron out vibrato. */
function smoothPitch(track: Track) {
  const { midi, voiced } = track;
  const smoothed = new Float32Array(midi.length);
  const radius = 3;
  const scratch: number[] = [];
  for (let frame = 0; frame < midi.length; frame += 1) {
    if (!voiced[frame]) continue;
    scratch.length = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const at = frame + offset;
      if (at < 0 || at >= midi.length || !voiced[at]) continue;
      scratch.push(midi[at]);
    }
    scratch.sort((a, b) => a - b);
    smoothed[frame] = scratch[Math.floor(scratch.length / 2)] ?? midi[frame];
  }
  return smoothed;
}

function buildMelodyNotes(
  salience: Salience,
  track: Track,
  onsets: Uint8Array,
  minDuration: number,
): DetectedNote[] {
  const pitch = smoothPitch(track);
  const { voiced, strength } = track;
  const { energy } = salience;
  const secondsPerFrame = 1 / salience.frameRate;
  const notes: DetectedNote[] = [];

  let runStart = -1;
  let runSum = 0;
  let runCount = 0;
  let runStrength = 0;
  // A singer's vibrato swings a third of a semitone either side several times
  // a second. Requiring the pitch to stay moved for a few frames before the
  // note is cut keeps that from printing as a run of grace notes.
  let departedSince = -1;

  const flush = (endFrame: number) => {
    if (runStart < 0 || runCount === 0) return;
    const start = runStart * secondsPerFrame;
    const duration = (endFrame - runStart) * secondsPerFrame;
    if (duration >= minDuration) {
      notes.push({
        midi: Math.round(runSum / runCount),
        start,
        duration,
        confidence: Math.max(0.05, Math.min(1, runStrength / runCount)),
      });
    }
    runStart = -1;
    runSum = 0;
    runCount = 0;
    runStrength = 0;
    departedSince = -1;
  };

  for (let frame = 0; frame < pitch.length; frame += 1) {
    if (!voiced[frame]) {
      flush(frame);
      continue;
    }
    const value = pitch[frame];
    if (runStart < 0) {
      runStart = frame;
    } else {
      const mean = runSum / runCount;
      const away = Math.abs(value - mean) > 0.62;
      if (!away) {
        departedSince = -1;
      } else if (departedSince < 0) {
        departedSince = frame;
      }
      // A new note starts either when the pitch has genuinely moved and
      // stayed there, or when the same pitch was struck again — a repeated
      // note has an onset but no pitch change, and without that test every
      // repetition would merge into one.
      const moved = departedSince >= 0 && frame - departedSince >= 3;
      // An onset alone is not enough to re-strike: vibrato and tremolo stir
      // the spectrum every fifth of a second without anything being played
      // again. A real attack also lifts the loudness above what the note was
      // already doing.
      let restruck = false;
      if (onsets[frame] === 1 && (frame - runStart) * secondsPerFrame > 0.09) {
        let before = 0;
        let count = 0;
        for (let at = Math.max(runStart, frame - 5); at < frame - 1; at += 1) {
          before += energy[at];
          count += 1;
        }
        restruck = count === 0 || energy[frame] > (before / count) * 1.2;
      }
      if (moved || restruck) {
        // The note really began where the pitch first left the old one, not
        // three frames later once we were sure of it. Read before flushing,
        // which clears the marker.
        const boundary = moved ? departedSince : frame;
        flush(boundary);
        runStart = boundary;
        for (let at = boundary; at < frame; at += 1) {
          runSum += pitch[at];
          runCount += 1;
          runStrength += strength[at];
        }
      }
      if (runStart < 0) runStart = frame;
    }
    runSum += value;
    runCount += 1;
    runStrength += strength[frame];
  }
  flush(pitch.length);

  return notes;
}

/**
 * Polyphonic reading: instead of one line, every pitch whose salience stands
 * clear of the frame is kept, with the obvious harmonics of a stronger pitch
 * suppressed so a single low note does not print as a chord.
 */
function buildChordNotes(
  salience: Salience,
  onsets: Uint8Array,
  sensitivity: number,
  minDuration: number,
): DetectedNote[] {
  const { data, frames } = salience;
  const semitones = MIDI_HIGH - MIDI_LOW + 1;
  const active = new Uint8Array(frames * semitones);
  const level = new Float32Array(frames * semitones);

  const relative = 0.5 - sensitivity * 0.28;
  const peaksPerFrame = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    peaksPerFrame[frame] = framePeak(data, frame * PITCH_BINS).value;
  }
  const sorted = Float32Array.from(peaksPerFrame).sort();
  const loud = sorted[Math.floor(sorted.length * 0.92)] || 1;
  const absolute = loud * (0.1 + (1 - sensitivity) * 0.16);

  for (let frame = 0; frame < frames; frame += 1) {
    const row = frame * PITCH_BINS;
    const peak = peaksPerFrame[frame];
    if (peak <= 0) continue;
    const gate = Math.max(peak * relative, absolute);

    const found: { midi: number; value: number }[] = [];
    for (let bin = 1; bin < PITCH_BINS - 1; bin += 1) {
      const value = data[row + bin];
      if (value < gate) continue;
      if (value < data[row + bin - 1] || value < data[row + bin + 1]) continue;
      found.push({ midi: Math.round(binToMidi(bin)), value });
    }
    found.sort((a, b) => b.value - a.value);

    const kept: { midi: number; value: number }[] = [];
    for (const candidate of found) {
      // An octave or a twelfth above a much stronger pitch is that pitch's
      // own overtone unless it is nearly as loud in its own right.
      const shadowed = kept.some((other) => {
        const interval = candidate.midi - other.midi;
        const harmonic = interval === 12 || interval === 19 || interval === 24;
        return harmonic && candidate.value < other.value * 0.62;
      });
      if (shadowed) continue;
      kept.push(candidate);
      if (kept.length >= 6) break;
    }
    for (const note of kept) {
      const index = note.midi - MIDI_LOW;
      if (index < 0 || index >= semitones) continue;
      active[frame * semitones + index] = 1;
      level[frame * semitones + index] = note.value / (loud || 1);
    }
  }

  const secondsPerFrame = 1 / salience.frameRate;
  const notes: DetectedNote[] = [];
  for (let index = 0; index < semitones; index += 1) {
    let start = -1;
    let sum = 0;
    let count = 0;
    let gap = 0;
    const flush = (endFrame: number) => {
      if (start < 0) return;
      const duration = (endFrame - start) * secondsPerFrame;
      if (duration >= minDuration && count > 0) {
        notes.push({
          midi: MIDI_LOW + index,
          start: start * secondsPerFrame,
          duration,
          confidence: Math.max(0.05, Math.min(1, sum / count)),
        });
      }
      start = -1;
      sum = 0;
      count = 0;
    };
    for (let frame = 0; frame < frames; frame += 1) {
      const on = active[frame * semitones + index] === 1;
      if (on) {
        if (start < 0) {
          start = frame;
        } else if (onsets[frame] === 1 && (frame - start) * secondsPerFrame > 0.12) {
          flush(frame);
          start = frame;
        }
        sum += level[frame * semitones + index];
        count += 1;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        // Two frames of silence inside a held note is the window sliding past
        // a transient, not the note stopping.
        if (gap > 2) flush(frame - gap + 1);
      }
    }
    flush(frames);
  }

  return notes;
}

export type EngineOptions = {
  /** 0..1 — how much benefit of the doubt a quiet pitch is given. */
  sensitivity: number;
  mode: ViewMode;
  /** Shortest note kept, in seconds. */
  minDuration?: number;
};

export type EngineResult = {
  notes: DetectedNote[];
  /** Milliseconds spent, for the "how long did that take" line. */
  elapsed: number;
};

/**
 * Runs the whole detector over mono samples at {@link ENGINE_SAMPLE_RATE}.
 */
export function detectNotes(
  samples: Float32Array,
  options: EngineOptions,
  onProgress?: (percent: number) => void,
): EngineResult {
  const startedAt = Date.now();
  const sensitivity = Math.max(0, Math.min(1, options.sensitivity));
  const minDuration = options.minDuration ?? 0.06;

  if (samples.length < FRAME_SIZE) {
    return { notes: [], elapsed: Date.now() - startedAt };
  }

  onProgress?.(2);
  const salience = computeSalience(samples, (fraction) => {
    onProgress?.(2 + Math.round(fraction * 82));
  });
  onProgress?.(86);

  const onsets = findOnsets(salience.flux);
  onProgress?.(90);

  const notes =
    options.mode === "full"
      ? buildChordNotes(salience, onsets, sensitivity, minDuration)
      : buildMelodyNotes(
          salience,
          trackMelody(salience, sensitivity),
          onsets,
          minDuration,
        );

  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  onProgress?.(100);

  return { notes, elapsed: Date.now() - startedAt };
}
