import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MixPlayer, audibleTracks, mixDuration, type MixTrack } from "./mixer";

const fake = (id: string, duration: number, extra: Partial<MixTrack> = {}): MixTrack => ({
  id,
  name: id,
  buffer: { duration } as AudioBuffer,
  gain: 1,
  pan: 0,
  muted: false,
  solo: false,
  offset: 0,
  color: 0,
  ...extra,
});

describe("mixer bookkeeping", () => {
  it("solo hides the others, mute hides itself", () => {
    const tracks = [fake("a", 1), fake("b", 1, { solo: true }), fake("c", 1, { muted: true })];
    expect(audibleTracks(tracks).map((track) => track.id)).toEqual(["b"]);
    expect(audibleTracks([fake("a", 1), fake("c", 1, { muted: true })]).map((track) => track.id)).toEqual(["a"]);
  });
  it("the mix lasts until the last track ends, offsets included", () => {
    expect(mixDuration([fake("a", 10), fake("b", 4, { offset: 8 })])).toBe(12);
    expect(mixDuration([])).toBe(0);
  });
});

/* ---- live playback, against a stand-in for the Web Audio graph ---- */

class FakeParam {
  value = 0;
  target: number | null = null;
  setTargetAtTime(value: number) {
    this.target = value;
    this.value = value;
  }
}
class FakeNode {
  connect(node: unknown) {
    return node;
  }
  disconnect() {}
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakePan extends FakeNode {
  pan = new FakeParam();
}
class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  startedAt: number | null = null;
  into = 0;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  gainNode: FakeGain | null = null;
  connect(node: unknown) {
    this.gainNode = node as FakeGain;
    return node;
  }
  start(when: number, into = 0) {
    this.startedAt = when;
    this.into = into;
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
}
class FakeContext {
  currentTime = 0;
  state = "running";
  destination = new FakeNode();
  sources: FakeSource[] = [];
  createGain() {
    return new FakeGain();
  }
  createStereoPanner() {
    return new FakePan();
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async resume() {}
  async close() {}
}

describe("MixPlayer", () => {
  let context: FakeContext;
  let intervals: (() => void)[];
  beforeEach(() => {
    context = new FakeContext();
    intervals = [];
    vi.stubGlobal("window", {
      AudioContext: function AudioContext() {
        return context;
      },
      setInterval: (callback: () => void) => intervals.push(callback),
      clearInterval: (id: number) => {
        intervals[id - 1] = () => {};
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const tick = () => intervals.forEach((callback) => callback());

  it("mute and solo move the right track's gain, without restarting the mix", async () => {
    const player = new MixPlayer();
    const tracks = [fake("a", 10, { gain: 0.5 }), fake("b", 10, { gain: 0.9 })];
    player.setTracks(tracks);
    await player.play();
    expect(context.sources).toHaveLength(2);
    const [a, b] = context.sources;
    // Swap which one is muted in a single change: same number audible, other track.
    player.setTracks([{ ...tracks[0], muted: true }, tracks[1]]);
    player.setTracks([tracks[0], { ...tracks[1], muted: true }]);
    expect(context.sources).toHaveLength(2);
    expect(a.gainNode!.gain.value).toBe(0.5);
    expect(b.gainNode!.gain.value).toBe(0);
    player.setTracks([tracks[0], { ...tracks[1], solo: true }]);
    expect(a.gainNode!.gain.value).toBe(0);
    expect(b.gainNode!.gain.value).toBe(0.9);
    player.dispose();
  });

  it("restarts when a track moves, so the new offset is heard", async () => {
    const player = new MixPlayer();
    const tracks = [fake("a", 10), fake("b", 10)];
    player.setTracks(tracks);
    await player.play();
    context.currentTime = 2.05;
    player.setTracks([tracks[0], { ...tracks[1], offset: 3 }]);
    await Promise.resolve();
    await Promise.resolve();
    const fresh = context.sources.slice(2);
    expect(fresh).toHaveLength(2);
    // Track b now starts one second from here.
    expect(fresh[1].startedAt! - fresh[0].startedAt!).toBeCloseTo(1, 5);
    player.dispose();
  });

  it("queues the next pass of the loop on the audio clock, with no gap", async () => {
    const player = new MixPlayer();
    player.setTracks([fake("a", 10)]);
    player.setLoop({ start: 1, end: 3 });
    await player.play(1);
    const first = context.sources[0];
    expect(first.startedAt).toBeCloseTo(0.05, 5);
    expect(first.into).toBe(1);
    context.currentTime = 1.5;
    tick();
    expect(context.sources).toHaveLength(1);
    context.currentTime = 1.9;
    tick();
    expect(context.sources).toHaveLength(2);
    const second = context.sources[1];
    // The pass ends and the next begins on the same instant.
    expect(first.stoppedAt).toBeCloseTo(2.05, 5);
    expect(second.startedAt).toBeCloseTo(2.05, 5);
    expect(second.into).toBe(1);
    expect(player.currentTime).toBeCloseTo(2.85, 5);
    context.currentTime = 2.15;
    expect(player.currentTime).toBeCloseTo(1.1, 5);
    player.dispose();
  });

  it("a pause while the context wakes up wins over the play", async () => {
    const player = new MixPlayer();
    player.setTracks([fake("a", 10)]);
    context.state = "suspended";
    const started = player.play();
    player.pause();
    expect(await started).toBe(false);
    expect(player.isPlaying).toBe(false);
    expect(context.sources).toHaveLength(0);
  });

  it("ends by itself at the end of the mix", async () => {
    const player = new MixPlayer();
    let ended = 0;
    player.onEnd = () => (ended += 1);
    player.setTracks([fake("a", 2)]);
    await player.play();
    context.currentTime = 1;
    tick();
    expect(player.isPlaying).toBe(true);
    context.currentTime = 2.2;
    tick();
    expect(player.isPlaying).toBe(false);
    expect(ended).toBe(1);
    expect(player.currentTime).toBe(0);
  });
});
