import { describe, expect, it } from "vitest";
import { scoreToAbc } from "./abc";
import { scoreToMusicXml } from "./musicxml";
import { buildScore, DEFAULT_METER } from "./score";
import type { DetectedNote } from "./types";

function melody(midis: number[], bpm = 120): DetectedNote[] {
  const beat = 60 / bpm;
  return midis.map((midi, index) => ({
    midi,
    start: index * beat,
    duration: beat * 0.95,
    confidence: 0.9,
  }));
}

const OPTIONS = {
  title: "שיר לדוגמה",
  tempo: { bpm: 96, offset: 0, fit: 1 },
  meter: DEFAULT_METER,
  stepsPerBeat: 4,
  mode: "melody" as const,
  transpose: 0,
};

const C_MAJOR = buildScore(melody([60, 62, 64, 65, 67, 69, 71, 72]), OPTIONS);

describe("scoreToAbc", () => {
  it("writes the header fields a reader needs", () => {
    const abc = scoreToAbc(C_MAJOR).split("\n");
    expect(abc[0]).toBe("X:1");
    expect(abc).toContain("T:שיר לדוגמה");
    expect(abc).toContain("M:4/4");
    expect(abc).toContain("L:1/16");
    expect(abc).toContain("Q:1/4=96");
    expect(abc.some((line) => line.startsWith("K:C"))).toBe(true);
  });

  it("closes the tune with a final barline", () => {
    expect(scoreToAbc(C_MAJOR).trimEnd().endsWith("|]")).toBe(true);
  });

  it("keeps a title with newlines from breaking the header", () => {
    const score = { ...C_MAJOR, title: "שורה\nשנייה" };
    const lines = scoreToAbc(score).split("\n");
    expect(lines.filter((line) => line.startsWith("T:"))).toHaveLength(1);
    expect(lines).toContain("T:שורה שנייה");
  });

  it("names the tune even when the title is blank", () => {
    expect(scoreToAbc({ ...C_MAJOR, title: "   " })).toContain("T:SongToNotes");
  });

  it("declares both voices for a grand staff", () => {
    const grand = buildScore(melody([40, 72, 43, 76, 45, 79]), { ...OPTIONS, mode: "full" });
    const abc = scoreToAbc(grand);
    expect(grand.staves).toHaveLength(2);
    expect(abc).toContain("%%score {1 | 2}");
    expect(abc).toContain("V:1 clef=treble");
    expect(abc).toContain("V:2 clef=bass");
  });
});

describe("scoreToMusicXml", () => {
  const xml = scoreToMusicXml(C_MAJOR);

  it("is a declared, doctyped partwise score", () => {
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("score-partwise");
    expect(xml).toContain("<!DOCTYPE");
  });

  it("carries the key, meter and tempo", () => {
    expect(xml).toContain("<fifths>0</fifths>");
    expect(xml).toContain("<beats>4</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
    expect(xml).toMatch(/tempo="96"/);
  });

  it("writes one measure element per measure", () => {
    const measures = xml.match(/<measure number="/g) ?? [];
    expect(measures).toHaveLength(C_MAJOR.measureCount * C_MAJOR.staves.length);
  });

  it("escapes a title that would otherwise break the markup", () => {
    const xml = scoreToMusicXml({ ...C_MAJOR, title: 'שיר <& "אחר"' });
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain('<work-title>שיר <');
  });

  it("balances every tag it opens", () => {
    const opened: string[] = xml.match(/<([a-z-]+)(?: [^>]*)?>/g) ?? [];
    const closed: string[] = xml.match(/<\/([a-z-]+)>/g) ?? [];
    const selfClosing: string[] = xml.match(/<[a-z-]+[^>]*\/>/g) ?? [];
    const count = (tags: string[]) =>
      tags.reduce<Record<string, number>>((totals, tag) => {
        const name = tag.replace(/[<>/]/g, "").split(" ")[0];
        totals[name] = (totals[name] ?? 0) + 1;
        return totals;
      }, {});
    const opens = count(opened.filter((tag) => !selfClosing.includes(tag)));
    const closes = count(closed);
    for (const [name, total] of Object.entries(closes)) {
      expect({ name, total }).toEqual({ name, total: opens[name] });
    }
  });
});
