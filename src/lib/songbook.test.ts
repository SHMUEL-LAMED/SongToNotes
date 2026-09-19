import { describe, expect, it } from "vitest";
import { foldChordLines, isChordLine, parseChordSymbol, parseSong, songChords, songToText, transposeChord, transposeSong } from "./songbook";

describe("songbook text", () => {
  it("recognises chord lines and folds them into brackets", () => {
    expect(isChordLine("Am  G   C")).toBe(true);
    expect(isChordLine("שלום לכולם")).toBe(false);
    const folded = foldChordLines("Am      G\nהיה היה פעם\nC\nילד קטן");
    expect(folded).toBe("[Am]היה היה [G]פעם\n[C]ילד קטן");
  });

  it("parses brackets into chord positions", () => {
    const lines = parseSong("[פזמון]\n[Am]היה [G]היה\n\nבלי אקורדים");
    expect(lines[0]).toEqual({ chords: [], lyric: "פזמון", kind: "heading" });
    expect(lines[1].lyric).toBe("היה היה");
    expect(lines[1].chords).toEqual([{ at: 0, name: "Am" }, { at: 4, name: "G" }]);
    expect(lines[2].kind).toBe("blank");
    expect(lines[3].chords).toEqual([]);
  });

  it("transposes chords, keeping quality and bass", () => {
    expect(transposeChord("Am", 3)).toBe("Cm");
    expect(transposeChord("G/B", -2)).toBe("F/A");
    expect(transposeChord("F#m7", 1, true)).toBe("Gm7");
    expect(transposeSong("[Am]שיר [G/B]עם [בית]כותרת", 2)).toBe("[Bm]שיר [A/C#]עם [בית]כותרת");
    expect(songChords("[Am]x [G]y [Am]z [בית]")).toEqual(["Am", "G"]);
    expect(parseChordSymbol("Bbmaj7")).toEqual({ root: 10, quality: "maj7" });
    expect(parseChordSymbol("nope")).toBeNull();
  });

  it("writes chords back over the words", () => {
    expect(songToText("[Am]היה [G]היה\nשורה")).toBe("Am  G\nהיה היה\nשורה");
  });
});
