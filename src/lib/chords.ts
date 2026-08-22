import { spellPitch } from "./key";
import type { Score } from "./score";
import type { KeySignature } from "./types";

type Template = { name: string; intervals: number[]; weight: number };

/** Ordered so simpler triads win ties against their richer relatives. */
const TEMPLATES: Template[] = [
  { name: "", intervals: [0, 4, 7], weight: 1 },
  { name: "m", intervals: [0, 3, 7], weight: 1 },
  { name: "7", intervals: [0, 4, 7, 10], weight: 0.97 },
  { name: "maj7", intervals: [0, 4, 7, 11], weight: 0.96 },
  { name: "m7", intervals: [0, 3, 7, 10], weight: 0.96 },
  { name: "sus4", intervals: [0, 5, 7], weight: 0.9 },
  { name: "dim", intervals: [0, 3, 6], weight: 0.88 },
  { name: "aug", intervals: [0, 4, 8], weight: 0.85 },
  { name: "m6", intervals: [0, 3, 7, 9], weight: 0.85 },
  { name: "6", intervals: [0, 4, 7, 9], weight: 0.85 },
];

function rootName(pitchClass: number, key: KeySignature) {
  const spelled = spellPitch(pitchClass + 60, key.fifths);
  const accidental = spelled.alter > 0 ? "#" : spelled.alter < 0 ? "b" : "";
  return `${spelled.letter}${accidental}`;
}

/**
 * Picks one chord symbol per half measure from the sounding pitch classes,
 * weighted by how long each one is held.
 */
export function detectChords(score: Score): (string | null)[] {
  const perMeasure: (string | null)[] = [];
  const half = score.stepsPerMeasure / 2;

  for (let measure = 0; measure < score.measureCount; measure += 1) {
    const weights = new Array(12).fill(0);
    let total = 0;

    score.staves.forEach((staff) => {
      staff.measures[measure]?.forEach((event) => {
        if (!event.midis.length) return;
        // The first half of the bar carries the harmony most of the time.
        const emphasis = event.offset < half ? 1.15 : 1;
        event.midis.forEach((midi, index) => {
          const value = event.length * emphasis * (index === 0 ? 1.3 : 1);
          weights[((midi % 12) + 12) % 12] += value;
          total += value;
        });
      });
    });

    if (total < score.stepsPerMeasure * 0.35) {
      perMeasure.push(null);
      continue;
    }

    let bestName: string | null = null;
    let bestScore = 0;
    for (let root = 0; root < 12; root += 1) {
      for (const template of TEMPLATES) {
        let inside = 0;
        for (const interval of template.intervals) {
          inside += weights[(root + interval) % 12];
        }
        const outside = total - inside;
        const score_ = ((inside - outside * 0.85) / total) * template.weight;
        if (score_ > bestScore) {
          bestScore = score_;
          bestName = `${rootName(root, score.key)}${template.name}`;
        }
      }
    }

    perMeasure.push(bestScore > 0.42 ? bestName : null);
  }

  // Repeating the same symbol on every bar is noise, so only changes are kept.
  let previous: string | null = null;
  return perMeasure.map((name) => {
    if (name && name === previous) return null;
    if (name) previous = name;
    return name;
  });
}
