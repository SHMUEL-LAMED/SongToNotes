import { Midi } from "@tonejs/midi";
import { scientificName } from "./key";
import type { Score } from "./score";
import type { DetectedNote, KeySignature } from "./types";

export type MidiOptions = {
  bpm: number;
  /** Write the notes snapped to the grid rather than as played. */
  quantized: boolean;
  /** Grid origin and resolution, used when quantized. */
  offset: number;
  stepsPerBeat: number;
  transpose: number;
};

export function notesToMidi(notes: DetectedNote[], options: MidiOptions) {
  const midi = new Midi();
  midi.header.setTempo(options.bpm);
  const track = midi.addTrack();
  track.name = "SongToNotes";

  const stepSeconds = 60 / options.bpm / options.stepsPerBeat;
  notes.forEach((note) => {
    let time = note.start;
    let duration = note.duration;
    if (options.quantized) {
      const startStep = Math.max(
        0,
        Math.round((note.start - options.offset) / stepSeconds),
      );
      const endStep = Math.max(
        startStep + 1,
        Math.round((note.start + note.duration - options.offset) / stepSeconds),
      );
      time = options.offset + startStep * stepSeconds;
      duration = (endStep - startStep) * stepSeconds;
    }
    track.addNote({
      midi: Math.max(0, Math.min(127, note.midi + options.transpose)),
      time: Math.max(0, time),
      duration: Math.max(0.02, duration),
      velocity: Math.min(1, Math.max(0.05, note.confidence)),
    });
  });

  return Uint8Array.from(midi.toArray());
}

export function notesToCsv(
  notes: DetectedNote[],
  key: KeySignature,
  transpose: number,
) {
  const rows = [
    "note,midi,start_seconds,duration_seconds,confidence",
    ...notes.map((note) => {
      const midi = note.midi + transpose;
      return [
        scientificName(midi, key.fifths),
        midi,
        note.start.toFixed(3),
        note.duration.toFixed(3),
        note.confidence.toFixed(3),
      ].join(",");
    }),
  ];
  // A BOM keeps Excel from mangling the file when it is opened directly.
  return `\uFEFF${rows.join("\r\n")}`;
}

export function scoreSummary(score: Score) {
  const events = score.staves.reduce(
    (total, staff) =>
      total +
      staff.measures.reduce(
        (count, measure) =>
          count + measure.filter((event) => event.midis.length).length,
        0,
      ),
    0,
  );
  return { events, measures: score.measureCount };
}

export function downloadFile(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Firefox cancels the download if the object URL is revoked in the same
  // tick, so the cleanup waits a beat.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFilename(name: string) {
  const base = name
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "song-to-notes";
}
