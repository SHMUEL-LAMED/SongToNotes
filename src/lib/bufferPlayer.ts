/**
 * Plays a decoded buffer with seek, loop and a position clock — the preview
 * player behind the ringtone, karaoke and practice tools. Position is read
 * off the audio clock, so the cursor never drifts from what is heard.
 */
export class BufferPlayer {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0;
  private offset = 0;
  private playing = false;
  private loop: { start: number; end: number } | null = null;
  onEnd: (() => void) | null = null;

  get isPlaying() {
    return this.playing;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get currentTime() {
    if (!this.context || !this.playing) return this.offset;
    let position = this.offset + (this.context.currentTime - this.startedAt);
    if (this.loop) {
      const span = this.loop.end - this.loop.start;
      if (span > 0.05 && position > this.loop.end) {
        position = this.loop.start + ((position - this.loop.start) % span);
      }
    }
    return Math.min(position, this.duration);
  }

  load(buffer: AudioBuffer | null) {
    const wasPlaying = this.playing;
    const position = this.currentTime;
    this.stop();
    this.buffer = buffer;
    if (buffer && position < buffer.duration) this.offset = position;
    if (wasPlaying && buffer) void this.play();
  }

  setLoop(loop: { start: number; end: number } | null) {
    this.loop = loop;
    if (this.playing) void this.play(this.currentTime);
  }

  setVolume(value: number) {
    if (this.gain) this.gain.gain.value = value;
  }

  private ensureContext() {
    if (this.context) return this.context;
    const Context =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return null;
    this.context = new Context();
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);
    return this.context;
  }

  async play(from?: number) {
    if (!this.buffer) return;
    const context = this.ensureContext();
    if (!context || !this.gain) return;
    if (context.state === "suspended") await context.resume();
    this.halt();

    let start = from ?? this.offset;
    if (this.loop && (start < this.loop.start || start >= this.loop.end)) {
      start = this.loop.start;
    }
    if (start >= this.buffer.duration - 0.01) start = this.loop?.start ?? 0;

    const source = context.createBufferSource();
    source.buffer = this.buffer;
    if (this.loop && this.loop.end - this.loop.start > 0.05) {
      source.loop = true;
      source.loopStart = this.loop.start;
      source.loopEnd = this.loop.end;
    }
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      this.playing = false;
      this.source = null;
      this.offset = 0;
      this.onEnd?.();
    };
    source.start(0, start);
    this.source = source;
    this.offset = start;
    this.startedAt = context.currentTime;
    this.playing = true;
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
    const target = Math.max(0, Math.min(time, this.duration));
    if (this.playing) void this.play(target);
    else this.offset = target;
  }

  dispose() {
    this.halt();
    void this.context?.close();
    this.context = null;
    this.gain = null;
  }

  /** Creates a buffer on this player's context so sources match. */
  createBuffer(channels: Float32Array[], sampleRate: number) {
    const context = this.ensureContext();
    if (!context) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
    const buffer = context.createBuffer(
      channels.length,
      Math.max(1, channels[0]?.length ?? 1),
      sampleRate,
    );
    channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
    return buffer;
  }

  private halt() {
    const source = this.source;
    this.source = null;
    this.playing = false;
    if (source) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already stopped.
      }
    }
  }
}
