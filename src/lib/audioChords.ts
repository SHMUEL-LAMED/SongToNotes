/**
 * Chords from audio: which chord is sounding, and when.
 *
 * A chromagram — how much energy sits on each of the twelve pitch classes —
 * is taken frame by frame with an FFT, then matched against templates for
 * the chord types a guitarist plays. The winner per frame is smoothed over
 * time so a strummed bar reads as one chord rather than a flicker, and runs
 * of the same chord become one timed segment. Nothing here needs a model.
 */
import { Fft, hannWindow } from "./fft";

export type ChordQuality = "" | "m" | "7" | "m7" | "maj7" | "sus4" | "sus2" | "dim" | "aug";

export type ChordSegment = {
  start: number;
  end: number;
  root: number;
  quality: ChordQuality;
  /** 0..1: how well the chroma fit the template. */
  confidence: number;
};

export const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
export const HEBREW_ROOTS = ["דו", "דו#", "רה", "רה#", "מי", "פה", "פה#", "סול", "סול#", "לה", "לה#", "סי"];

/** Intervals from the root, in semitones. */
const QUALITIES: { quality: ChordQuality; intervals: number[]; weight: number }[] = [
  { quality: "", intervals: [0, 4, 7], weight: 1 },
  { quality: "m", intervals: [0, 3, 7], weight: 1 },
  // Four-note chords match more of any chroma, so they need to earn it:
  // a plain triad's overtones alone must not read as a seventh.
  { quality: "7", intervals: [0, 4, 7, 10], weight: 0.9 },
  { quality: "m7", intervals: [0, 3, 7, 10], weight: 0.9 },
  { quality: "maj7", intervals: [0, 4, 7, 11], weight: 0.84 },
  { quality: "sus4", intervals: [0, 5, 7], weight: 0.86 },
  { quality: "sus2", intervals: [0, 2, 7], weight: 0.86 },
  { quality: "dim", intervals: [0, 3, 6], weight: 0.82 },
  { quality: "aug", intervals: [0, 4, 8], weight: 0.8 },
];

export function chordName(root: number, quality: ChordQuality, flats = false) {
  return `${(flats ? FLAT_NAMES : ROOT_NAMES)[((root % 12) + 12) % 12]}${quality}`;
}

/** Cmaj7 → "דו מז'ור 7" style label. */
export function chordHebrew(root: number, quality: ChordQuality) {
  const base = HEBREW_ROOTS[((root % 12) + 12) % 12];
  const kind: Record<ChordQuality, string> = {
    "": "מז'ור",
    m: "מינור",
    "7": "דומיננט 7",
    m7: "מינור 7",
    maj7: "מז'ור 7",
    sus4: "sus4",
    sus2: "sus2",
    dim: "מוקטן",
    aug: "מוגדל",
  };
  return `${base} ${kind[quality]}`;
}

/** Moves a chord by semitones, e.g. for a capo or a singer's key. */
export function transposeRoot(root: number, semitones: number) {
  return (((root + semitones) % 12) + 12) % 12;
}

const TEMPLATES = (() => {
  const list: { root: number; quality: ChordQuality; vector: Float32Array; weight: number }[] = [];
  for (let root = 0; root < 12; root += 1) {
    for (const { quality, intervals, weight } of QUALITIES) {
      const vector = new Float32Array(12);
      intervals.forEach((interval, index) => {
        // The root and fifth carry a chord; the colour tones less so.
        vector[(root + interval) % 12] = index === 0 ? 1 : interval === 7 ? 0.9 : 0.75;
      });
      let norm = 0;
      for (const value of vector) norm += value * value;
      norm = Math.sqrt(norm) || 1;
      for (let index = 0; index < 12; index += 1) vector[index] /= norm;
      list.push({ root, quality, vector, weight });
    }
  }
  return list;
})();

/**
 * Chroma per frame: `frames` rows of 12, from a mono signal.
 *
 * Rather than dropping every FFT bin into its pitch class — which lets the
 * overtones of a note vote for other classes (E's third harmonic is a B) —
 * each candidate note's salience is the weighted sum of its first four
 * harmonics. A note that is really there has its harmonics; a class that is
 * only someone else's overtone does not, and so counts for less.
 */
export function chromagram(mono: Float32Array, sampleRate: number, hopSeconds = 0.1) {
  const size = 16384;
  const hop = Math.max(256, Math.round(hopSeconds * sampleRate));
  const fft = new Fft(size);
  const window = hannWindow(size);
  const frame = new Float32Array(size);
  const magnitudes = new Float32Array(size / 2);
  const frames = Math.max(1, Math.floor((mono.length - size) / hop) + 1);
  const chroma = new Float32Array(frames * 12);
  // The low notes alone, note by note rather than by class, for telling
  // which one is the bass: the lowest of the strong ones.
  const LOW_NOTES = 16;
  const bass = new Float32Array(frames * LOW_NOTES);

  // E2 to E6: the range a guitar or a piano's chord voicing lives in.
  const lowest = 40;
  const highest = 88;
  const HARMONICS = [1, 0.5, 0.25, 0.12];
  const notes: { cls: number; bins: number[][]; weight: number; low: number }[] = [];
  for (let midi = lowest; midi <= highest; midi += 1) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    // The bins within a quarter tone of each harmonic.
    const bins = HARMONICS.map((_, index) => {
      const centre = frequency * (index + 1);
      const low = Math.max(1, Math.floor((centre * 2 ** (-1 / 24) * size) / sampleRate));
      const high = Math.min(size / 2 - 1, Math.ceil((centre * 2 ** (1 / 24) * size) / sampleRate));
      const list: number[] = [];
      for (let bin = low; bin <= high; bin += 1) list.push(bin);
      return list;
    });
    // Bass notes anchor a chord; the top of the range is mostly colour.
    const weight = midi < 55 ? 1.25 : midi > 76 ? 0.7 : 1;
    notes.push({ cls: midi % 12, bins, weight, low: midi - lowest < LOW_NOTES ? midi - lowest : -1 });
  }

  for (let index = 0; index < frames; index += 1) {
    const offset = index * hop;
    for (let sample = 0; sample < size; sample += 1) {
      frame[sample] = (mono[offset + sample] ?? 0) * window[sample];
    }
    fft.magnitudes(frame, magnitudes);
    const row = index * 12;
    const salience = new Float32Array(notes.length);
    notes.forEach((note, at) => {
      let sum = 0;
      note.bins.forEach((bins, harmonic) => {
        let peak = 0;
        for (const bin of bins) if (magnitudes[bin] > peak) peak = magnitudes[bin];
        sum += HARMONICS[harmonic] * peak;
      });
      salience[at] = sum;
    });
    // From the bottom up, each note explains part of what sits at its
    // octave, twelfth and double octave; what is left there is a note of
    // its own, or nothing.
    const OVERTONES: [number, number][] = [
      [12, 0.5],
      [19, 0.3],
      [24, 0.2],
    ];
    for (let at = 0; at < notes.length; at += 1) {
      for (const [interval, share] of OVERTONES) {
        const above = at + interval;
        if (above < notes.length) salience[above] = Math.max(0, salience[above] - salience[at] * share);
      }
    }
    notes.forEach((note, at) => {
      // Gentle compression, so a loud strum does not own the frame and a
      // quiet inner voice still counts.
      const value = Math.sqrt(salience[at]);
      chroma[row + note.cls] += value * note.weight;
      if (note.low >= 0) bass[index * LOW_NOTES + note.low] = value;
    });
  }
  return { chroma, bass, lowNotes: LOW_NOTES, lowestMidi: lowest, frames, hopSeconds: hop / sampleRate };
}

type FrameChoice = { template: number; score: number };

/** The pitch class of the lowest strong note, or -1 when nothing is down there. */
function bassClass(bass: Float32Array, row: number, count: number, lowestMidi: number) {
  let peak = 0;
  for (let note = 0; note < count; note += 1) peak = Math.max(peak, bass[row + note]);
  if (peak <= 1e-6) return -1;
  for (let note = 0; note < count; note += 1) {
    if (bass[row + note] >= peak * 0.6) return (lowestMidi + note) % 12;
  }
  return -1;
}

/**
 * The template that fits the frame best. The bass note breaks near-ties:
 * a G7 voiced with a doubled B still has G underneath, and a listener hears
 * the chord from the bass up.
 */
function bestTemplate(chroma: Float32Array, row: number, bass: number): FrameChoice {
  let norm = 0;
  for (let index = 0; index < 12; index += 1) norm += chroma[row + index] * chroma[row + index];
  norm = Math.sqrt(norm);
  if (norm <= 1e-6) return { template: -1, score: 0 };
  let best = -1;
  let bestScore = -1;
  for (let index = 0; index < TEMPLATES.length; index += 1) {
    const { vector, weight } = TEMPLATES[index];
    let dot = 0;
    for (let cls = 0; cls < 12; cls += 1) dot += chroma[row + cls] * vector[cls];
    const score = (dot / norm) * weight + (bass >= 0 && TEMPLATES[index].root === bass ? 0.08 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return { template: best, score: bestScore };
}

/**
 * The chord timeline. Frames vote, a window of votes decides each moment
 * (so a passing note does not split a bar), and short runs merge into their
 * neighbours. `minSeconds` is the shortest chord worth reporting.
 */
export function detectChordTimeline(
  mono: Float32Array,
  sampleRate: number,
  options: { hopSeconds?: number; smoothSeconds?: number; minSeconds?: number } = {},
): ChordSegment[] {
  const hopSeconds = options.hopSeconds ?? 0.1;
  const smoothSeconds = options.smoothSeconds ?? 0.6;
  const minSeconds = options.minSeconds ?? 0.45;
  const { chroma, bass, lowNotes, lowestMidi, frames, hopSeconds: hop } = chromagram(mono, sampleRate, hopSeconds);

  // Average the chroma over a sliding window before matching: cheaper and
  // steadier than matching every frame and voting afterwards.
  const radius = Math.max(1, Math.round(smoothSeconds / hop / 2));
  const smooth = (source: Float32Array, width: number) => {
    const out = new Float32Array(frames * width);
    const prefix = new Float64Array((frames + 1) * width);
    for (let index = 0; index < frames; index += 1) {
      for (let cls = 0; cls < width; cls += 1) {
        prefix[(index + 1) * width + cls] = prefix[index * width + cls] + source[index * width + cls];
      }
    }
    for (let index = 0; index < frames; index += 1) {
      const from = Math.max(0, index - radius);
      const to = Math.min(frames, index + radius + 1);
      for (let cls = 0; cls < width; cls += 1) {
        out[index * width + cls] = (prefix[to * width + cls] - prefix[from * width + cls]) / (to - from);
      }
    }
    return out;
  };
  const smoothed = smooth(chroma, 12);
  const smoothedBass = smooth(bass, lowNotes);

  const choices: FrameChoice[] = [];
  for (let index = 0; index < frames; index += 1) {
    choices.push(
      bestTemplate(smoothed, index * 12, bassClass(smoothedBass, index * lowNotes, lowNotes, lowestMidi)),
    );
  }

  // Runs of the same template become segments.
  const segments: ChordSegment[] = [];
  let runStart = 0;
  for (let index = 1; index <= frames; index += 1) {
    const current = choices[index]?.template ?? -2;
    if (index < frames && current === choices[runStart].template) continue;
    const template = choices[runStart].template;
    if (template >= 0) {
      let score = 0;
      for (let at = runStart; at < index; at += 1) score += choices[at].score;
      segments.push({
        start: runStart * hop,
        end: index * hop,
        root: TEMPLATES[template].root,
        quality: TEMPLATES[template].quality,
        confidence: Math.max(0, Math.min(1, score / (index - runStart))),
      });
    }
    runStart = index;
  }

  // Short segments are absorbed by whichever neighbour they resemble more —
  // the same root first, then simply the longer one.
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.end - segment.start >= minSeconds) continue;
      const previous = segments[index - 1];
      const next = segments[index + 1];
      if (!previous && !next) break;
      const pick =
        previous && next
          ? previous.root === segment.root
            ? previous
            : next.root === segment.root
              ? next
              : previous.end - previous.start >= next.end - next.start
                ? previous
                : next
          : (previous ?? next);
      if (pick === previous) previous.end = segment.end;
      else next.start = segment.start;
      segments.splice(index, 1);
      changed = true;
      break;
    }
  }
  // Merging may have left equal neighbours side by side.
  const merged: ChordSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.root === segment.root && last.quality === segment.quality) {
      last.end = segment.end;
      last.confidence = Math.max(last.confidence, segment.confidence);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/** A plain chord sheet: one line per chord with its start time. */
export function chordSheet(segments: ChordSegment[], semitones = 0, flats = false) {
  const clock = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  };
  return segments
    .map((segment) => `${clock(segment.start)}  ${chordName(transposeRoot(segment.root, semitones), segment.quality, flats)}`)
    .join("\n");
}

/** Chords in order of first appearance, for the diagrams row. */
export function uniqueChords(segments: ChordSegment[]) {
  const seen = new Set<string>();
  const list: { root: number; quality: ChordQuality }[] = [];
  for (const segment of segments) {
    const key = `${segment.root}${segment.quality}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ root: segment.root, quality: segment.quality });
  }
  return list;
}
