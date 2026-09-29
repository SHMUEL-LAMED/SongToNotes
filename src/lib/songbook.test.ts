import { describe, expect, it, vi } from "vitest";
import { clearSongbookDraft, foldChordLines, peekSongbookDraft, setSongbookDraft, takeSongbookDraft, isChordLine, isChordToken, parseChordSymbol, parseSong, songChords, songToText, transposeChord, transposeSong } from "./songbook";

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

  it("reads and transposes the longer chord names sheets use", () => {
    for (const name of ["Bm7b5", "E7sus4", "Cdim7", "C5", "Cm(maj7)", "Cadd9", "Fmaj", "CM7", "C7(b9)", "Asus", "Emin7"]) {
      expect(isChordLine(name)).toBe(true);
    }
    expect(transposeSong("[Bm7b5]א [E7sus4]ב [Cdim7/G]ג", 2)).toBe("[C#m7b5]א [F#7sus4]ב [Ddim7/A]ג");
    expect(parseChordSymbol("Bm7b5")).toEqual({ root: 11, quality: "dim" });
    expect(parseChordSymbol("E7sus4")).toEqual({ root: 4, quality: "sus4" });
    expect(parseChordSymbol("Emin7")).toEqual({ root: 4, quality: "m7" });
    expect(parseChordSymbol("CM7")).toEqual({ root: 0, quality: "maj7" });
    expect(parseChordSymbol("A13")).toEqual({ root: 9, quality: "7" });
    expect(parseChordSymbol("Cadd9")).toEqual({ root: 0, quality: "" });
    // Still not words, and not a long remark in brackets.
    for (const word of ["Bad", "Add", "Hello", "Ebb", "Am I"]) expect(isChordToken(word)).toBe(false);
    expect(isChordToken(`A${"7".repeat(40)}`)).toBe(false);
  });

  it("reads ChordPro section directives", () => {
    const lines = parseSong("{soc}\n[Am]לה\n{eoc}\n{start_of_verse: בית 2}\n{c: בשקט}\n{key: G}");
    expect(lines[0]).toEqual({ chords: [], lyric: "פזמון", kind: "heading" });
    expect(lines[2].kind).toBe("blank");
    expect(lines[3]).toEqual({ chords: [], lyric: "בית 2", kind: "heading" });
    expect(lines[4]).toEqual({ chords: [], lyric: "בשקט", kind: "heading" });
    expect(lines[5]).toMatchObject({ kind: "line", lyric: "{key: G}" });
  });

  it("writes chords back over the words", () => {
    expect(songToText("[Am]היה [G]היה\nשורה")).toBe("Am  G\nהיה היה\nשורה");
  });
});

describe("songbook draft", () => {
  it("survives being read by a render that is thrown away, and goes once cleared", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    setSongbookDraft({ title: "שיר", body: "[Am] [G]" });
    expect(peekSongbookDraft()?.body).toBe("[Am] [G]");
    // A second render reads the same draft.
    expect(peekSongbookDraft()?.body).toBe("[Am] [G]");
    clearSongbookDraft();
    expect(peekSongbookDraft()).toBeNull();
    setSongbookDraft({ title: "", body: "[C]" });
    expect(takeSongbookDraft()?.body).toBe("[C]");
    expect(takeSongbookDraft()).toBeNull();
    vi.unstubAllGlobals();
  });
});
