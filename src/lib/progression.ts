/**
 * The progression generator: a mood picks a family of chord progressions,
 * the key spells them, and an accompaniment turns them into notes — a
 * voice-led chord part and a bass line — that the site's synth can loop and
 * the MIDI writer can save.
 *
 * Progressions are written as tokens relative to the key: "1".."7" are the
 * scale's own chords, and a few borrowed chords that songs lean on are named
 * for what they are — "b7" is the major chord a whole step below the tonic
 * (the rock and mixolydian sound), "5M" the major dominant of harmonic minor,
 * "4m" the minor subdominant borrowed into a major key, "4M" the major
 * subdominant of the dorian sound in a minor one.
 */
import { ROOTS, diatonicChords, findScale } from "./theory";
import type { DetectedNote } from "./types";

export type Mood = {
  id: string;
  label: string;
  minor: boolean;
  /** Seventh chords suit it better than triads. */
  sevenths?: boolean;
  pool: string[][];
};

export const MOODS: Mood[] = [
  { id: "pop", label: "פופ", minor: false, pool: [["1", "5", "6", "4"], ["1", "6", "4", "5"], ["6", "4", "1", "5"], ["1", "4", "6", "5"], ["4", "1", "5", "6"], ["1", "5", "4", "4"]] },
  { id: "happy", label: "שמח", minor: false, pool: [["1", "4", "5", "4"], ["1", "4", "1", "5"], ["1", "2", "4", "5"], ["1", "3", "4", "5"], ["4", "5", "1", "1"]] },
  { id: "sad", label: "עצוב", minor: true, pool: [["1", "6", "3", "7"], ["1", "4", "7", "3"], ["1", "6", "4", "5"], ["1", "7", "6", "7"], ["6", "7", "1", "1"]] },
  { id: "dramatic", label: "דרמטי / מזרחי", minor: true, pool: [["1", "7", "6", "5M"], ["1", "4", "5M", "1"], ["1", "6", "7", "5M"], ["4", "5M", "1", "1"]] },
  { id: "rock", label: "רוק", minor: false, pool: [["1", "b7", "4", "1"], ["1", "4", "b7", "4"], ["1", "b6", "b7", "1"], ["1", "5", "b7", "4"]] },
  { id: "dreamy", label: "חלומי", minor: false, sevenths: true, pool: [["1", "4"], ["1", "3", "6", "4"], ["4", "5", "3", "6"], ["1", "6", "4", "4m"]] },
  { id: "jazz", label: "ג׳אז", minor: false, sevenths: true, pool: [["2", "5", "1", "1"], ["1", "6", "2", "5"], ["3", "6", "2", "5"], ["1", "4", "3", "6"]] },
  { id: "epic", label: "אפי", minor: true, pool: [["1", "6", "3", "7"], ["6", "7", "1", "1"], ["1", "b6", "b7", "1"], ["1", "3", "7", "4"]] },
];

export type ProgChord = {
  token: string;
  /** Roman numeral, relative to the key. */
  roman: string;
  /** As the site shows it: F♯m, B♭maj7, B°. */
  name: string;
  /** As the songbook reads it: F#m, Bbmaj7, Bdim. */
  plain: string;
  rootPc: number;
  /** Pitch classes above the root, e.g. [0, 4, 7]. */
  intervals: number[];
};

/** The chord symbol in plain ASCII, the only kind the songbook accepts. */
export function plainChordName(name: string) {
  return name
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/m7b5$/, "m7")
    .replace(/°7$/, "dim")
    .replace(/°$/, "dim")
    .replace(/\+$/, "aug")
    .replace(/maj7#5$/, "maj7")
    .replace(/m\(maj7\)$/, "m");
}

/** Spells one token in a key. */
export function chordFor(token: string, keyPc: number, minor: boolean, sevenths: boolean): ProgChord {
  const scale = findScale(minor ? "minor" : "major");
  const diatonic = diatonicChords(keyPc, scale, sevenths);
  const plainDegree = /^[1-7]$/.test(token) ? Number(token) : null;
  if (plainDegree) {
    const chord = diatonic[plainDegree - 1];
    const intervals = chord.midi.map((value) => value - chord.midi[0]);
    return {
      token,
      roman: chord.roman,
      name: chord.name,
      plain: plainChordName(chord.name),
      rootPc: chord.midi[0] % 12,
      intervals,
    };
  }
  // Borrowed chords.
  const borrowed: Record<string, { offset: number; intervals: number[]; seventh: number; suffix: string; seventhSuffix: string; roman: string }> = {
    b7: { offset: 10, intervals: [0, 4, 7], seventh: 10, suffix: "", seventhSuffix: "7", roman: "♭VII" },
    b6: { offset: 8, intervals: [0, 4, 7], seventh: 11, suffix: "", seventhSuffix: "maj7", roman: "♭VI" },
    b3: { offset: 3, intervals: [0, 4, 7], seventh: 11, suffix: "", seventhSuffix: "maj7", roman: "♭III" },
    "5M": { offset: 7, intervals: [0, 4, 7], seventh: 10, suffix: "", seventhSuffix: "7", roman: "V" },
    "4m": { offset: 5, intervals: [0, 3, 7], seventh: 10, suffix: "m", seventhSuffix: "m7", roman: "iv" },
    "4M": { offset: 5, intervals: [0, 4, 7], seventh: 10, suffix: "", seventhSuffix: "7", roman: "IV" },
  };
  const spec = borrowed[token] ?? borrowed["5M"];
  const rootPc = (keyPc + spec.offset) % 12;
  // Spelled from the scale degree it sits on, so C♯ minor gets G♯ and not
  // A♭; the flat chords of a major key lower that degree's letter.
  const degree = token === "5M" ? 5 : token === "4m" || token === "4M" ? 4 : Number(token.slice(1));
  const letterName = diatonic[degree - 1].name.match(/^[A-G][♯♭]*/)?.[0] ?? ROOTS[rootPc].name;
  const flattened = token.startsWith("b") && !minor ? (letterName.endsWith("♯") ? letterName.slice(0, -1) : `${letterName}♭`) : letterName;
  // A double flat is correct but unreadable on a lead sheet; the enharmonic wins.
  const lowered = flattened.endsWith("♭♭") ? ROOTS[rootPc].name : flattened;
  const name = `${lowered}${sevenths ? spec.seventhSuffix : spec.suffix}`;
  return {
    token,
    roman: sevenths ? `${spec.roman}${spec.seventhSuffix.replace(/^m/, "")}` : spec.roman,
    name,
    plain: plainChordName(name),
    rootPc,
    intervals: sevenths ? [...spec.intervals, spec.seventh] : spec.intervals,
  };
}

export function spellProgression(tokens: string[], keyPc: number, minor: boolean, sevenths: boolean) {
  return tokens.map((token) => chordFor(token, keyPc, minor, sevenths));
}

/** A progression from the mood, sometimes with one chord swapped for a neighbour that still fits. */
export function generateTokens(mood: Mood, random: () => number = Math.random): string[] {
  const base = [...mood.pool[Math.floor(random() * mood.pool.length) % mood.pool.length]];
  if (base.length >= 4 && random() < 0.35) {
    const swaps: Record<string, string[]> = { "1": ["6", "3"], "4": ["2", "6"], "5": ["3", "7"], "6": ["4", "1"], "2": ["4"], "3": ["5", "1"], "7": ["5"] };
    const at = 1 + Math.floor(random() * (base.length - 1));
    const options = swaps[base[at]];
    if (options) base[at] = options[Math.floor(random() * options.length) % options.length];
  }
  return base;
}

/** Other chords that could stand in one slot, for rerolling a single card. */
export function alternativesFor(token: string, minor: boolean) {
  const diatonic = ["1", "2", "3", "4", "5", "6", "7"];
  // What a minor key borrows is the major dominant and the dorian IV; a major
  // key borrows from its parallel minor.
  const extra = minor ? ["5M", "4M"] : ["b7", "b6", "4m"];
  return [...diatonic, ...extra].filter((item) => item !== token && !(minor && item === "2"));
}

/* ---- voicing ---- */

const CHORD_LOW = 53;
const CHORD_HIGH = 77;

/** Every inversion of the chord that sits in the chord register. */
function candidates(chord: ProgChord) {
  const found: number[][] = [];
  for (let base = CHORD_LOW - 12; base <= CHORD_HIGH; base += 1) {
    if (((base % 12) + 12) % 12 !== chord.rootPc) continue;
    const notes = chord.intervals.map((interval) => base + interval);
    for (let inversion = 0; inversion < notes.length; inversion += 1) {
      const voiced = [...notes.slice(inversion), ...notes.slice(0, inversion).map((value) => value + 12)].sort((a, b) => a - b);
      if (voiced[0] >= CHORD_LOW && voiced[voiced.length - 1] <= CHORD_HIGH) found.push(voiced);
    }
  }
  return found;
}

/** Each chord voiced to move as little as possible from the one before. */
export function voiceLead(chords: ProgChord[]): number[][] {
  const result: number[][] = [];
  let previous: number[] | null = null;
  for (const chord of chords) {
    const options = candidates(chord);
    if (!options.length) {
      result.push(chord.intervals.map((interval) => 60 + chord.rootPc + interval));
      continue;
    }
    let best = options[0];
    let bestCost = Infinity;
    for (const option of options) {
      const centre = option.reduce((sum, value) => sum + value, 0) / option.length;
      const cost = previous
        ? option.reduce((sum, value) => sum + Math.min(...previous!.map((prior) => Math.abs(prior - value))), 0)
        : Math.abs(centre - 64);
      if (cost < bestCost) {
        bestCost = cost;
        best = option;
      }
    }
    result.push(best);
    previous = best;
  }
  return result;
}

/* ---- accompaniment ---- */

export type Pattern = "block" | "pulse" | "arpUp" | "arpUpDown" | "broken" | "offbeat";
export type BassStyle = "none" | "root" | "rootFifth" | "octaves" | "walking";

export const PATTERNS: { id: Pattern; label: string }[] = [
  { id: "block", label: "אקורד מלא" },
  { id: "pulse", label: "על כל פעמה" },
  { id: "arpUp", label: "ארפג׳יו עולה" },
  { id: "arpUpDown", label: "ארפג׳יו עולה ויורד" },
  { id: "broken", label: "בלדה" },
  { id: "offbeat", label: "אופ־ביט (רגאיי)" },
];

export const BASS_STYLES: { id: BassStyle; label: string }[] = [
  { id: "none", label: "בלי בס" },
  { id: "root", label: "צליל יסוד" },
  { id: "rootFifth", label: "יסוד וקווינטה" },
  { id: "octaves", label: "אוקטבות" },
  { id: "walking", label: "בס מהלך" },
];

export type Arrangement = {
  bpm: number;
  /** Beats each chord lasts. */
  beatsPerChord: number;
  pattern: Pattern;
  bass: BassStyle;
};

const note = (midi: number, start: number, duration: number, level = 0.8): DetectedNote => ({ midi, start, duration, confidence: level });

/** The bass note for a pitch class, in the octave from E1 up. */
function bassNote(pc: number) {
  const base = 28 + ((((pc - 4) % 12) + 12) % 12);
  return base;
}

/** The whole loop as notes, the chord part and the bass together. */
export function arrange(chords: ProgChord[], arrangement: Arrangement): DetectedNote[] {
  const beat = 60 / arrangement.bpm;
  const span = arrangement.beatsPerChord * beat;
  const voicings = voiceLead(chords);
  const notes: DetectedNote[] = [];

  chords.forEach((chord, index) => {
    const start = index * span;
    const voiced = voicings[index];
    const eighth = beat / 2;
    const eighths = arrangement.beatsPerChord * 2;

    switch (arrangement.pattern) {
      case "block":
        voiced.forEach((midi) => notes.push(note(midi, start, span * 0.98, 0.6)));
        break;
      case "pulse":
        for (let b = 0; b < arrangement.beatsPerChord; b += 1) {
          voiced.forEach((midi) => notes.push(note(midi, start + b * beat, beat * 0.85, b === 0 ? 0.7 : 0.5)));
        }
        break;
      case "arpUp":
      case "arpUpDown": {
        const up = [...voiced, voiced[0] + 12];
        const cycle = arrangement.pattern === "arpUp" ? up : [...up, ...up.slice(1, -1).reverse()];
        for (let step = 0; step < eighths; step += 1) {
          notes.push(note(cycle[step % cycle.length], start + step * eighth, eighth * 1.6, step % 2 === 0 ? 0.65 : 0.5));
        }
        break;
      }
      case "broken": {
        // Root-fifth-octave-third, the pattern of a thousand piano ballads.
        const low = voiced[0];
        const figure = [low, low + 7, low + 12, voiced[1] + 12];
        for (let step = 0; step < eighths; step += 1) {
          notes.push(note(figure[step % figure.length], start + step * eighth, eighth * 2.5, step % 4 === 0 ? 0.65 : 0.5));
        }
        break;
      }
      case "offbeat":
        for (let b = 0; b < arrangement.beatsPerChord; b += 1) {
          voiced.forEach((midi) => notes.push(note(midi, start + b * beat + eighth, eighth * 0.7, 0.55)));
        }
        break;
    }

    const root = bassNote(chord.rootPc);
    const fifth = root + 7;
    switch (arrangement.bass) {
      case "none":
        break;
      case "root":
        notes.push(note(root, start, span * 0.95, 0.85));
        break;
      case "rootFifth":
        for (let b = 0; b < arrangement.beatsPerChord; b += 2) {
          notes.push(note(b % 4 === 0 ? root : fifth, start + b * beat, beat * 1.8, 0.85));
        }
        break;
      case "octaves":
        for (let step = 0; step < arrangement.beatsPerChord * 2; step += 1) {
          notes.push(note(step % 2 === 0 ? root : root + 12, start + step * (beat / 2), beat * 0.45, 0.8));
        }
        break;
      case "walking": {
        const next = chords[(index + 1) % chords.length];
        const target = bassNote(next.rootPc);
        const third = root + chord.intervals[1];
        const line = [root, third, fifth];
        for (let b = 0; b < arrangement.beatsPerChord; b += 1) {
          const last = b === arrangement.beatsPerChord - 1;
          // The last beat leans a half step into the next chord's root.
          const pitch = last && arrangement.beatsPerChord > 1 ? (target > root ? target - 1 : target + 1) : line[b % line.length];
          notes.push(note(pitch, start + b * beat, beat * 0.9, 0.85));
        }
        break;
      }
    }
  });

  return notes;
}

/** Length of the loop in seconds. */
export function loopLength(chords: ProgChord[], arrangement: Arrangement) {
  return chords.length * arrangement.beatsPerChord * (60 / arrangement.bpm);
}

/** The progression as songbook text, one bar per chord. */
export function toSongbookBody(chords: ProgChord[], repeats = 2) {
  const line = chords.map((chord) => `[${chord.plain}]`).join(" ");
  return Array.from({ length: repeats }, () => line).join("\n");
}
