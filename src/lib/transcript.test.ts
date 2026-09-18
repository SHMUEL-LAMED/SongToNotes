import { describe, expect, it } from "vitest";
import {
  countWords,
  formatTimestamp,
  normalizeSegments,
  segmentsToSrt,
  segmentsToText,
  segmentsToVtt,
  textToSegments,
} from "./transcript";

const segments = [
  { start: 0, end: 2.5, text: "שלום לכולם" },
  { start: 2.5, end: null, text: "ברוכים הבאים" },
  { start: 6.25, end: 8, text: "להתראות" },
];

describe("formatTimestamp", () => {
  it("writes hours, minutes, seconds and millis", () => {
    expect(formatTimestamp(0)).toBe("00:00:00,000");
    expect(formatTimestamp(62.345)).toBe("00:01:02,345");
    expect(formatTimestamp(3600 + 5.5, ".")).toBe("01:00:05.500");
    expect(formatTimestamp(-3)).toBe("00:00:00,000");
  });
});

describe("SRT and VTT", () => {
  it("numbers the cues and fills a missing end from the next start", () => {
    const srt = segmentsToSrt(segments);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:02,500\nשלום לכולם\n");
    expect(srt).toContain("2\n00:00:02,500 --> 00:00:06,250\nברוכים הבאים\n");
    expect(srt).toContain("3\n00:00:06,250 --> 00:00:08,000\nלהתראות\n");
  });

  it("gives the last open-ended segment a couple of seconds", () => {
    expect(segmentsToSrt([{ start: 10, end: null, text: "סוף" }])).toContain(
      "00:00:10,000 --> 00:00:12,000",
    );
  });

  it("writes a WEBVTT header and dotted millis", () => {
    const vtt = segmentsToVtt(segments);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:02.500\nשלום לכולם");
    expect(vtt).not.toContain(",");
  });
});

describe("editing in place", () => {
  it("keeps timestamps when lines are changed", () => {
    const text = segmentsToText(segments).replace("ברוכים הבאים", "ברוכים הבאים לאתר");
    const edited = textToSegments(text, segments);
    expect(edited).toHaveLength(3);
    expect(edited[1]).toEqual({ start: 2.5, end: null, text: "ברוכים הבאים לאתר" });
  });

  it("drops a blanked line and joins extra lines onto the last segment", () => {
    const edited = textToSegments("שלום לכולם\n\nלהתראות\nועוד משהו", segments);
    expect(edited.map((item) => item.text)).toEqual(["שלום לכולם", "להתראות ועוד משהו"]);
    expect(edited[1].start).toBe(6.25);
  });
});

describe("normalizeSegments", () => {
  it("keeps well-formed segments and drops the rest", () => {
    expect(
      normalizeSegments([
        { start: 1, end: 2, text: " היי " },
        { start: 3, end: 1, text: "סוף לפני התחלה" },
        { start: "x", text: "לא מספר" },
        { start: 4, end: 5, text: "   " },
        null,
      ]),
    ).toEqual([
      { start: 1, end: 2, text: "היי" },
      { start: 3, end: null, text: "סוף לפני התחלה" },
    ]);
    expect(normalizeSegments("nope")).toEqual([]);
  });
});

describe("countWords", () => {
  it("counts Hebrew and English words, not punctuation", () => {
    expect(countWords("שלום, עולם! hello-world 123")).toBe(4);
    expect(countWords("")).toBe(0);
  });
});
