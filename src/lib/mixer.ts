/**
 * A small multitrack mixer: tracks with a gain, a pan, mute and solo,
 * played together in sync from one audio clock, with an optional loop, and
 * rendered to one file offline. The graph is rebuilt on every play, which
 * is simpler than keeping nodes alive and costs nothing audible.
 */
import { getOfflineAudioContextClass } from "./audio";

export type MixTrack = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  /** 0..1.5 */
  gain: number;
  /** -1 left .. 1 right */
  pan: number;
  muted: boolean;
  solo: boolean;
  /** Seconds the track starts at, relative to the mix. */
  offset: number;
  color: number;
};

export function audibleTracks(tracks: MixTrack[]) {
  const anySolo = tracks.some((track) => track.solo);
  return tracks.filter((track) => !track.muted && (!anySolo || track.solo));
}

export function mixDuration(tracks: MixTrack[]) {
  return tracks.reduce((longest, track) => Math.max(longest, track.offset + track.buffer.duration), 0);
}

type Live = { id: string; source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null };

/** How far ahead of the audio clock the next pass of a loop is queued. */
const LOOKAHEAD = 0.2;
/** How often the scheduler looks at the clock. */
const TICK_MS = 25;
/** A loop shorter than this is ignored, as it always has been. */
const MIN_LOOP = 0.05;

/**
 * Live playback of the mix on a shared context.
 *
 * Every track gets its own source for the whole run, silent tracks included:
 * mute and solo only move a gain, so they are instant, never restart the mix
 * and can never land on the wrong track. Only a new track, a removed one or
 * a moved offset rebuilds the graph. The loop is scheduled on the audio clock
 * a little ahead of time, so the next pass starts on the exact sample the
 * last one ends — a timer that restarts everything leaves a gap every pass.
 */
export class MixPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private live: Live[] = [];
  /** The mix position that sounds at audio time `anchorAt`. */
  private anchorPos = 0;
  private anchorAt = 0;
  /** Where the previous pass of the loop ends, while the next is already queued. */
  private previousEnd: number | null = null;
  private offset = 0;
  private playing = false;
  private loop: { start: number; end: number } | null = null;
  private tracks: MixTrack[] = [];
  /** The tracks (and where they start) the running graph was built for. */
  private built: { id: string; buffer: AudioBuffer; offset: number }[] = [];
  private timer: number | null = null;
  /** Bumped by every play, pause and stop, so a play still waiting on resume() knows it was overtaken. */
  private generation = 0;
  onEnd: (() => void) | null = null;

  get isPlaying() {
    return this.playing;
  }

  get currentTime() {
    if (!this.context || !this.playing) return this.offset;
    const now = this.context.currentTime;
    let position =
      now < this.anchorAt
        ? this.previousEnd !== null
          ? this.previousEnd - (this.anchorAt - now)
          : this.anchorPos
        : this.anchorPos + (now - this.anchorAt);
    const loop = this.activeLoop();
    if (loop && position >= loop.end) {
      const span = loop.end - loop.start;
      position = loop.start + ((position - loop.start) % span);
    }
    return Math.max(0, position);
  }

  private activeLoop() {
    return this.loop && this.loop.end - this.loop.start > MIN_LOOP ? this.loop : null;
  }

  private ensure() {
    if (this.context) return this.context;
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    this.context = new Context();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    return this.context;
  }

  setTracks(tracks: MixTrack[]) {
    this.tracks = tracks;
    if (!this.playing) return;
    const same =
      tracks.length === this.built.length &&
      tracks.every((track, index) => {
        const built = this.built[index];
        return built.id === track.id && built.buffer === track.buffer && built.offset === track.offset;
      });
    // Levels, pan, mute and solo change live; a new shape restarts from the same spot.
    if (same) this.applyLevels();
    else void this.play(this.currentTime);
  }

  setLoop(loop: { start: number; end: number } | null) {
    this.loop = loop;
    if (!this.playing || !this.context) return;
    const position = this.currentTime;
    const queued = this.previousEnd !== null && this.context.currentTime < this.anchorAt;
    const active = this.activeLoop();
    // Inside the new region the running pass simply ends at the new edge (the
    // scheduler reads it); only a jump — or a pass already queued for the old
    // region — needs a restart. Dragging a region's edge then no longer
    // restarts the mix on every pointer move.
    if (queued || (active && (position < active.start || position >= active.end))) void this.play(position);
  }

  private applyLevels() {
    const context = this.context;
    if (!context) return;
    const audible = new Set(audibleTracks(this.tracks).map((track) => track.id));
    const byId = new Map(this.tracks.map((track) => [track.id, track]));
    const now = context.currentTime;
    for (const node of this.live) {
      const track = byId.get(node.id);
      if (!track) continue;
      // A short glide rather than a jump, so a mute does not click.
      node.gain.gain.setTargetAtTime(audible.has(track.id) ? track.gain : 0, now, 0.01);
      node.pan?.pan.setTargetAtTime(track.pan, now, 0.01);
    }
  }

  /** Sources for every track from mix position `from`, sounding at audio time `at`. */
  private schedule(context: AudioContext, from: number, at: number) {
    const audible = new Set(audibleTracks(this.tracks).map((track) => track.id));
    for (const track of this.tracks) {
      // Where in this track the mix position falls; a track that starts later waits.
      const into = from - track.offset;
      if (into >= track.buffer.duration) continue;
      const source = context.createBufferSource();
      source.buffer = track.buffer;
      const gain = context.createGain();
      gain.gain.value = audible.has(track.id) ? track.gain : 0;
      const pan = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
      if (pan) pan.pan.value = track.pan;
      source.connect(gain);
      if (pan) {
        gain.connect(pan);
        pan.connect(this.master!);
      } else gain.connect(this.master!);
      if (into >= 0) source.start(at, into);
      else source.start(at - into, 0);
      const node: Live = { id: track.id, source, gain, pan };
      source.onended = () => {
        node.source.disconnect();
        node.gain.disconnect();
        node.pan?.disconnect();
        this.live = this.live.filter((item) => item !== node);
      };
      this.live.push(node);
    }
  }

  async play(from?: number) {
    const generation = ++this.generation;
    const context = this.ensure();
    if (!context || !this.master) return false;
    if (context.state === "suspended") await context.resume();
    // A pause, a stop or a newer play came in while the context woke up.
    if (generation !== this.generation || this.context !== context) return false;
    this.halt();
    const duration = mixDuration(this.tracks);
    if (duration <= 0) return false;
    const loop = this.activeLoop();
    let start = Math.max(0, from ?? this.offset);
    if (loop && (start < loop.start || start >= loop.end)) start = loop.start;
    if (start >= duration - 0.01) start = loop?.start ?? 0;
    const at = context.currentTime + 0.05;
    this.schedule(context, start, at);
    this.built = this.tracks.map((track) => ({ id: track.id, buffer: track.buffer, offset: track.offset }));
    this.anchorPos = start;
    this.anchorAt = at;
    this.previousEnd = null;
    this.offset = start;
    this.playing = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    return true;
  }

  /** Queues the next pass of the loop just before it is due, or ends the mix. */
  private tick() {
    const context = this.context;
    if (!context || !this.playing) return;
    const now = context.currentTime;
    const loop = this.activeLoop();
    if (loop) {
      if (now < this.anchorAt) return;
      const boundary = this.anchorAt + (loop.end - this.anchorPos);
      if (boundary - now > LOOKAHEAD) return;
      if (boundary <= now) {
        // The page was too busy to queue the pass in time; start it now.
        void this.play(loop.start);
        return;
      }
      for (const node of this.live) {
        try {
          node.source.stop(boundary);
        } catch {
          // Already stopped.
        }
      }
      this.previousEnd = loop.end;
      this.anchorPos = loop.start;
      this.anchorAt = boundary;
      this.schedule(context, loop.start, boundary);
      return;
    }
    const end = this.anchorAt + (mixDuration(this.tracks) - this.anchorPos);
    if (now >= end + 0.03) {
      this.halt();
      this.offset = 0;
      this.onEnd?.();
    }
  }

  pause() {
    this.generation += 1;
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.halt();
  }

  stop() {
    this.generation += 1;
    this.halt();
    this.offset = 0;
  }

  seek(time: number) {
    if (this.playing) void this.play(time);
    else this.offset = Math.max(0, time);
  }

  private halt() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const node of this.live) {
      node.source.onended = null;
      try {
        node.source.stop();
      } catch {
        // Already stopped.
      }
      node.source.disconnect();
      node.gain.disconnect();
      node.pan?.disconnect();
    }
    this.live = [];
    this.previousEnd = null;
    this.playing = false;
  }

  dispose() {
    this.generation += 1;
    this.halt();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}

/** Renders the audible tracks to one stereo buffer, offline. */
export async function renderMix(tracks: MixTrack[], sampleRate = 44_100, region?: { start: number; end: number } | null): Promise<AudioBuffer> {
  const Offline = getOfflineAudioContextClass();
  if (!Offline) throw new Error("הדפדפן הזה אינו תומך ברינדור אודיו.");
  const from = region ? region.start : 0;
  const to = region ? region.end : mixDuration(tracks);
  const seconds = Math.max(0.1, to - from);
  const offline = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
  for (const track of audibleTracks(tracks)) {
    const source = offline.createBufferSource();
    source.buffer = track.buffer;
    const gain = offline.createGain();
    gain.gain.value = track.gain;
    const pan = typeof offline.createStereoPanner === "function" ? offline.createStereoPanner() : null;
    if (pan) pan.pan.value = track.pan;
    source.connect(gain);
    if (pan) {
      gain.connect(pan);
      pan.connect(offline.destination);
    } else gain.connect(offline.destination);
    const into = from - track.offset;
    if (into >= track.buffer.duration) continue;
    if (into >= 0) source.start(0, into);
    else source.start(-into, 0);
  }
  return offline.startRendering();
}
