import { describe, expect, it } from "vitest";
import { DRILL_CHORDS, SUGGESTED_PAIRS, findDrillChord, normalizeHistory, pairKey, pairStats, perMinute, strumNotes } from "./changes";

describe("chord changes", () => {
  it("keys a pair the same way in either order", () => {
    expect(pairKey("G", "C")).toBe(pairKey("C", "G"));
  });

  it("scales any drill length to changes per minute", () => {
    expect(perMinute({ changes: 20, seconds: 30 })).toBe(40);
    expect(perMinute({ changes: 45, seconds: 60 })).toBe(45);
    expect(perMinute({ changes: 5, seconds: 0 })).toBe(0);
  });

  it("finds the best and the latest runs per pair", () => {
    const history = [
      { pair: "C|G", changes: 20, seconds: 60, at: "1" },
      { pair: "A|D", changes: 50, seconds: 60, at: "2" },
      { pair: "C|G", changes: 30, seconds: 60, at: "3" },
      { pair: "C|G", changes: 12, seconds: 30, at: "4" },
    ];
    const stats = pairStats(history, "C|G", 2);
    expect(stats.best).toBe(30);
    expect(stats.runs).toBe(3);
    expect(stats.recent.map((item) => item.at)).toEqual(["3", "4"]);
  });

  it("drops anything malformed from storage", () => {
    expect(normalizeHistory("nope")).toEqual([]);
    expect(normalizeHistory([{ pair: "C|G", changes: 3, seconds: 0, at: "x" }, { pair: "C|G", changes: 3, seconds: 60, at: "x" }, null])).toHaveLength(1);
  });

  it("only suggests chords it can draw", () => {
    for (const [a, b] of SUGGESTED_PAIRS) {
      expect(findDrillChord(a)).not.toBeNull();
      expect(findDrillChord(b)).not.toBeNull();
    }
  });

  it("strums the fingered notes, skipping muted strings", () => {
    const c = strumNotes(findDrillChord("C")!);
    expect(c).toEqual([48, 52, 55, 60, 64]);
    for (const chord of DRILL_CHORDS) expect(strumNotes(chord).length).toBeGreaterThanOrEqual(4);
  });
});
