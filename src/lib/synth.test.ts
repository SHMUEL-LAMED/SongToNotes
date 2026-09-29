import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotePlayer } from "./synth";

/**
 * A context that stays suspended until the test lets it resume — the state an
 * iPhone, or a play the assistant starts, leaves the player waiting in.
 */
function installSuspendedContext() {
  let release: () => void = () => undefined;
  class FakeContext {
    state = "suspended";
    currentTime = 0;
    destination = {};
    resume() {
      return new Promise<void>((resolve) => {
        release = () => {
          this.state = "running";
          resolve();
        };
      });
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
    createGain() {
      return { gain: { value: 1 }, connect: () => undefined };
    }
    createDynamicsCompressor() {
      return { threshold: { value: 0 }, ratio: { value: 0 }, connect: () => undefined };
    }
  }
  vi.stubGlobal("window", {
    AudioContext: FakeContext,
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
  return () => release();
}

const notes = [{ midi: 60, start: 0, duration: 0.5, confidence: 1 }];

describe("NotePlayer.play while the context resumes", () => {
  let resume: () => void;
  beforeEach(() => {
    resume = installSuspendedContext();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stays stopped when stopped during the wait", async () => {
    const player = new NotePlayer();
    player.load(notes, 0);
    const playing = player.play(0);
    player.stop(true);
    resume();
    await playing;
    expect(player.isPlaying).toBe(false);
  });

  it("stays paused when paused during the wait", async () => {
    const player = new NotePlayer();
    player.load(notes, 0);
    const playing = player.play(0);
    player.pause();
    resume();
    await playing;
    expect(player.isPlaying).toBe(false);
  });

  it("still starts when nothing interrupts it", async () => {
    const player = new NotePlayer();
    player.load(notes, 0);
    vi.spyOn(player as unknown as { schedule: () => void }, "schedule").mockImplementation(() => undefined);
    const playing = player.play(0);
    resume();
    await playing;
    expect(player.isPlaying).toBe(true);
  });
});
