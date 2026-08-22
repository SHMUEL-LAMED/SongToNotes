import { detectChords } from "./chords";
import { keyToAbc, spellPitch } from "./key";
import type { Score, ScoreEvent } from "./score";

const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

/** What the key signature already does to a letter, before any accidental. */
export function keyAlterFor(letter: string, fifths: number) {
  if (fifths > 0) {
    const index = SHARP_ORDER.indexOf(letter);
    return index >= 0 && index < fifths ? 1 : 0;
  }
  if (fifths < 0) {
    const index = FLAT_ORDER.indexOf(letter);
    return index >= 0 && index < -fifths ? -1 : 0;
  }
  return 0;
}

function accidentalMark(alter: number) {
  if (alter === 0) return "=";
  if (alter === 1) return "^";
  if (alter === 2) return "^^";
  if (alter === -1) return "_";
  if (alter === -2) return "__";
  return "";
}

function abcOctave(letter: string, octave: number) {
  if (octave >= 5) return letter.toLowerCase() + "'".repeat(octave - 5);
  if (octave < 4) return letter + ",".repeat(4 - octave);
  return letter;
}

function durationSuffix(steps: number) {
  return steps === 1 ? "" : String(steps);
}

/**
 * Tracks accidentals the way a reader does: one written accidental holds for
 * that letter and octave until the barline, so the same sharp is not repeated
 * on every note.
 */
class MeasureAccidentals {
  private state = new Map<string, number>();
  private fifths: number;

  constructor(fifths: number) {
    this.fifths = fifths;
  }

  reset() {
    this.state.clear();
  }

  markFor(letter: string, octave: number, alter: number) {
    const slot = `${letter}${octave}`;
    const current = this.state.has(slot)
      ? this.state.get(slot)!
      : keyAlterFor(letter, this.fifths);
    if (current === alter) return "";
    this.state.set(slot, alter);
    return accidentalMark(alter);
  }
}

function renderEvent(
  event: ScoreEvent,
  fifths: number,
  accidentals: MeasureAccidentals,
) {
  if (!event.midis.length) {
    return `z${durationSuffix(event.length)}`;
  }

  const pitches = event.midis.map((midi) => {
    const spelled = spellPitch(midi, fifths);
    const mark = accidentals.markFor(spelled.letter, spelled.octave, spelled.alter);
    return mark + abcOctave(spelled.letter, spelled.octave);
  });

  const body =
    pitches.length === 1
      ? pitches[0]
      : `[${pitches.join("")}]`;
  return `${body}${durationSuffix(event.length)}${event.tiedTo ? "-" : ""}`;
}

export type AbcOptions = {
  /** Print chord symbols above the top staff. */
  withChords?: boolean;
  measuresPerLine?: number;
};

export function scoreToAbc(score: Score, options: AbcOptions = {}) {
  const measuresPerLine = options.measuresPerLine ?? 4;
  const fifths = score.key.fifths;
  const unitDenominator = score.stepsPerBeat * score.meter.beatType;
  const chords = options.withChords ? detectChords(score) : [];

  const staffLines = score.staves.map((staff, staffIndex) => {
    const accidentals = new MeasureAccidentals(fifths);
    return staff.measures.map((measure, measureIndex) => {
      accidentals.reset();
      const tokens = measure.map((event) => {
        const rendered = renderEvent(event, fifths, accidentals);
        if (staffIndex > 0) return rendered;
        // Chord symbols attach to the note that starts the window they cover.
        const mark = chords.find(
          (chord) =>
            chord.measure === measureIndex && chord.offset === event.offset,
        );
        return mark ? `"${mark.symbol}"${rendered}` : rendered;
      });
      return tokens.join(" ");
    });
  });

  const safeTitle =
    score.title.replace(/[\r\n]/g, " ").trim().slice(0, 120) || "SongToNotes";

  const header = [
    "X:1",
    `T:${safeTitle}`,
    `M:${score.meter.beats}/${score.meter.beatType}`,
    `L:1/${unitDenominator}`,
    `Q:1/4=${Math.round(score.bpm)}`,
  ];

  const lines: string[] = [];

  if (score.staves.length > 1) {
    header.push("%%score {1 | 2}");
    score.staves.forEach((staff, index) => {
      header.push(`V:${index + 1} clef=${staff.clef}`);
    });
    header.push(`K:${keyToAbc(score.key)}`);

    for (
      let start = 0;
      start < score.measureCount;
      start += measuresPerLine
    ) {
      score.staves.forEach((_, staffIndex) => {
        const slice = staffLines[staffIndex].slice(start, start + measuresPerLine);
        lines.push(`V:${staffIndex + 1}`);
        lines.push(`| ${slice.join(" | ")} |`);
      });
    }
  } else {
    header.push(`K:${keyToAbc(score.key)} clef=${score.staves[0].clef}`);
    for (
      let start = 0;
      start < score.measureCount;
      start += measuresPerLine
    ) {
      const slice = staffLines[0].slice(start, start + measuresPerLine);
      lines.push(`| ${slice.join(" | ")} |`);
    }
  }

  return [...header, ...lines].join("\n");
}
