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

type Live = { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null };

/** Live playback of the mix on a shared context. */
export class MixPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private live: Live[] = [];
  private startedAt = 0;
  private offset = 0;
  private playing = false;
  private loop: { start: number; end: number } | null = null;
  private tracks: MixTrack[] = [];
  private ending: number | null = null;
  onEnd: (() => void) | null = null;

  get isPlaying() {
    return this.playing;
  }

  get currentTime() {
    if (!this.context || !this.playing) return this.offset;
    let position = this.offset + (this.context.currentTime - this.startedAt);
    if (this.loop && this.loop.end - this.loop.start > 0.05 && position >= this.loop.end) {
      const span = this.loop.end - this.loop.start;
      position = this.loop.start + ((position - this.loop.start) % span);
    }
    return position;
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
    if (this.playing) {
      // Levels change live; a structural change restarts from the same spot.
      const sameShape = this.live.length === audibleTracks(tracks).length;
      if (sameShape) this.applyLevels();
      else void this.play(this.currentTime);
    }
  }

  setLoop(loop: { start: number; end: number } | null) {
    this.loop = loop;
    if (this.playing) void this.play(this.currentTime);
  }

  private applyLevels() {
    const audible = audibleTracks(this.tracks);
    this.live.forEach((node, index) => {
      const track = audible[index];
      if (!track) return;
      node.gain.gain.value = track.gain;
      if (node.pan) node.pan.pan.value = track.pan;
    });
  }

  async play(from?: number) {
    const context = this.ensure();
    if (!context || !this.master) return false;
    if (context.state === "suspended") await context.resume();
    this.halt();
    const duration = mixDuration(this.tracks);
    let start = from ?? this.offset;
    if (this.loop && (start < this.loop.start || start >= this.loop.end)) start = this.loop.start;
    if (start >= duration - 0.01) start = this.loop?.start ?? 0;
    const at = context.currentTime + 0.05;
    const looping = this.loop !== null && this.loop.end - this.loop.start > 0.05;
    for (const track of audibleTracks(this.tracks)) {
      const source = context.createBufferSource();
      source.buffer = track.buffer;
      const gain = context.createGain();
      gain.gain.value = track.gain;
      const pan = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
      if (pan) pan.pan.value = track.pan;
      source.connect(gain);
      if (pan) {
        gain.connect(pan);
        pan.connect(this.master);
      } else gain.connect(this.master);
      // Where in this track the mix position falls; a track that starts later waits.
      const into = start - track.offset;
      if (into >= track.buffer.duration) continue;
      if (into >= 0) source.start(at, into);
      else source.start(at - into, 0);
      this.live.push({ source, gain, pan });
    }
    this.startedAt = at;
    this.offset = start;
    this.playing = true;
    if (this.ending) window.clearTimeout(this.ending);
    if (looping) {
      // The loop is driven from here rather than per source, since tracks
      // do not share a start; at the end of the region, play again.
      const wait = (this.loop!.end - start) * 1000 + 50;
      this.ending = window.setTimeout(() => void this.play(this.loop!.start), wait);
    } else {
      this.ending = window.setTimeout(() => {
        this.halt();
        this.offset = 0;
        this.onEnd?.();
      }, (duration - start) * 1000 + 80);
    }
    return true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.halt();
  }

  stop() {
    this.halt();
    this.offset = 0;
  }

  seek(time: number) {
    if (this.playing) void this.play(time);
    else this.offset = Math.max(0, time);
  }

  private halt() {
    if (this.ending) window.clearTimeout(this.ending);
    this.ending = null;
    for (const node of this.live) {
      try {
        node.source.stop();
      } catch {
        // Already stopped.
      }
      node.source.disconnect();
    }
    this.live = [];
    this.playing = false;
  }

  dispose() {
    this.halt();
    void this.context?.close();
    this.context = null;
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
