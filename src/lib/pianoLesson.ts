/**
 * A lesson for the virtual piano: the notes song-to-notes found, played on
 * the keys so a visitor can learn the song. The notes are taken from the
 * score on screen — the same bars, transposition and melody-or-everything
 * choice as the sheet — timed in seconds, and handed to the piano through
 * the tab's session storage, so a reload keeps the lesson.
 */
import type { Score } from "./score";

export type LessonNote = { midi: number; start: number; duration: number };
export type PianoLesson = { title: string; notes: LessonNote[] };
/** Notes that start together: one thing to play. */
export type LessonStep = { start: number; midis: number[] };

const KEY = "musictools.piano-lesson.v1";
/** Seconds before the first note, for it to fall into view. */
export const LEAD_IN = 2;
/** Notes starting this close together are played together. */
const TOGETHER = 0.04;

/** The score's notes in seconds, held notes joined across their ties, starting after the lead-in. */
export function lessonFromScore(score: Score): LessonNote[] {
  const step = 60 / score.bpm / score.stepsPerBeat;
  const notes: LessonNote[] = [];
  for (const staff of score.staves) {
    // A tied event continues the notes still sounding from the one before.
    let open: LessonNote[] = [];
    staff.measures.forEach((events, measure) => {
      for (const event of events) {
        const start = (measure * score.stepsPerMeasure + event.offset) * step;
        const length = event.length * step;
        if (!event.midis.length) {
          open = [];
          continue;
        }
        if (event.tiedFrom && open.length) {
          for (const note of open) note.duration += length;
        } else {
          open = event.midis.map((midi) => ({ midi, start, duration: length }));
          notes.push(...open);
        }
        if (!event.tiedTo) open = [];
      }
    });
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const first = notes[0]?.start ?? 0;
  return notes.map((note) => ({ ...note, start: round(note.start - first + LEAD_IN), duration: round(note.duration) }));
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The lesson as steps: notes that start together, in order. */
export function lessonSteps(notes: LessonNote[]): LessonStep[] {
  const steps: LessonStep[] = [];
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const last = steps[steps.length - 1];
    if (last && note.start - last.start <= TOGETHER) {
      if (!last.midis.includes(note.midi)) last.midis.push(note.midi);
    } else {
      steps.push({ start: note.start, midis: [note.midi] });
    }
  }
  return steps;
}

/**
 * The keyboard that shows a lesson — the octave it starts at (its lowest C is
 * C of that octave) and two or three octaves — and the notes, any outside it
 * moved by octaves onto it.
 */
export function fitKeyboard(notes: LessonNote[]): { octave: number; octaves: 2 | 3; notes: LessonNote[] } {
  if (!notes.length) return { octave: 3, octaves: 3, notes };
  const midis = notes.map((note) => note.midi);
  const low = Math.min(...midis);
  const high = Math.max(...midis);
  let lowest = 12 * Math.floor(low / 12);
  let octaves: 2 | 3 = high - lowest <= 24 ? 2 : 3;
  if (high - lowest > 36) {
    // Wider than the keys: the three octaves that hold the most notes, the rest moved in.
    let best = { lowest, count: -1 };
    for (let start = 12 * Math.floor(low / 12); start <= high; start += 12) {
      const count = midis.filter((midi) => midi >= start && midi <= start + 36).length;
      if (count > best.count) best = { lowest: start, count };
    }
    lowest = best.lowest;
    octaves = 3;
  }
  const top = lowest + octaves * 12;
  const fold = (midi: number) => {
    let value = midi;
    while (value < lowest) value += 12;
    while (value > top) value -= 12;
    return value;
  };
  const octave = Math.max(0, Math.min(7, lowest / 12 - 1));
  return { octave, octaves, notes: notes.map((note) => ({ ...note, midi: fold(note.midi) })) };
}

export function savePianoLesson(lesson: PianoLesson) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(lesson));
  } catch {
    // Without session storage the lesson cannot cross to the piano.
  }
}

/** The lesson waiting in this tab, if there is a sound one. */
export function readPianoLesson(): PianoLesson | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<PianoLesson>) : null;
    if (!parsed || !Array.isArray(parsed.notes)) return null;
    const notes = parsed.notes.filter(
      (note): note is LessonNote =>
        typeof note?.midi === "number" && typeof note.start === "number" && typeof note.duration === "number" && note.duration > 0,
    );
    return notes.length ? { title: typeof parsed.title === "string" ? parsed.title : "", notes } : null;
  } catch {
    return null;
  }
}

export function clearPianoLesson() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
