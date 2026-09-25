import { describe, expect, it } from "vitest";
import { RELOAD_GAP_MS, isMissingPiece, mayReload } from "./staleBuild";

describe("a piece of the site that did not arrive", () => {
  it("is told apart in every browser's words", () => {
    const url = "https://shmuel-lamed.github.io/SongToNotes/assets/RingtoneTool-Bnc81HtL.js";
    expect(isMissingPiece(new TypeError(`Failed to fetch dynamically imported module: ${url}`))).toBe(true); // Chrome
    expect(isMissingPiece(new TypeError(`error loading dynamically imported module: ${url}`))).toBe(true); // Firefox
    expect(isMissingPiece(new TypeError("Importing a module script failed."))).toBe(true); // Safari
    expect(isMissingPiece(new Error("Unable to preload CSS for /SongToNotes/assets/IdentifyTool-x.css"))).toBe(true); // Vite
    expect(isMissingPiece("Failed to fetch dynamically imported module")).toBe(true);
  });

  it("is not any other failure", () => {
    expect(isMissingPiece(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isMissingPiece(new Error("Failed to fetch"))).toBe(false);
    expect(isMissingPiece(null)).toBe(false);
    expect(isMissingPiece({ message: "Failed to fetch dynamically imported module" })).toBe(false);
  });
});

describe("reloading for the new build", () => {
  const now = 1_800_000_000_000;

  it("happens the first time", () => {
    expect(mayReload(0, now)).toBe(true);
  });

  it("never twice within a minute, so a real outage cannot loop", () => {
    expect(mayReload(now - 1_000, now)).toBe(false);
    expect(mayReload(now - RELOAD_GAP_MS + 1, now)).toBe(false);
    expect(mayReload(now - RELOAD_GAP_MS, now)).toBe(true);
  });

  it("is not held back by a clock that went back", () => {
    expect(mayReload(now + 5_000, now)).toBe(true);
  });
});
