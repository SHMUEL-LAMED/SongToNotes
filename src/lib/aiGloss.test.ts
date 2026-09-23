import { describe, expect, it } from "vitest";
import { parseLyricGloss } from "./aiApi";

describe("parseLyricGloss", () => {
  it("pairs each line with its transliteration and translation", () => {
    const gloss = parseLyricGloss("הלו || שלום\nגודביי || להתראות", ["Hello", "Goodbye"]);
    expect(gloss).toEqual([
      { transliteration: "הלו", translation: "שלום" },
      { transliteration: "גודביי", translation: "להתראות" },
    ]);
  });

  it("keeps blank lines blank when the model drops them", () => {
    const gloss = parseLyricGloss("אה || א\nבי || ב", ["A", "", "B"]);
    expect(gloss?.map((item) => item.translation)).toEqual(["א", "", "ב"]);
  });

  it("accepts blank lines the model kept", () => {
    const gloss = parseLyricGloss("אה || א\n\nבי || ב", ["A", "", "B"]);
    expect(gloss?.map((item) => item.translation)).toEqual(["א", "", "ב"]);
  });

  it("refuses answers that do not line up", () => {
    expect(parseLyricGloss("אחת || 1", ["one", "two", "three"])).toBeNull();
  });

  it("takes a line without a separator as the translation", () => {
    expect(parseLyricGloss("שלום", ["Hello"])).toEqual([{ transliteration: "", translation: "שלום" }]);
  });
});
