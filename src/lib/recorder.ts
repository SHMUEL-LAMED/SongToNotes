/**
 * The arithmetic behind the multitrack recorder, kept apart from the audio
 * graph so it can be tested without a browser: where a take really begins
 * once the round trip through the sound card is taken out, when every click
 * of the count-in and the metronome falls, how a take's raw capture chunks
 * become one aligned buffer, and how a refused microphone is explained.
 */

export const MAX_TRACKS = 8;
export const MIN_BPM = 40;
export const MAX_BPM = 240;
export const MAX_COUNT_IN_BARS = 2;
/** The user's correction on top of the measured latency, in milliseconds. */
export const MIN_LATENCY_OFFSET_MS = -100;
export const MAX_LATENCY_OFFSET_MS = 300;
export const LATENCY_STORAGE_KEY = "musictools.recorder.latency.v1";
/** A take this long is ~115 MB of float samples at 48 kHz; past it, memory runs out on phones. */
export const MAX_TAKE_SECONDS = 10 * 60;

export function clamp(value: number, min: number, max: number, fallback = min) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function clampBpm(bpm: number, fallback = 100) {
  return Math.round(clamp(bpm, MIN_BPM, MAX_BPM, fallback));
}

export function clampCountIn(bars: number, fallback = 1) {
  return Math.round(clamp(bars, 0, MAX_COUNT_IN_BARS, fallback));
}

export function clampLatencyOffset(ms: number) {
  return Math.round(clamp(ms, MIN_LATENCY_OFFSET_MS, MAX_LATENCY_OFFSET_MS, 0));
}

export function secondsPerBeat(bpm: number) {
  return 60 / clampBpm(bpm);
}

/** How long the count-in lasts before the take (and the backing tracks) start. */
export function countInSeconds(bpm: number, bars: number, beatsPerBar: number) {
  const beats = clampCountIn(bars) * Math.max(1, Math.round(beatsPerBar));
  return beats * secondsPerBeat(bpm);
}

export type Click = {
  /** Context time the click should sound at. */
  time: number;
  /** Beat number counted from the first click of the count-in, 0-based. */
  index: number;
  /** The first beat of a bar is played higher. */
  accent: boolean;
  /** True for the clicks before the take starts. */
  countIn: boolean;
};

export type ClickPlan = {
  bpm: number;
  beatsPerBar: number;
  countInBars: number;
  /** Context time the take starts at: the end of the count-in. */
  takeStart: number;
  /** Whether the metronome keeps clicking once the take has started. */
  clickDuringTake: boolean;
};

/**
 * The clicks that fall inside [from, to) of the context clock. The scheduler
 * asks for a short window ahead of the clock every few tens of milliseconds
 * rather than booking every click of a ten-minute take up front, which would
 * leave thousands of oscillators waiting and nothing to cancel them cleanly.
 * Beat times are computed from the beat index, never accumulated, so they do
 * not drift over a long take.
 */
export function clicksInWindow(plan: ClickPlan, from: number, to: number): Click[] {
  const beat = secondsPerBeat(plan.bpm);
  const perBar = Math.max(1, Math.round(plan.beatsPerBar));
  const countInBeats = clampCountIn(plan.countInBars) * perBar;
  const origin = plan.takeStart - countInBeats * beat;
  const clicks: Click[] = [];
  if (!(to > from)) return clicks;
  // A tiny tolerance keeps a beat that lands exactly on a window edge in
  // exactly one window despite floating-point error.
  const epsilon = 1e-9;
  let index = Math.max(0, Math.ceil((from - origin) / beat - epsilon));
  for (; ; index += 1) {
    const time = origin + index * beat;
    if (time >= to - epsilon) break;
    const countIn = index < countInBeats;
    if (!countIn && !plan.clickDuringTake) break;
    clicks.push({ time, index, accent: index % perBar === 0, countIn });
  }
  return clicks;
}

/**
 * The round trip from the moment a backing sample is scheduled to the moment
 * the note the musician plays along with it reaches the capture node: the
 * output buffer and the DAC (baseLatency + outputLatency), then the ADC and
 * the input buffer (the track's reported latency). Browsers that do not
 * report a figure leave it undefined; a typical value stands in for it, and
 * the user's offset slider absorbs whatever is left.
 */
export function estimateRoundTripSeconds(parts: { baseLatency?: number; outputLatency?: number; inputLatency?: number }) {
  const safe = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1 ? value : fallback;
  return safe(parts.baseLatency, 0.01) + safe(parts.outputLatency, 0.02) + safe(parts.inputLatency, 0.01);
}

/** The measured round trip plus the user's correction, never negative. */
export function totalLatencySeconds(autoSeconds: number, offsetMs: number) {
  return Math.max(0, autoSeconds + clampLatencyOffset(offsetMs) / 1000);
}

/**
 * Moves a take earlier by `shiftFrames` samples: the start is dropped, so
 * what was played in time with the backing tracks lines up with them. A
 * negative shift (the user dragged the offset below the measured latency)
 * moves it later instead, padding the start with silence.
 */
export function applyLatencyShift(samples: Float32Array, shiftFrames: number): Float32Array {
  const shift = Math.round(shiftFrames);
  if (!Number.isFinite(shift) || shift === 0) return samples.slice();
  if (shift > 0) return samples.slice(Math.min(shift, samples.length));
  const padded = new Float32Array(samples.length - shift);
  padded.set(samples, -shift);
  return padded;
}

export type CaptureChunk = {
  /** Context frame of the chunk's first sample. */
  frame: number;
  data: Float32Array;
};

/**
 * Stitches the capture chunks of one take into one buffer that starts at
 * the take's timeline zero. Each chunk carries the context frame it was
 * captured at, so the result is sample-accurate even though capture began
 * before the count-in and the messages arrived in batches; a chunk the
 * browser dropped under load leaves silence rather than pulling everything
 * after it early. The latency shift is applied by reading from later in the
 * capture: the note heard at timeline t arrived at t + latency.
 */
export function assembleTake(
  chunks: CaptureChunk[],
  options: { startFrame: number; latencyFrames: number; maxFrames?: number },
): Float32Array {
  if (!chunks.length) return new Float32Array(0);
  const from = Math.round(options.startFrame + options.latencyFrames);
  const lastEnd = chunks.reduce((end, chunk) => Math.max(end, chunk.frame + chunk.data.length), 0);
  let length = Math.max(0, lastEnd - from);
  if (options.maxFrames !== undefined) length = Math.min(length, Math.max(0, Math.floor(options.maxFrames)));
  const out = new Float32Array(length);
  for (const chunk of chunks) {
    const at = chunk.frame - from;
    const skip = Math.max(0, -at);
    if (skip >= chunk.data.length) continue;
    const into = Math.max(0, at);
    if (into >= length) continue;
    const count = Math.min(chunk.data.length - skip, length - into);
    out.set(chunk.data.subarray(skip, skip + count), into);
  }
  return out;
}

/**
 * The loudest sample in each of `buckets` equal slices, 0..1 — enough for a
 * waveform strip a few dozen pixels high. The channels are folded together
 * so a stereo import draws as one lane.
 */
export function miniPeaks(channels: Float32Array[], buckets = 160): Float32Array {
  const count = Math.max(1, Math.floor(buckets));
  const peaks = new Float32Array(count);
  const frames = channels[0]?.length ?? 0;
  if (!frames) return peaks;
  const size = frames / count;
  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * size);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * size));
    let peak = 0;
    for (const channel of channels) {
      for (let index = start; index < end && index < frames; index += 1) {
        const value = Math.abs(channel[index]);
        if (value > peak) peak = value;
      }
    }
    peaks[bucket] = Math.min(1, peak);
  }
  return peaks;
}

/** An SVG path of mirrored bars, one per peak, in a width × height box. */
export function peaksPath(peaks: Float32Array, width: number, height: number): string {
  if (!peaks.length || width <= 0 || height <= 0) return "";
  const step = width / peaks.length;
  const bar = Math.max(0.6, step * 0.7);
  const middle = height / 2;
  const parts: string[] = [];
  for (let index = 0; index < peaks.length; index += 1) {
    // A floor of half a pixel keeps silence visible as a thin line.
    const half = Math.max(0.5, peaks[index] * middle);
    const x = index * step;
    parts.push(`M${x.toFixed(2)} ${(middle - half).toFixed(2)}h${bar.toFixed(2)}v${(half * 2).toFixed(2)}h${(-bar).toFixed(2)}z`);
  }
  return parts.join("");
}

/** "ערוץ 3" — the first number not already taken by a track of that name. */
export function nextTrackName(names: string[], prefix = "ערוץ") {
  const taken = new Set(names.map((name) => name.trim()));
  for (let number = 1; ; number += 1) {
    const name = `${prefix} ${number}`;
    if (!taken.has(name)) return name;
  }
}

/** m:ss.t — tenths make a take's first seconds readable while recording. */
export function formatClock(seconds: number) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const tenths = Math.floor(safe * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/**
 * What to tell the visitor when the microphone cannot be opened. Browsers
 * report these with English DOMException names; each is said once here in
 * Hebrew, with what to do next.
 */
export function describeMicError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "אין הרשאה למיקרופון. אפשר לאשר אותה בסמל המנעול שליד כתובת האתר, ואז לנסות שוב.";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "לא נמצא מיקרופון. חבר מיקרופון או אוזניות עם מיקרופון ונסה שוב.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "המיקרופון תפוס על ידי תוכנה או לשונית אחרת. סגור אותה ונסה שוב.";
    case "NotSupportedError":
    case "TypeError":
      return "הדפדפן הזה אינו תומך בהקלטה מהמיקרופון. נסה בכרום, אדג׳, פיירפוקס או ספארי עדכני.";
    default:
      return "לא הצלחנו לפתוח את המיקרופון. בדוק שהוא מחובר ונסה שוב.";
  }
}

/** The stored offset, or 0 when storage is empty, blocked or holds junk. */
export function readLatencyOffset(storage: Pick<Storage, "getItem"> | null | undefined): number {
  try {
    const raw = storage?.getItem(LATENCY_STORAGE_KEY);
    if (raw === null || raw === undefined) return 0;
    const parsed = JSON.parse(raw) as unknown;
    const value = typeof parsed === "number" ? parsed : Number((parsed as { offsetMs?: unknown } | null)?.offsetMs);
    return clampLatencyOffset(value);
  } catch {
    return 0;
  }
}

export function writeLatencyOffset(storage: Pick<Storage, "setItem"> | null | undefined, offsetMs: number) {
  try {
    storage?.setItem(LATENCY_STORAGE_KEY, JSON.stringify({ offsetMs: clampLatencyOffset(offsetMs) }));
  } catch {
    // Private mode or a full quota: the offset holds for this visit only.
  }
}

/** Where the playhead sits as a fraction of the timeline, for the overlay line. */
export function playheadFraction(position: number, duration: number) {
  if (!(duration > 0)) return 0;
  return clamp(position / duration, 0, 1, 0);
}
