import { describe, expect, it } from "vitest";
import { chordName, chordSheet, detectChordTimeline, transposeRoot, uniqueChords } from "./audioChords";
import { guitarShape } from "./guitarShapes";

const RATE = 22_050;

/** A plucked-ish chord: the given MIDI notes with a couple of overtones each. */
function chord(midis: number[], seconds: number) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (const midi of midis) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let index = 0; index < out.length; index += 1) {
      const t = index / RATE;
      out[index] +=
        (Math.sin(2 * Math.PI * frequency * t) + 0.4 * Math.sin(4 * Math.PI * frequency * t) + 0.2 * Math.sin(6 * Math.PI * frequency * t)) /
        midis.length;
    }
  }
  return out;
}

function concat(parts: Float32Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("chord timeline", () => {
  it("hears a C major, then an A minor, then a G7", () => {
    const signal = concat([
      chord([48, 52, 55, 60, 64], 2), // C E G C E
      chord([45, 52, 57, 60, 64], 2), // A E A C E
      chord([43, 47, 50, 53, 59], 2), // G B D F B
    ]);
    const segments = detectChordTimeline(signal, RATE);
    const names = segments.map((segment) => chordName(segment.root, segment.quality));
    expect(names[0]).toBe("C");
    expect(names).toContain("Am");
    expect(names[names.length - 1]).toMatch(/^G(7)?$/);
    expect(segments[0].start).toBe(0);
    expect(Math.abs(segments[0].end - 2)).toBeLessThan(0.5);
  });

  it("keeps silence out of the timeline", () => {
    const segments = detectChordTimeline(new Float32Array(RATE * 2), RATE);
    expect(segments).toHaveLength(0);
  });

  it("transposes and writes a sheet", () => {
    expect(transposeRoot(0, -2)).toBe(10);
    expect(chordName(transposeRoot(9, 3), "m")).toBe("Cm");
    const sheet = chordSheet([{ start: 0, end: 4, root: 0, quality: "", confidence: 1 }, { start: 65, end: 70, root: 9, quality: "m", confidence: 1 }]);
    expect(sheet).toBe("0:00  C\n1:05  Am");
    expect(uniqueChords([
      { start: 0, end: 1, root: 0, quality: "", confidence: 1 },
      { start: 1, end: 2, root: 0, quality: "", confidence: 1 },
      { start: 2, end: 3, root: 7, quality: "7", confidence: 1 },
    ])).toEqual([{ root: 0, quality: "" }, { root: 7, quality: "7" }]);
  });
});

describe("guitar shapes", () => {
  it("uses open shapes where they exist and barres elsewhere", () => {
    expect(guitarShape(0, "").frets).toEqual([-1, 3, 2, 0, 1, 0]);
    expect(guitarShape(4, "m").frets).toEqual([0, 2, 2, 0, 0, 0]);
    const fSharpMinor = guitarShape(6, "m");
    expect(fSharpMinor.barre?.fret).toBe(2);
    expect(fSharpMinor.frets).toEqual([2, 4, 4, 2, 2, 2]);
    const bFlat = guitarShape(10, "");
    expect(bFlat.barre?.fret).toBe(1);
    expect(bFlat.frets).toEqual([-1, 1, 3, 3, 3, 1]);
  });
});
