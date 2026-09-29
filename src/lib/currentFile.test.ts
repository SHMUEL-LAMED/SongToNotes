import { afterEach, describe, expect, it } from "vitest";
import { currentOffer, offerFile, receivingTools, resetOffers, type FileOffer } from "./currentFile";

const offer = (kind: FileOffer["kind"], name: string, tool = "speed"): FileOffer => ({
  kind,
  name,
  tool,
  get: () => new File(["x"], name),
});

afterEach(() => resetOffers());

describe("file offers", () => {
  it("offers the song until it is withdrawn", () => {
    const withdraw = offerFile(offer("source", "song.mp3"));
    expect(currentOffer()?.name).toBe("song.mp3");
    withdraw();
    expect(currentOffer()).toBeNull();
  });

  it("prefers a result over the song, and falls back to the song when the result goes", () => {
    offerFile(offer("source", "song.mp3"));
    const withdrawResult = offerFile(offer("result", "song-slow.wav"));
    expect(currentOffer()?.name).toBe("song-slow.wav");
    withdrawResult();
    expect(currentOffer()?.name).toBe("song.mp3");
  });

  it("does not let a replaced offer withdraw its replacement", () => {
    const first = offerFile(offer("source", "a.mp3"));
    offerFile(offer("source", "b.mp3"));
    first();
    expect(currentOffer()?.name).toBe("b.mp3");
  });
});

describe("receivingTools", () => {
  it("lists the tools that open a handed song, without the one it comes from", () => {
    const ids = receivingTools("speed").map((tool) => tool.id);
    expect(ids).toContain("vocals");
    expect(ids).toContain("ringtone");
    expect(ids).toContain("transcript");
    expect(ids).not.toContain("speed");
    // Tools with nothing to do with a song are not offered.
    expect(ids).not.toContain("metronome");
    expect(ids).not.toContain("setlist");
  });

  it("leaves out tools the site has switched off", () => {
    expect(receivingTools(null, ["vocals"]).map((tool) => tool.id)).not.toContain("vocals");
  });
});
