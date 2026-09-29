/**
 * The arithmetic behind the file joiner: where each trimmed clip lands on
 * the joined timeline, how a crossfade blends two neighbours, and the actual
 * sample-by-sample join of Float32Array channels. None of it touches the
 * Web Audio API, so every number the page shows (and every sample the export
 * writes) can be checked in a unit test. Decoding, resampling and upmixing
 * happen in the component, with an OfflineAudioContext, before this runs.
 */

export type TransitionKind = "none" | "crossfade" | "gap";

export type Transition = {
  kind: TransitionKind;
  /** Requested length in seconds; clamped to 0..MAX_TRANSITION_SECONDS. */
  seconds: number;
};

export const MAX_TRANSITION_SECONDS = 10;

/** The shortest a trimmed clip may become, so a handle can never swallow it. */
export const MIN_CLIP_SECONDS = 0.1;

export function clampTransitionSeconds(seconds: number) {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(MAX_TRANSITION_SECONDS, seconds));
}

export type TimelineLayout = {
  /** Where each clip starts on the joined timeline. */
  starts: number[];
  /** The length each clip contributes (its trimmed length). */
  lengths: number[];
  /**
   * One entry per boundary (clips.length - 1): how much the two neighbours
   * overlap. Non-zero only for a crossfade, and already clamped so it never
   * exceeds half of either neighbour — which is what guarantees that a clip
   * with a crossfade on both sides never has the two fades overlap.
   */
  overlaps: number[];
  /** One entry per boundary: the silence inserted between the neighbours. */
  gaps: number[];
  /** Length of the whole joined result. */
  total: number;
};

/**
 * Lays clips of the given lengths end to end with the transition between
 * each pair. Works in whatever unit it is handed: seconds for the page, or
 * whole frames for the PCM join (pass `integer: true` so the halves used for
 * clamping are floored and every offset stays an exact sample index).
 */
export function layoutTimeline(lengths: number[], transition: Transition, { integer = false, sampleRate = 1 }: { integer?: boolean; sampleRate?: number } = {}): TimelineLayout {
  const safe = lengths.map((length) => (Number.isFinite(length) && length > 0 ? length : 0));
  const requestedSeconds = transition.kind === "none" ? 0 : clampTransitionSeconds(transition.seconds);
  const requested = integer ? Math.round(requestedSeconds * sampleRate) : requestedSeconds * sampleRate;
  const half = (value: number) => (integer ? Math.floor(value / 2) : value / 2);
  const starts: number[] = [];
  const overlaps: number[] = [];
  const gaps: number[] = [];
  let cursor = 0;
  safe.forEach((length, index) => {
    if (index > 0) {
      const previous = safe[index - 1];
      const overlap = transition.kind === "crossfade" ? Math.max(0, Math.min(requested, half(previous), half(length))) : 0;
      const gap = transition.kind === "gap" ? requested : 0;
      overlaps.push(overlap);
      gaps.push(gap);
      cursor += previous - overlap + gap;
    }
    starts.push(cursor);
  });
  const total = safe.length ? starts[starts.length - 1] + safe[safe.length - 1] : 0;
  return { starts, lengths: safe, overlaps, gaps, total };
}

/**
 * Equal-power crossfade gains at one point of an overlap `length` frames
 * long. Using cos/sin rather than straight lines keeps fadeOut² + fadeIn² = 1
 * throughout, so two unrelated recordings keep the same loudness through the
 * blend instead of dipping by 3 dB in the middle. Samples are taken at the
 * frame centres ((i + 0.5) / length), which keeps the curve symmetric: the
 * fade-in is the exact mirror of the fade-out.
 */
export function crossfadeGains(index: number, length: number): { fadeIn: number; fadeOut: number } {
  if (length <= 0) return { fadeIn: 1, fadeOut: 0 };
  const x = Math.max(0, Math.min(1, (index + 0.5) / length));
  return { fadeIn: Math.sin((x * Math.PI) / 2), fadeOut: Math.cos((x * Math.PI) / 2) };
}

/** A clip ready to be joined: channels already at the output rate. */
export type PcmClip = {
  channels: Float32Array[];
  /** First frame to keep (inclusive); default 0. */
  start?: number;
  /** Frame to stop at (exclusive); default the channel length. */
  end?: number;
  /** Linear gain; default 1. */
  gain?: number;
};

/** The frame range a clip really contributes, with its bounds made safe. */
export function clipFrameRange(clip: PcmClip) {
  const available = clip.channels[0]?.length ?? 0;
  const start = Math.max(0, Math.min(available, Math.floor(clip.start ?? 0)));
  const end = Math.max(start, Math.min(available, Math.floor(clip.end ?? available)));
  return { start, end, length: end - start };
}

/**
 * Joins the clips into one set of `channelCount` channels. Each clip is added
 * into the output at its layout offset, faded in over the overlap before it
 * and out over the overlap after it; gaps are simply the zeros the output
 * starts with. A mono clip in a stereo join is copied to both sides (the
 * component normally upmixes first, this just keeps the function total).
 */
export function joinPcm(clips: PcmClip[], transition: Transition, sampleRate: number, channelCount?: number): Float32Array[] {
  const count = Math.max(1, channelCount ?? Math.max(1, ...clips.map((clip) => clip.channels.length)));
  const ranges = clips.map(clipFrameRange);
  const layout = layoutTimeline(
    ranges.map((range) => range.length),
    transition,
    { integer: true, sampleRate },
  );
  const output = Array.from({ length: count }, () => new Float32Array(layout.total));
  clips.forEach((clip, index) => {
    const { start, length } = ranges[index];
    if (!length || !clip.channels.length) return;
    const gain = Number.isFinite(clip.gain) ? (clip.gain as number) : 1;
    const fadeInFrames = index > 0 ? layout.overlaps[index - 1] : 0;
    const fadeOutFrames = index < clips.length - 1 ? layout.overlaps[index] : 0;
    const fadeOutFrom = length - fadeOutFrames;
    const offset = layout.starts[index];
    for (let channel = 0; channel < count; channel += 1) {
      const source = clip.channels[Math.min(channel, clip.channels.length - 1)];
      const target = output[channel];
      for (let frame = 0; frame < length; frame += 1) {
        let weight = gain;
        if (frame < fadeInFrames) weight *= crossfadeGains(frame, fadeInFrames).fadeIn;
        if (frame >= fadeOutFrom) weight *= crossfadeGains(frame - fadeOutFrom, fadeOutFrames).fadeOut;
        target[offset + frame] += source[start + frame] * weight;
      }
    }
  });
  return output;
}

/**
 * The common output for clips of mixed shapes: the highest sample rate among
 * them (so nothing is thrown away), and stereo when any clip has more than
 * one channel (a mono clip upmixes to both sides without loss).
 */
export function outputFormat(clips: { sampleRate: number; numberOfChannels: number }[]) {
  const sampleRate = clips.reduce((best, clip) => Math.max(best, clip.sampleRate || 0), 0) || 44_100;
  const channels: 1 | 2 = clips.some((clip) => clip.numberOfChannels > 1) ? 2 : 1;
  return { sampleRate, channels };
}

/** The rates an MP3 file can carry; the encoder refuses anything else. */
const MP3_RATES = [48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000];

/** The best MP3 rate for a given output rate: itself if allowed, else the next lower one. */
export function mp3SampleRate(sampleRate: number) {
  return MP3_RATES.find((rate) => rate <= sampleRate) ?? MP3_RATES[MP3_RATES.length - 1];
}

/**
 * Keeps a trim sane: inside the file, start before end, and at least
 * MIN_CLIP_SECONDS long (or the whole file when the file is shorter).
 */
export function clampTrim(start: number, end: number, duration: number, moving: "start" | "end" = "end") {
  const minimum = Math.min(MIN_CLIP_SECONDS, duration);
  let from = Math.max(0, Math.min(duration, Number.isFinite(start) ? start : 0));
  let to = Math.max(0, Math.min(duration, Number.isFinite(end) ? end : duration));
  if (to - from < minimum) {
    // Whichever handle the visitor is moving gives way; the other stays put.
    if (moving === "start") from = Math.max(0, to - minimum);
    else to = Math.min(duration, from + minimum);
    if (to - from < minimum) {
      from = Math.max(0, to - minimum);
      to = Math.min(duration, from + minimum);
    }
  }
  return { start: from, end: to };
}

/** A copy of the list with one item moved; out-of-range moves return it unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = list.slice();
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
