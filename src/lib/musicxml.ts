import { keyAlterFor } from "./abc";
import { spellPitch } from "./key";
import { noteValue, type Score, type ScoreEvent } from "./score";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const ACCIDENTAL_NAMES: Record<number, string> = {
  [-2]: "flat-flat",
  [-1]: "flat",
  0: "natural",
  1: "sharp",
  2: "sharp-sharp",
};

class MeasureAccidentals {
  private state = new Map<string, number>();
  private fifths: number;

  constructor(fifths: number) {
    this.fifths = fifths;
  }

  reset() {
    this.state.clear();
  }

  /** Returns the accidental to print, or null when none is needed. */
  needsAccidental(letter: string, octave: number, alter: number) {
    const slot = `${letter}${octave}`;
    const current = this.state.has(slot)
      ? this.state.get(slot)!
      : keyAlterFor(letter, this.fifths);
    if (current === alter) return null;
    this.state.set(slot, alter);
    return ACCIDENTAL_NAMES[alter] ?? null;
  }
}

function renderEvent(
  event: ScoreEvent,
  score: Score,
  staffNumber: number,
  totalStaves: number,
  accidentals: MeasureAccidentals,
) {
  const { type, dots } = noteValue(
    event.length,
    score.stepsPerBeat,
    score.meter.beatType,
  );
  const typeTag = type ? `<type>${type}</type>` : "";
  const dotTags = "<dot/>".repeat(dots);
  const staffTag = totalStaves > 1 ? `<staff>${staffNumber}</staff>` : "";
  const voiceTag = `<voice>${staffNumber}</voice>`;

  if (!event.midis.length) {
    return `<note><rest/><duration>${event.length}</duration>${voiceTag}${typeTag}${dotTags}${staffTag}</note>`;
  }

  return event.midis
    .map((midi, index) => {
      const spelled = spellPitch(midi, score.key.fifths);
      const accidental = accidentals.needsAccidental(
        spelled.letter,
        spelled.octave,
        spelled.alter,
      );
      const chordTag = index > 0 ? "<chord/>" : "";
      const alterTag = spelled.alter ? `<alter>${spelled.alter}</alter>` : "";
      const accidentalTag = accidental
        ? `<accidental>${accidental}</accidental>`
        : "";

      // A tie is both a sounding instruction and a printed slur, so both the
      // <tie> and <tied> forms are emitted.
      const ties: string[] = [];
      const tied: string[] = [];
      if (event.tiedFrom) {
        ties.push('<tie type="stop"/>');
        tied.push('<tied type="stop"/>');
      }
      if (event.tiedTo) {
        ties.push('<tie type="start"/>');
        tied.push('<tied type="start"/>');
      }
      const notations = tied.length
        ? `<notations>${tied.join("")}</notations>`
        : "";

      return (
        `<note>${chordTag}` +
        `<pitch><step>${spelled.letter}</step>${alterTag}<octave>${spelled.octave}</octave></pitch>` +
        `<duration>${event.length}</duration>` +
        `${ties.join("")}` +
        `${voiceTag}${typeTag}${dotTags}${accidentalTag}${staffTag}${notations}` +
        `</note>`
      );
    })
    .join("");
}

export function scoreToMusicXml(score: Score) {
  const totalStaves = score.staves.length;
  // MusicXML divisions are per quarter note.
  const divisions = (score.stepsPerBeat * score.meter.beatType) / 4;
  const accidentalTrackers = score.staves.map(
    () => new MeasureAccidentals(score.key.fifths),
  );

  const measures: string[] = [];
  for (let index = 0; index < score.measureCount; index += 1) {
    const parts: string[] = [];

    if (index === 0) {
      const clefs = score.staves
        .map((staff, staffIndex) => {
          const number = totalStaves > 1 ? ` number="${staffIndex + 1}"` : "";
          return staff.clef === "bass"
            ? `<clef${number}><sign>F</sign><line>4</line></clef>`
            : `<clef${number}><sign>G</sign><line>2</line></clef>`;
        })
        .join("");
      parts.push(
        `<attributes><divisions>${divisions}</divisions>` +
          `<key><fifths>${score.key.fifths}</fifths><mode>${score.key.mode}</mode></key>` +
          `<time><beats>${score.meter.beats}</beats><beat-type>${score.meter.beatType}</beat-type></time>` +
          (totalStaves > 1 ? `<staves>${totalStaves}</staves>` : "") +
          `${clefs}</attributes>`,
      );
      parts.push(
        `<direction placement="above"><direction-type><metronome parentheses="no">` +
          `<beat-unit>quarter</beat-unit><per-minute>${Math.round(score.bpm)}</per-minute>` +
          `</metronome></direction-type><sound tempo="${Math.round(score.bpm)}"/></direction>`,
      );
    }

    score.staves.forEach((staff, staffIndex) => {
      if (staffIndex > 0) {
        parts.push(
          `<backup><duration>${score.stepsPerMeasure}</duration></backup>`,
        );
      }
      accidentalTrackers[staffIndex].reset();
      staff.measures[index]?.forEach((event) => {
        parts.push(
          renderEvent(
            event,
            score,
            staffIndex + 1,
            totalStaves,
            accidentalTrackers[staffIndex],
          ),
        );
      });
    });

    measures.push(`<measure number="${index + 1}">${parts.join("")}</measure>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>${escapeXml(score.title)}</work-title></work><identification><encoding><software>SongToNotes</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding></identification><part-list><score-part id="P1"><part-name>${escapeXml(score.title)}</part-name></score-part></part-list><part id="P1">${measures.join("")}</part></score-partwise>`;
}
