import { Midi } from "@tonejs/midi";
import type { NoteEventTime } from "@spotify/basic-pitch";

export type ViewMode = "melody" | "full";

export type NoteGrid = {
  bpm: number;
  secondsPerStep: number;
  steps: number[][];
  measureCount: number;
};

const STEPS_PER_BEAT = 4;
const STEPS_PER_MEASURE = 16;
const MAX_MEASURES = 96;

export function midiName(midi: number) {
  const names = [
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
  return `${names[midi % 12]} ${Math.floor(midi / 12) - 1}`;
}

export function estimateTempo(notes: NoteEventTime[]) {
  const uniqueOnsets = Array.from(
    new Set(notes.map((note) => Math.round(note.startTimeSeconds * 20) / 20)),
  ).sort((a, b) => a - b);
  const intervals = uniqueOnsets
    .slice(1)
    .map((value, index) => value - uniqueOnsets[index])
    .filter((interval) => interval >= 0.22 && interval <= 1.5)
    .sort((a, b) => a - b);

  if (!intervals.length) return 120;
  const median = intervals[Math.floor(intervals.length / 2)];
  let bpm = 60 / median;
  while (bpm < 70) bpm *= 2;
  while (bpm > 170) bpm /= 2;
  return Math.round(Math.min(180, Math.max(60, bpm)));
}

export function createGrid(
  notes: NoteEventTime[],
  bpm: number,
  mode: ViewMode,
): NoteGrid {
  const secondsPerStep = 60 / bpm / STEPS_PER_BEAT;
  const lastTime = Math.max(
    1,
    ...notes.map((note) => note.startTimeSeconds + note.durationSeconds),
  );
  const measureCount = Math.min(
    MAX_MEASURES,
    Math.max(1, Math.ceil(lastTime / secondsPerStep / STEPS_PER_MEASURE)),
  );
  const totalSteps = measureCount * STEPS_PER_MEASURE;

  if (mode === "melody") {
    const best = Array.from({ length: totalSteps }, () => ({
      pitch: -1,
      score: -1,
    }));
    notes.forEach((note) => {
      const start = Math.max(0, Math.round(note.startTimeSeconds / secondsPerStep));
      const length = Math.max(1, Math.round(note.durationSeconds / secondsPerStep));
      const score = note.amplitude + note.pitchMidi / 1000;
      for (let step = start; step < Math.min(totalSteps, start + length); step += 1) {
        if (score > best[step].score) {
          best[step] = { pitch: note.pitchMidi, score };
        }
      }
    });
    return {
      bpm,
      secondsPerStep,
      steps: best.map((value) => (value.pitch >= 0 ? [value.pitch] : [])),
      measureCount,
    };
  }

  const steps: number[][] = Array.from({ length: totalSteps }, () => []);
  notes.forEach((note) => {
    const start = Math.max(0, Math.round(note.startTimeSeconds / secondsPerStep));
    const length = Math.max(1, Math.round(note.durationSeconds / secondsPerStep));
    for (let step = start; step < Math.min(totalSteps, start + length); step += 1) {
      if (!steps[step].includes(note.pitchMidi)) steps[step].push(note.pitchMidi);
    }
  });
  steps.forEach((step) => step.sort((a, b) => a - b));
  return { bpm, secondsPerStep, steps, measureCount };
}

function abcPitch(midi: number) {
  const pitchClasses = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];
  const octave = Math.floor(midi / 12) - 1;
  const pitchClass = pitchClasses[midi % 12];
  const accidental = pitchClass.startsWith("^") ? "^" : "";
  let letter = pitchClass.replace("^", "");

  if (octave >= 5) {
    letter = letter.toLowerCase() + "'".repeat(Math.max(0, octave - 5));
  } else if (octave <= 3) {
    letter += ",".repeat(4 - octave);
  }
  return accidental + letter;
}

function sameChord(a: number[], b: number[]) {
  return a.length === b.length && a.every((pitch, index) => pitch === b[index]);
}

function durationSuffix(length: number) {
  return length === 1 ? "" : String(length);
}

function measureTokens(steps: number[][]) {
  const tokens: string[] = [];
  let index = 0;
  while (index < steps.length) {
    let end = index + 1;
    while (end < steps.length && sameChord(steps[index], steps[end])) end += 1;
    const duration = end - index;
    const pitches = steps[index];
    if (!pitches.length) {
      tokens.push(`z${durationSuffix(duration)}`);
    } else if (pitches.length === 1) {
      tokens.push(`${abcPitch(pitches[0])}${durationSuffix(duration)}`);
    } else {
      tokens.push(`[${pitches.map(abcPitch).join("")}]${durationSuffix(duration)}`);
    }
    index = end;
  }
  return tokens.join(" ");
}

export function gridToAbc(grid: NoteGrid, title: string) {
  const safeTitle = title.replace(/[\r\n]/g, " ").trim() || "SongToNotes";
  const measures: string[] = [];
  for (let measure = 0; measure < grid.measureCount; measure += 1) {
    measures.push(
      measureTokens(
        grid.steps.slice(
          measure * STEPS_PER_MEASURE,
          (measure + 1) * STEPS_PER_MEASURE,
        ),
      ),
    );
  }

  const rows: string[] = [];
  for (let index = 0; index < measures.length; index += 4) {
    rows.push(`| ${measures.slice(index, index + 4).join(" | ")} |`);
  }

  return [
    "X:1",
    `T:${safeTitle}`,
    "M:4/4",
    "L:1/16",
    `Q:1/4=${grid.bpm}`,
    "K:C clef=treble",
    ...rows,
  ].join("\n");
}

function xmlPitch(midi: number) {
  const pitchClasses = [
    ["C", 0],
    ["C", 1],
    ["D", 0],
    ["D", 1],
    ["E", 0],
    ["F", 0],
    ["F", 1],
    ["G", 0],
    ["G", 1],
    ["A", 0],
    ["A", 1],
    ["B", 0],
  ] as const;
  const [step, alter] = pitchClasses[midi % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function durationType(duration: number) {
  return ({ 1: "16th", 2: "eighth", 4: "quarter", 8: "half", 16: "whole" } as Record<number, string>)[duration];
}

function musicXmlMeasure(steps: number[][], measureNumber: number) {
  const notes: string[] = [];
  let index = 0;
  while (index < steps.length) {
    let end = index + 1;
    while (end < steps.length && sameChord(steps[index], steps[end])) end += 1;
    const duration = end - index;
    const type = durationType(duration);
    const pitches = steps[index];

    if (!pitches.length) {
      notes.push(`<note><rest/><duration>${duration}</duration>${type ? `<type>${type}</type>` : ""}</note>`);
    } else {
      pitches.forEach((midi, pitchIndex) => {
        const pitch = xmlPitch(midi);
        notes.push(
          `<note>${pitchIndex ? "<chord/>" : ""}<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ""}<octave>${pitch.octave}</octave></pitch><duration>${duration}</duration>${type ? `<type>${type}</type>` : ""}</note>`,
        );
      });
    }
    index = end;
  }

  const attributes =
    measureNumber === 1
      ? "<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>"
      : "";
  return `<measure number="${measureNumber}">${attributes}${notes.join("")}</measure>`;
}

export function gridToMusicXml(grid: NoteGrid, title: string) {
  const measures: string[] = [];
  for (let measure = 0; measure < grid.measureCount; measure += 1) {
    measures.push(
      musicXmlMeasure(
        grid.steps.slice(
          measure * STEPS_PER_MEASURE,
          (measure + 1) * STEPS_PER_MEASURE,
        ),
        measure + 1,
      ),
    );
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>${xmlEscape(title)}</work-title></work><identification><encoding><software>SongToNotes</software></encoding></identification><part-list><score-part id="P1"><part-name>Transcription</part-name></score-part></part-list><part id="P1"><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${grid.bpm}</per-minute></metronome></direction-type><sound tempo="${grid.bpm}"/></direction>${measures.join("")}</part></score-partwise>`;
}

export function notesToMidi(notes: NoteEventTime[], bpm: number) {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.name = "SongToNotes";
  notes.forEach((note) => {
    track.addNote({
      midi: note.pitchMidi,
      time: note.startTimeSeconds,
      duration: note.durationSeconds,
      velocity: Math.min(1, Math.max(0.05, note.amplitude)),
    });
  });
  return Uint8Array.from(midi.toArray()).buffer;
}

export function notesToCsv(notes: NoteEventTime[]) {
  const rows = ["note,midi,start_seconds,duration_seconds,confidence"];
  notes.forEach((note) => {
    rows.push(
      [
        midiName(note.pitchMidi),
        note.pitchMidi,
        note.startTimeSeconds.toFixed(3),
        note.durationSeconds.toFixed(3),
        note.amplitude.toFixed(3),
      ].join(","),
    );
  });
  return rows.join("\n");
}

export function downloadFile(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
