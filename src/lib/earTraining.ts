/**
 * The exercises behind the ear trainer.
 *
 * Everything here is pure: a question is a list of notes to play, one right
 * answer and the buttons to offer. The tool owns the audio and the screen, so
 * the part that decides what is asked can be tested without a browser.
 */

export type ExerciseMode = "intervals" | "chords" | "degrees";
export type Level = "easy" | "medium" | "hard";
/** Two notes one after the other, or both at once. */
export type IntervalStyle = "melodic" | "harmonic";

export type PlayableNote = {
  midi: number;
  /** Seconds from the start of the question. */
  start: number;
  duration: number;
};

export type Choice = { id: string; label: string };

export type Question = {
  mode: ExerciseMode;
  level: Level;
  notes: PlayableNote[];
  /** The `id` of the choice that is right. */
  answer: string;
  choices: Choice[];
  /** Shown once the answer is in, e.g. "C → G". */
  detail: string;
};

export type Stats = {
  asked: number;
  correct: number;
  streak: number;
  best: number;
};

export const MODE_LABELS: Record<ExerciseMode, string> = {
  intervals: "מרווחים",
  chords: "אקורדים",
  degrees: "דרגות בסולם",
};

export const MODE_HINTS: Record<ExerciseMode, string> = {
  intervals: "שני צלילים — מה המרחק ביניהם?",
  chords: "אקורד אחד — איזה סוג הוא?",
  degrees: "אקורד הסולם ואז צליל אחד — איזו דרגה נשמעה?",
};

export const LEVEL_LABELS: Record<Level, string> = {
  easy: "מתחילים",
  medium: "בינוני",
  hard: "מתקדם",
};

/** The lowest note a question may start on, and the highest it may reach. */
const LOWEST_ROOT = 55; // G3
const HIGHEST_ROOT = 67; // G4
const NOTE_SECONDS = 0.75;
const GAP_SECONDS = 0.1;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(midi: number) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

type IntervalDefinition = { semitones: number; label: string; short: string };

export const INTERVALS: IntervalDefinition[] = [
  { semitones: 1, label: "סקונדה קטנה", short: "2מ" },
  { semitones: 2, label: "סקונדה גדולה", short: "2ג" },
  { semitones: 3, label: "טרצה קטנה", short: "3מ" },
  { semitones: 4, label: "טרצה גדולה", short: "3ג" },
  { semitones: 5, label: "קוורטה", short: "4" },
  { semitones: 6, label: "טריטון", short: "♦" },
  { semitones: 7, label: "קווינטה", short: "5" },
  { semitones: 8, label: "סקסטה קטנה", short: "6מ" },
  { semitones: 9, label: "סקסטה גדולה", short: "6ג" },
  { semitones: 10, label: "ספטימה קטנה", short: "7מ" },
  { semitones: 11, label: "ספטימה גדולה", short: "7ג" },
  { semitones: 12, label: "אוקטבה", short: "8" },
];

type ChordDefinition = { id: string; label: string; intervals: number[] };

export const CHORDS: ChordDefinition[] = [
  { id: "major", label: "מז׳ור", intervals: [0, 4, 7] },
  { id: "minor", label: "מינור", intervals: [0, 3, 7] },
  { id: "dim", label: "מוקטן", intervals: [0, 3, 6] },
  { id: "aug", label: "מוגדל", intervals: [0, 4, 8] },
  { id: "sus4", label: "sus4", intervals: [0, 5, 7] },
  { id: "dom7", label: "דומיננטי 7", intervals: [0, 4, 7, 10] },
  { id: "maj7", label: "מז׳ור 7", intervals: [0, 4, 7, 11] },
  { id: "min7", label: "מינור 7", intervals: [0, 3, 7, 10] },
];

type DegreeDefinition = { id: string; label: string; semitones: number };

/** Sol-fa over a major scale: the reference chord makes the tonic obvious. */
export const DEGREES: DegreeDefinition[] = [
  { id: "1", label: "דו (1)", semitones: 0 },
  { id: "2", label: "רה (2)", semitones: 2 },
  { id: "3", label: "מי (3)", semitones: 4 },
  { id: "4", label: "פה (4)", semitones: 5 },
  { id: "5", label: "סול (5)", semitones: 7 },
  { id: "6", label: "לה (6)", semitones: 9 },
  { id: "7", label: "סי (7)", semitones: 11 },
  { id: "8", label: "דו עליון (8)", semitones: 12 },
];

/**
 * Which answers each level puts on the table. A level is only ever a subset
 * of the one above it, so moving up adds options rather than replacing them.
 */
const POOLS: Record<ExerciseMode, Record<Level, string[]>> = {
  intervals: {
    easy: ["4", "7", "12"],
    medium: ["2", "3", "4", "5", "7", "9", "12"],
    hard: INTERVALS.map((interval) => String(interval.semitones)),
  },
  chords: {
    easy: ["major", "minor"],
    medium: ["major", "minor", "dim", "dom7"],
    hard: CHORDS.map((chord) => chord.id),
  },
  degrees: {
    easy: ["1", "3", "5"],
    medium: ["1", "2", "3", "4", "5"],
    hard: DEGREES.map((degree) => degree.id),
  },
};

export function choicesFor(mode: ExerciseMode, level: Level): Choice[] {
  const pool = POOLS[mode][level];
  if (mode === "intervals") {
    return INTERVALS.filter((interval) => pool.includes(String(interval.semitones))).map(
      (interval) => ({ id: String(interval.semitones), label: interval.label }),
    );
  }
  if (mode === "chords") {
    return CHORDS.filter((chord) => pool.includes(chord.id)).map((chord) => ({
      id: chord.id,
      label: chord.label,
    }));
  }
  return DEGREES.filter((degree) => pool.includes(degree.id)).map((degree) => ({
    id: degree.id,
    label: degree.label,
  }));
}

export type QuestionOptions = {
  mode: ExerciseMode;
  level: Level;
  intervalStyle: IntervalStyle;
};

function pick<T>(items: T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/** A root low enough that the tallest answer still fits under the ceiling. */
function rootFor(highestOffset: number, random: () => number) {
  const ceiling = Math.min(HIGHEST_ROOT, 84 - highestOffset);
  const span = Math.max(0, ceiling - LOWEST_ROOT);
  return LOWEST_ROOT + Math.round(random() * span);
}

/**
 * Builds one question. `random` is injected so a test can walk every answer
 * in the pool instead of hoping the dice land on it.
 */
export function createQuestion(
  options: QuestionOptions,
  random: () => number = Math.random,
): Question {
  const choices = choicesFor(options.mode, options.level);
  const answer = pick(choices, random);

  if (options.mode === "intervals") {
    const semitones = Number(answer.id);
    const root = rootFor(semitones, random);
    const top = root + semitones;
    const notes: PlayableNote[] =
      options.intervalStyle === "harmonic"
        ? [
            { midi: root, start: 0, duration: NOTE_SECONDS * 1.6 },
            { midi: top, start: 0, duration: NOTE_SECONDS * 1.6 },
          ]
        : [
            { midi: root, start: 0, duration: NOTE_SECONDS },
            { midi: top, start: NOTE_SECONDS + GAP_SECONDS, duration: NOTE_SECONDS },
          ];
    return {
      mode: options.mode,
      level: options.level,
      notes,
      answer: answer.id,
      choices,
      detail: `${noteName(root)} → ${noteName(top)}`,
    };
  }

  if (options.mode === "chords") {
    const chord = CHORDS.find((item) => item.id === answer.id) ?? CHORDS[0];
    const root = rootFor(Math.max(...chord.intervals), random);
    const notes = chord.intervals.map((interval) => ({
      midi: root + interval,
      start: 0,
      duration: NOTE_SECONDS * 2,
    }));
    return {
      mode: options.mode,
      level: options.level,
      notes,
      answer: answer.id,
      choices,
      detail: `${noteName(root)} ${chord.label}`,
    };
  }

  const degree = DEGREES.find((item) => item.id === answer.id) ?? DEGREES[0];
  const tonic = rootFor(Math.max(12, degree.semitones), random);
  // The tonic triad first, so the ear has a key to measure the degree against.
  const reference: PlayableNote[] = [0, 4, 7, 12].map((interval) => ({
    midi: tonic + interval,
    start: 0,
    duration: NOTE_SECONDS * 1.4,
  }));
  return {
    mode: options.mode,
    level: options.level,
    notes: [
      ...reference,
      {
        midi: tonic + degree.semitones,
        start: NOTE_SECONDS * 1.4 + GAP_SECONDS * 3,
        duration: NOTE_SECONDS,
      },
    ],
    answer: answer.id,
    choices,
    detail: `${noteName(tonic)} מז׳ור · ${degree.label}`,
  };
}

/** How long the whole question takes to play, including the last release. */
export function questionSeconds(question: Question) {
  return question.notes.reduce((end, note) => Math.max(end, note.start + note.duration), 0);
}

export const EMPTY_STATS: Stats = { asked: 0, correct: 0, streak: 0, best: 0 };

export function recordAnswer(stats: Stats, correct: boolean): Stats {
  const streak = correct ? stats.streak + 1 : 0;
  return {
    asked: stats.asked + 1,
    correct: stats.correct + (correct ? 1 : 0),
    streak,
    best: Math.max(stats.best, streak),
  };
}

export function accuracy(stats: Stats) {
  return stats.asked === 0 ? 0 : Math.round((stats.correct / stats.asked) * 100);
}

/**
 * Stats come back from localStorage, where anything could be sitting — an
 * older shape, a hand-edited number, a half-written entry. Nothing is trusted.
 */
export function normalizeStats(value: unknown): Stats {
  if (!value || typeof value !== "object") return EMPTY_STATS;
  const raw = value as Partial<Record<keyof Stats, unknown>>;
  const whole = (input: unknown) => {
    const parsed = Math.floor(Number(input));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const asked = whole(raw.asked);
  const correct = Math.min(asked, whole(raw.correct));
  const streak = Math.min(asked, whole(raw.streak));
  return { asked, correct, streak, best: Math.max(streak, Math.min(asked, whole(raw.best))) };
}
