/**
 * The touch drum kit's engine room: which drums the kit has and where they
 * sit, how each of the three kits synthesises each drum (declared as data, so
 * the tests can see that nothing is missing), how hard a hit was from where it
 * landed, the keyboard map, and the arithmetic of the loop recorder — snapping
 * to the grid, and finding which recorded hits fall in the next slice of time
 * however many times the loop has gone round.
 *
 * Times in the loop are counted in beats (quarter notes), not seconds, so a
 * loop follows the tempo when it changes and renders exactly on the grid.
 */

import { foldTail } from "./drums";

/* ---- the kit ---- */

export type DrumId = "kick" | "snare" | "hat" | "open" | "crash" | "ride" | "tom1" | "tom2" | "floor" | "clap";
export type DrumShape = "kick" | "drum" | "cymbal" | "pad";
export type KitId = "acoustic" | "electronic" | "808";
/** Where on the drum it was struck: the rim of a drum, the bell of a cymbal, or anywhere else. */
export type Zone = "normal" | "edge" | "bell";

export type DrumInfo = {
  id: DrumId;
  label: string;
  shape: DrumShape;
  /** Place on the top-down kit: centre in percent of the board's width / height, diameter in percent of its width. */
  x: number;
  y: number;
  size: number;
};

export const DRUMS: DrumInfo[] = [
  { id: "crash", label: "קראש", shape: "cymbal", x: 31, y: 19, size: 21 },
  { id: "open", label: "היי־האט פתוח", shape: "cymbal", x: 12, y: 31, size: 15 },
  { id: "ride", label: "רייד", shape: "cymbal", x: 81, y: 24, size: 23 },
  { id: "hat", label: "היי־האט", shape: "cymbal", x: 12, y: 64, size: 16 },
  { id: "tom1", label: "טום 1", shape: "drum", x: 42, y: 44, size: 14 },
  { id: "tom2", label: "טום 2", shape: "drum", x: 59, y: 44, size: 14 },
  { id: "snare", label: "סנר", shape: "drum", x: 29, y: 61, size: 17 },
  { id: "floor", label: "טום רצפה", shape: "drum", x: 74, y: 65, size: 19 },
  { id: "clap", label: "מחיאה", shape: "pad", x: 92, y: 83, size: 12 },
  { id: "kick", label: "בס־דראם", shape: "kick", x: 50, y: 75, size: 24 },
];

export const DRUM_IDS = DRUMS.map((drum) => drum.id);

export function isDrumId(value: unknown): value is DrumId {
  return typeof value === "string" && (DRUM_IDS as string[]).includes(value);
}

export const KITS: { id: KitId; label: string }[] = [
  { id: "acoustic", label: "אקוסטית" },
  { id: "electronic", label: "אלקטרונית" },
  { id: "808", label: "808" },
];

export function isKitId(value: unknown): value is KitId {
  return value === "acoustic" || value === "electronic" || value === "808";
}

/* ---- keyboard ---- */

/**
 * Two keys for most drums, one for each hand, read by physical position
 * (KeyboardEvent.code) so the map works the same with a Hebrew layout.
 */
export const KEY_MAP: Record<DrumId, { code: string; label: string }[]> = {
  kick: [{ code: "Space", label: "רווח" }, { code: "KeyB", label: "B" }],
  snare: [{ code: "KeyF", label: "F" }, { code: "KeyJ", label: "J" }],
  hat: [{ code: "KeyD", label: "D" }, { code: "KeyK", label: "K" }],
  open: [{ code: "KeyE", label: "E" }, { code: "KeyI", label: "I" }],
  crash: [{ code: "KeyR", label: "R" }, { code: "KeyU", label: "U" }],
  ride: [{ code: "KeyS", label: "S" }, { code: "KeyL", label: "L" }],
  tom1: [{ code: "KeyG", label: "G" }, { code: "KeyT", label: "T" }],
  tom2: [{ code: "KeyH", label: "H" }, { code: "KeyY", label: "Y" }],
  floor: [{ code: "KeyN", label: "N" }, { code: "KeyM", label: "M" }],
  clap: [{ code: "KeyC", label: "C" }, { code: "KeyX", label: "X" }],
};

const CODE_TO_DRUM = new Map<string, DrumId>(
  (Object.keys(KEY_MAP) as DrumId[]).flatMap((drum) => KEY_MAP[drum].map((key) => [key.code, drum] as const)),
);

export function drumForCode(code: string): DrumId | null {
  return CODE_TO_DRUM.get(code) ?? null;
}

/**
 * A note from a MIDI drum pad or e-kit, by the General MIDI drum map; the
 * side-stick plays the snare's rim and the ride-bell note its bell. Notes
 * outside the map go round the kit from note 36, where pad controllers start.
 */
export function drumForMidiNote(note: number): { drum: DrumId; zone: Zone } {
  const GM: Record<number, [DrumId, Zone]> = {
    35: ["kick", "normal"], 36: ["kick", "normal"],
    37: ["snare", "edge"], 38: ["snare", "normal"], 40: ["snare", "edge"],
    39: ["clap", "normal"],
    42: ["hat", "normal"], 44: ["hat", "normal"], 46: ["open", "normal"],
    41: ["floor", "normal"], 43: ["floor", "normal"],
    45: ["tom2", "normal"], 47: ["tom2", "normal"],
    48: ["tom1", "normal"], 50: ["tom1", "normal"],
    49: ["crash", "normal"], 52: ["crash", "edge"], 55: ["crash", "normal"], 57: ["crash", "normal"],
    51: ["ride", "normal"], 59: ["ride", "normal"], 53: ["ride", "bell"],
  };
  const known = GM[note];
  if (known) return { drum: known[0], zone: known[1] };
  const index = (((note - 36) % DRUM_IDS.length) + DRUM_IDS.length) % DRUM_IDS.length;
  return { drum: DRUM_IDS[index], zone: "normal" };
}

/* ---- where it was hit ---- */

export const BELL_RADIUS = 0.3;
export const RIM_RADIUS = 0.84;

/**
 * How hard a hit was, from where it landed. `dx`, `dy` are the offset from
 * the centre in units of the radius (so the rim is at distance 1). A drum is
 * loudest in the middle and softer toward the edge, and its outer ring is the
 * rim; a cymbal has its bell in the middle, and grows louder and washier
 * toward the edge, the way a stick on the edge of a crash sounds.
 */
export function velocityFromPosition(dx: number, dy: number, shape: DrumShape): { velocity: number; zone: Zone } {
  const r = Math.min(1, Math.hypot(Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0));
  let velocity: number;
  let zone: Zone = "normal";
  if (shape === "cymbal") {
    if (r < BELL_RADIUS) {
      zone = "bell";
      velocity = 0.95 - 0.15 * (r / BELL_RADIUS);
    } else {
      velocity = 0.62 + 0.38 * ((r - BELL_RADIUS) / (1 - BELL_RADIUS));
      if (r > 0.86) zone = "edge";
    }
  } else {
    velocity = 1 - 0.6 * r * r;
    if (shape === "drum" && r > RIM_RADIUS) zone = "edge";
  }
  return { velocity: round2(Math.max(0.3, Math.min(1, velocity))), zone };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/* ---- the loop ---- */

export type LoopEvent = {
  drum: DrumId;
  /** Beats from the start of the loop, 0 ≤ beat < loop length. */
  beat: number;
  velocity: number;
  zone: Zone;
  /**
   * Live only, never saved: the audio-clock time before which this hit is not
   * replayed — it was just played by hand, and its snapped copy a moment later
   * would sound as a flam.
   */
  notBefore?: number;
};

export type Take = { id: string; events: LoopEvent[] };

export const BEATS_PER_BAR = 4;
export const LOOP_BARS = [1, 2, 4, 8] as const;
export type LoopLength = "free" | (typeof LOOP_BARS)[number];

export function secondsPerBeat(bpm: number) {
  return 60 / bpm;
}

/** Snaps a position in beats to the nearest 1/`division` of a beat (4 = sixteenth notes). */
export function quantizeBeat(beat: number, division = 4) {
  const snapped = Math.round(beat * division) / division;
  return Object.is(snapped, -0) ? 0 : snapped;
}

/** A position folded into the loop, 0 ≤ result < loopBeats. */
export function wrapBeat(beat: number, loopBeats: number) {
  if (!(loopBeats > 0)) return beat;
  const wrapped = ((beat % loopBeats) + loopBeats) % loopBeats;
  // Floating point can land a hair under the length; that is the downbeat.
  return loopBeats - wrapped < 1e-9 ? 0 : wrapped;
}

/**
 * How long a loop played freely (without a set number of bars) is: when the
 * grid is on, the nearest whole beat, at least one; otherwise as played, at
 * least a sixteenth.
 */
export function freeLoopBeats(recordedBeats: number, quantize: boolean) {
  if (!Number.isFinite(recordedBeats)) return quantize ? 1 : 0.25;
  return quantize ? Math.max(1, Math.round(recordedBeats)) : Math.max(0.25, recordedBeats);
}

/**
 * Every repetition of the loop's hits that falls in [fromBeat, toBeat) on the
 * transport's clock, in time order. The loop's first pass starts at
 * `loopStart`; a window can straddle the loop's end, or span several passes.
 */
export function loopEventsInWindow<T extends { beat: number }>(
  events: readonly T[],
  loopBeats: number,
  loopStart: number,
  fromBeat: number,
  toBeat: number,
): { event: T; beat: number }[] {
  if (!(loopBeats > 0) || !(toBeat > fromBeat) || !events.length) return [];
  const out: { event: T; beat: number }[] = [];
  const firstCycle = Math.max(0, Math.floor((fromBeat - loopStart) / loopBeats));
  const lastCycle = Math.floor((toBeat - loopStart) / loopBeats);
  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    const base = loopStart + cycle * loopBeats;
    for (const event of events) {
      if (!(event.beat >= 0 && event.beat < loopBeats)) continue;
      const beat = base + event.beat;
      if (beat >= fromBeat && beat < toBeat) out.push({ event, beat });
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}

/** Whole beats in [fromBeat, toBeat), for the metronome; `accent` on each bar's downbeat. */
export function clicksInWindow(fromBeat: number, toBeat: number): { beat: number; accent: boolean }[] {
  const out: { beat: number; accent: boolean }[] = [];
  for (let beat = Math.ceil(fromBeat); beat < toBeat; beat += 1) {
    out.push({ beat, accent: ((beat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR === 0 });
  }
  return out;
}

/** Where a new hit goes in the loop: snapped to the grid if asked, then folded into the loop. */
export function placeHit(absoluteBeat: number, loopStart: number, loopBeats: number | null, quantize: boolean) {
  const snapped = quantize ? quantizeBeat(absoluteBeat) : absoluteBeat;
  const relative = snapped - loopStart;
  return { snapped, beat: loopBeats ? wrapBeat(relative, loopBeats) : relative };
}

export function countEvents(takes: readonly Take[]) {
  return takes.reduce((sum, take) => sum + take.events.length, 0);
}

/* ---- saved settings ---- */

export type DrumKitSettings = {
  kit: KitId;
  volume: number;
  bpm: number;
  click: boolean;
  quantize: boolean;
  countIn: boolean;
  length: LoopLength;
  /** The recorded loop, so it is still there next visit. */
  loopBeats: number | null;
  takes: Take[];
};

export const DEFAULT_SETTINGS: DrumKitSettings = {
  kit: "acoustic",
  volume: 0.85,
  bpm: 100,
  click: false,
  quantize: true,
  countIn: true,
  length: 2,
  loopBeats: null,
  takes: [],
};

export const MIN_BPM = 40;
export const MAX_BPM = 240;
const MAX_SAVED_EVENTS = 4000;

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** Settings read back from storage: anything missing or malformed falls back to the default. */
export function normalizeSettings(raw: unknown): DrumKitSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const length: LoopLength =
    source.length === "free" ? "free" : (LOOP_BARS as readonly number[]).includes(Number(source.length)) ? (Number(source.length) as LoopLength) : DEFAULT_SETTINGS.length;
  const loopBeats = source.loopBeats === null || source.loopBeats === undefined ? null : clampNumber(source.loopBeats, 0.25, 256, 0) || null;
  let budget = MAX_SAVED_EVENTS;
  const takes: Take[] = [];
  if (loopBeats && Array.isArray(source.takes)) {
    for (const rawTake of source.takes) {
      if (!rawTake || typeof rawTake !== "object" || !Array.isArray((rawTake as Take).events)) continue;
      const events: LoopEvent[] = [];
      for (const item of (rawTake as Take).events) {
        if (budget <= 0 || !item || typeof item !== "object" || !isDrumId(item.drum)) continue;
        const beat = Number(item.beat);
        if (!Number.isFinite(beat) || beat < 0 || beat >= loopBeats) continue;
        const zone: Zone = item.zone === "edge" || item.zone === "bell" ? item.zone : "normal";
        events.push({ drum: item.drum, beat, velocity: clampNumber(item.velocity, 0.05, 1, 0.8), zone });
        budget -= 1;
      }
      if (events.length) takes.push({ id: String((rawTake as Take).id || takes.length + 1), events });
    }
  }
  return {
    kit: isKitId(source.kit) ? source.kit : DEFAULT_SETTINGS.kit,
    volume: clampNumber(source.volume, 0, 1, DEFAULT_SETTINGS.volume),
    bpm: Math.round(clampNumber(source.bpm, MIN_BPM, MAX_BPM, DEFAULT_SETTINGS.bpm)),
    click: typeof source.click === "boolean" ? source.click : DEFAULT_SETTINGS.click,
    quantize: typeof source.quantize === "boolean" ? source.quantize : DEFAULT_SETTINGS.quantize,
    countIn: typeof source.countIn === "boolean" ? source.countIn : DEFAULT_SETTINGS.countIn,
    length,
    loopBeats: takes.length ? loopBeats : null,
    takes,
  };
}

/** What goes to storage: the live-only fields are left behind. */
export function serializeSettings(settings: DrumKitSettings) {
  return JSON.stringify({
    ...settings,
    takes: settings.takes.map((take) => ({
      id: take.id,
      events: take.events.map(({ drum, beat, velocity, zone }) => ({ drum, beat: Math.round(beat * 10_000) / 10_000, velocity, zone })),
    })),
  });
}

/* ---- the sounds, as data ---- */

type Wave = OscillatorType;

export type ToneLayer = { type: "tone"; wave: Wave; from: number; to: number; sweep: number; peak: number; decay: number; delay?: number };
export type NoiseLayer = {
  type: "noise";
  filter: BiquadFilterType;
  frequency: number;
  q?: number;
  peak: number;
  decay: number;
  delay?: number;
  /** Several quick bursts, as in a hand clap: offsets in seconds. */
  bursts?: number[];
};
/** A cluster of square waves at inharmonic pitches through a filter — the 808's way to a cymbal. */
export type MetalLayer = { type: "metal"; frequencies: number[]; filter: BiquadFilterType; frequency: number; q?: number; peak: number; decay: number };
export type Layer = ToneLayer | NoiseLayer | MetalLayer;

export type VoiceParams = {
  layers: Layer[];
  /** Extra layers for a hit on the rim (drums) or edge (cymbals). */
  edge?: Layer[];
  /** Extra layers for a hit on a cymbal's bell; the body is then quieter. */
  bell?: Layer[];
  /** Drums this one cuts off, like the closed hi-hat stopping the open one. */
  chokes?: DrumId[];
};

const METAL_808 = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(scale: number) {
  return METAL_808.map((frequency) => Math.round(frequency * scale * 10) / 10);
}

const rimClick = (frequency: number, peak = 0.32): ToneLayer => ({ type: "tone", wave: "triangle", from: frequency, to: frequency * 0.85, sweep: 0.015, peak, decay: 0.025 });

export const KIT_VOICES: Record<KitId, Record<DrumId, VoiceParams>> = {
  acoustic: {
    kick: {
      layers: [
        { type: "tone", wave: "sine", from: 115, to: 47, sweep: 0.08, peak: 1.0, decay: 0.4 },
        { type: "noise", filter: "lowpass", frequency: 1100, peak: 0.25, decay: 0.03 },
        { type: "tone", wave: "triangle", from: 1300, to: 300, sweep: 0.01, peak: 0.14, decay: 0.015 },
      ],
    },
    snare: {
      layers: [
        { type: "noise", filter: "bandpass", frequency: 3600, q: 0.6, peak: 0.6, decay: 0.22 },
        { type: "noise", filter: "highpass", frequency: 5500, peak: 0.22, decay: 0.12 },
        { type: "tone", wave: "triangle", from: 225, to: 180, sweep: 0.04, peak: 0.5, decay: 0.09 },
        { type: "tone", wave: "sine", from: 335, to: 290, sweep: 0.03, peak: 0.26, decay: 0.06 },
      ],
      edge: [rimClick(1750, 0.38), { type: "tone", wave: "square", from: 520, to: 480, sweep: 0.02, peak: 0.12, decay: 0.04 }],
    },
    hat: {
      layers: [
        { type: "noise", filter: "highpass", frequency: 9000, peak: 0.34, decay: 0.05 },
        { type: "metal", frequencies: metal(1.6), filter: "highpass", frequency: 8000, peak: 0.12, decay: 0.04 },
      ],
      chokes: ["open"],
    },
    open: {
      layers: [
        { type: "noise", filter: "highpass", frequency: 8000, peak: 0.28, decay: 0.45 },
        { type: "metal", frequencies: metal(1.6), filter: "highpass", frequency: 7200, peak: 0.12, decay: 0.5 },
      ],
    },
    crash: {
      layers: [
        { type: "noise", filter: "highpass", frequency: 5200, peak: 0.42, decay: 1.6 },
        { type: "noise", filter: "bandpass", frequency: 3200, q: 0.5, peak: 0.18, decay: 1.2 },
        { type: "metal", frequencies: metal(1.35), filter: "highpass", frequency: 5000, peak: 0.1, decay: 1.4 },
      ],
      edge: [{ type: "noise", filter: "bandpass", frequency: 2400, q: 0.7, peak: 0.16, decay: 0.9 }],
      bell: [{ type: "metal", frequencies: metal(2.2), filter: "bandpass", frequency: 2600, q: 1.4, peak: 0.34, decay: 0.8 }],
    },
    ride: {
      layers: [
        { type: "metal", frequencies: metal(1.9), filter: "highpass", frequency: 4800, peak: 0.16, decay: 1.1 },
        { type: "noise", filter: "highpass", frequency: 7500, peak: 0.12, decay: 0.8 },
        { type: "tone", wave: "sine", from: 3900, to: 3900, sweep: 0.01, peak: 0.04, decay: 0.5 },
      ],
      edge: [{ type: "noise", filter: "highpass", frequency: 4500, peak: 0.16, decay: 1.2 }],
      bell: [
        { type: "tone", wave: "sine", from: 1120, to: 1120, sweep: 0.01, peak: 0.34, decay: 0.9 },
        { type: "tone", wave: "sine", from: 1690, to: 1690, sweep: 0.01, peak: 0.2, decay: 0.7 },
        { type: "metal", frequencies: metal(2.6), filter: "bandpass", frequency: 3000, q: 1.2, peak: 0.16, decay: 0.6 },
      ],
    },
    tom1: {
      layers: [
        { type: "tone", wave: "sine", from: 265, to: 190, sweep: 0.2, peak: 0.85, decay: 0.34 },
        { type: "noise", filter: "lowpass", frequency: 3000, peak: 0.1, decay: 0.04 },
      ],
      edge: [rimClick(1500)],
    },
    tom2: {
      layers: [
        { type: "tone", wave: "sine", from: 205, to: 145, sweep: 0.22, peak: 0.85, decay: 0.42 },
        { type: "noise", filter: "lowpass", frequency: 2600, peak: 0.1, decay: 0.04 },
      ],
      edge: [rimClick(1350)],
    },
    floor: {
      layers: [
        { type: "tone", wave: "sine", from: 135, to: 88, sweep: 0.3, peak: 0.95, decay: 0.6 },
        { type: "noise", filter: "lowpass", frequency: 2000, peak: 0.1, decay: 0.05 },
      ],
      edge: [rimClick(1150)],
    },
    clap: {
      layers: [
        { type: "noise", filter: "bandpass", frequency: 1200, q: 1.2, peak: 0.55, decay: 0.03, bursts: [0, 0.011, 0.023] },
        { type: "noise", filter: "bandpass", frequency: 1100, q: 0.9, peak: 0.45, decay: 0.22, delay: 0.03 },
      ],
    },
  },
  electronic: {
    kick: {
      layers: [
        { type: "tone", wave: "sine", from: 190, to: 50, sweep: 0.06, peak: 1.05, decay: 0.5 },
        { type: "tone", wave: "triangle", from: 2600, to: 600, sweep: 0.01, peak: 0.2, decay: 0.01 },
        { type: "noise", filter: "highpass", frequency: 3000, peak: 0.08, decay: 0.012 },
      ],
    },
    snare: {
      layers: [
        { type: "tone", wave: "triangle", from: 195, to: 160, sweep: 0.05, peak: 0.55, decay: 0.12 },
        { type: "noise", filter: "highpass", frequency: 1800, peak: 0.6, decay: 0.2 },
      ],
      edge: [rimClick(2000, 0.34)],
    },
    hat: { layers: [{ type: "noise", filter: "highpass", frequency: 9500, peak: 0.36, decay: 0.035 }], chokes: ["open"] },
    open: { layers: [{ type: "noise", filter: "highpass", frequency: 8500, peak: 0.3, decay: 0.3 }] },
    crash: {
      layers: [
        { type: "noise", filter: "highpass", frequency: 6500, peak: 0.4, decay: 1.1 },
        { type: "metal", frequencies: metal(1.5), filter: "highpass", frequency: 6000, peak: 0.1, decay: 1.0 },
      ],
      edge: [{ type: "noise", filter: "bandpass", frequency: 3000, q: 0.6, peak: 0.14, decay: 0.8 }],
      bell: [{ type: "metal", frequencies: metal(2.4), filter: "bandpass", frequency: 3200, q: 1.5, peak: 0.3, decay: 0.5 }],
    },
    ride: {
      layers: [
        { type: "metal", frequencies: metal(2), filter: "bandpass", frequency: 4600, q: 1.6, peak: 0.24, decay: 0.8 },
        { type: "noise", filter: "highpass", frequency: 9000, peak: 0.08, decay: 0.6 },
      ],
      edge: [{ type: "noise", filter: "highpass", frequency: 6000, peak: 0.12, decay: 0.9 }],
      bell: [
        { type: "tone", wave: "triangle", from: 950, to: 950, sweep: 0.01, peak: 0.26, decay: 0.5 },
        { type: "tone", wave: "triangle", from: 1425, to: 1425, sweep: 0.01, peak: 0.18, decay: 0.4 },
      ],
    },
    tom1: { layers: [{ type: "tone", wave: "sine", from: 340, to: 220, sweep: 0.12, peak: 0.8, decay: 0.28 }], edge: [rimClick(1900, 0.26)] },
    tom2: { layers: [{ type: "tone", wave: "sine", from: 255, to: 160, sweep: 0.13, peak: 0.82, decay: 0.34 }], edge: [rimClick(1700, 0.26)] },
    floor: { layers: [{ type: "tone", wave: "sine", from: 175, to: 100, sweep: 0.16, peak: 0.9, decay: 0.45 }], edge: [rimClick(1500, 0.26)] },
    clap: {
      layers: [
        { type: "noise", filter: "bandpass", frequency: 1500, q: 1.5, peak: 0.55, decay: 0.025, bursts: [0, 0.009, 0.018, 0.027] },
        { type: "noise", filter: "bandpass", frequency: 1400, q: 1, peak: 0.42, decay: 0.25, delay: 0.035 },
      ],
    },
  },
  "808": {
    kick: {
      layers: [
        { type: "tone", wave: "sine", from: 125, to: 48, sweep: 0.05, peak: 1.0, decay: 1.1 },
        { type: "tone", wave: "triangle", from: 900, to: 200, sweep: 0.01, peak: 0.16, decay: 0.012 },
      ],
    },
    snare: {
      layers: [
        { type: "tone", wave: "sine", from: 238, to: 230, sweep: 0.05, peak: 0.42, decay: 0.1 },
        { type: "tone", wave: "sine", from: 476, to: 470, sweep: 0.05, peak: 0.24, decay: 0.08 },
        { type: "noise", filter: "highpass", frequency: 2500, peak: 0.45, decay: 0.16 },
      ],
      edge: [{ type: "tone", wave: "triangle", from: 1700, to: 1700, sweep: 0.01, peak: 0.34, decay: 0.03 }],
    },
    hat: { layers: [{ type: "metal", frequencies: metal(1), filter: "highpass", frequency: 8000, peak: 0.32, decay: 0.05 }], chokes: ["open"] },
    open: { layers: [{ type: "metal", frequencies: metal(1), filter: "highpass", frequency: 8000, peak: 0.28, decay: 0.36 }] },
    crash: {
      layers: [
        { type: "metal", frequencies: metal(1), filter: "highpass", frequency: 5500, peak: 0.3, decay: 1.3 },
        { type: "noise", filter: "highpass", frequency: 7000, peak: 0.12, decay: 0.9 },
      ],
      edge: [{ type: "metal", frequencies: metal(0.8), filter: "bandpass", frequency: 3000, q: 0.8, peak: 0.12, decay: 0.9 }],
      bell: [{ type: "metal", frequencies: metal(1), filter: "bandpass", frequency: 3500, q: 1.3, peak: 0.34, decay: 0.6 }],
    },
    ride: {
      layers: [{ type: "metal", frequencies: metal(1.2), filter: "bandpass", frequency: 5000, q: 1, peak: 0.25, decay: 0.9 }],
      edge: [{ type: "metal", frequencies: metal(1.2), filter: "highpass", frequency: 6000, peak: 0.1, decay: 1.0 }],
      // The 808 cowbell, where a ride's bell would be.
      bell: [{ type: "metal", frequencies: [545, 815], filter: "bandpass", frequency: 900, q: 2, peak: 0.34, decay: 0.32 }],
    },
    tom1: { layers: [{ type: "tone", wave: "sine", from: 245, to: 210, sweep: 0.25, peak: 0.8, decay: 0.45 }], edge: [rimClick(1600, 0.24)] },
    tom2: { layers: [{ type: "tone", wave: "sine", from: 185, to: 155, sweep: 0.3, peak: 0.82, decay: 0.5 }], edge: [rimClick(1450, 0.24)] },
    floor: { layers: [{ type: "tone", wave: "sine", from: 122, to: 100, sweep: 0.35, peak: 0.9, decay: 0.65 }], edge: [rimClick(1250, 0.24)] },
    clap: {
      layers: [
        { type: "noise", filter: "bandpass", frequency: 1000, q: 1, peak: 0.55, decay: 0.028, bursts: [0, 0.012, 0.024] },
        { type: "noise", filter: "bandpass", frequency: 1000, q: 0.9, peak: 0.45, decay: 0.3, delay: 0.034 },
      ],
    },
  },
};

/** The longest a voice rings, in seconds — how much tail a render needs. */
export function voiceLength(params: VoiceParams) {
  return Math.max(
    ...[...params.layers, ...(params.edge ?? []), ...(params.bell ?? [])].map(
      (layer) => (layer.type === "noise" ? (layer.delay ?? 0) + Math.max(0, ...(layer.bursts ?? [0])) : layer.type === "tone" ? layer.delay ?? 0 : 0) + layer.decay,
    ),
  );
}

/* ---- the sounds, played ---- */

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(context: BaseAudioContext) {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.floor(context.sampleRate * 2), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    noiseBuffers.set(context, buffer);
  }
  return buffer;
}

/**
 * Plays the kit on one audio context — live or offline, the same code — so
 * a loop exported to WAV sounds like what was played.
 */
export class DrumSynth {
  private readonly context: BaseAudioContext;
  private readonly destination: AudioNode;
  /** The latest voice of each drum, so a closed hi-hat can cut the open one off. */
  private readonly ringing = new Map<DrumId, { gain: GainNode; start: number; end: number }>();

  constructor(context: BaseAudioContext, destination: AudioNode) {
    this.context = context;
    this.destination = destination;
  }

  play(drum: DrumId, kit: KitId, time: number, velocity: number, zone: Zone = "normal") {
    const params = KIT_VOICES[kit][drum];
    const v = Math.max(0, Math.min(1, velocity));
    if (!params || v <= 0) return;
    const context = this.context;
    const at = Math.max(time, context.currentTime);

    for (const choked of params.chokes ?? []) {
      const voice = this.ringing.get(choked);
      if (voice && voice.start < at && voice.end > at) {
        voice.gain.gain.setValueAtTime(1, at);
        voice.gain.gain.linearRampToValueAtTime(0, at + 0.025);
        voice.end = at;
      }
    }

    const out = context.createGain();
    out.gain.value = 1;
    out.connect(this.destination);
    // Softer hits are darker and shorter, as on a real drum.
    const level = Math.pow(v, 1.4);
    const brightness = 0.72 + 0.28 * v;
    const length = 0.85 + 0.15 * v;
    const bodyLevel = zone === "bell" && params.bell ? 0.35 : 1;
    const layers: { layer: Layer; gain: number }[] = params.layers.map((layer) => ({ layer, gain: bodyLevel }));
    if (zone === "edge" && params.edge) layers.push(...params.edge.map((layer) => ({ layer, gain: 1 })));
    if (zone === "bell" && params.bell) layers.push(...params.bell.map((layer) => ({ layer, gain: 1 })));

    let end = at;
    for (const { layer, gain } of layers) {
      end = Math.max(end, this.layer(out, layer, at, level * gain, brightness, length));
    }
    this.ringing.set(drum, { gain: out, start: at, end });
    // The voice's own gain node goes once everything in it has stopped.
    if ("OfflineAudioContext" in globalThis && context instanceof OfflineAudioContext) return;
    const lifetime = (end - context.currentTime + 0.2) * 1000;
    globalThis.setTimeout?.(() => out.disconnect(), Math.max(50, lifetime));
  }

  private envelope(destination: AudioNode, time: number, peak: number, decay: number) {
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.0015 + decay);
    gain.connect(destination);
    return gain;
  }

  /** Schedules one layer; returns when it has stopped. */
  private layer(out: AudioNode, layer: Layer, time: number, level: number, brightness: number, length: number) {
    const context = this.context;
    const decay = layer.decay * length;
    if (layer.type === "tone") {
      const start = time + (layer.delay ?? 0);
      const osc = context.createOscillator();
      osc.type = layer.wave;
      osc.frequency.setValueAtTime(layer.from, start);
      if (layer.to !== layer.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, layer.to), start + layer.sweep);
      osc.connect(this.envelope(out, start, layer.peak * level, decay));
      osc.start(start);
      osc.stop(start + decay + 0.05);
      return start + decay + 0.05;
    }
    if (layer.type === "noise") {
      let last = time;
      for (const offset of layer.bursts ?? [0]) {
        const start = time + (layer.delay ?? 0) + offset;
        const source = context.createBufferSource();
        source.buffer = noiseBuffer(context);
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = layer.filter;
        filter.frequency.value = Math.min(context.sampleRate / 2 - 100, layer.frequency * (layer.filter === "highpass" ? 1 : brightness));
        filter.Q.value = layer.q ?? 0.8;
        source.connect(filter);
        filter.connect(this.envelope(out, start, layer.peak * level, decay));
        // Start somewhere different in the noise each time, so repeated hits are not identical.
        source.start(start, Math.random() * 1.5);
        source.stop(start + decay + 0.05);
        last = Math.max(last, start + decay + 0.05);
      }
      return last;
    }
    const filter = context.createBiquadFilter();
    filter.type = layer.filter;
    filter.frequency.value = Math.min(context.sampleRate / 2 - 100, layer.frequency * (layer.filter === "highpass" ? 1 : brightness));
    filter.Q.value = layer.q ?? 0.8;
    filter.connect(this.envelope(out, time, layer.peak * level, decay));
    for (const frequency of layer.frequencies) {
      const osc = context.createOscillator();
      osc.type = "square";
      osc.frequency.value = frequency;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + decay + 0.05);
    }
    return time + decay + 0.05;
  }
}

/** Master level into a gentle compressor, the same live and offline. */
export function masterChain(context: BaseAudioContext, volume: number) {
  const master = context.createGain();
  master.gain.value = volume;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 8;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  master.connect(compressor);
  compressor.connect(context.destination);
  return master;
}

/**
 * The loop rendered to audio, exactly `loopBeats` long so it repeats on the
 * grid: cymbals still ringing at the end are folded back onto the start, the
 * way they sound when the loop comes round.
 */
export async function renderDrumLoop(
  options: { events: readonly LoopEvent[]; loopBeats: number; bpm: number; kit: KitId; volume: number; repeats?: number },
  sampleRate = 44_100,
): Promise<AudioBuffer> {
  const OfflineContext =
    window.OfflineAudioContext ||
    (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  const repeats = Math.max(1, Math.round(options.repeats ?? 1));
  const spb = secondsPerBeat(options.bpm);
  const loopFrames = Math.max(1, Math.round(options.loopBeats * spb * repeats * sampleRate));
  const tail = Math.max(...DRUM_IDS.map((drum) => voiceLength(KIT_VOICES[options.kit][drum]))) + 0.2;
  const context = new OfflineContext(2, loopFrames + Math.ceil(tail * sampleRate), sampleRate);
  const synth = new DrumSynth(context, masterChain(context, options.volume));
  const hits = loopEventsInWindow(options.events, options.loopBeats, 0, 0, options.loopBeats * repeats);
  for (const { event, beat } of hits) synth.play(event.drum, options.kit, beat * spb, event.velocity, event.zone);
  const rendered = await context.startRendering();
  const loop = new AudioBuffer({ length: loopFrames, numberOfChannels: rendered.numberOfChannels, sampleRate });
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    loop.copyToChannel(foldTail(rendered.getChannelData(channel), loopFrames), channel);
  }
  return loop;
}
