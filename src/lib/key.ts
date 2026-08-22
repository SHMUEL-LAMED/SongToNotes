import type { DetectedNote, KeySignature } from "./types";

/** Krumhansl–Kessler tonal hierarchies. */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

/** Circle-of-fifths position of each tonic, choosing the readable spelling. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const MINOR_FIFTHS = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2];

const LETTERS = ["F", "C", "G", "D", "A", "E", "B"] as const;
const NATURAL_PITCH_CLASS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const HEBREW_NAMES = [
  "דו",
  "דו♯",
  "רה",
  "רה♯",
  "מי",
  "פה",
  "פה♯",
  "סול",
  "סול♯",
  "לה",
  "לה♯",
  "סי",
];

const HEBREW_LETTERS: Record<string, string> = {
  C: "דו",
  D: "רה",
  E: "מי",
  F: "פה",
  G: "סול",
  A: "לה",
  B: "סי",
};

export type SpelledPitch = {
  /** A–G */
  letter: string;
  /** -2..2, in semitones */
  alter: number;
  octave: number;
};

function correlate(histogram: number[], profile: number[], rotation: number) {
  const meanHistogram = histogram.reduce((a, b) => a + b, 0) / 12;
  const meanProfile = profile.reduce((a, b) => a + b, 0) / 12;
  let numerator = 0;
  let histogramVariance = 0;
  let profileVariance = 0;
  for (let index = 0; index < 12; index += 1) {
    const x = histogram[(index + rotation) % 12] - meanHistogram;
    const y = profile[index] - meanProfile;
    numerator += x * y;
    histogramVariance += x * x;
    profileVariance += y * y;
  }
  const denominator = Math.sqrt(histogramVariance * profileVariance);
  return denominator > 0 ? numerator / denominator : 0;
}

export function pitchClassHistogram(notes: DetectedNote[]) {
  const histogram = new Array(12).fill(0);
  notes.forEach((note) => {
    // Weighting by sounding time keeps passing notes from outvoting the tonic.
    histogram[((note.midi % 12) + 12) % 12] +=
      Math.max(0.05, note.duration) * Math.max(0.1, note.confidence);
  });
  return histogram;
}

export function detectKey(notes: DetectedNote[]): KeySignature {
  if (notes.length < 4) {
    return { fifths: 0, mode: "major", tonicPitchClass: 0, fit: 0 };
  }
  const histogram = pitchClassHistogram(notes);
  let best: KeySignature = {
    fifths: 0,
    mode: "major",
    tonicPitchClass: 0,
    fit: -Infinity,
  };

  for (let tonic = 0; tonic < 12; tonic += 1) {
    const major = correlate(histogram, MAJOR_PROFILE, tonic);
    if (major > best.fit) {
      best = {
        fifths: MAJOR_FIFTHS[tonic],
        mode: "major",
        tonicPitchClass: tonic,
        fit: major,
      };
    }
    const minor = correlate(histogram, MINOR_PROFILE, tonic);
    if (minor > best.fit) {
      best = {
        fifths: MINOR_FIFTHS[tonic],
        mode: "minor",
        tonicPitchClass: tonic,
        fit: minor,
      };
    }
  }

  return { ...best, fit: Math.max(0, best.fit) };
}

/**
 * Places a pitch class on the line of fifths, picking the spelling that sits
 * closest to the key centre — so F♯ major gets D♯ rather than E♭.
 */
export function spellPitch(midi: number, fifths: number): SpelledPitch {
  const pitchClass = ((midi % 12) + 12) % 12;
  const base = (pitchClass * 7) % 12;
  const centre = fifths + 1;

  let position = base;
  let bestDistance = Infinity;
  for (const candidate of [base - 12, base, base + 12]) {
    if (candidate < -7 || candidate > 11) continue;
    const distance = Math.abs(candidate - centre);
    if (distance < bestDistance) {
      bestDistance = distance;
      position = candidate;
    }
  }

  const letter = LETTERS[(((position + 1) % 7) + 7) % 7];
  const alter = Math.floor((position + 1) / 7);
  const octave =
    Math.round((midi - alter - NATURAL_PITCH_CLASS[letter]) / 12) - 1;
  return { letter, alter, octave };
}

export function keyName(key: KeySignature) {
  const spelled = spellPitch(key.tonicPitchClass + 60, key.fifths);
  const accidental = spelled.alter > 0 ? "♯" : spelled.alter < 0 ? "♭" : "";
  const hebrew = `${HEBREW_LETTERS[spelled.letter]}${accidental}`;
  return `${hebrew} ${key.mode === "major" ? "מז׳ור" : "מינור"}`;
}

/** ABC's key field, e.g. `Bb` or `F#m`. */
export function keyToAbc(key: KeySignature) {
  const spelled = spellPitch(key.tonicPitchClass + 60, key.fifths);
  const accidental = spelled.alter > 0 ? "#" : spelled.alter < 0 ? "b" : "";
  return `${spelled.letter}${accidental}${key.mode === "minor" ? "m" : ""}`;
}

export function hebrewNoteName(midi: number, fifths = 0) {
  const spelled = spellPitch(midi, fifths);
  const accidental = spelled.alter > 0 ? "♯" : spelled.alter < 0 ? "♭" : "";
  return `${HEBREW_LETTERS[spelled.letter]}${accidental} ${spelled.octave}`;
}

export function plainNoteName(midi: number) {
  return `${HEBREW_NAMES[((midi % 12) + 12) % 12]} ${Math.floor(midi / 12) - 1}`;
}

export function scientificName(midi: number, fifths = 0) {
  const spelled = spellPitch(midi, fifths);
  const accidental = spelled.alter > 0 ? "#" : spelled.alter < 0 ? "b" : "";
  return `${spelled.letter}${accidental}${spelled.octave}`;
}
