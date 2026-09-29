import { describe, expect, it } from "vitest";
import { pathRoute, routeFrom } from "./router";

const BASE = "/SongToNotes/";

describe("pathRoute", () => {
  it("reads the tool from a tool page's path", () => {
    expect(pathRoute("/SongToNotes/tuner/", BASE)).toBe("tuner");
    expect(pathRoute("/SongToNotes/tuner", BASE)).toBe("tuner");
  });

  it("finds nothing on the main page or a file", () => {
    expect(pathRoute("/SongToNotes/", BASE)).toBeNull();
    expect(pathRoute("/SongToNotes/index.html", BASE)).toBeNull();
    expect(pathRoute("/elsewhere/tuner/", BASE)).toBeNull();
  });
});

describe("routeFrom", () => {
  it("prefers the hash", () => {
    expect(routeFrom("#/metronome", "/SongToNotes/tuner/", BASE)).toBe("metronome");
  });

  it("goes home on #/ even from a tool page", () => {
    expect(routeFrom("#/", "/SongToNotes/tuner/", BASE)).toBe("home");
  });

  it("falls back to the path, then home", () => {
    expect(routeFrom("", "/SongToNotes/tuner/", BASE)).toBe("tuner");
    expect(routeFrom("", "/SongToNotes/", BASE)).toBe("home");
  });
});
