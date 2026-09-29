import { describe, expect, it } from "vitest";
import type { ChordQuality } from "./audioChords";
import { guitarShape } from "./guitarShapes";
import { GUITAR_STRINGS } from "./theory";

const TONES: Record<ChordQuality, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

describe("guitarShape", () => {
  for (const quality of Object.keys(TONES) as ChordQuality[]) {
    it(`plays only the chord's own notes, root in the bass, for every ${quality || "major"} chord`, () => {
      for (let root = 0; root < 12; root += 1) {
        const shape = guitarShape(root, quality);
        const sounded = shape.frets.flatMap((fret, string) => (fret < 0 ? [] : [GUITAR_STRINGS[string] + fret]));
        const classes = sounded.map((midi) => (((midi - root) % 12) + 12) % 12);
        expect(classes.every((pc) => TONES[quality].includes(pc)), `${root}${quality}: ${shape.frets}`).toBe(true);
        expect(classes[0], `${root}${quality} bass`).toBe(0);
        expect(new Set(classes).size).toBeGreaterThanOrEqual(3);
        // Every fretted note sits at or above the fret the diagram starts at.
        for (const fret of shape.frets) if (fret > 0) expect(fret).toBeGreaterThanOrEqual(shape.base);
      }
    });
  }
});
