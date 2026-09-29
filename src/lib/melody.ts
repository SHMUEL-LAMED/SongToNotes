/**
 * The melody generator. Everything here is pure and seeded, so a pair of
 * seeds and the same settings always give back the same tune.
 *
 * The melody is built the way a songwriter would sketch one, not by picking
 * random notes:
 *
 *  1. Harmony first. A chord progression is taken from progression.ts for the
 *     mood and the kind of scale, and the last chord is made to hold the
 *     tonic so the tune can come home on it.
 *  2. A skeleton of the strong beats (1 and 3 of every bar): chord tones,
 *     moving mostly by step or a third, a leap now and then that is answered
 *     by a step the other way, and drawn along a contour that suits the mood
 *     (an arch for happy, a falling line for sad…).
 *  3. The weak beats (2 and 4) fill the gaps between skeleton notes with
 *     passing and neighbour tones from the scale, so every non-chord tone
 *     resolves by step.
 *  4. Phrases: bar 1 is a motif, bar 3 repeats it as a sequence fitted to its
 *     chord, the phrase ends on a long cadence note (the tonic at the very
 *     end, an open chord tone halfway through an eight-bar tune), and the
 *     second half of an eight-bar tune restates the first — A A'.
 *  5. The rhythm is drawn separately from a small vocabulary of idiomatic
 *     half-bar cells per mood, then sampled against the pitch line: a note on
 *     a beat sounds that beat's pitch, a note between beats sounds a passing
 *     or neighbour tone between them.
 *
 * Because the rhythm and the pitch line come from two independent seeds and
 * the pitch line never looks at the rhythm, either can be kept while the
 * other is redrawn: "same rhythm, new notes" or "same notes, new rhythm".
 */
import { Midi } from "@tonejs/midi";
import { MOODS, arrange, chordFor, generateTokens, type BassStyle, type Mood as ProgressionMood, type Pattern, type ProgChord } from "./progression";
import { findScale, rootFor, scaleNotes, type ScaleId } from "./theory";
import type { DetectedNote } from "./types";

/* ---- settings ---- */

export type MelodyScale = "major" | "minor" | "pentatonic" | "minorPentatonic" | "dorian" | "harmonicMinor" | "blues";
export type MelodyMood = "calm" | "happy" | "sad" | "energetic";
export type MelodyBars = 2 | 4 | 8;

export const MELODY_SCALES: { id: MelodyScale; label: string; theory: ScaleId }[] = [
  { id: "major", label: "מז׳ור", theory: "major" },
  { id: "minor", label: "מינור", theory: "minor" },
  { id: "pentatonic", label: "פנטטוני", theory: "majorPentatonic" },
  { id: "minorPentatonic", label: "פנטטוני מינורי", theory: "minorPentatonic" },
  { id: "dorian", label: "דורי", theory: "dorian" },
  { id: "harmonicMinor", label: "מינור הרמוני", theory: "harmonicMinor" },
  { id: "blues", label: "בלוז", theory: "blues" },
];

export const MELODY_MOODS: { id: MelodyMood; label: string; bpm: number }[] = [
  { id: "calm", label: "רגוע", bpm: 76 },
  { id: "happy", label: "שמח", bpm: 112 },
  { id: "sad", label: "עצוב", bpm: 68 },
  { id: "energetic", label: "אנרגטי", bpm: 128 },
];

export type MelodySettings = {
  /** Pitch class of the tonic, 0 = C. */
  key: number;
  scale: MelodyScale;
  mood: MelodyMood;
  bars: MelodyBars;
  /** 1 (sparse) … 5 (busy). */
  density: number;
  /** Octaves the tune may span. */
  range: 1 | 2;
  rhythmSeed: number;
  noteSeed: number;
};

export function isMelodyScale(value: unknown): value is MelodyScale {
  return MELODY_SCALES.some((item) => item.id === value);
}

export function isMelodyMood(value: unknown): value is MelodyMood {
  return MELODY_MOODS.some((item) => item.id === value);
}

export function scaleDefinition(scale: MelodyScale) {
  return findScale(MELODY_SCALES.find((item) => item.id === scale)?.theory ?? "major");
}

/** The key as a musician writes it: "C", "F♯m", "C♯m". */
export function keyLabel(key: number, scale: MelodyScale) {
  const definition = scaleDefinition(scale);
  return `${rootFor(key, definition).name}${definition.minorish ? "m" : ""}`;
}

/** Reads a tonic typed as "C", "f#", "Bb", "E♭" (a trailing "m" is ignored here). */
export function parseKeyName(input: string): number | null {
  const match = input.trim().match(/^([A-Ga-g])(#|♯|b|♭)?/);
  if (!match) return null;
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const shift = match[2] === "#" || match[2] === "♯" ? 1 : match[2] === "b" || match[2] === "♭" ? -1 : 0;
  return (base[match[1].toLowerCase()] + shift + 12) % 12;
}

/* ---- seeds ---- */

/** A small, fast, well-mixed PRNG; one per stream so the streams stay independent. */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One random number fixed by its coordinates, so a choice does not depend on how many came before it. */
function hashRandom(...parts: number[]) {
  let hash = 2166136261;
  for (const part of parts) {
    hash ^= part >>> 0;
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return mulberry32(hash)();
}

// Four base-36 characters per seed: short enough to read out, 1.6M values each.
const SEED_MIN = 36 ** 3;
const SEED_MAX = 36 ** 4 - 1;

export function randomSeed(random: () => number = Math.random) {
  return SEED_MIN + Math.floor(random() * (SEED_MAX - SEED_MIN));
}

export function seedCode(rhythmSeed: number, noteSeed: number) {
  return `${rhythmSeed.toString(36)}-${noteSeed.toString(36)}`.toUpperCase();
}

export function parseSeedCode(text: string): { rhythmSeed: number; noteSeed: number } | null {
  const match = text.trim().match(/^([0-9a-z]{1,6})\s*-\s*([0-9a-z]{1,6})$/i);
  if (!match) return null;
  const rhythmSeed = parseInt(match[1], 36);
  const noteSeed = parseInt(match[2], 36);
  // Six base-36 characters reach past 2^31, which the saved state rejects
  // as a seed, so such a code played once and was gone after a reload.
  if (!(rhythmSeed > 0) || !(noteSeed > 0) || rhythmSeed >= 2 ** 31 || noteSeed >= 2 ** 31) return null;
  return { rhythmSeed, noteSeed };
}

function pickWeighted<T>(items: T[], weights: number[], random: () => number): T {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (!(total > 0)) return items[Math.floor(random() * items.length) % items.length];
  let roll = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    roll -= Math.max(0, weights[index]);
    if (roll <= 0) return items[index];
  }
  return items[items.length - 1];
}

/* ---- harmony ---- */

// Dorian's colour is the major IV; the natural-minor pools lean on ♭VI, which
// would clash with dorian's raised sixth, so it gets a pool of its own.
const DORIAN: ProgressionMood = {
  id: "dorian",
  label: "דורי",
  minor: true,
  pool: [["1", "4M", "1", "4M"], ["1", "4M", "7", "4M"], ["1", "7", "4M", "1"], ["1", "3", "4M", "7"], ["1", "5", "4M", "1"]],
};

function progressionMood(scale: MelodyScale, mood: MelodyMood): ProgressionMood {
  const byId = (id: string) => MOODS.find((item) => item.id === id) ?? MOODS[0];
  if (scale === "dorian") return DORIAN;
  // Harmonic minor exists for its major V, which the "dramatic" pool is built on.
  if (scale === "harmonicMinor") return byId("dramatic");
  if (!scaleDefinition(scale).minorish) {
    return byId({ calm: "dreamy", happy: "happy", sad: "pop", energetic: "pop" }[mood]);
  }
  return byId({ calm: "sad", happy: "epic", sad: "sad", energetic: "epic" }[mood]);
}

export function chordPcs(chord: ProgChord) {
  return new Set(chord.intervals.map((interval) => (chord.rootPc + interval) % 12));
}

/** A chord belongs if at least two notes of its triad are in the scale, so the tune has something to land on. */
function fitsScale(chord: ProgChord, scalePcs: Set<number>) {
  return chord.intervals.slice(0, 3).filter((interval) => scalePcs.has((chord.rootPc + interval) % 12)).length >= 2;
}

export type ChordSlot = { start: number; length: number; chord: ProgChord };

function buildHarmony(settings: MelodySettings, scalePcs: Set<number>) {
  const random = mulberry32(settings.noteSeed ^ 0x9e3779b9);
  const mood = progressionMood(settings.scale, settings.mood);
  const minor = mood.minor;
  // Only the calm major sound asks for sevenths; elsewhere triads keep the tune's landing notes clear.
  const sevenths = Boolean(mood.sevenths) && settings.mood === "calm";
  let tokens: string[] = ["1", "4", "5", "1"];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = generateTokens(mood, random);
    if (candidate.every((token) => fitsScale(chordFor(token, settings.key, minor, sevenths), scalePcs))) {
      tokens = candidate;
      break;
    }
  }

  // Two bars of a four-chord progression move twice a bar; otherwise one chord a bar, looped.
  const perBar = settings.bars === 2 && tokens.length === 4 ? 2 : 1;
  const slots = settings.bars * perBar;
  const length = 4 / perBar;
  const sequence = Array.from({ length: slots }, (_, index) => tokens[index % tokens.length]);
  // The tune ends on the tonic, so the last chord must hold it: IV and vi do, V does not.
  const lastChord = chordFor(sequence[slots - 1], settings.key, minor, sevenths);
  if (!chordPcs(lastChord).has(settings.key)) sequence[slots - 1] = "1";

  const chords: ChordSlot[] = sequence.map((token, index) => ({
    start: index * length,
    length,
    chord: chordFor(token, settings.key, minor, sevenths),
  }));
  return { tokens, chords };
}

/* ---- rhythm ---- */

/** Half-bar rhythm cells in sixteenths; a negative value is a rest. Each sums to 8. */
type Cell = { cell: number[]; weight: number };

const CELLS: Record<MelodyMood, Cell[]> = {
  calm: [
    { cell: [8], weight: 1.2 },
    { cell: [4, 4], weight: 1.4 },
    { cell: [6, 2], weight: 1.2 },
    { cell: [4, 2, 2], weight: 1 },
    { cell: [2, 2, 4], weight: 1 },
    { cell: [-2, 2, 4], weight: 0.6 },
    { cell: [4, -2, 2], weight: 0.5 },
    { cell: [2, 2, 2, 2], weight: 0.6 },
  ],
  happy: [
    { cell: [4, 4], weight: 1 },
    { cell: [4, 2, 2], weight: 1.3 },
    { cell: [2, 2, 4], weight: 1.2 },
    { cell: [2, 4, 2], weight: 0.9 },
    { cell: [2, 2, 2, 2], weight: 1 },
    { cell: [3, 1, 4], weight: 0.9 },
    { cell: [3, 1, 3, 1], weight: 0.7 },
    { cell: [3, 1, 2, 2], weight: 0.7 },
    { cell: [6, 2], weight: 0.8 },
    { cell: [8], weight: 0.3 },
  ],
  sad: [
    { cell: [8], weight: 1 },
    { cell: [6, 2], weight: 1.3 },
    { cell: [4, 4], weight: 1.2 },
    { cell: [4, 2, 2], weight: 1 },
    { cell: [2, 2, 4], weight: 0.9 },
    { cell: [3, 1, 4], weight: 0.8 },
    { cell: [-2, 2, 4], weight: 0.7 },
    { cell: [4, -2, 2], weight: 0.5 },
    { cell: [2, 2, 2, 2], weight: 0.5 },
  ],
  energetic: [
    { cell: [2, 2, 2, 2], weight: 1.2 },
    { cell: [2, 4, 2], weight: 1.1 },
    { cell: [3, 3, 2], weight: 1.2 },
    { cell: [1, 1, 2, 2, 2], weight: 0.9 },
    { cell: [2, 1, 1, 2, 2], weight: 0.8 },
    { cell: [2, 2, 4], weight: 0.8 },
    { cell: [1, 1, 1, 1, 4], weight: 0.7 },
    { cell: [2, 1, 1, 2, 1, 1], weight: 0.8 },
    { cell: [-2, 2, -2, 2], weight: 0.5 },
    { cell: [1, 1, 1, 1, 1, 1, 2], weight: 0.5 },
    { cell: [4, 4], weight: 0.4 },
  ],
};

/** Notes per half bar that each density asks for, from density 1 to 5. */
const DENSITY_SPAN: Record<MelodyMood, [number, number]> = {
  calm: [1, 3],
  happy: [1.5, 4],
  sad: [1.2, 3.2],
  energetic: [2.2, 5.5],
};

type RhythmEvent = { pos: number; length: number };

const onsets = (cell: number[]) => cell.filter((value) => value > 0).length;

function cellsToBar(cells: number[][]): RhythmEvent[] {
  const events: RhythmEvent[] = [];
  let pos = 0;
  for (const cell of cells) {
    for (const value of cell) {
      if (value > 0) events.push({ pos, length: value });
      pos += Math.abs(value);
    }
  }
  return events;
}

type BarRole = "motif" | "answer" | "sequence" | "half" | "restate" | "variant" | "cadence";

/**
 * What each bar does in the phrase. Two bars: a motif and its answer on the
 * tonic. Four: motif, answer, the motif again as a sequence, cadence. Eight:
 * that phrase ending open, then restated with a new line into the final cadence.
 */
function barRoles(bars: MelodyBars): BarRole[] {
  if (bars === 2) return ["motif", "cadence"];
  if (bars === 4) return ["motif", "answer", "sequence", "cadence"];
  return ["motif", "answer", "sequence", "half", "restate", "restate", "variant", "cadence"];
}

function generateRhythm(settings: MelodySettings): RhythmEvent[][] {
  const random = mulberry32(settings.rhythmSeed ^ 0x51ed27);
  const vocabulary = CELLS[settings.mood];
  const [low, high] = DENSITY_SPAN[settings.mood];
  const density = Math.max(1, Math.min(5, Math.round(settings.density)));
  const target = low + ((high - low) * (density - 1)) / 4;
  const draw = (wanted: number) =>
    pickWeighted(
      vocabulary.map((item) => item.cell),
      vocabulary.map((item) => item.weight * Math.exp(-1.3 * Math.abs(onsets(item.cell) - wanted))),
      random,
    );

  const motif = [draw(target), draw(target)];
  let answer = [draw(target * 1.1), draw(target)];
  if (answer.join() === motif.join()) answer = [draw(target * 1.1), draw(target)];
  // A cadence settles: a lighter first half, then a half note to land on.
  const cadence = [draw(Math.min(target, 3)), [8]];
  const half = [draw(Math.min(target, 3)), [8]];

  const roles = barRoles(settings.bars);
  const bars: number[][][] = [];
  roles.forEach((role, bar) => {
    // A restated bar repeats the rhythm of the bar four earlier; the motif's
    // rhythm comes back for its sequence and its variant, which is what makes
    // the tune recognisable as one idea.
    if (role === "restate") bars.push(bars[bar - 4]);
    else if (role === "answer") bars.push(answer);
    else if (role === "half") bars.push(half);
    else if (role === "cadence") bars.push(cadence);
    else bars.push(motif);
  });
  return bars.map(cellsToBar);
}

/* ---- pitch ---- */

/** Where the tonic sits for each mood: sad lower and darker, energetic brighter. */
const REGISTER: Record<MelodyMood, number> = { calm: 62, happy: 64, sad: 60, energetic: 65 };
/** How far the contour swings, as a share of half the range. */
const SWING: Record<MelodyMood, number> = { calm: 0.5, happy: 0.8, sad: 0.7, energetic: 0.9 };

/** The phrase's shape, -1 (low) … 1 (high), at position 0…1 through the phrase. */
function contour(mood: MelodyMood, p: number) {
  switch (mood) {
    case "calm":
      return Math.sin(Math.PI * p) * 0.8 - 0.25;
    case "happy":
      return Math.sin(Math.PI * p) * 1.1 - 0.35;
    case "sad":
      return 0.45 + 0.35 * Math.sin(Math.PI * p) - 1.2 * p;
    case "energetic":
      return p < 0.6 ? -0.4 + 1.4 * (p / 0.6) : 1 - 2.2 * ((p - 0.6) / 0.4);
  }
}

export function melodyRange(settings: Pick<MelodySettings, "key" | "mood" | "range">) {
  const target = REGISTER[settings.mood];
  let tonic = target - 6;
  while (((tonic % 12) + 12) % 12 !== settings.key) tonic += 1;
  // One octave runs tonic to tonic; two run from the fifth below to the fifth above the octave.
  return settings.range === 2 ? { tonic, low: tonic - 5, high: tonic + 19 } : { tonic, low: tonic, high: tonic + 12 };
}

export type MelodyNote = {
  midi: number;
  /** In beats (quarter notes) from the start. */
  start: number;
  length: number;
  velocity: number;
  bar: number;
  /** Starts on beat 1 or 3. */
  strong: boolean;
};

export type Melody = {
  settings: MelodySettings;
  notes: MelodyNote[];
  chords: ChordSlot[];
  /** The progression as drawn, before it was fitted to the bars. */
  tokens: string[];
  beats: number;
  low: number;
  high: number;
  tonic: number;
};

export function generateMelody(settings: MelodySettings): Melody {
  const definition = scaleDefinition(settings.scale);
  const scalePcs = new Set(definition.steps.map((step) => (settings.key + step) % 12));
  const { low, high, tonic } = melodyRange(settings);
  const pool: number[] = [];
  for (let midi = low; midi <= high; midi += 1) if (scalePcs.has(midi % 12)) pool.push(midi);
  const indexOf = (midi: number) => pool.indexOf(midi);
  const at = (index: number) => pool[Math.max(0, Math.min(pool.length - 1, index))];

  const { tokens, chords } = buildHarmony(settings, scalePcs);
  const chordAt = (beat: number) => chords.find((slot) => beat >= slot.start && beat < slot.start + slot.length) ?? chords[chords.length - 1];
  const tonesAt = (beat: number) => {
    const pcs = chordPcs(chordAt(beat).chord);
    const tones = pool.filter((midi) => pcs.has(midi % 12));
    return tones.length ? tones : pool;
  };
  const isChordTone = (midi: number, beat: number) => chordPcs(chordAt(beat).chord).has(midi % 12);

  const roles = barRoles(settings.bars);
  const phraseBars = settings.bars === 2 ? 2 : 4;
  const centre = (low + high) / 2;
  const swing = ((high - low) / 2) * SWING[settings.mood];
  const targetAt = (beat: number) => {
    const p = ((beat % (phraseBars * 4)) + 1) / (phraseBars * 4);
    return centre + swing * contour(settings.mood, p);
  };
  const random = mulberry32(settings.noteSeed);
  const totalBeats = settings.bars * 4;
  const guide: number[] = new Array(totalBeats).fill(tonic);

  /* Pass 1: the strong-beat skeleton, half a bar at a time. */
  let previous: number | null = null;
  let previousMove = 0;
  const place = (beat: number, midi: number) => {
    if (previous !== null) previousMove = indexOf(midi) - indexOf(previous);
    guide[beat] = midi;
    previous = midi;
  };

  const chooseStrong = (beat: number, bias?: (midi: number) => number) => {
    const tones = tonesAt(beat);
    const target = targetAt(beat);
    if (previous === null) {
      const primary = new Set([settings.key, (settings.key + definition.steps[2]) % 12, (settings.key + 7) % 12]);
      return pickWeighted(tones, tones.map((midi) => Math.exp(-Math.abs(midi - target) / 3) * (primary.has(midi % 12) ? 1.4 : 1) * (bias?.(midi) ?? 1)), random);
    }
    const from: number = previous;
    let near = tones.filter((midi) => Math.abs(midi - from) <= 9);
    if (!near.length) near = tones.filter((midi) => Math.abs(midi - from) <= 12);
    if (!near.length) near = tones;
    const stepWeights = [1, 2.6, 2, 0.9, 0.5, 0.25, 0.15, 0.1];
    const weights = near.map((midi) => {
      const move = indexOf(midi) - indexOf(from);
      const steps = Math.abs(move);
      let weight = stepWeights[Math.min(steps, stepWeights.length - 1)];
      if (steps === 0 && (settings.mood === "calm" || settings.mood === "energetic")) weight *= 1.2;
      // A leap is answered by a step back the other way.
      if (Math.abs(previousMove) >= 3 && steps > 0) {
        if (Math.sign(move) === Math.sign(previousMove)) weight *= 0.15;
        else if (steps <= 2) weight *= 3;
      }
      // The same note three strong beats running goes nowhere.
      if (previousMove === 0 && steps === 0) weight *= 0.35;
      if (Math.abs(midi - from) === 6) weight *= 0.25;
      weight *= Math.exp(-Math.abs(midi - target) / 3.5);
      return weight * (bias?.(midi) ?? 1);
    });
    return pickWeighted(near, weights, random);
  };

  /** Moves a note to the nearest chord tone, for a copied or shifted bar that no longer fits its chord. */
  const snap = (midi: number, beat: number) => {
    if (isChordTone(midi, beat)) return midi;
    const tones = tonesAt(beat);
    return tones.reduce((best, tone) => (Math.abs(tone - midi) < Math.abs(best - midi) ? tone : best), tones[0]);
  };

  const finalTonic = (from: number) => {
    const tonics = pool.filter((midi) => midi % 12 === settings.key);
    return tonics.reduce((best, midi) => (Math.abs(midi - from) < Math.abs(best - from) ? midi : best), tonics[0]);
  };

  roles.forEach((role, bar) => {
    const b0 = bar * 4;
    const b2 = b0 + 2;
    switch (role) {
      case "motif":
      case "answer":
      case "variant":
        place(b0, chooseStrong(b0));
        place(b2, chooseStrong(b2));
        break;
      case "restate": {
        const source = bar - 4;
        place(b0, snap(guide[source * 4], b0));
        place(b2, snap(guide[source * 4 + 2], b2));
        break;
      }
      case "sequence": {
        // The motif moved up or down the scale to where its strong notes fit the new chord.
        const source = [guide[0], guide[2]].map(indexOf);
        const from: number = previous ?? tonic;
        let best = 0;
        let bestScore = -Infinity;
        for (let shift = -4; shift <= 4; shift += 1) {
          const first = source[0] + shift;
          const second = source[1] + shift;
          if (first < 0 || second < 0 || first >= pool.length || second >= pool.length) continue;
          const fits = Number(isChordTone(pool[first], b0)) + Number(isChordTone(pool[second], b2));
          const jump = Math.abs(pool[first] - from);
          const score = fits * 3 - jump / 4 - (jump > 9 ? 3 : 0) - Math.abs(pool[first] - targetAt(b0)) / 6 + random() * 0.6 - (shift === 0 ? 0.4 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = shift;
          }
        }
        place(b0, snap(at(source[0] + best), b0));
        place(b2, snap(at(source[1] + best), b2));
        break;
      }
      case "half": {
        place(b0, chooseStrong(b0));
        // Halfway: rest on a chord tone that is not the tonic, so the tune clearly goes on.
        const from: number = previous ?? tonic;
        place(b2, chooseStrong(b2, (midi) => (midi % 12 === settings.key ? 0.3 : 2) * (Math.abs(midi - from) <= 7 ? 1 : 0.2)));
        guide[b0 + 3] = guide[b2];
        break;
      }
      case "cadence": {
        // Leaning towards home already on beat 1, then the tonic on beat 3.
        // Not the tonic itself yet, or the ending has nowhere to arrive from.
        place(b0, chooseStrong(b0, (midi) => (midi % 12 === settings.key ? 0.35 : 1) * Math.exp(-Math.abs(midi - finalTonic(midi)) / 3)));
        place(b2, finalTonic(guide[b0]));
        guide[b0 + 3] = guide[b2];
        break;
      }
    }
  });

  /* Pass 2: the weak beats, between the skeleton notes around them. */
  const sourceBar = (bar: number) => (roles[bar] === "restate" ? bar - 4 : roles[bar] === "sequence" ? 0 : bar);
  const arpeggio = settings.mood === "energetic" ? 0.3 : settings.mood === "happy" ? 0.2 : 0.1;
  for (let beat = 1; beat < totalBeats; beat += 2) {
    const bar = Math.floor(beat / 4);
    const role = roles[bar];
    if (beat % 4 === 3 && (role === "half" || role === "cadence")) continue;
    const a = indexOf(guide[beat - 1]);
    const b = beat + 1 < totalBeats ? indexOf(guide[beat + 1]) : a;
    const diff = b - a;
    const roll = hashRandom(settings.noteSeed, 7, sourceBar(bar), beat % 4);
    let index: number;
    if (role === "cadence" && beat % 4 === 1 && Math.abs(diff) <= 1) {
      // The step into the final note: the note above it, or the leading note below.
      const up = roll < 0.65;
      index = b + (up ? (b + 1 < pool.length ? 1 : -1) : b - 1 >= 0 ? -1 : 1);
    } else if (Math.abs(diff) >= 2) {
      index = a + Math.sign(diff) * Math.floor(Math.abs(diff) / 2);
    } else if (diff !== 0) {
      index = roll < 0.45 ? a : roll < 0.8 ? a - Math.sign(diff) : b;
    } else if (roll < arpeggio) {
      // A skip to another chord tone close by, for some lift.
      const tones = tonesAt(beat).filter((midi) => midi !== pool[a] && Math.abs(midi - pool[a]) <= 5);
      index = tones.length ? indexOf(tones[Math.floor(roll * 1000) % tones.length]) : a + 1;
    } else {
      index = roll < 0.6 ? a + 1 : roll < 0.85 ? a - 1 : a;
    }
    guide[beat] = at(index);
  }

  /* The rhythm, sampled against the line. */
  const rhythm = generateRhythm(settings);
  const notes: MelodyNote[] = [];
  rhythm.forEach((events, bar) => {
    for (const event of events) {
      const beat = bar * 4 + Math.floor(event.pos / 4);
      const sub = event.pos % 4;
      let midi: number;
      if (sub === 0) {
        midi = guide[beat];
      } else {
        // Between beats: a passing tone on the way to the next beat's note, or a neighbour around it.
        const a = indexOf(guide[beat]);
        const b = beat + 1 < totalBeats ? indexOf(guide[beat + 1]) : a;
        const diff = b - a;
        // One choice per beat, so the sixteenths inside a beat make one figure
        // (a turn, a run) rather than zigzagging between unrelated neighbours.
        const roll = hashRandom(settings.noteSeed, 11, sourceBar(bar), beat % 4);
        const detail = hashRandom(settings.noteSeed, 13, sourceBar(bar), event.pos);
        let index: number;
        if (Math.abs(diff) >= 2) {
          index = a + Math.sign(diff) * Math.min(Math.abs(diff) - 1, Math.max(1, Math.round((Math.abs(diff) * sub) / 4)));
        } else if (diff !== 0) {
          // Early in the beat dip away and come back; late in it, anticipate the next note.
          const away = a - Math.sign(diff);
          if (sub === 1) index = roll < 0.5 ? away : b;
          else if (sub === 2) index = detail < 0.55 ? b : roll < 0.7 ? a : away;
          else index = b;
        } else {
          const direction = roll < 0.6 ? 1 : -1;
          index = sub === 2 && detail < 0.4 ? a : a + direction;
        }
        midi = at(index);
      }
      const strong = event.pos % 8 === 0;
      const onBeat = sub === 0;
      notes.push({
        midi,
        start: bar * 4 + event.pos / 4,
        length: event.length / 4,
        velocity: strong ? 0.9 : onBeat ? 0.78 : 0.66,
        bar,
        strong,
      });
    }
  });

  // A gap between notes of more than an octave is folded back an octave;
  // the pitch class, and so the chord-tone and the tonic, stay.
  for (let index = 1; index < notes.length; index += 1) {
    const gap = notes[index].midi - notes[index - 1].midi;
    if (Math.abs(gap) > 12) notes[index].midi -= Math.sign(gap) * 12;
  }
  if (notes.length) notes[notes.length - 1].velocity = 0.85;

  return { settings, notes, chords, tokens, beats: totalBeats, low, high, tonic };
}

/* ---- playback and export ---- */

const ARTICULATION: Record<MelodyMood, number> = { calm: 0.97, happy: 0.88, sad: 0.96, energetic: 0.78 };

/** The melody in seconds, for the synth and the piano. */
export function melodyToNotes(melody: Melody, bpm: number): DetectedNote[] {
  const beat = 60 / bpm;
  const hold = ARTICULATION[melody.settings.mood];
  return melody.notes.map((note) => ({
    midi: note.midi,
    start: note.start * beat,
    duration: note.length * beat * hold,
    confidence: note.velocity,
  }));
}

const ACCOMPANIMENT: Record<MelodyMood, { pattern: Pattern; bass: BassStyle }> = {
  calm: { pattern: "block", bass: "root" },
  happy: { pattern: "arpUpDown", bass: "rootFifth" },
  sad: { pattern: "broken", bass: "root" },
  energetic: { pattern: "pulse", bass: "octaves" },
};

/** The chords under the melody, as the progression generator plays them, a little softer. */
export function accompanimentNotes(melody: Melody, bpm: number): DetectedNote[] {
  const style = ACCOMPANIMENT[melody.settings.mood];
  return arrange(
    melody.chords.map((slot) => slot.chord),
    { bpm, beatsPerChord: melody.chords[0]?.length ?? 4, pattern: style.pattern, bass: style.bass },
  ).map((note) => ({ ...note, confidence: note.confidence * 0.75 }));
}

/** Seconds from the first beat to the end of the last bar. */
export function melodyLength(melody: Melody, bpm: number) {
  return melody.beats * (60 / bpm);
}

/** A Standard MIDI File with the melody on one track and the chords on another. */
export function melodyToMidi(melody: Melody, bpm: number, withChords: boolean) {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  midi.header.name = "Melody";
  const lead = midi.addTrack();
  lead.name = "Melody";
  lead.channel = 0;
  for (const note of melodyToNotes(melody, bpm)) {
    lead.addNote({ midi: note.midi, time: note.start, duration: Math.max(0.02, note.duration), velocity: note.confidence });
  }
  if (withChords) {
    const chords = midi.addTrack();
    chords.name = "Chords";
    chords.channel = 1;
    for (const note of accompanimentNotes(melody, bpm)) {
      chords.addNote({ midi: note.midi, time: note.start, duration: Math.max(0.02, note.duration), velocity: Math.min(1, note.confidence) });
    }
  }
  return Uint8Array.from(midi.toArray());
}

/** Note names spelled for the key: E♭ in B♭ major, D♯ in B major. */
export function noteNamer(settings: Pick<MelodySettings, "key" | "scale">) {
  const spelled = new Map(scaleNotes(settings.key, scaleDefinition(settings.scale)).map((note) => [note.pc, note.name]));
  const fallback = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  return (midi: number) => {
    const name = spelled.get(midi % 12) ?? fallback[midi % 12];
    let octave = Math.floor(midi / 12) - 1;
    // B♯ belongs to the octave below its sounding C, C♭ to the one above its B.
    if (name.startsWith("B♯")) octave -= 1;
    if (name.startsWith("C♭")) octave += 1;
    return `${name}${octave}`;
  };
}
