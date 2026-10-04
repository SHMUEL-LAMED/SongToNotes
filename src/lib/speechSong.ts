/**
 * Speech to song: a spoken recording becomes a short song. The voice is cut
 * into syllables by its loudness, every syllable is moved onto a beat grid,
 * and — for singing — its pitch is pulled to a note of the key that follows
 * the speaker's own intonation and the chord under it. A backing of drums,
 * chords and bass is rendered under the voice.
 *
 * Three ways to use it:
 * - "song": the speech is sung, slower than spoken, with held vowels;
 * - "rap": the speech keeps its own pitch, and every syllable lands on a
 *   sixteenth of the beat;
 * - "hook": the most musical phrase of a longer recording is found, sung,
 *   and looped as a chorus.
 *
 * The voice is moved with TD-PSOLA (pitch-synchronous overlap-add): one
 * grain per pitch period, laid down at the period of the target note and at
 * the time the beat asks for. It keeps the speaker's timbre, which is what
 * makes the result sound like them singing rather than like a synth.
 *
 * Everything up to the final mix is plain arithmetic on sample arrays, so it
 * is tested without a browser; only {@link renderSpeechSong} needs Web Audio.
 */
import { detectPitch, frequencyToMidi, lowPass, midiToFrequency, resample } from "./dsp";
import { PRESETS, STEPS, VOICES, playVoice, type Pattern } from "./drums";
import { spellProgression, type ProgChord } from "./progression";
import { ROOTS } from "./theory";
import { makeImpulseResponse } from "./voiceFx";

export type SpeechSongMode = "song" | "rap" | "hook";

export const SPEECH_SONG_MODES: { id: SpeechSongMode; label: string; blurb: string }[] = [
  { id: "song", label: "שיר", blurb: "הדיבור מושר על מנגינה" },
  { id: "rap", label: "ראפ", blurb: "כל הברה נוחתת על הביט" },
  { id: "hook", label: "פזמון", blurb: "המשפט הכי מוזיקלי, בלופ" },
];

export function isSpeechSongMode(value: unknown): value is SpeechSongMode {
  return value === "song" || value === "rap" || value === "hook";
}

/** The beats a song can sit on: the drum machine's own grooves. */
export const SPEECH_SONG_BEATS = ["boombap", "trap", "rock", "reggaeton", "house", "funk"] as const;
export type SpeechSongBeat = (typeof SPEECH_SONG_BEATS)[number];

export function isSpeechSongBeat(value: unknown): value is SpeechSongBeat {
  return SPEECH_SONG_BEATS.includes(value as SpeechSongBeat);
}

export function beatLabel(beat: SpeechSongBeat) {
  return PRESETS.find((preset) => preset.id === beat)?.label ?? beat;
}

/** Longest recording each mode takes: a hook is looked for in a longer one. */
export const MAX_SECONDS: Record<SpeechSongMode, number> = { song: 45, rap: 45, hook: 180 };

// ---------------------------------------------------------------------------
// Analysis: loudness and pitch, 100 frames a second
// ---------------------------------------------------------------------------

/** Speech carries nothing above 4 kHz that pitch or syllables need. */
export const ANALYSIS_RATE = 11_025;
export const HOP_SECONDS = 0.01;
const WINDOW_SECONDS = 0.04;
const MIN_F0 = 70;
const MAX_F0 = 500;

export type SpeechAnalysis = {
  /** Seconds per frame. */
  hop: number;
  /** Loudness of each frame, of the input scaled to a peak of 0.9. */
  rms: Float32Array;
  /** Pitch of each frame in Hz, 0 where it is not voiced. */
  f0: Float32Array;
  duration: number;
};

export function peakOf(samples: Float32Array) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index]);
    if (value > peak) peak = value;
  }
  return peak;
}

/** Mono, at a peak of 0.9: quiet phone recordings are analysed like loud ones. */
export function prepareVoice(channels: Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) mono[index] += channel[index] / channels.length;
  }
  let mean = 0;
  for (let index = 0; index < length; index += 1) mean += mono[index];
  mean /= Math.max(1, length);
  for (let index = 0; index < length; index += 1) mono[index] -= mean;
  const peak = peakOf(mono);
  if (peak > 0) {
    const gain = 0.9 / peak;
    for (let index = 0; index < length; index += 1) mono[index] *= gain;
  }
  return mono;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function analyzeSpeech(samples: Float32Array, sampleRate: number): SpeechAnalysis {
  const ratio = sampleRate / ANALYSIS_RATE;
  const signal = ratio > 1.01 ? resample(lowPass(samples, sampleRate, 4000), ratio) : samples;
  const rate = ratio > 1.01 ? sampleRate / ratio : sampleRate;
  const hop = Math.max(1, Math.round(HOP_SECONDS * rate));
  const half = Math.round((WINDOW_SECONDS * rate) / 2);
  const frames = Math.max(1, Math.ceil(signal.length / hop));
  const rms = new Float32Array(frames);
  const raw = new Float32Array(frames);
  const window = new Float32Array(half * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const centre = frame * hop;
    window.fill(0);
    const from = centre - half;
    for (let index = 0; index < window.length; index += 1) {
      const at = from + index;
      if (at >= 0 && at < signal.length) window[index] = signal[at];
    }
    const reading = detectPitch(window, rate, MIN_F0, MAX_F0);
    rms[frame] = reading.rms;
    raw[frame] = reading.clarity >= 0.75 && reading.frequency >= MIN_F0 && reading.frequency <= MAX_F0 ? reading.frequency : 0;
  }

  // A five-frame median takes out lone octave slips; a voiced run shorter
  // than three frames (30 ms) is a click or a fricative, not a vowel.
  const f0 = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    if (!raw[frame]) continue;
    const around: number[] = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      const value = raw[frame + offset];
      if (value) around.push(value);
    }
    f0[frame] = median(around);
  }
  let runStart = -1;
  for (let frame = 0; frame <= frames; frame += 1) {
    const voiced = frame < frames && f0[frame] > 0;
    if (voiced && runStart < 0) runStart = frame;
    if (!voiced && runStart >= 0) {
      if (frame - runStart < 3) f0.fill(0, runStart, frame);
      runStart = -1;
    }
  }
  return { hop: hop / rate, rms, f0, duration: samples.length / sampleRate };
}

// ---------------------------------------------------------------------------
// Syllables and phrases
// ---------------------------------------------------------------------------

export type Syllable = {
  /** Seconds in the recording. */
  start: number;
  end: number;
  /** The vowel: the voiced stretch inside the syllable, the part that is held when sung. */
  voicedStart: number;
  voicedEnd: number;
  /** Median pitch of the vowel in Hz, or 0 for a syllable with no voiced frames. */
  f0: number;
  /** Peak loudness, 0..1. */
  peak: number;
};

function toDb(value: number) {
  return 20 * Math.log10(value + 1e-6);
}

/**
 * Syllables from the loudness curve: every peak of the smoothed curve is a
 * syllable's vowel, and the dip between two peaks is where one ends and the
 * next begins — unless the dip is too shallow to hear, when the weaker peak
 * is folded into the stronger.
 */
export function findSyllables(analysis: SpeechAnalysis): Syllable[] {
  const { rms, f0, hop } = analysis;
  const frames = rms.length;
  if (frames < 5) return [];
  const raw = Array.from(rms, toDb);
  const db = raw.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const value = raw[index + offset];
      if (value !== undefined) {
        sum += value;
        count += 1;
      }
    }
    return sum / count;
  });
  const loudest = Math.max(...db);
  const floor = [...db].sort((a, b) => a - b)[Math.floor(frames * 0.1)];
  const gate = Math.max(loudest - 30, floor + 6);
  if (loudest < gate + 3) return [];

  let peaks: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    if (db[frame] < gate + 4) continue;
    let isPeak = true;
    for (let offset = -5; offset <= 5 && isPeak; offset += 1) {
      const other = db[frame + offset];
      if (other === undefined || offset === 0) continue;
      // Ties go to the earlier frame, so a flat top is one peak.
      if (other > db[frame] || (other === db[frame] && offset < 0)) isPeak = false;
    }
    if (isPeak) peaks.push(frame);
  }

  const dipBetween = (a: number, b: number) => {
    let at = a;
    for (let frame = a; frame <= b; frame += 1) if (db[frame] < db[at]) at = frame;
    return at;
  };
  // Merge peaks whose dip is shallow, weakest first, until every dip counts.
  while (peaks.length > 1) {
    let weakest = -1;
    let shallowest = Infinity;
    for (let index = 0; index + 1 < peaks.length; index += 1) {
      const a = peaks[index];
      const b = peaks[index + 1];
      const dip = db[dipBetween(a, b)];
      const depth = Math.min(db[a], db[b]) - dip;
      if (dip >= gate && depth < 3 && depth < shallowest) {
        weakest = index;
        shallowest = depth;
      }
    }
    if (weakest < 0) break;
    const drop = db[peaks[weakest]] < db[peaks[weakest + 1]] ? weakest : weakest + 1;
    peaks = peaks.filter((_, index) => index !== drop);
  }

  const syllables: Syllable[] = [];
  for (let index = 0; index < peaks.length; index += 1) {
    const peak = peaks[index];
    let start = peak;
    const previousDip = index > 0 ? dipBetween(peaks[index - 1], peak) : 0;
    while (start > previousDip && db[start - 1] >= gate) start -= 1;
    let end = peak;
    const nextDip = index + 1 < peaks.length ? dipBetween(peak, peaks[index + 1]) : frames - 1;
    while (end < nextDip && db[end + 1] >= gate) end += 1;
    end += 1;
    if ((end - start) * hop < 0.06) continue;
    let voicedStart = -1;
    let voicedEnd = -1;
    const pitches: number[] = [];
    for (let frame = start; frame < end; frame += 1) {
      if (f0[frame] > 0) {
        if (voicedStart < 0) voicedStart = frame;
        voicedEnd = frame + 1;
        pitches.push(f0[frame]);
      }
    }
    if (voicedStart < 0) {
      voicedStart = peak;
      voicedEnd = peak;
    }
    syllables.push({
      start: start * hop,
      end: end * hop,
      voicedStart: voicedStart * hop,
      voicedEnd: voicedEnd * hop,
      f0: median(pitches),
      peak: rms[peak],
    });
  }
  return syllables;
}

export type Phrase = {
  /** Syllable indices, end exclusive. */
  from: number;
  to: number;
  start: number;
  end: number;
  /** 0..1 — how good a hook it would make. */
  score: number;
};

/** A silence this long between syllables ends a phrase. */
export const PHRASE_GAP = 0.3;

/**
 * How catchy a phrase is: a handful of syllables in a couple of seconds,
 * with clear vowels, some rise and fall in the voice and an even pulse —
 * the things that make a spoken line sound like it wants to be sung.
 */
export function scorePhrase(syllables: Syllable[], loudest: number) {
  const count = syllables.length;
  if (count < 2) return 0;
  const duration = syllables[count - 1].end - syllables[0].start;
  const lengthFit =
    (count >= 4 && count <= 10 ? 1 : count < 4 ? count / 4 : Math.max(0.2, 10 / count)) *
    (duration >= 1 && duration <= 4 ? 1 : duration < 1 ? Math.max(0.3, duration) : Math.max(0.2, 4 / duration));
  const pitched = syllables.filter((syllable) => syllable.f0 > 0).map((syllable) => frequencyToMidi(syllable.f0));
  const mean = pitched.reduce((sum, value) => sum + value, 0) / Math.max(1, pitched.length);
  const spread = Math.sqrt(pitched.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, pitched.length));
  const melodic = Math.min(1, spread / 3);
  const voiced =
    syllables.reduce((sum, syllable) => sum + (syllable.voicedEnd - syllable.voicedStart) / Math.max(0.01, syllable.end - syllable.start), 0) / count;
  const loud = syllables.reduce((sum, syllable) => sum + syllable.peak, 0) / count / Math.max(1e-6, loudest);
  const gaps = syllables.slice(1).map((syllable, index) => syllable.start - syllables[index].start);
  const gapMean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  const gapSpread = Math.sqrt(gaps.reduce((sum, value) => sum + (value - gapMean) ** 2, 0) / gaps.length);
  const regular = Math.max(0, 1 - gapSpread / Math.max(0.01, gapMean));
  return lengthFit * (0.3 * melodic + 0.25 * Math.min(1, voiced) + 0.2 * Math.min(1, loud) + 0.25 * regular);
}

export function findPhrases(syllables: Syllable[], gap = PHRASE_GAP): Phrase[] {
  const loudest = syllables.reduce((max, syllable) => Math.max(max, syllable.peak), 0);
  const phrases: Phrase[] = [];
  let from = 0;
  for (let index = 1; index <= syllables.length; index += 1) {
    if (index === syllables.length || syllables[index].start - syllables[index - 1].end > gap) {
      const group = syllables.slice(from, index);
      if (group.length) {
        phrases.push({ from, to: index, start: group[0].start, end: group[group.length - 1].end, score: scorePhrase(group, loudest) });
      }
      from = index;
    }
  }
  return phrases;
}

/** The best hooks, best first. */
export function rankHooks(syllables: Syllable[], count = 3): Phrase[] {
  return findPhrases(syllables)
    .filter((phrase) => phrase.to - phrase.from >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// The plan: where each syllable lands and what it sings
// ---------------------------------------------------------------------------

export type SpeechSongSettings = {
  mode: SpeechSongMode;
  bpm: number;
  /** Pitch class of the key, or null to take it from the speaker's voice. */
  keyPc: number | null;
  minor: boolean;
  beat: SpeechSongBeat;
  /** How many times the vocal runs over the backing. */
  repeats: number;
  /** Backing level, 0..1. */
  backing: number;
};

export const DEFAULT_SETTINGS: Record<SpeechSongMode, SpeechSongSettings> = {
  song: { mode: "song", bpm: 96, keyPc: null, minor: false, beat: "rock", repeats: 2, backing: 0.7 },
  rap: { mode: "rap", bpm: 90, keyPc: null, minor: true, beat: "boombap", repeats: 2, backing: 0.7 },
  hook: { mode: "hook", bpm: 100, keyPc: null, minor: false, beat: "reggaeton", repeats: 4, backing: 0.7 },
};

export type Anchor = { out: number; in: number };

export type SungNote = {
  /** Index into the syllables the plan was made from. */
  syllable: number;
  /** Seconds from the start of the vocal pass. */
  start: number;
  end: number;
  /** The note sung, or null to keep the spoken pitch. */
  midi: number | null;
  /** Lands on a beat (a strong position) rather than between beats. */
  onBeat: boolean;
};

export type SpeechSongPlan = {
  mode: SpeechSongMode;
  notes: SungNote[];
  /** Output time to recording time, seconds; piecewise linear. */
  anchors: Anchor[];
  keyPc: number;
  minor: boolean;
  /** One chord per bar, looping. */
  chords: ProgChord[];
  bpm: number;
  barSeconds: number;
  /** Bars one vocal pass takes (even, at least two). */
  bars: number;
  /** Seconds of voice in one pass. */
  vocalLength: number;
};

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export function keyLabel(keyPc: number, minor: boolean) {
  return `${ROOTS[((keyPc % 12) + 12) % 12].name} ${minor ? "מינור" : "מז׳ור"}`;
}

/** The midi note with one of `pcs` nearest to `target`; ties go down. */
export function nearestInSet(target: number, pcs: number[]) {
  let best = Math.round(target);
  let distance = Infinity;
  for (let candidate = Math.floor(target) - 12; candidate <= Math.ceil(target) + 12; candidate += 1) {
    if (!pcs.includes(((candidate % 12) + 12) % 12)) continue;
    const gap = Math.abs(candidate - target);
    if (gap < distance - 1e-9) {
      best = candidate;
      distance = gap;
    }
  }
  return best;
}

/** The pitch the speaker talks around, as a midi number (A3 when nothing was voiced). */
export function voiceCentre(syllables: Syllable[]) {
  const pitched = syllables.filter((syllable) => syllable.f0 > 0).map((syllable) => frequencyToMidi(syllable.f0));
  return pitched.length ? median(pitched) : 57;
}

/**
 * Lays the syllables on the grid. Every syllable gets the next free slot at
 * or after its own spoken time (scaled a little slower for singing), and a
 * pause in the speech starts the next phrase on a beat. A syllable is never
 * squeezed below 60% of its spoken length: when the grid is too tight, the
 * next one moves along.
 */
export function placeSyllables(syllables: Syllable[], mode: SpeechSongMode, bpm: number) {
  const beat = 60 / bpm;
  const perBeat = mode === "rap" ? 4 : 2;
  const step = beat / perBeat;
  const pace = mode === "rap" ? 1 : 1.3;
  const t0 = syllables[0]?.start ?? 0;
  const slots: number[] = [];
  let earliest = 0;
  syllables.forEach((syllable, index) => {
    let slot = Math.max(earliest, Math.round(((syllable.start - t0) * pace) / step));
    if (index > 0 && syllable.start - syllables[index - 1].end > PHRASE_GAP) {
      slot = Math.max(slot, Math.ceil(earliest / perBeat) * perBeat);
    }
    slots.push(slot);
    const minimum = (syllable.end - syllable.start) * 0.6;
    earliest = slot + Math.max(1, Math.ceil(minimum / step - 1e-9));
  });
  return { slots, step, perBeat };
}

export function planSpeechSong(syllables: Syllable[], settings: SpeechSongSettings): SpeechSongPlan {
  const { mode, bpm, minor } = settings;
  const barSeconds = (60 / bpm) * 4;
  const centre = voiceCentre(syllables);
  const keyPc = settings.keyPc ?? ((Math.round(centre) % 12) + 12) % 12;
  const chords = spellProgression(minor ? ["1", "6", "3", "7"] : ["1", "5", "6", "4"], keyPc, minor, false);
  const { slots, step, perBeat } = placeSyllables(syllables, mode, bpm);

  const anchors: Anchor[] = [];
  const timing: { start: number; end: number }[] = [];
  syllables.forEach((syllable, index) => {
    const start = slots[index] * step;
    const spoken = syllable.end - syllable.start;
    const next = index + 1 < syllables.length ? slots[index + 1] * step : start + Math.max(spoken, 2 * step);
    const room = Math.max(0.02, next - start - 0.02);
    const target =
      mode === "rap"
        ? Math.min(Math.max(room * 0.9, spoken * 0.6), spoken * 1.15, room)
        : Math.min(Math.max(room * 0.95, spoken * 0.6), spoken + 1.2, room);
    const before = syllable.voicedStart - syllable.start;
    const vowel = syllable.voicedEnd - syllable.voicedStart;
    const after = syllable.end - syllable.voicedEnd;
    // Consonants keep their length (squeezed only if the syllable must
    // shrink); the vowel takes up whatever is left — that is singing.
    const squeeze = Math.min(1, target / Math.max(0.001, spoken));
    const vowelOut = Math.max(vowel * 0.5, target - (before + after) * squeeze);
    const a = start + before * squeeze;
    const b = a + vowelOut;
    const end = b + after * squeeze;
    anchors.push({ out: start, in: syllable.start });
    if (vowel > 0) {
      anchors.push({ out: a, in: syllable.voicedStart });
      anchors.push({ out: b, in: syllable.voicedEnd });
    }
    anchors.push({ out: end, in: syllable.end });
    timing.push({ start, end });
  });

  const notes: SungNote[] = [];
  const scale = (minor ? MINOR_STEPS : MAJOR_STEPS).map((offset) => (offset + keyPc) % 12);
  const home = Math.round(centre);
  // Each syllable's place in its phrase: the tune arches over a phrase and
  // comes home at its end.
  const phraseOf = syllables.map(() => ({ position: 0, size: 1 }));
  for (const phrase of findPhrases(syllables)) {
    for (let index = phrase.from; index < phrase.to; index += 1) {
      phraseOf[index] = { position: index - phrase.from, size: phrase.to - phrase.from };
    }
  }
  const sung: number[] = [];
  let contour = 0;
  syllables.forEach((syllable, index) => {
    const { start, end } = timing[index];
    const onBeat = slots[index] % perBeat === 0;
    if (mode === "rap") {
      notes.push({ syllable: index, start, end, midi: null, onBeat });
      return;
    }
    // The speaker's own rise and fall, exaggerated, is the tune; the arch
    // gives a flat speaker a melody too.
    if (syllable.f0 > 0) contour = (frequencyToMidi(syllable.f0) - centre) * 1.6;
    const { position, size } = phraseOf[index];
    const progress = size > 1 ? position / (size - 1) : 0;
    const arch = size > 2 ? 4 * Math.sin(Math.PI * progress) : 0;
    const chord = chords[Math.floor(start / barSeconds + 1e-9) % chords.length];
    const chordTones = chord.intervals.map((interval) => (chord.rootPc + interval) % 12);
    const allowed = onBeat ? chordTones : scale;
    const previous = sung.length ? sung[sung.length - 1] : null;
    let midi = nearestInSet(home + contour + arch, allowed);
    if (size > 2 && position === size - 1) {
      // The last syllable of a phrase lands on the chord's root: it resolves.
      midi = nearestInSet(previous ?? midi, [chord.rootPc]);
    } else if (previous !== null && midi === previous && sung.length > 1 && sung[sung.length - 2] === previous) {
      // A third time on the same note drones; step on, the way the arch goes.
      const up = progress < 0.5;
      for (let candidate = midi + (up ? 1 : -1); Math.abs(candidate - midi) <= 7; candidate += up ? 1 : -1) {
        if (allowed.includes(((candidate % 12) + 12) % 12)) {
          midi = candidate;
          break;
        }
      }
    }
    // A leap wider than a fifth is hard to sing: keep the direction, shorten the step.
    if (previous !== null && Math.abs(midi - previous) > 7) midi = nearestInSet(previous + Math.sign(midi - previous) * 5, allowed);
    midi = Math.max(home - 9, Math.min(home + 9, midi));
    if (!scale.includes(((midi % 12) + 12) % 12)) midi = nearestInSet(midi, scale);
    notes.push({ syllable: index, start, end, midi, onBeat });
    sung.push(midi);
  });

  const vocalLength = timing.length ? timing[timing.length - 1].end + 0.05 : 0;
  const bars = Math.max(2, Math.ceil(vocalLength / barSeconds / 2 - 1e-9) * 2);
  return { mode, notes, anchors, keyPc, minor, chords, bpm, barSeconds, bars, vocalLength };
}

// ---------------------------------------------------------------------------
// Moving the voice: TD-PSOLA
// ---------------------------------------------------------------------------

/** Output seconds to input seconds, from the anchors; slope 1 past either end. */
export function makeTimeMap(anchors: Anchor[]) {
  const points = [...anchors].sort((a, b) => a.out - b.out);
  return (out: number) => {
    if (!points.length) return out;
    if (out <= points[0].out) return points[0].in + (out - points[0].out);
    const last = points[points.length - 1];
    if (out >= last.out) return last.in + (out - last.out);
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (points[middle].out <= out) low = middle;
      else high = middle;
    }
    const a = points[low];
    const b = points[high];
    const span = b.out - a.out;
    return span > 1e-9 ? a.in + ((out - a.out) / span) * (b.in - a.in) : b.in;
  };
}

export type PitchMark = { pos: number; period: number; voiced: boolean };

/**
 * One mark per pitch period through the voiced parts, each on the period's
 * strongest sample so the grains line up; a steady 5 ms spacing through the
 * unvoiced parts, which have no period to follow.
 */
export function pitchMarks(samples: Float32Array, sampleRate: number, analysis: SpeechAnalysis): PitchMark[] {
  const unvoicedStep = Math.max(16, Math.round(0.005 * sampleRate));
  const f0At = (position: number) => analysis.f0[Math.round(position / sampleRate / analysis.hop)] ?? 0;
  const marks: PitchMark[] = [];
  let last = -unvoicedStep;
  let lastVoiced = false;
  while (true) {
    const probe = last + (lastVoiced ? marks[marks.length - 1].period : unvoicedStep);
    if (probe >= samples.length) break;
    const frequency = f0At(Math.max(0, probe));
    if (frequency > 0) {
      const period = sampleRate / frequency;
      const low = Math.max(last + 1, Math.round(lastVoiced ? last + 0.8 * period : probe));
      const high = Math.min(samples.length - 1, Math.round(lastVoiced ? last + 1.2 * period : probe + period));
      if (low > high) break;
      let best = low;
      for (let index = low; index <= high; index += 1) if (samples[index] > samples[best]) best = index;
      marks.push({ pos: best, period, voiced: true });
      last = best;
      lastVoiced = true;
    } else {
      const pos = Math.max(last + 1, Math.round(probe));
      marks.push({ pos, period: unvoicedStep, voiced: false });
      last = pos;
      lastVoiced = false;
    }
  }
  return marks;
}

function nearestMark(marks: PitchMark[], position: number) {
  let low = 0;
  let high = marks.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (marks[middle].pos <= position) low = middle;
    else high = middle;
  }
  return Math.abs(marks[high].pos - position) < Math.abs(marks[low].pos - position) ? high : low;
}

/**
 * Overlap-add of two-period grains: the time map says where in the
 * recording to read, the target says how far apart to lay the grains — and
 * so at what pitch the voice comes out.
 */
export function psola(
  samples: Float32Array,
  marks: PitchMark[],
  outLength: number,
  inAt: (outSample: number) => number,
  targetPeriod: (outSample: number, mark: PitchMark) => number,
): Float32Array {
  const out = new Float32Array(outLength);
  const weight = new Float32Array(outLength);
  if (!marks.length || !outLength) return out;
  let t = 0;
  while (t < outLength) {
    const source = inAt(t);
    const mark = marks[nearestMark(marks, source)];
    const half = Math.max(8, Math.round(mark.period));
    const centre = mark.voiced ? mark.pos : Math.round(source);
    const at = Math.round(t);
    for (let offset = -half + 1; offset < half; offset += 1) {
      const read = centre + offset;
      const write = at + offset;
      if (read < 0 || read >= samples.length || write < 0 || write >= outLength) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * offset) / half);
      out[write] += samples[read] * w;
      weight[write] += w;
    }
    t += mark.voiced ? Math.max(16, Math.min(mark.period * 2.2, targetPeriod(t, mark))) : half;
  }
  for (let index = 0; index < outLength; index += 1) out[index] /= Math.max(1, weight[index]);
  return out;
}

/** The midi to sing at `time` (seconds into the pass): glides in, and wavers on a long note. */
export function sungMidiAt(notes: SungNote[], time: number): number | null {
  if (!notes.length) return null;
  let index = -1;
  for (let i = 0; i < notes.length && notes[i].start <= time; i += 1) index = i;
  if (index < 0) index = 0;
  const note = notes[index];
  if (note.midi === null) return null;
  const into = time - note.start;
  const previous = index > 0 ? notes[index - 1].midi : null;
  const glide = 0.05;
  let midi = note.midi;
  if (previous !== null && into >= 0 && into < glide) midi = previous + (note.midi - previous) * (into / glide);
  if (into > 0.3 && time < note.end) midi += 0.25 * Math.sin(2 * Math.PI * 5.5 * (into - 0.3)) * Math.min(1, (into - 0.3) / 0.2);
  return midi;
}

/** One pass of the voice, moved onto the grid and (when singing) onto the notes. */
export function renderVocal(samples: Float32Array, sampleRate: number, analysis: SpeechAnalysis, plan: SpeechSongPlan): Float32Array {
  const marks = pitchMarks(samples, sampleRate, analysis);
  const map = makeTimeMap(plan.anchors);
  const length = Math.max(1, Math.ceil(plan.vocalLength * sampleRate));
  const vocal = psola(
    samples,
    marks,
    length,
    (outSample) => map(outSample / sampleRate) * sampleRate,
    (outSample, mark) => {
      const midi = sungMidiAt(plan.notes, outSample / sampleRate);
      return midi === null ? mark.period : sampleRate / midiToFrequency(midi);
    },
  );
  const peak = peakOf(vocal);
  if (peak > 0) for (let index = 0; index < vocal.length; index += 1) vocal[index] *= 0.9 / peak;
  return vocal;
}

// ---------------------------------------------------------------------------
// The whole song
// ---------------------------------------------------------------------------

/** One bar of lead-in before the voice, and one to ring out after it. */
export function songLayout(plan: SpeechSongPlan, repeats: number) {
  const intro = plan.barSeconds;
  const pass = plan.bars * plan.barSeconds;
  return { intro, pass, total: intro + pass * repeats + plan.barSeconds };
}

/** The notes of a chord around middle C, and its root down in the bass. */
export function chordVoicing(chord: ProgChord) {
  const tones = chord.intervals.map((interval) => {
    const pc = (chord.rootPc + interval) % 12;
    return 55 + ((pc - 55 + 120) % 12);
  });
  return { tones: tones.sort((a, b) => a - b), bass: 36 + chord.rootPc };
}

function patternFor(beat: SpeechSongBeat): Pattern {
  return (PRESETS.find((preset) => preset.id === beat) ?? PRESETS[0]).pattern;
}

function padNote(context: BaseAudioContext, destination: AudioNode, midi: number, when: number, duration: number, level: number) {
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  gain.connect(filter);
  filter.connect(destination);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(level, when + 0.08);
  gain.gain.setValueAtTime(level, when + Math.max(0.1, duration - 0.15));
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  for (const [type, detune] of [["sawtooth", -7], ["triangle", 6]] as const) {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = midiToFrequency(midi);
    osc.detune.value = detune;
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }
}

function bassNote(context: BaseAudioContext, destination: AudioNode, midi: number, when: number, duration: number, level: number) {
  const gain = context.createGain();
  gain.connect(destination);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(level, when + 0.01);
  gain.gain.exponentialRampToValueAtTime(level * 0.5, when + duration * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  const osc = context.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = midiToFrequency(midi);
  osc.connect(gain);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

/**
 * The song: the backing for every bar, with the vocal pass laid over it
 * `repeats` times, through a touch of room reverb and a bus compressor.
 */
export async function renderSpeechSong(
  vocal: Float32Array,
  vocalRate: number,
  plan: SpeechSongPlan,
  settings: Pick<SpeechSongSettings, "beat" | "repeats" | "backing">,
  sampleRate = 44_100,
): Promise<AudioBuffer> {
  const OfflineContext =
    window.OfflineAudioContext ||
    (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  const repeats = Math.max(1, Math.min(8, Math.round(settings.repeats)));
  const { intro, pass, total } = songLayout(plan, repeats);
  const context = new OfflineContext(2, Math.ceil((total + 1) * sampleRate), sampleRate);

  const master = context.createGain();
  master.gain.value = 0.9;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.ratio.value = 3;
  master.connect(compressor);
  compressor.connect(context.destination);

  const backing = context.createGain();
  backing.gain.value = Math.max(0, Math.min(1, settings.backing));
  backing.connect(master);

  // Backing: chords from the first bar, drums once the voice comes in.
  const bar = plan.barSeconds;
  const totalBars = Math.round((total - bar) / bar) + 1;
  const pattern = patternFor(settings.beat);
  const step = bar / STEPS;
  for (let barIndex = 0; barIndex < totalBars; barIndex += 1) {
    const at = barIndex * bar;
    const last = barIndex === totalBars - 1;
    // The progression starts over with every pass, as the tune was fitted to it.
    const chord = plan.chords[last ? 0 : (Math.max(0, barIndex - 1) % plan.bars) % plan.chords.length];
    const { tones, bass } = chordVoicing(chord);
    for (const tone of tones) padNote(context, backing, tone, at, last ? bar * 1.5 : bar, 0.05);
    if (barIndex === 0) {
      bassNote(context, backing, bass, at, bar * 0.9, 0.3);
      continue;
    }
    if (last) {
      bassNote(context, backing, bass, at, bar, 0.3);
      playVoice(context, backing, "kick", at, 0.9);
      playVoice(context, backing, "open", at, 0.6);
      continue;
    }
    for (let cell = 0; cell < STEPS; cell += 1) {
      const when = at + cell * step;
      for (const voice of VOICES) {
        const value = pattern[voice.id][cell];
        if (value) playVoice(context, backing, voice.id, when, (value === 2 ? 1 : 0.7) * 0.8);
      }
      // The bass follows the kick drum, which is what locks a groove.
      if (pattern.kick[cell]) bassNote(context, backing, bass, when, step * 3, 0.32);
    }
  }

  // The voice, dry and with a little room.
  const voiceBuffer = context.createBuffer(1, vocal.length, vocalRate);
  voiceBuffer.copyToChannel(vocal as Float32Array<ArrayBuffer>, 0);
  const dry = context.createGain();
  dry.gain.value = 1;
  dry.connect(master);
  const reverb = context.createConvolver();
  const impulse = makeImpulseResponse(sampleRate, 1.4, { decay: 3.5 });
  const impulseBuffer = context.createBuffer(2, impulse[0].length, sampleRate);
  impulse.forEach((channel, index) => impulseBuffer.copyToChannel(channel, index));
  reverb.buffer = impulseBuffer;
  const wet = context.createGain();
  wet.gain.value = 0.18;
  reverb.connect(wet);
  wet.connect(master);
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const source = context.createBufferSource();
    source.buffer = voiceBuffer;
    source.connect(dry);
    source.connect(reverb);
    source.start(intro + repeat * pass);
  }

  const rendered = await context.startRendering();
  const length = Math.ceil(total * sampleRate);
  const result = context.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = rendered.getChannelData(channel).slice(0, length);
    // Half a second of fade at the very end, so the file never clicks off.
    const fade = Math.min(length, Math.round(0.5 * sampleRate));
    for (let index = 0; index < fade; index += 1) data[length - 1 - index] *= index / fade;
    result.copyToChannel(data, channel);
  }
  return result;
}
