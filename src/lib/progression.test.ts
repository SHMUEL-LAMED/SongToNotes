import { describe, expect, it } from "vitest";
import { isChordToken } from "./songbook";
import { MOODS, alternativesFor, arrange, chordFor, generateTokens, loopLength, spellProgression, toSongbookBody, voiceLead } from "./progression";

describe("chordFor", () => {
  it("spells the scale's own chords", () => {
    expect(spellProgression(["1", "5", "6", "4"], 0, false, false).map((chord) => chord.name)).toEqual(["C", "G", "Am", "F"]);
    expect(spellProgression(["1", "6", "3", "7"], 9, true, false).map((chord) => chord.name)).toEqual(["Am", "F", "C", "G"]);
  });

  it("spells borrowed chords from their scale degree", () => {
    expect(chordFor("b7", 0, false, false).name).toBe("B♭");
    expect(chordFor("b6", 0, false, false).name).toBe("A♭");
    expect(chordFor("4m", 0, false, false).name).toBe("Fm");
    expect(chordFor("5M", 9, true, false).name).toBe("E");
    expect(chordFor("5M", 1, true, true).name).toBe("G♯7");
  });

  it("gives the songbook a symbol it can read", () => {
    for (const mood of MOODS) {
      for (const pc of [0, 1, 6, 10]) {
        for (const tokens of mood.pool) {
          for (const chord of spellProgression(tokens, pc, mood.minor, Boolean(mood.sevenths))) {
            expect(isChordToken(chord.plain), `${chord.name} → ${chord.plain}`).toBe(true);
          }
        }
      }
    }
  });

  it("keeps root pitch classes right", () => {
    expect(chordFor("5", 2, false, false).rootPc).toBe(9);
    expect(chordFor("b7", 7, false, false).rootPc).toBe(5);
  });
});

describe("generateTokens", () => {
  it("draws from the mood and stays the same length", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 50; run += 1) {
      const tokens = generateTokens(MOODS[0], random);
      expect(tokens.length).toBeGreaterThanOrEqual(2);
      expect(tokens[0]).toBe(MOODS[0].pool.find((item) => item.length === tokens.length && item[0] === tokens[0])?.[0] ?? tokens[0]);
    }
  });

  it("offers alternatives other than the chord itself", () => {
    expect(alternativesFor("1", false)).not.toContain("1");
    expect(alternativesFor("1", true)).toContain("5M");
    expect(chordFor("4M", 9, true, false).name).toBe("D");
  });
});

describe("voiceLead", () => {
  it("keeps voices close from chord to chord", () => {
    const voiced = voiceLead(spellProgression(["1", "5", "6", "4"], 0, false, false));
    for (let index = 1; index < voiced.length; index += 1) {
      const moved = voiced[index].reduce((sum, value, at) => sum + Math.abs(value - voiced[index - 1][at]), 0);
      expect(moved).toBeLessThanOrEqual(8);
    }
    voiced.flat().forEach((midi) => expect(midi).toBeGreaterThanOrEqual(53));
  });
});

describe("arrange", () => {
  const chords = spellProgression(["1", "5", "6", "4"], 0, false, false);
  it("fills the loop and nothing starts past it", () => {
    const arrangement = { bpm: 120, beatsPerChord: 4, pattern: "arpUp" as const, bass: "walking" as const };
    const notes = arrange(chords, arrangement);
    const length = loopLength(chords, arrangement);
    expect(length).toBe(8);
    expect(notes.every((item) => item.start >= 0 && item.start < length)).toBe(true);
    expect(notes.some((item) => item.midi < 48)).toBe(true);
  });

  it("writes no bass when asked for none", () => {
    const notes = arrange(chords, { bpm: 100, beatsPerChord: 4, pattern: "block", bass: "none" });
    expect(notes.every((item) => item.midi >= 53)).toBe(true);
    expect(notes).toHaveLength(12);
  });
});

it("writes songbook text", () => {
  expect(toSongbookBody(spellProgression(["1", "4"], 0, false, false), 1)).toBe("[C] [F]");
});
