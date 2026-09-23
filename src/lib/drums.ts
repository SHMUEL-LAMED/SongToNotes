/**
 * The drum machine's engine: eight voices synthesised from oscillators and
 * noise (nothing is fetched, so it works offline and nothing leaves the
 * device), a pattern of sixteen steps, and a scheduler that runs off the audio
 * clock rather than a timer — the same approach as the metronome, so the
 * groove stays tight however busy the page is.
 */

export const STEPS = 16;

export type VoiceId = "kick" | "snare" | "clap" | "hat" | "open" | "lowTom" | "highTom" | "cowbell";

export const VOICES: { id: VoiceId; label: string; short: string; hue: number }[] = [
  { id: "kick", label: "בס־דראם", short: "KICK", hue: 28 },
  { id: "snare", label: "סנר", short: "SNARE", hue: 52 },
  { id: "clap", label: "מחיאה", short: "CLAP", hue: 85 },
  { id: "hat", label: "היי־האט סגור", short: "HAT", hue: 165 },
  { id: "open", label: "היי־האט פתוח", short: "OPEN", hue: 200 },
  { id: "lowTom", label: "טום נמוך", short: "LO TOM", hue: 262 },
  { id: "highTom", label: "טום גבוה", short: "HI TOM", hue: 300 },
  { id: "cowbell", label: "קאובל", short: "BELL", hue: 340 },
];

/** 0 = rest, 1 = hit, 2 = accented hit. */
export type Cell = 0 | 1 | 2;
export type Pattern = Record<VoiceId, Cell[]>;

export type Mix = Record<VoiceId, { volume: number; muted: boolean }>;

export function emptyPattern(): Pattern {
  return Object.fromEntries(VOICES.map((voice) => [voice.id, Array<Cell>(STEPS).fill(0)])) as Pattern;
}

export function defaultMix(): Mix {
  return Object.fromEntries(VOICES.map((voice) => [voice.id, { volume: 0.8, muted: false }])) as Mix;
}

/** A pattern from a compact string per voice: "x" hit, "X" accent, anything else a rest. */
function fromStrings(rows: Partial<Record<VoiceId, string>>): Pattern {
  const pattern = emptyPattern();
  for (const voice of VOICES) {
    const row = rows[voice.id];
    if (!row) continue;
    const cells = row.replace(/\s+/g, "");
    for (let step = 0; step < STEPS; step += 1) {
      const char = cells[step];
      pattern[voice.id][step] = char === "X" ? 2 : char === "x" ? 1 : 0;
    }
  }
  return pattern;
}

export type Preset = { id: string; label: string; bpm: number; swing: number; pattern: Pattern };

export const PRESETS: Preset[] = [
  {
    id: "house",
    label: "האוס",
    bpm: 124,
    swing: 0,
    pattern: fromStrings({
      kick: "X... X... X... X...",
      clap: ".... X... .... X...",
      hat: "xx.x xx.x xx.x xx.x",
      open: "..x. ..x. ..x. ..x.",
      cowbell: ".... .... .... ..x.",
    }),
  },
  {
    id: "boombap",
    label: "בום־באפ",
    bpm: 90,
    swing: 0.28,
    pattern: fromStrings({
      kick: "X... .... ..x. ....",
      snare: ".... X... .... X...",
      hat: "x.x. x.x. x.x. x.xx",
      lowTom: ".... .... .... ..x.",
    }),
  },
  {
    id: "rock",
    label: "רוק",
    bpm: 112,
    swing: 0,
    pattern: fromStrings({
      kick: "X... ..x. X.x. ....",
      snare: ".... X... .... X...",
      hat: "x.x. x.x. x.x. x.x.",
      highTom: ".... .... .... ..xx",
    }),
  },
  {
    id: "trap",
    label: "טראפ",
    bpm: 140,
    swing: 0,
    pattern: fromStrings({
      kick: "X... .... ..x. .x..",
      snare: ".... .... X... ....",
      clap: ".... .... X... ....",
      hat: "xxxx xxXx xxxx xXxx",
      open: ".... .... .... ...x",
    }),
  },
  {
    id: "reggaeton",
    label: "רגאטון",
    bpm: 95,
    swing: 0,
    pattern: fromStrings({
      kick: "X... X... X... X...",
      snare: "...x ..x. ...x ..x.",
      hat: "x.x. x.x. x.x. x.x.",
      cowbell: "..x. .... ..x. ....",
    }),
  },
  {
    id: "funk",
    label: "פאנק",
    bpm: 102,
    swing: 0.12,
    pattern: fromStrings({
      kick: "X..x ..x. .x.. ..x.",
      snare: ".... X..x .x.. X...",
      hat: "xXxX xXxX xXxX xXxX",
      open: ".... .... .... ..x.",
    }),
  },
  {
    id: "empty",
    label: "דף ריק",
    bpm: 100,
    swing: 0,
    pattern: emptyPattern(),
  },
];

/** A fresh random groove that still sounds like one. */
export function randomPattern(random: () => number = Math.random): Pattern {
  const pattern = emptyPattern();
  for (let step = 0; step < STEPS; step += 1) {
    const onBeat = step % 4 === 0;
    if (step === 0 || (onBeat && random() < 0.55) || (!onBeat && random() < 0.14)) pattern.kick[step] = step === 0 ? 2 : 1;
    if (step % 8 === 4) pattern.snare[step] = 2;
    else if (random() < 0.07) pattern.snare[step] = 1;
    if (step % 2 === 0) pattern.hat[step] = random() < 0.25 ? 2 : 1;
    else if (random() < 0.3) pattern.hat[step] = 1;
    if (step === 14 && random() < 0.6) pattern.open[step] = 1;
    if (step % 8 === 4 && random() < 0.4) pattern.clap[step] = 1;
    if (step >= 12 && random() < 0.18) pattern[random() < 0.5 ? "lowTom" : "highTom"][step] = 1;
    if (random() < 0.05) pattern.cowbell[step] = 1;
  }
  return pattern;
}

/** How many hits are in a pattern — for the assistant and the page. */
export function countHits(pattern: Pattern) {
  return VOICES.reduce((sum, voice) => sum + pattern[voice.id].filter(Boolean).length, 0);
}

/** A pattern read back from storage or from the assistant, or null when it is not one. */
export function normalizePattern(raw: unknown): Pattern | null {
  if (!raw || typeof raw !== "object") return null;
  const pattern = emptyPattern();
  for (const voice of VOICES) {
    const row = (raw as Record<string, unknown>)[voice.id];
    if (!Array.isArray(row)) continue;
    for (let step = 0; step < STEPS; step += 1) {
      const value = Number(row[step]);
      pattern[voice.id][step] = value >= 2 ? 2 : value >= 1 ? 1 : 0;
    }
  }
  return pattern;
}

/* ---- sound ---- */

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(context: BaseAudioContext) {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.floor(context.sampleRate * 1), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    noiseBuffers.set(context, buffer);
  }
  return buffer;
}

function envelope(context: BaseAudioContext, destination: AudioNode, time: number, peak: number, decay: number, attack = 0.002) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  gain.connect(destination);
  return gain;
}

function noiseBurst(
  context: BaseAudioContext,
  destination: AudioNode,
  time: number,
  options: { type: BiquadFilterType; frequency: number; q?: number; peak: number; decay: number },
) {
  const source = context.createBufferSource();
  source.buffer = noise(context);
  const filter = context.createBiquadFilter();
  filter.type = options.type;
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q ?? 0.8;
  const gain = envelope(context, destination, time, options.peak, options.decay);
  source.connect(filter);
  filter.connect(gain);
  source.start(time);
  source.stop(time + options.decay + 0.05);
}

function tone(
  context: BaseAudioContext,
  destination: AudioNode,
  time: number,
  options: { type: OscillatorType; from: number; to: number; sweep: number; peak: number; decay: number },
) {
  const osc = context.createOscillator();
  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), time + options.sweep);
  const gain = envelope(context, destination, time, options.peak, options.decay);
  osc.connect(gain);
  osc.start(time);
  osc.stop(time + options.decay + 0.05);
}

/** Sounds one voice at `time` on the given context, at a level of 0..1. */
export function playVoice(context: BaseAudioContext, destination: AudioNode, voice: VoiceId, time: number, level: number) {
  const v = Math.max(0, Math.min(1.5, level));
  if (v <= 0) return;
  switch (voice) {
    case "kick":
      tone(context, destination, time, { type: "sine", from: 160, to: 42, sweep: 0.12, peak: 1.0 * v, decay: 0.42 });
      tone(context, destination, time, { type: "triangle", from: 900, to: 200, sweep: 0.012, peak: 0.25 * v, decay: 0.02 });
      break;
    case "snare":
      noiseBurst(context, destination, time, { type: "highpass", frequency: 1400, peak: 0.55 * v, decay: 0.18 });
      tone(context, destination, time, { type: "triangle", from: 240, to: 170, sweep: 0.05, peak: 0.45 * v, decay: 0.1 });
      break;
    case "clap":
      for (const offset of [0, 0.011, 0.022]) {
        noiseBurst(context, destination, time + offset, { type: "bandpass", frequency: 1300, q: 1.2, peak: 0.55 * v, decay: 0.03 });
      }
      noiseBurst(context, destination, time + 0.03, { type: "bandpass", frequency: 1200, q: 0.9, peak: 0.45 * v, decay: 0.2 });
      break;
    case "hat":
      noiseBurst(context, destination, time, { type: "highpass", frequency: 7500, peak: 0.32 * v, decay: 0.045 });
      break;
    case "open":
      noiseBurst(context, destination, time, { type: "highpass", frequency: 6800, peak: 0.28 * v, decay: 0.32 });
      break;
    case "lowTom":
      tone(context, destination, time, { type: "sine", from: 130, to: 78, sweep: 0.18, peak: 0.8 * v, decay: 0.38 });
      break;
    case "highTom":
      tone(context, destination, time, { type: "sine", from: 220, to: 140, sweep: 0.15, peak: 0.7 * v, decay: 0.3 });
      break;
    case "cowbell": {
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 900;
      filter.Q.value = 2;
      const gain = envelope(context, destination, time, 0.32 * v, 0.28);
      filter.connect(gain);
      for (const frequency of [545, 815]) {
        const osc = context.createOscillator();
        osc.type = "square";
        osc.frequency.value = frequency;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + 0.34);
      }
      break;
    }
  }
}

/** Seconds from the start of the bar to a step, with swing on the off-beats. */
export function stepOffset(step: number, bpm: number, swing: number) {
  const stepSeconds = 60 / bpm / 4;
  const swungDelay = step % 2 === 1 ? Math.max(0, Math.min(0.6, swing)) * stepSeconds * 0.5 : 0;
  return step * stepSeconds + swungDelay;
}

export function barSeconds(bpm: number) {
  return (60 / bpm) * 4;
}

function levelFor(cell: Cell, mix: Mix[VoiceId]) {
  if (!cell || mix.muted) return 0;
  return mix.volume * (cell === 2 ? 1.25 : 0.85);
}

/* ---- live playback ---- */

type Settings = { pattern: Pattern; mix: Mix; bpm: number; swing: number; volume: number };

export class BeatPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private nextStep = 0;
  private nextTime = 0;
  private queue: { step: number; time: number }[] = [];
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  get isPlaying() {
    return this.timer !== null;
  }

  update(settings: Partial<Settings>) {
    this.settings = { ...this.settings, ...settings };
    if (this.master && settings.volume !== undefined) this.master.gain.value = settings.volume;
  }

  private ensureContext() {
    if (this.context) return this.context;
    const AudioContextClass =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("הדפדפן הזה אינו תומך בשמע.");
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.settings.volume;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.ratio.value = 3;
    this.master.connect(compressor);
    compressor.connect(this.context.destination);
    return this.context;
  }

  /** Plays one voice now, for the row labels. */
  async preview(voice: VoiceId) {
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume();
    playVoice(context, this.master!, voice, context.currentTime + 0.01, this.settings.mix[voice].volume);
  }

  async start() {
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume();
    if (this.timer !== null) return;
    this.nextStep = 0;
    this.nextTime = context.currentTime + 0.08;
    this.queue = [];
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
  }

  dispose() {
    this.stop();
    if (this.context) void this.context.close();
    this.context = null;
    this.master = null;
  }

  /** The step sounding right now, for the playhead; -1 when stopped. */
  currentStep() {
    if (!this.context || this.timer === null) return -1;
    const now = this.context.currentTime;
    while (this.queue.length > 1 && this.queue[1].time <= now) this.queue.shift();
    const head = this.queue[0];
    return head && head.time <= now ? head.step : -1;
  }

  private schedule() {
    const context = this.context;
    if (!context || !this.master) return;
    const { pattern, mix, bpm, swing } = this.settings;
    const stepSeconds = 60 / bpm / 4;
    while (this.nextTime < context.currentTime + 0.12) {
      const swungDelay = this.nextStep % 2 === 1 ? Math.max(0, Math.min(0.6, swing)) * stepSeconds * 0.5 : 0;
      const at = this.nextTime + swungDelay;
      for (const voice of VOICES) {
        const level = levelFor(pattern[voice.id][this.nextStep], mix[voice.id]);
        if (level > 0) playVoice(context, this.master, voice.id, at, level);
      }
      this.queue.push({ step: this.nextStep, time: at });
      this.nextTime += stepSeconds;
      this.nextStep = (this.nextStep + 1) % STEPS;
    }
  }
}

/* ---- rendering to a file ---- */

/** The groove rendered to audio, `bars` times over, with a short tail for the last hits to ring out. */
export async function renderPattern(settings: Settings & { bars: number }, sampleRate = 44_100): Promise<AudioBuffer> {
  const OfflineContext =
    window.OfflineAudioContext ||
    (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  const bar = barSeconds(settings.bpm);
  const duration = bar * settings.bars + 0.5;
  const context = new OfflineContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const master = context.createGain();
  master.gain.value = settings.volume;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -8;
  compressor.ratio.value = 3;
  master.connect(compressor);
  compressor.connect(context.destination);
  for (let barIndex = 0; barIndex < settings.bars; barIndex += 1) {
    for (let step = 0; step < STEPS; step += 1) {
      const at = barIndex * bar + stepOffset(step, settings.bpm, settings.swing);
      for (const voice of VOICES) {
        const level = levelFor(settings.pattern[voice.id][step], settings.mix[voice.id]);
        if (level > 0) playVoice(context, master, voice.id, at, level);
      }
    }
  }
  return context.startRendering();
}
