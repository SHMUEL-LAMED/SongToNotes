import type { DetectedNote } from "./types";

type PlayerHandlers = {
  onEnd?: () => void;
};

export type Instrument = "piano" | "strings" | "organ" | "synth" | "marimba";

export const INSTRUMENTS: { id: Instrument; label: string }[] = [
  { id: "piano", label: "פסנתר" },
  { id: "strings", label: "כלי קשת" },
  { id: "organ", label: "אורגן" },
  { id: "synth", label: "סינת׳" },
  { id: "marimba", label: "מרימבה" },
];

export type ClickTrack = {
  bpm: number;
  offset: number;
  beatsPerMeasure: number;
};

const LOOKAHEAD_SECONDS = 0.35;
const TICK_MS = 60;

/**
 * Plays the transcription with a small built-in synth. Nothing is fetched —
 * no soundfont, no network — which keeps the promise that the audio never
 * leaves the machine, and lets the playhead run off the audio clock rather
 * than a timer. Time inside the player is always "note time": the playback
 * rate only stretches how fast the audio clock walks through it.
 */
export class NotePlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private notes: DetectedNote[] = [];
  private transpose = 0;
  private nextIndex = 0;
  private startedAt = 0;
  private offset = 0;
  private timer: number | null = null;
  private handlers: PlayerHandlers = {};
  private endsAt = 0;
  private active: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private instrument: Instrument = "piano";
  private rate = 1;
  private volume = 0.85;
  private loop: { start: number; end: number } | null = null;
  private click: ClickTrack | null = null;
  private nextBeat = 0;

  get isPlaying() {
    return this.timer !== null;
  }

  get currentTime() {
    if (!this.context) return this.offset;
    if (this.timer === null) return this.offset;
    return this.offset + (this.context.currentTime - this.startedAt) * this.rate;
  }

  get duration() {
    return this.endsAt;
  }

  load(notes: DetectedNote[], transpose: number) {
    const wasPlaying = this.isPlaying;
    const position = this.currentTime;
    this.stop(true);
    this.notes = [...notes].sort((a, b) => a.start - b.start);
    this.transpose = transpose;
    this.endsAt = this.notes.reduce(
      (max, note) => Math.max(max, note.start + note.duration),
      0,
    );
    this.offset = Math.min(position, this.endsAt);
    if (wasPlaying) void this.play(this.offset);
  }

  setInstrument(instrument: Instrument) {
    this.instrument = instrument;
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  setRate(rate: number) {
    const wasPlaying = this.isPlaying;
    const position = this.currentTime;
    this.rate = Math.max(0.25, Math.min(2, rate));
    if (wasPlaying) void this.play(position);
  }

  setLoop(loop: { start: number; end: number } | null) {
    this.loop = loop && loop.end - loop.start > 0.1 ? loop : null;
    if (this.isPlaying && this.loop) {
      const position = this.currentTime;
      if (position < this.loop.start || position > this.loop.end) {
        void this.play(this.loop.start);
      }
    }
  }

  setClick(click: ClickTrack | null) {
    this.click = click;
    if (this.isPlaying) void this.play(this.currentTime);
  }

  async play(from?: number) {
    if (!this.notes.length) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    if (!this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.ratio.value = 4;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();

    this.stopTimer();
    this.silence();
    this.offset = from ?? this.currentTime;
    if (this.loop && (this.offset < this.loop.start || this.offset >= this.loop.end - 0.01)) {
      this.offset = this.loop.start;
    } else if (this.offset >= this.endsAt - 0.01) {
      this.offset = 0;
    }
    this.startedAt = this.context.currentTime;
    this.nextIndex = this.notes.findIndex(
      (note) => note.start + note.duration > this.offset,
    );
    if (this.nextIndex < 0) this.nextIndex = this.notes.length;
    if (this.click) {
      const beat = 60 / this.click.bpm;
      this.nextBeat = Math.max(0, Math.ceil((this.offset - this.click.offset - 1e-6) / beat));
    }

    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  pause() {
    if (!this.context) return;
    this.offset = this.currentTime;
    this.stopTimer();
    this.silence();
  }

  stop(keepContext = false) {
    this.stopTimer();
    this.silence();
    this.offset = this.loop ? this.loop.start : 0;
    if (!keepContext && this.context) {
      void this.context.close();
      this.context = null;
      this.master = null;
    }
  }

  seek(time: number) {
    const target = Math.max(0, Math.min(time, this.endsAt));
    if (this.isPlaying) void this.play(target);
    else this.offset = target;
  }

  setHandlers(handlers: PlayerHandlers) {
    this.handlers = handlers;
  }

  dispose() {
    this.stop();
  }

  /** Converts a note-time instant into the audio clock. */
  private clockAt(noteTime: number) {
    return this.startedAt + Math.max(0, noteTime - this.offset) / this.rate;
  }

  private stopTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private silence() {
    const now = this.context?.currentTime ?? 0;
    this.active.forEach(({ osc, gain }) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.01);
        osc.forEach((node) => node.stop(now + 0.08));
      } catch {
        // The node may already have stopped; nothing to clean up.
      }
    });
    this.active = [];
  }

  private schedule() {
    if (!this.context || !this.master) return;
    const elapsed = this.currentTime;
    const horizon = elapsed + LOOKAHEAD_SECONDS * this.rate;
    const limit = this.loop ? this.loop.end : Infinity;

    while (this.nextIndex < this.notes.length) {
      const note = this.notes[this.nextIndex];
      if (note.start > horizon) break;
      if (note.start >= limit) break;
      this.voice(note, Math.max(this.context.currentTime, this.clockAt(note.start)));
      this.nextIndex += 1;
    }

    if (this.click) {
      const beat = 60 / this.click.bpm;
      while (true) {
        const at = this.click.offset + this.nextBeat * beat;
        if (at > horizon || at >= Math.min(limit, this.endsAt + 0.01)) break;
        if (at >= this.offset - 1e-6) {
          this.tick(
            Math.max(this.context.currentTime, this.clockAt(at)),
            this.nextBeat % this.click.beatsPerMeasure === 0,
          );
        }
        this.nextBeat += 1;
      }
    }

    if (this.loop && elapsed >= this.loop.end) {
      void this.play(this.loop.start);
      return;
    }

    if (elapsed >= this.endsAt) {
      this.stopTimer();
      this.offset = 0;
      this.handlers.onEnd?.();
    }
  }

  private tick(when: number, accent: boolean) {
    if (!this.context || !this.master) return;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    gain.connect(this.master);
    const osc = this.context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(accent ? 1760 : 1320, when);
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  private voice(note: DetectedNote, when: number) {
    if (!this.context || !this.master) return;
    const midi = note.midi + this.transpose;
    if (midi < 0 || midi > 127) return;
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    const duration = Math.max(0.08, note.duration) / this.rate;
    const peak = 0.16 + Math.min(0.16, note.confidence * 0.2);

    const gain = this.context.createGain();
    gain.connect(this.master);
    const oscillators: OscillatorNode[] = [];
    const add = (type: OscillatorType, multiplier: number, level: number, detune = 0) => {
      const osc = this.context!.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency * multiplier, when);
      if (detune) osc.detune.setValueAtTime(detune, when);
      if (level === 1) {
        osc.connect(gain);
      } else {
        const partial = this.context!.createGain();
        partial.gain.value = level;
        osc.connect(partial);
        partial.connect(gain);
      }
      oscillators.push(osc);
      return osc;
    };

    let release = 0.045;
    let tail = 0.35;
    switch (this.instrument) {
      case "strings": {
        add("sawtooth", 1, 0.5, -6);
        add("sawtooth", 1, 0.5, 6);
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = Math.min(9000, frequency * 5);
        gain.disconnect();
        gain.connect(filter);
        filter.connect(this.master);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(peak * 0.7, when + Math.min(0.12, duration * 0.4));
        gain.gain.setValueAtTime(peak * 0.7, when + duration);
        release = 0.12;
        tail = 0.5;
        break;
      }
      case "organ": {
        add("sine", 1, 0.55);
        add("sine", 2, 0.3);
        add("sine", 3, 0.15);
        add("sine", 4, 0.1);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(peak, when + 0.02);
        gain.gain.setValueAtTime(peak, when + duration);
        release = 0.03;
        tail = 0.2;
        break;
      }
      case "synth": {
        add("square", 1, 0.35);
        add("sawtooth", 1, 0.35, 7);
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.Q.value = 5;
        filter.frequency.setValueAtTime(Math.min(12000, frequency * 8), when);
        filter.frequency.exponentialRampToValueAtTime(Math.max(200, frequency * 1.5), when + 0.5);
        gain.disconnect();
        gain.connect(filter);
        filter.connect(this.master);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(peak, when + 0.01);
        gain.gain.exponentialRampToValueAtTime(peak * 0.5, when + Math.min(duration, 0.7));
        break;
      }
      case "marimba": {
        add("sine", 1, 1);
        add("sine", 4, 0.25);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(peak * 1.3, when + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.3, Math.min(duration, 1.2)));
        release = 0.02;
        tail = 0.1;
        break;
      }
      default: {
        add("triangle", 1, 1);
        add("sine", 2, 0.22);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
        // A gentle decay through the note, then a short release, reads as a
        // struck note rather than an organ tone.
        gain.gain.exponentialRampToValueAtTime(peak * 0.35, when + Math.min(duration, 0.9));
      }
    }
    gain.gain.setTargetAtTime(0.0001, when + duration, release);

    oscillators.forEach((osc) => osc.start(when));
    const stopAt = when + duration + tail;
    oscillators.forEach((osc) => osc.stop(stopAt));

    const entry = { osc: oscillators, gain };
    this.active.push(entry);
    oscillators[0].onended = () => {
      this.active = this.active.filter((item) => item !== entry);
    };
  }
}
