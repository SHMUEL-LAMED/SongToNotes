/**
 * How to play a chord on a guitar: six strings, low E to high e, each a
 * fret number, 0 for open and -1 for muted. Open shapes where the chord has
 * one; otherwise a barre shape moved up the neck.
 */
import type { ChordQuality } from "./audioChords";

export type GuitarShape = {
  frets: number[];
  /** Fret the diagram starts at; 1 draws the nut. */
  base: number;
  /** A barre from this string index across to the end, when the shape has one. */
  barre?: { fret: number; from: number };
  fingers?: number[];
};

const OPEN: Record<string, GuitarShape> = {
  // majors
  "0": { frets: [-1, 3, 2, 0, 1, 0], base: 1, fingers: [0, 3, 2, 0, 1, 0] },
  "2": { frets: [-1, -1, 0, 2, 3, 2], base: 1, fingers: [0, 0, 0, 1, 3, 2] },
  "4": { frets: [0, 2, 2, 1, 0, 0], base: 1, fingers: [0, 2, 3, 1, 0, 0] },
  "5": { frets: [1, 3, 3, 2, 1, 1], base: 1, barre: { fret: 1, from: 0 }, fingers: [1, 3, 4, 2, 1, 1] },
  "7": { frets: [3, 2, 0, 0, 0, 3], base: 1, fingers: [2, 1, 0, 0, 0, 3] },
  "9": { frets: [-1, 0, 2, 2, 2, 0], base: 1, fingers: [0, 0, 1, 2, 3, 0] },
  // minors
  "2m": { frets: [-1, -1, 0, 2, 3, 1], base: 1, fingers: [0, 0, 0, 2, 3, 1] },
  "4m": { frets: [0, 2, 2, 0, 0, 0], base: 1, fingers: [0, 2, 3, 0, 0, 0] },
  "9m": { frets: [-1, 0, 2, 2, 1, 0], base: 1, fingers: [0, 0, 2, 3, 1, 0] },
  // sevenths
  "07": { frets: [-1, 3, 2, 3, 1, 0], base: 1, fingers: [0, 3, 2, 4, 1, 0] },
  "27": { frets: [-1, -1, 0, 2, 1, 2], base: 1, fingers: [0, 0, 0, 2, 1, 3] },
  "47": { frets: [0, 2, 0, 1, 0, 0], base: 1, fingers: [0, 2, 0, 1, 0, 0] },
  "77": { frets: [3, 2, 0, 0, 0, 1], base: 1, fingers: [3, 2, 0, 0, 0, 1] },
  "97": { frets: [-1, 0, 2, 0, 2, 0], base: 1, fingers: [0, 0, 2, 0, 3, 0] },
  "2m7": { frets: [-1, -1, 0, 2, 1, 1], base: 1, fingers: [0, 0, 0, 2, 1, 1] },
  "4m7": { frets: [0, 2, 0, 0, 0, 0], base: 1, fingers: [0, 2, 0, 0, 0, 0] },
  "9m7": { frets: [-1, 0, 2, 0, 1, 0], base: 1, fingers: [0, 0, 2, 0, 1, 0] },
  "0maj7": { frets: [-1, 3, 2, 0, 0, 0], base: 1, fingers: [0, 3, 2, 0, 0, 0] },
  "2maj7": { frets: [-1, -1, 0, 2, 2, 2], base: 1, fingers: [0, 0, 0, 1, 1, 1] },
  "5maj7": { frets: [-1, -1, 3, 2, 1, 0], base: 1, fingers: [0, 0, 3, 2, 1, 0] },
  "7maj7": { frets: [3, 2, 0, 0, 0, 2], base: 1, fingers: [3, 1, 0, 0, 0, 2] },
  "9maj7": { frets: [-1, 0, 2, 1, 2, 0], base: 1, fingers: [0, 0, 2, 1, 3, 0] },
  // sus
  "2sus4": { frets: [-1, -1, 0, 2, 3, 3], base: 1, fingers: [0, 0, 0, 1, 2, 3] },
  "2sus2": { frets: [-1, -1, 0, 2, 3, 0], base: 1, fingers: [0, 0, 0, 1, 3, 0] },
  "4sus4": { frets: [0, 2, 2, 2, 0, 0], base: 1, fingers: [0, 1, 2, 3, 0, 0] },
  "9sus4": { frets: [-1, 0, 2, 2, 3, 0], base: 1, fingers: [0, 0, 1, 2, 3, 0] },
  "9sus2": { frets: [-1, 0, 2, 2, 0, 0], base: 1, fingers: [0, 0, 1, 2, 0, 0] },
  "0sus2": { frets: [-1, 3, 0, 0, 1, 3], base: 1, fingers: [0, 2, 0, 0, 1, 3] },
  "7sus4": { frets: [3, 3, 0, 0, 1, 3], base: 1, fingers: [2, 3, 0, 0, 1, 4] },
};

/** E-shape and A-shape barre chords, as fret offsets from the barre. */
const BARRE: Record<ChordQuality, { e: number[]; a: number[] }> = {
  "": { e: [0, 2, 2, 1, 0, 0], a: [-1, 0, 2, 2, 2, 0] },
  m: { e: [0, 2, 2, 0, 0, 0], a: [-1, 0, 2, 2, 1, 0] },
  "7": { e: [0, 2, 0, 1, 0, 0], a: [-1, 0, 2, 0, 2, 0] },
  m7: { e: [0, 2, 0, 0, 0, 0], a: [-1, 0, 2, 0, 1, 0] },
  maj7: { e: [0, -1, 1, 1, 0, -1], a: [-1, 0, 2, 1, 2, 0] },
  sus4: { e: [0, 2, 2, 2, 0, 0], a: [-1, 0, 2, 2, 3, 0] },
  sus2: { e: [0, 2, 4, 4, 0, 0], a: [-1, 0, 2, 2, 0, 0] },
  dim: { e: [0, 1, 2, 0, -1, -1], a: [-1, 0, 1, 2, 1, -1] },
  aug: { e: [0, -1, 2, 1, 1, 0], a: [-1, 0, 3, 2, 2, 1] },
};

/** Semitone of each open string, low E first, as a pitch class. */
const STRING_CLASS = [4, 9, 2, 7, 11, 4];

/** A playable shape for the chord, open where one exists, barred otherwise. */
export function guitarShape(root: number, quality: ChordQuality): GuitarShape {
  const open = OPEN[`${root}${quality}`];
  if (open) return open;
  // E-shape barre: the barre fret is where the low E string reaches the root.
  const eFret = ((root - STRING_CLASS[0]) % 12 + 12) % 12 || 12;
  const aFret = ((root - STRING_CLASS[1]) % 12 + 12) % 12 || 12;
  // Prefer whichever sits lower on the neck.
  const useA = aFret < eFret;
  const fret = useA ? aFret : eFret;
  const pattern = useA ? BARRE[quality].a : BARRE[quality].e;
  const frets = pattern.map((offset) => (offset < 0 ? -1 : fret + offset));
  const base = Math.max(1, fret);
  return {
    frets,
    base,
    barre: { fret, from: useA ? 1 : 0 },
  };
}
