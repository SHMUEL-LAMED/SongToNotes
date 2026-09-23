/**
 * Music theory for the explorer: scales and modes spelled the way a musician
 * would write them (one letter per degree, so E♭ major has an A♭ and not a
 * G♯), the chords each degree of a scale builds, the circle of fifths, and
 * where the notes fall on a guitar neck.
 */

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

/** The twelve roots, spelled as their major keys usually are. */
export const ROOTS: { name: string; pc: number; letter: number }[] = [
  { name: "C", pc: 0, letter: 0 },
  { name: "D♭", pc: 1, letter: 1 },
  { name: "D", pc: 2, letter: 1 },
  { name: "E♭", pc: 3, letter: 2 },
  { name: "E", pc: 4, letter: 2 },
  { name: "F", pc: 5, letter: 3 },
  { name: "F♯", pc: 6, letter: 3 },
  { name: "G", pc: 7, letter: 4 },
  { name: "A♭", pc: 8, letter: 5 },
  { name: "A", pc: 9, letter: 5 },
  { name: "B♭", pc: 10, letter: 6 },
  { name: "B", pc: 11, letter: 6 },
];

/** Minor keys read better with sharps on these roots: C♯m, F♯m, G♯m. */
const MINOR_ROOTS: Record<number, { name: string; letter: number }> = {
  1: { name: "C♯", letter: 0 },
  8: { name: "G♯", letter: 4 },
};

export type ScaleId =
  | "major"
  | "minor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "harmonicMinor"
  | "melodicMinor"
  | "majorPentatonic"
  | "minorPentatonic"
  | "blues";

export type ScaleDefinition = {
  id: ScaleId;
  label: string;
  /** Semitones above the root. */
  steps: number[];
  /** Degree numbers as written: 1 2 ♭3 … */
  mood: string;
  minorish: boolean;
};

export const SCALES: ScaleDefinition[] = [
  { id: "major", label: "מז׳ור (יוני)", steps: [0, 2, 4, 5, 7, 9, 11], mood: "שמח, יציב ופתוח", minorish: false },
  { id: "minor", label: "מינור טבעי (אאולי)", steps: [0, 2, 3, 5, 7, 8, 10], mood: "עצוב, מופנם", minorish: true },
  { id: "dorian", label: "דורי", steps: [0, 2, 3, 5, 7, 9, 10], mood: "מינור עם קריצה — ג׳אז, פאנק, סנטנה", minorish: true },
  { id: "phrygian", label: "פריגי", steps: [0, 1, 3, 5, 7, 8, 10], mood: "ספרדי, מזרחי, דרמטי", minorish: true },
  { id: "lydian", label: "לידי", steps: [0, 2, 4, 6, 7, 9, 11], mood: "חלומי ומרחף — פסקולים", minorish: false },
  { id: "mixolydian", label: "מיקסולידי", steps: [0, 2, 4, 5, 7, 9, 10], mood: "מז׳ור מחוספס — רוק ובלוז", minorish: false },
  { id: "locrian", label: "לוקרי", steps: [0, 1, 3, 5, 6, 8, 10], mood: "לא יציב ומתוח", minorish: true },
  { id: "harmonicMinor", label: "מינור הרמוני", steps: [0, 2, 3, 5, 7, 8, 11], mood: "מזרחי וקלאסי, עם משיכה חזקה לטוניקה", minorish: true },
  { id: "melodicMinor", label: "מינור מלודי", steps: [0, 2, 3, 5, 7, 9, 11], mood: "מינור עם עלייה חלקה — ג׳אז", minorish: true },
  { id: "majorPentatonic", label: "פנטטוני מז׳ור", steps: [0, 2, 4, 7, 9], mood: "פשוט ובטוח — קאנטרי ופופ", minorish: false },
  { id: "minorPentatonic", label: "פנטטוני מינור", steps: [0, 3, 5, 7, 10], mood: "סולם הסולו של הרוק והבלוז", minorish: true },
  { id: "blues", label: "בלוז", steps: [0, 3, 5, 6, 7, 10], mood: "פנטטוני מינור עם ה״בלו נוט״", minorish: true },
];

export function findScale(id: string) {
  return SCALES.find((scale) => scale.id === id) ?? SCALES[0];
}

function accidental(offset: number) {
  if (offset === 0) return "";
  if (offset === 1) return "♯";
  if (offset === 2) return "𝄪";
  if (offset === -1) return "♭";
  if (offset === -2) return "𝄫";
  return "";
}

function spell(letter: number, pc: number) {
  const natural = LETTER_PC[((letter % 7) + 7) % 7];
  let offset = (((pc - natural) % 12) + 12) % 12;
  if (offset > 6) offset -= 12;
  return `${LETTERS[((letter % 7) + 7) % 7]}${accidental(offset)}`;
}

/** The root as it is spelled for this kind of scale. */
export function rootFor(pc: number, scale: ScaleDefinition) {
  const minorRoot = scale.minorish ? MINOR_ROOTS[pc] : undefined;
  const root = ROOTS.find((item) => item.pc === pc) ?? ROOTS[0];
  return minorRoot ? { ...root, ...minorRoot } : root;
}

const DEGREE_NAMES = ["1", "♭2", "2", "♭3", "3", "4", "♯4", "5", "♭6", "6", "♭7", "7"];

export type ScaleNote = { name: string; pc: number; semitones: number; degree: string };

/** The notes of a scale on a root, spelled. */
export function scaleNotes(rootPc: number, scale: ScaleDefinition): ScaleNote[] {
  const root = rootFor(rootPc, scale);
  const heptatonic = scale.steps.length === 7;
  return scale.steps.map((semitones, index) => {
    const pc = (rootPc + semitones) % 12;
    let name: string;
    if (heptatonic) {
      name = spell(root.letter + index, pc);
    } else {
      // Five- and six-note scales skip letters, so they borrow the spelling
      // of the parent major or minor scale.
      const parent = scale.minorish ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
      const letterIndex = parent.indexOf(semitones);
      // The one note outside both parents is the blues ♭5, written as a flat fifth.
      name = letterIndex >= 0 ? spell(root.letter + letterIndex, pc) : spell(root.letter + 4, pc);
    }
    return { name, pc, semitones, degree: DEGREE_NAMES[semitones] };
  });
}

/** Whole and half steps between neighbouring notes, closing the octave. */
export function stepPattern(scale: ScaleDefinition) {
  return scale.steps.map((step, index) => {
    const next = index + 1 < scale.steps.length ? scale.steps[index + 1] : 12;
    return next - step;
  });
}

export type ChordQuality = "major" | "minor" | "diminished" | "augmented" | "maj7" | "7" | "m7" | "m7b5" | "dim7" | "mMaj7" | "maj7#5";

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  major: "",
  minor: "m",
  diminished: "°",
  augmented: "+",
  maj7: "maj7",
  "7": "7",
  m7: "m7",
  m7b5: "m7♭5",
  dim7: "°7",
  mMaj7: "m(maj7)",
  "maj7#5": "maj7♯5",
};

const QUALITY_LABEL: Record<ChordQuality, string> = {
  major: "מז׳ור",
  minor: "מינור",
  diminished: "מוקטן",
  augmented: "מוגדל",
  maj7: "מז׳ור 7",
  "7": "דומיננט 7",
  m7: "מינור 7",
  m7b5: "חצי מוקטן",
  dim7: "מוקטן 7",
  mMaj7: "מינור־מז׳ור 7",
  "maj7#5": "מז׳ור 7 מוגדל",
};

function quality(intervals: number[]): ChordQuality {
  const key = intervals.join(",");
  switch (key) {
    case "4,7":
      return "major";
    case "3,7":
      return "minor";
    case "3,6":
      return "diminished";
    case "4,8":
      return "augmented";
    case "4,7,11":
      return "maj7";
    case "4,7,10":
      return "7";
    case "3,7,10":
      return "m7";
    case "3,6,10":
      return "m7b5";
    case "3,6,9":
      return "dim7";
    case "3,7,11":
      return "mMaj7";
    case "4,8,11":
      return "maj7#5";
    default:
      return intervals[0] === 3 ? "minor" : "major";
  }
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export type DiatonicChord = {
  degree: number;
  roman: string;
  name: string;
  quality: ChordQuality;
  qualityLabel: string;
  notes: string[];
  /** MIDI notes for playback, voiced upward from the octave around middle C. */
  midi: number[];
};

/** The chord built on each degree of a seven-note scale, as triads or sevenths. */
export function diatonicChords(rootPc: number, scale: ScaleDefinition, sevenths: boolean): DiatonicChord[] {
  if (scale.steps.length !== 7) return [];
  const notes = scaleNotes(rootPc, scale);
  const base = 48 + rootPc;
  return notes.map((note, index) => {
    const size = sevenths ? 4 : 3;
    const members = Array.from({ length: size }, (_, stack) => index + stack * 2);
    const semis = members.map((member) => scale.steps[member % 7] + 12 * Math.floor(member / 7));
    const intervals = semis.slice(1).map((value) => value - semis[0]);
    const kind = quality(intervals);
    const minorLike = ["minor", "diminished", "m7", "m7b5", "dim7", "mMaj7"].includes(kind);
    let roman = minorLike ? ROMAN[index].toLowerCase() : ROMAN[index];
    if (kind === "diminished" || kind === "dim7") roman += "°";
    if (kind === "m7b5") roman += "ø";
    if (kind === "augmented" || kind === "maj7#5") roman += "+";
    if (sevenths && !["m7b5", "dim7"].includes(kind)) roman += kind === "maj7" || kind === "mMaj7" || kind === "maj7#5" ? "maj7" : "7";
    if (sevenths && (kind === "dim7" || kind === "m7b5")) roman += "7";
    return {
      degree: index + 1,
      roman,
      name: `${note.name}${QUALITY_SUFFIX[kind]}`,
      quality: kind,
      qualityLabel: QUALITY_LABEL[kind],
      notes: members.map((member) => notes[member % 7].name),
      midi: semis.map((value) => base + value),
    };
  });
}

/** Well-worn progressions, as degrees of the scale (1-based). */
export const PROGRESSIONS: { id: string; label: string; degrees: number[]; minor?: boolean }[] = [
  { id: "pop", label: "הפופ הנצחי · I–V–vi–IV", degrees: [1, 5, 6, 4] },
  { id: "fifties", label: "שנות ה־50 · I–vi–IV–V", degrees: [1, 6, 4, 5] },
  { id: "jazz", label: "ג׳אז · ii–V–I", degrees: [2, 5, 1] },
  { id: "sad", label: "מלנכולי · vi–IV–I–V", degrees: [6, 4, 1, 5] },
  { id: "canon", label: "הקאנון של פכלבל", degrees: [1, 5, 6, 3, 4, 1, 4, 5] },
  { id: "andalusian", label: "אנדלוסי · i–VII–VI–V", degrees: [1, 7, 6, 5], minor: true },
  { id: "minorPop", label: "מינור · i–VI–III–VII", degrees: [1, 6, 3, 7], minor: true },
];

/** The circle of fifths: major keys clockwise from C, with their relative minors. */
export const CIRCLE: { major: string; minor: string; pc: number; accidentals: string }[] = [
  { major: "C", minor: "Am", pc: 0, accidentals: "ללא סימנים" },
  { major: "G", minor: "Em", pc: 7, accidentals: "דיאז אחד" },
  { major: "D", minor: "Bm", pc: 2, accidentals: "2 דיאזים" },
  { major: "A", minor: "F♯m", pc: 9, accidentals: "3 דיאזים" },
  { major: "E", minor: "C♯m", pc: 4, accidentals: "4 דיאזים" },
  { major: "B", minor: "G♯m", pc: 11, accidentals: "5 דיאזים" },
  { major: "F♯", minor: "D♯m", pc: 6, accidentals: "6 דיאזים" },
  { major: "D♭", minor: "B♭m", pc: 1, accidentals: "5 במולים" },
  { major: "A♭", minor: "Fm", pc: 8, accidentals: "4 במולים" },
  { major: "E♭", minor: "Cm", pc: 3, accidentals: "3 במולים" },
  { major: "B♭", minor: "Gm", pc: 10, accidentals: "2 במולים" },
  { major: "F", minor: "Dm", pc: 5, accidentals: "במול אחד" },
];

/** Where the key of a scale sits on the circle: its own major, or its relative major. */
export function circleIndex(rootPc: number, scale: ScaleDefinition) {
  // Each mode borrows the key signature of the major scale it is a rotation of.
  const offsets: Partial<Record<ScaleId, number>> = {
    major: 0,
    minor: 3,
    dorian: -2,
    phrygian: -4,
    lydian: -5,
    mixolydian: -7,
    locrian: 1,
    harmonicMinor: 3,
    melodicMinor: 3,
    majorPentatonic: 0,
    minorPentatonic: 3,
    blues: 3,
  };
  const parentPc = (((rootPc + (offsets[scale.id] ?? 0)) % 12) + 12) % 12;
  return CIRCLE.findIndex((item) => item.pc === parentPc);
}

/** Standard guitar tuning, low string first, as MIDI notes. */
export const GUITAR_STRINGS = [40, 45, 50, 55, 59, 64];
export const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
