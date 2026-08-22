import { spellPitch } from "./key";
import type { Score } from "./score";
import type { KeySignature } from "./types";

type Template = { name: string; intervals: number[]; weight: number };

/** Ordered so simpler triads win ties against their richer relatives. */
const TEMPLATES: Template[] = [
  { name: "", intervals: [0, 4, 7], weight: 1 },
  { name: "m", intervals: [0, 3, 7], weight: 1 },
  { name: "7", intervals: [0, 4, 7, 10], weight: 0.98 },
  { name: "maj7", intervals: [0, 4, 7, 11], weight: 0.97 },
  { name: "m7", intervals: [0, 3, 7, 10], weight: 0.97 },
  { name: "sus4", intervals: [0, 5, 7], weight: 0.92 },
  { name: "dim", intervals: [0, 3, 6], weight: 0.9 },
  { name: "m6", intervals: [0, 3, 7, 9], weight: 0.86 },
  { name: "6", intervals: [0, 4, 7, 9], weight: 0.86 },
  { name: "aug", intervals: [0, 4, 8], weight: 0.82 },
];

export type ChordMark = {
  measure: number;
  /** Step offset inside the measure. */
  offset: number;
  symbol: string;
};

function rootName(pitchClass: number, key: KeySignature) {
  const spelled = spellPitch(pitchClass + 60, key.fifths);
  const accidental = spelled.alter > 0 ? "#" : spelled.alter < 0 ? "b" : "";
  return `${spelled.letter}${accidental}`;
}

function bestChord(weights: number[], total: number, key: KeySignature) {
  let bestName: string | null = null;
  let bestScore = 0;

  for (let root = 0; root < 12; root += 1) {
    for (const template of TEMPLATES) {
      let inside = 0;
      let present = 0;
      for (const interval of template.intervals) {
        const weight = weights[(root + interval) % 12];
        inside += weight;
        if (weight > total * 0.06) present += 1;
      }
      // Rewarding coverage alone lets a seventh chord claim any two notes it
      // happens to contain, so a template is also scored on how much of it is
      // actually sounding.
      const completeness = present / template.intervals.length;
      const outside = total - inside;
      const score =
        (inside / total) * completeness * template.weight -
        (outside / total) * 0.8;
      if (score > bestScore) {
        bestScore = score;
        bestName = rootName(root, key);
        bestName += template.name;
      }
    }
  }

  return bestScore > 0.55 ? bestName : null;
}

/**
 * Reads one chord symbol per half measure. Only genuine simultaneities are
 * considered: guessing harmony from a single melodic line produces confident
 * nonsense, so a window needs real stacked pitches to earn a symbol.
 */
export function detectChords(score: Score): ChordMark[] {
  const window = Math.max(1, score.stepsPerMeasure / 2);
  const marks: ChordMark[] = [];
  let previous: string | null = null;

  for (let measure = 0; measure < score.measureCount; measure += 1) {
    for (let offset = 0; offset < score.stepsPerMeasure; offset += window) {
      const weights = new Array(12).fill(0);
      let total = 0;
      let polyphonic = false;
      const pitchClasses = new Set<number>();

      score.staves.forEach((staff) => {
        staff.measures[measure]?.forEach((event) => {
          if (!event.midis.length) return;
          const overlap =
            Math.min(event.offset + event.length, offset + window) -
            Math.max(event.offset, offset);
          if (overlap <= 0) return;
          if (event.midis.length > 1) polyphonic = true;
          event.midis.forEach((midi) => {
            const pitchClass = ((midi % 12) + 12) % 12;
            pitchClasses.add(pitchClass);
            weights[pitchClass] += overlap;
            total += overlap;
          });
        });
      });

      // Two staves sounding together count as polyphony even when each one is
      // a single line.
      if (score.staves.length > 1 && pitchClasses.size >= 3) polyphonic = true;

      if (!polyphonic || pitchClasses.size < 3 || total < window * 0.5) {
        continue;
      }

      const symbol = bestChord(weights, total, score.key);
      if (symbol && symbol !== previous) {
        marks.push({ measure, offset, symbol });
        previous = symbol;
      }
    }
  }

  return marks;
}
