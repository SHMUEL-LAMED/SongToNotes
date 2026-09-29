import { describe, expect, it } from "vitest";
import {
  MELODY_MOODS,
  MELODY_SCALES,
  accompanimentNotes,
  chordPcs,
  generateMelody,
  keyLabel,
  melodyLength,
  melodyRange,
  melodyToMidi,
  melodyToNotes,
  noteNamer,
  parseKeyName,
  parseSeedCode,
  randomSeed,
  scaleDefinition,
  seedCode,
  type Melody,
  type MelodyBars,
  type MelodySettings,
} from "./melody";

const base: MelodySettings = { key: 0, scale: "major", mood: "happy", bars: 4, density: 3, range: 1, rhythmSeed: 123456, noteSeed: 654321 };

/** A spread of settings: every scale, mood, length and range, over several keys and seeds. */
function sweep(): MelodySettings[] {
  const out: MelodySettings[] = [];
  let seed = 50_000;
  for (const scale of MELODY_SCALES) {
    for (const mood of MELODY_MOODS) {
      for (const bars of [2, 4, 8] as MelodyBars[]) {
        for (const range of [1, 2] as const) {
          for (let trial = 0; trial < 3; trial += 1) {
            seed += 7919;
            out.push({ key: (seed >> 3) % 12, scale: scale.id, mood: mood.id, bars, density: 1 + (seed % 5), range, rhythmSeed: seed, noteSeed: seed * 3 + 11 });
          }
        }
      }
    }
  }
  return out;
}

const chordAt = (melody: Melody, beat: number) => melody.chords.find((slot) => beat >= slot.start && beat < slot.start + slot.length)!.chord;

describe("generateMelody", () => {
  it("gives the same melody for the same seeds", () => {
    expect(generateMelody(base)).toEqual(generateMelody({ ...base }));
    expect(generateMelody({ ...base, noteSeed: 777 }).notes).not.toEqual(generateMelody(base).notes);
  });

  it("keeps the rhythm when only the note seed changes, and the notes' harmony when only the rhythm does", () => {
    const one = generateMelody(base);
    const newNotes = generateMelody({ ...base, noteSeed: 99_999 });
    expect(newNotes.notes.map((note) => [note.start, note.length])).toEqual(one.notes.map((note) => [note.start, note.length]));
    const newRhythm = generateMelody({ ...base, rhythmSeed: 99_999 });
    expect(newRhythm.chords).toEqual(one.chords);
    // A note that falls on a beat in both versions has the same pitch: the line is kept.
    for (const note of newRhythm.notes) {
      const twin = one.notes.find((other) => other.start === note.start);
      if (twin && Number.isInteger(note.start)) expect(note.midi).toBe(twin.midi);
    }
  });

  it("stays in the scale and inside the range", () => {
    for (const settings of sweep()) {
      const melody = generateMelody(settings);
      const pcs = new Set(scaleDefinition(settings.scale).steps.map((step) => (settings.key + step) % 12));
      const { low, high } = melodyRange(settings);
      expect(high - low).toBe(settings.range === 2 ? 24 : 12);
      for (const note of melody.notes) {
        expect(pcs.has(note.midi % 12), `${JSON.stringify(settings)} ${note.midi}`).toBe(true);
        expect(note.midi).toBeGreaterThanOrEqual(low);
        expect(note.midi).toBeLessThanOrEqual(high);
      }
    }
  });

  it("puts chord tones on the strong beats", () => {
    let strong = 0;
    let fitting = 0;
    for (const settings of sweep()) {
      const melody = generateMelody(settings);
      for (const note of melody.notes.filter((item) => item.strong)) {
        strong += 1;
        if (chordPcs(chordAt(melody, note.start)).has(note.midi % 12)) fitting += 1;
      }
    }
    expect(strong).toBeGreaterThan(500);
    expect(fitting / strong).toBeGreaterThanOrEqual(0.9);
  });

  it("ends on a long tonic that belongs to the last chord", () => {
    for (const settings of sweep()) {
      const melody = generateMelody(settings);
      const last = melody.notes[melody.notes.length - 1];
      expect(last.midi % 12).toBe(settings.key);
      expect(chordPcs(melody.chords[melody.chords.length - 1].chord).has(settings.key)).toBe(true);
      expect(last.length).toBeGreaterThanOrEqual(2);
      expect(last.start + last.length).toBe(settings.bars * 4);
    }
  });

  it("fills exactly the bars asked for, in order, without overlaps", () => {
    for (const settings of sweep()) {
      const melody = generateMelody(settings);
      expect(melody.beats).toBe(settings.bars * 4);
      expect(new Set(melody.notes.map((note) => note.bar)).size).toBe(settings.bars);
      const chordBeats = melody.chords.reduce((sum, slot) => sum + slot.length, 0);
      expect(chordBeats).toBe(settings.bars * 4);
      for (let index = 1; index < melody.notes.length; index += 1) {
        const before = melody.notes[index - 1];
        expect(melody.notes[index].start).toBeGreaterThanOrEqual(before.start + before.length - 1e-9);
      }
    }
    expect(melodyLength(generateMelody({ ...base, bars: 8 }), 120)).toBeCloseTo(16);
  });

  it("never leaps more than an octave, and moves mostly by step", () => {
    let moves = 0;
    let small = 0;
    for (const settings of sweep()) {
      const notes = generateMelody(settings).notes;
      for (let index = 1; index < notes.length; index += 1) {
        const gap = Math.abs(notes[index].midi - notes[index - 1].midi);
        expect(gap).toBeLessThanOrEqual(12);
        moves += 1;
        if (gap <= 4) small += 1;
      }
    }
    expect(small / moves).toBeGreaterThan(0.75);
  });

  it("repeats the motif's rhythm in the third bar and restates the first phrase in an eight-bar tune", () => {
    const melody = generateMelody({ ...base, bars: 8 });
    const rhythmOf = (bar: number) => melody.notes.filter((note) => note.bar === bar).map((note) => [note.start - bar * 4, note.length]);
    expect(rhythmOf(2)).toEqual(rhythmOf(0));
    expect(rhythmOf(4)).toEqual(rhythmOf(0));
    const pitches = (bar: number) => melody.notes.filter((note) => note.bar === bar).map((note) => note.midi);
    expect(pitches(4)).toEqual(pitches(0));
  });

  it("makes busier melodies at a higher density", () => {
    const count = (density: number) => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed += 1) total += generateMelody({ ...base, density, rhythmSeed: seed * 1013 }).notes.length;
      return total;
    };
    expect(count(5)).toBeGreaterThan(count(1) * 1.4);
  });
});

describe("playback and export", () => {
  it("times the melody and the accompaniment in seconds", () => {
    const melody = generateMelody(base);
    const notes = melodyToNotes(melody, 120);
    expect(notes).toHaveLength(melody.notes.length);
    expect(notes[1].start).toBeCloseTo(melody.notes[1].start * 0.5);
    const chords = accompanimentNotes(melody, 120);
    expect(chords.length).toBeGreaterThan(melody.chords.length);
    expect(Math.max(...chords.map((note) => note.start))).toBeLessThan(8);
  });

  it("writes a MIDI file with a melody track and a chords track", () => {
    const data = melodyToMidi(generateMelody(base), 100, true);
    expect(String.fromCharCode(...data.slice(0, 4))).toBe("MThd");
    const tracks = String.fromCharCode(...data).split("MTrk").length - 1;
    expect(tracks).toBeGreaterThanOrEqual(2);
    const alone = melodyToMidi(generateMelody(base), 100, false);
    expect(alone.length).toBeLessThan(data.length);
  });
});

describe("helpers", () => {
  it("round-trips the seed code", () => {
    const rhythmSeed = randomSeed(() => 0.42);
    const noteSeed = randomSeed(() => 0.9);
    const code = seedCode(rhythmSeed, noteSeed);
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(parseSeedCode(code)).toEqual({ rhythmSeed, noteSeed });
    expect(parseSeedCode(code.toLowerCase())).toEqual({ rhythmSeed, noteSeed });
    expect(parseSeedCode("hello")).toBeNull();
  });

  it("reads key names and spells notes for the key", () => {
    expect(parseKeyName("C")).toBe(0);
    expect(parseKeyName("f#")).toBe(6);
    expect(parseKeyName("B♭")).toBe(10);
    expect(parseKeyName("Db")).toBe(1);
    expect(parseKeyName("H")).toBeNull();
    expect(keyLabel(9, "minor")).toBe("Am");
    expect(keyLabel(1, "minor")).toBe("C♯m");
    expect(noteNamer({ key: 10, scale: "major" })(63)).toBe("E♭4");
    expect(noteNamer({ key: 11, scale: "major" })(63)).toBe("D♯4");
  });
});
