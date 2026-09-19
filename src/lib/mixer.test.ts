import { describe, expect, it } from "vitest";
import { audibleTracks, mixDuration, type MixTrack } from "./mixer";

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
