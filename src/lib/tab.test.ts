import { describe, expect, it } from "vitest";
import type { Score, ScoreEvent } from "./score";
import { MAX_FRET, STANDARD_TUNING, chordShapes, fingerEvents, intoRange, scoreToTab } from "./tab";

const note = (offset: number, midis: number[], extra: Partial<ScoreEvent> = {}): ScoreEvent => ({ offset, length: 1, midis, tiedFrom: false, tiedTo: false, ...extra });

/** A score of 4/4 bars, a step per beat, with the given staves' events. */
function score(staves: ScoreEvent[][][], title = "שיר"): Score {
  return {
    title,
    key: { fifths: 0, mode: "major", tonicPitchClass: 0, fit: 1 },
    meter: { beats: 4, beatType: 4 },
    bpm: 96,
    stepsPerBeat: 1,
    stepsPerMeasure: 4,
    measureCount: staves[0].length,
    staves: staves.map((measures, index) => ({ clef: index === 0 ? "treble" : "bass", measures })),
    offsetSeconds: 0,
    truncated: false,
  };
}

/** The sounding pitch of a position. */
const pitch = (position: { string: number; fret: number }) => STANDARD_TUNING[position.string] + position.fret;

describe("intoRange", () => {
  it("moves notes by octaves onto the guitar", () => {
    expect(intoRange(60)).toBe(60);
    expect(intoRange(30)).toBe(42);
    expect(intoRange(96)).toBe(84);
  });
});

describe("chordShapes", () => {
  it("finds every place a single note sounds", () => {
    const places = chordShapes([64]).map(([position]) => `${position.string}:${position.fret}`);
    expect(places.sort()).toEqual(["1:19", "2:14", "3:9", "4:5", "5:0"]);
  });

  it("puts a chord one note to a string, within a hand's stretch", () => {
    const shapes = chordShapes([48, 52, 55, 60, 64]); // C major, as an open chord has it
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(new Set(shape.map((item) => item.string)).size).toBe(shape.length);
      expect(shape.map(pitch).sort((a, b) => a - b)).toEqual([48, 52, 55, 60, 64]);
      const frets = shape.map((item) => item.fret).filter((fret) => fret > 0);
      expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4);
    }
    // The open C chord is among them: x32010.
    expect(shapes.some((shape) => shape.map((item) => `${item.string}:${item.fret}`).sort().join() === ["1:3", "2:2", "3:0", "4:1", "5:0"].join())).toBe(true);
  });
});

describe("fingerEvents", () => {
  it("plays every note at its own pitch", () => {
    const events = [[60], [62], [64], [65], [67], [69], [71], [72], [48, 55, 64], [30], [100]];
    fingerEvents(events).forEach((shape, index) => {
      expect(shape.map(pitch).sort((a, b) => a - b)).toEqual([...new Set(events[index].map(intoRange))].sort((a, b) => a - b));
      for (const position of shape) expect(position.fret).toBeLessThanOrEqual(MAX_FRET);
    });
  });

  it("keeps a scale under one hand, low on the neck", () => {
    const shapes = fingerEvents([[60], [62], [64], [65], [67], [69], [71], [72]]);
    const frets = shapes.flat().map((item) => item.fret).filter((fret) => fret > 0);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(5);
    expect(Math.max(...frets)).toBeLessThanOrEqual(10);
  });

  it("thins a chord too big for six strings, keeping the melody on top", () => {
    const [shape] = fingerEvents([[40, 45, 50, 55, 59, 64, 69, 76]]);
    expect(shape.length).toBeLessThanOrEqual(6);
    expect(Math.max(...shape.map(pitch))).toBe(76);
  });
});

describe("scoreToTab", () => {
  it("draws the bars as six lines, the high string on top", () => {
    const text = scoreToTab(score([[[note(0, [40]), note(2, [45])]]]), { lang: "en" });
    expect(text.split("\n")).toEqual([
      "Guitar tab — שיר",
      "Standard tuning (E A D G B E) · 96 BPM · 4/4",
      "",
      "e|------|",
      "B|------|",
      "G|------|",
      "D|------|",
      "A|---0--|",
      "E|0-----|",
      "",
    ]);
  });

  it("joins the staves, skips held notes and rests, and writes two-digit frets whole", () => {
    const treble = [[note(0, [76]), note(1, [76], { tiedFrom: true }), note(2, []), note(3, [83])]];
    const bass = [[note(0, [40])]];
    const lines = scoreToTab(score([treble, bass]), { lang: "en" }).split("\n").slice(3, 9);
    expect(lines.every((line) => line.length === lines[0].length)).toBe(true);
    const low = lines[5];
    expect(low.startsWith("E|0")).toBe(true);
    // 76 and 83 above the open E: both on the high strings, one of them past the ninth fret.
    expect(lines.some((line) => /\d\d/.test(line))).toBe(true);
    expect(lines.join("").replace(/[^0-9]/g, "").length).toBeGreaterThanOrEqual(3);
  });

  it("wraps bars into systems that fit the width", () => {
    const bars = Array.from({ length: 12 }, (_, index) => [note(0, [52 + index]), note(2, [55 + index])]);
    const lines = scoreToTab(score([bars]), { width: 40 }).split("\n").filter((line) => line.startsWith("e|"));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(40);
  });

  it("says so when there is nothing to play, in the site's language", () => {
    expect(scoreToTab(score([[[note(0, [])]]]), { lang: "he" })).toContain("(אין תווים)");
  });
});
