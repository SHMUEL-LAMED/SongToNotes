import type { DetectedNote } from "./types";

type PlayerHandlers = {
  onEnd?: () => void;
};

const LOOKAHEAD_SECONDS = 0.35;
const TICK_MS = 60;

/**
 * Plays the transcription with a small built-in synth. Nothing is fetched —
 * no soundfont, no network — which keeps the promise that the audio never
 * leaves the machine, and lets the playhead run off the audio clock rather
 * than a timer.
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

  get isPlaying() {
    return this.timer !== null;
  }

  get currentTime() {
    if (!this.context) return this.offset;
    if (this.timer === null) return this.offset;
    return this.offset + (this.context.currentTime - this.startedAt);
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
      this.master.gain.value = 0.85;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();

    this.stopTimer();
    this.silence();
    this.offset = from ?? this.currentTime;
    if (this.offset >= this.endsAt - 0.01) this.offset = 0;
    this.startedAt = this.context.currentTime;
    this.nextIndex = this.notes.findIndex(
      (note) => note.start + note.duration > this.offset,
    );
    if (this.nextIndex < 0) this.nextIndex = this.notes.length;

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
    this.offset = 0;
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

    while (this.nextIndex < this.notes.length) {
      const note = this.notes[this.nextIndex];
      if (note.start > elapsed + LOOKAHEAD_SECONDS) break;
      const when =
        this.startedAt + Math.max(0, note.start - this.offset);
      this.voice(note, Math.max(this.context.currentTime, when));
      this.nextIndex += 1;
    }

    if (elapsed >= this.endsAt) {
      this.stopTimer();
      this.offset = 0;
      this.handlers.onEnd?.();
    }
  }

  private voice(note: DetectedNote, when: number) {
    if (!this.context || !this.master) return;
    const midi = note.midi + this.transpose;
    if (midi < 0 || midi > 127) return;
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    const duration = Math.max(0.08, note.duration);

    const gain = this.context.createGain();
    const peak = 0.16 + Math.min(0.16, note.confidence * 0.2);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    // A gentle decay through the note, then a short release, reads as a
    // struck note rather than an organ tone.
    gain.gain.exponentialRampToValueAtTime(
      peak * 0.35,
      when + Math.min(duration, 0.9),
    );
    gain.gain.setTargetAtTime(0.0001, when + duration, 0.045);
    gain.connect(this.master);

    const body = this.context.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(frequency, when);

    const shimmer = this.context.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.setValueAtTime(frequency * 2, when);
    const shimmerGain = this.context.createGain();
    shimmerGain.gain.value = 0.22;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(gain);

    body.connect(gain);
    body.start(when);
    shimmer.start(when);
    const stopAt = when + duration + 0.35;
    body.stop(stopAt);
    shimmer.stop(stopAt);

    const entry = { osc: [body, shimmer], gain };
    this.active.push(entry);
    body.onended = () => {
      this.active = this.active.filter((item) => item !== entry);
    };
  }
}
