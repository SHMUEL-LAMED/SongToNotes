import { describe, expect, it } from "vitest";
import { applyLineEdits, buildLines, linesToLrc, positionAt } from "./lyrics";

const segments = [
  { start: 0, end: 2, text: "שלום עולם" },
  { start: 2.5, end: 4, text: "מה נשמע" },
];
const words = [
  { word: "שלום", start: 0.1, end: 0.6 },
  { word: "עולם", start: 0.8, end: 1.5 },
  { word: "מה", start: 2.6, end: 2.9 },
  { word: "נשמע", start: 3.1, end: 3.8 },
];

describe("synced lyrics", () => {
  it("puts words into their lines", () => {
    const lines = buildLines(segments, words);
    expect(lines).toHaveLength(2);
    expect(lines[0].words.map((word) => word.text)).toEqual(["שלום", "עולם"]);
    expect(lines[1].words[1].start).toBe(3.1);
  });
  it("keeps timings through edits", () => {
    const lines = buildLines(segments, words);
    const edited = applyLineEdits(lines, "שלום עולמי\nמה קורה פה");
    expect(edited[0].words[1]).toEqual({ text: "עולמי", start: 0.8, end: 1.5 });
    expect(edited[1].words).toHaveLength(3);
    expect(edited[1].words[0].start).toBe(2.5);
  });
  it("writes LRC, plain and enhanced", () => {
    const lines = buildLines(segments, words);
    expect(linesToLrc(lines)).toContain("[00:00.00]שלום עולם");
    expect(linesToLrc(lines)).toContain("[00:02.50]מה נשמע");
    expect(linesToLrc(lines, true)).toContain("[00:00.00]<00:00.10>שלום <00:00.80>עולם");
    expect(linesToLrc(lines, false, { title: "שיר" })).toMatch(/^\[ti:שיר\]/);
  });
  it("gives a word on a boundary to the line that starts there", () => {
    const touching = [
      { start: 0, end: 2, text: "אחת" },
      { start: 2, end: 4, text: "שתיים" },
    ];
    const lines = buildLines(touching, [
      { word: "אחת", start: 0.5, end: 1 },
      { word: "שתיים", start: 2, end: 2.5 },
    ]);
    expect(lines[0].words.map((word) => word.text)).toEqual(["אחת"]);
    expect(lines[1].words.map((word) => word.text)).toEqual(["שתיים"]);
  });
  it("never writes sixty seconds in LRC", () => {
    const lines = [{ start: 59.996, end: 61, text: "כמעט דקה", words: [{ text: "כמעט", start: 119.999, end: 120.2 }] }];
    expect(linesToLrc(lines)).toContain("[01:00.00]כמעט דקה");
    expect(linesToLrc(lines, true)).toContain("<02:00.00>כמעט");
  });
  it("finds the sounding line and word", () => {
    const lines = buildLines(segments, words);
    expect(positionAt(lines, 1)).toEqual({ line: 0, word: 1 });
    expect(positionAt(lines, 2.7)).toEqual({ line: 1, word: 0 });
    expect(positionAt(lines, -1)).toEqual({ line: -1, word: -1 });
  });
});
