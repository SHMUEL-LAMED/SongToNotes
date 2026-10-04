import { describe, expect, it } from "vitest";
import { detectPitch } from "./dsp";
import {
  DEFAULT_SETTINGS,
  analyzeSpeech,
  chordVoicing,
  findPhrases,
  findSyllables,
  makeTimeMap,
  nearestInSet,
  pitchMarks,
  placeSyllables,
  planSpeechSong,
  prepareVoice,
  psola,
  rankHooks,
  renderVocal,
  songLayout,
  sungMidiAt,
  type Syllable,
} from "./speechSong";

const RATE = 16_000;

/** A buzz with the harmonics of a voice, at a pitch that may glide. */
function voiced(seconds: number, fromHz: number, toHz = fromHz) {
  const length = Math.round(seconds * RATE);
  const out = new Float32Array(length);
  let phase = 0;
  for (let index = 0; index < length; index += 1) {
    const frequency = fromHz + ((toHz - fromHz) * index) / length;
    phase += (2 * Math.PI * frequency) / RATE;
    let value = 0;
    for (let harmonic = 1; harmonic <= 8; harmonic += 1) value += Math.sin(harmonic * phase) / harmonic;
    // Raised-cosine envelope: each burst reads as one syllable.
    out[index] = 0.3 * value * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length));
  }
  return out;
}

function silence(seconds: number) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < out.length; index += 1) out[index] = (Math.sin(index * 12.9898) * 43758.5453 % 1) * 0.0005;
  return out;
}

function join(parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// Two phrases: four syllables rising and falling, a pause, then two flat ones.
const PITCHES = [140, 170, 200, 160];
const SPEECH = join([
  silence(0.2),
  ...PITCHES.flatMap((hz) => [voiced(0.2, hz), silence(0.06)]),
  silence(0.5),
  voiced(0.2, 150),
  silence(0.06),
  voiced(0.2, 150),
  silence(0.3),
]);

describe("speech analysis", () => {
  const analysis = analyzeSpeech(SPEECH, RATE);
  const syllables = findSyllables(analysis);

  it("follows the pitch of the voice", () => {
    // The middle of the third syllable: 0.2 s lead-in, two syllables and gaps, half a syllable.
    const frame = Math.round((0.2 + 2 * 0.26 + 0.1) / analysis.hop);
    expect(analysis.f0[frame]).toBeGreaterThan(190);
    expect(analysis.f0[frame]).toBeLessThan(210);
  });

  it("finds one syllable per burst, at the right times", () => {
    expect(syllables).toHaveLength(6);
    expect(syllables[0].start).toBeGreaterThan(0.15);
    expect(syllables[0].start).toBeLessThan(0.3);
    for (const syllable of syllables) {
      expect(syllable.end).toBeGreaterThan(syllable.start);
      expect(syllable.voicedStart).toBeGreaterThanOrEqual(syllable.start);
      expect(syllable.voicedEnd).toBeLessThanOrEqual(syllable.end + 1e-9);
    }
    syllables.slice(0, 4).forEach((syllable, index) => {
      expect(Math.abs(syllable.f0 - PITCHES[index]) / PITCHES[index]).toBeLessThan(0.05);
    });
  });

  it("splits phrases at a pause, and ranks the varied one as the better hook", () => {
    const phrases = findPhrases(syllables);
    expect(phrases.map((phrase) => phrase.to - phrase.from)).toEqual([4, 2]);
    const [best] = rankHooks(syllables);
    expect(best.from).toBe(0);
    expect(best.to).toBe(4);
  });

  it("finds nothing in silence", () => {
    expect(findSyllables(analyzeSpeech(silence(1), RATE))).toEqual([]);
  });

  it("brings a quiet recording up to a working level", () => {
    const quiet = SPEECH.map((value) => value * 0.01);
    expect(findSyllables(analyzeSpeech(prepareVoice([quiet]), RATE))).toHaveLength(6);
  });
});

function syllable(start: number, end: number, f0 = 150): Syllable {
  return { start, end, voicedStart: start + 0.02, voicedEnd: end - 0.02, f0, peak: 0.5 };
}

describe("placing syllables on the beat", () => {
  const syllables = [syllable(0, 0.15), syllable(0.18, 0.3), syllable(0.32, 0.5), syllable(1.2, 1.35), syllable(1.4, 1.6)];

  it("gives every syllable its own slot, in order", () => {
    for (const mode of ["song", "rap"] as const) {
      const { slots } = placeSyllables(syllables, mode, 100);
      for (let index = 1; index < slots.length; index += 1) expect(slots[index]).toBeGreaterThan(slots[index - 1]);
    }
  });

  it("starts the phrase after a pause on a beat", () => {
    const { slots, perBeat } = placeSyllables(syllables, "rap", 100);
    expect(slots[3] % perBeat).toBe(0);
  });

  it("never squeezes a syllable below most of its spoken length", () => {
    const long = [syllable(0, 0.6), syllable(0.62, 0.7)];
    const { slots, step } = placeSyllables(long, "rap", 120);
    expect((slots[1] - slots[0]) * step).toBeGreaterThanOrEqual(0.6 * 0.6 - 1e-9);
  });
});

describe("the sung plan", () => {
  const syllables = [syllable(0, 0.2, 140), syllable(0.25, 0.45, 170), syllable(0.5, 0.7, 200), syllable(0.75, 0.95, 160)];

  it("sings notes of the key, and chord tones on the beat", () => {
    const plan = planSpeechSong(syllables, { ...DEFAULT_SETTINGS.song, keyPc: 0, minor: false });
    const scale = [0, 2, 4, 5, 7, 9, 11];
    for (const note of plan.notes) {
      expect(note.midi).not.toBeNull();
      expect(scale).toContain(((note.midi! % 12) + 12) % 12);
      if (note.onBeat) {
        const chord = plan.chords[Math.floor(note.start / plan.barSeconds) % plan.chords.length];
        const tones = chord.intervals.map((interval) => (chord.rootPc + interval) % 12);
        expect(tones).toContain(note.midi! % 12);
      }
    }
    expect(plan.chords.map((chord) => chord.plain)).toEqual(["C", "G", "Am", "F"]);
  });

  it("follows the rise and fall of the speech, and comes home at the end", () => {
    const five = [...syllables, syllable(1, 1.2, 150)];
    const plan = planSpeechSong(five, { ...DEFAULT_SETTINGS.song, keyPc: 0 });
    const midis = plan.notes.map((note) => note.midi!);
    expect(midis[2]).toBeGreaterThan(midis[0]);
    expect(midis[3]).toBeLessThan(midis[2]);
    // The phrase ends on the root of the chord under it.
    const last = plan.notes[4];
    const chord = plan.chords[Math.floor(last.start / plan.barSeconds) % plan.chords.length];
    expect(last.midi! % 12).toBe(chord.rootPc);
  });

  it("takes the key from the voice when none is chosen", () => {
    // 220 Hz is A3: the key is A.
    const plan = planSpeechSong([syllable(0, 0.2, 220), syllable(0.3, 0.5, 220)], DEFAULT_SETTINGS.song);
    expect(plan.keyPc).toBe(9);
  });

  it("keeps the spoken pitch when rapping", () => {
    const plan = planSpeechSong(syllables, DEFAULT_SETTINGS.rap);
    expect(plan.notes.every((note) => note.midi === null)).toBe(true);
  });

  it("holds a sung vowel longer than it was spoken", () => {
    const plan = planSpeechSong(syllables, DEFAULT_SETTINGS.song);
    const sung = plan.notes[0].end - plan.notes[0].start;
    expect(sung).toBeGreaterThan(0.2);
    for (let index = 1; index < plan.notes.length; index += 1) {
      expect(plan.notes[index].start).toBeGreaterThanOrEqual(plan.notes[index - 1].end - 0.03);
    }
  });

  it("fills whole bars, an even number of them", () => {
    const plan = planSpeechSong(syllables, DEFAULT_SETTINGS.song);
    expect(plan.bars % 2).toBe(0);
    expect(plan.bars * plan.barSeconds).toBeGreaterThanOrEqual(plan.vocalLength);
    const layout = songLayout(plan, 2);
    expect(layout.total).toBeCloseTo(plan.barSeconds * (2 + 2 * plan.bars));
  });

  it("glides into a note and holds it", () => {
    const notes = [
      { syllable: 0, start: 0, end: 0.5, midi: 60, onBeat: true },
      { syllable: 1, start: 0.5, end: 1.5, midi: 64, onBeat: false },
    ];
    expect(sungMidiAt(notes, 0.1)).toBe(60);
    const mid = sungMidiAt(notes, 0.525)!;
    expect(mid).toBeGreaterThan(60);
    expect(mid).toBeLessThan(64);
    expect(Math.abs(sungMidiAt(notes, 1.2)! - 64)).toBeLessThanOrEqual(0.25);
  });
});

describe("helpers", () => {
  it("maps time through the anchors, at slope one beyond them", () => {
    const map = makeTimeMap([
      { out: 1, in: 0 },
      { out: 3, in: 1 },
    ]);
    expect(map(2)).toBeCloseTo(0.5);
    expect(map(0)).toBeCloseTo(-1);
    expect(map(4)).toBeCloseTo(2);
  });

  it("snaps to the nearest note of a set", () => {
    expect(nearestInSet(61, [0, 4, 7])).toBe(60);
    expect(nearestInSet(62.4, [0, 4, 7])).toBe(64);
    expect(nearestInSet(66, [0, 4, 7])).toBe(67);
  });

  it("voices chords around middle C with the root in the bass", () => {
    const { tones, bass } = chordVoicing({ token: "1", roman: "I", name: "G", plain: "G", rootPc: 7, intervals: [0, 4, 7] });
    for (const tone of tones) {
      expect(tone).toBeGreaterThanOrEqual(55);
      expect(tone).toBeLessThan(67);
    }
    expect(tones.map((tone) => tone % 12).sort()).toEqual([11, 2, 7].sort());
    expect(bass % 12).toBe(7);
  });
});

describe("moving the voice", () => {
  const tone = join([silence(0.05), voiced(0.6, 150), silence(0.05)]);
  const analysis = analyzeSpeech(tone, RATE);
  const marks = pitchMarks(tone, RATE, analysis);
  const middle = (signal: Float32Array, centre: number) => signal.subarray(centre - 800, centre + 800);

  it("marks one period at a time through the vowel", () => {
    const voicedMarks = marks.filter((mark) => mark.voiced);
    expect(voicedMarks.length).toBeGreaterThan(60);
    const gaps = voicedMarks.slice(1).map((mark, index) => mark.pos - voicedMarks[index].pos);
    const typical = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    expect(Math.abs(typical - RATE / 150)).toBeLessThan(3);
  });

  it("moves the pitch without changing the length", () => {
    const out = psola(tone, marks, tone.length, (t) => t, () => RATE / 200);
    expect(out.length).toBe(tone.length);
    const reading = detectPitch(middle(out, Math.round(0.35 * RATE)), RATE, 70, 500);
    expect(Math.abs(reading.frequency - 200)).toBeLessThan(6);
  });

  it("stretches time without changing the pitch", () => {
    const out = psola(tone, marks, tone.length * 2, (t) => t / 2, (_, mark) => mark.period);
    const reading = detectPitch(middle(out, Math.round(0.7 * RATE)), RATE, 70, 500);
    expect(Math.abs(reading.frequency - 150)).toBeLessThan(5);
  });

  it("renders a pass of the planned length", () => {
    const syllables = findSyllables(analyzeSpeech(SPEECH, RATE));
    const plan = planSpeechSong(syllables, { ...DEFAULT_SETTINGS.song, keyPc: 0 });
    const vocal = renderVocal(SPEECH, RATE, analyzeSpeech(SPEECH, RATE), plan);
    expect(vocal.length).toBe(Math.ceil(plan.vocalLength * RATE));
    let peak = 0;
    for (const value of vocal) peak = Math.max(peak, Math.abs(value));
    expect(peak).toBeCloseTo(0.9, 2);
  });
});
