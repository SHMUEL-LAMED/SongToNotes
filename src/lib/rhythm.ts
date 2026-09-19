/**
 * Rhythm training: a pattern of beats to tap along to, and how close each
 * tap landed. Patterns are written in sixteenths per bar — a 1 is a hit —
 * so a level is a small list of strings, and scoring is the distance from
 * each tap to the nearest expected hit, in milliseconds.
 */

export type RhythmLevel = "easy" | "medium" | "hard";

export type Pattern = {
  id: string;
  name: string;
  /** Sixteenths, "1" for a hit, "." for rest; length 16 for 4/4. */
  steps: string;
  level: RhythmLevel;
};

export const LEVEL_LABELS: Record<RhythmLevel, string> = {
  easy: "קל",
  medium: "בינוני",
  hard: "קשה",
};

export const PATTERNS: Pattern[] = [
  { id: "quarters", name: "רבעים", steps: "1...1...1...1...", level: "easy" },
  { id: "halves", name: "חצאים", steps: "1.......1.......", level: "easy" },
  { id: "eighths", name: "שמיניות", steps: "1.1.1.1.1.1.1.1.", level: "easy" },
  { id: "one-three", name: "ראשון ושלישי", steps: "1.......1.......", level: "easy" },
  { id: "backbeat", name: "בקביט (2 ו־4)", steps: "....1.......1...", level: "medium" },
  { id: "dotted", name: "מנוקד", steps: "1..1..1.1..1..1.", level: "medium" },
  { id: "syncopated", name: "סינקופה", steps: "1..1..1...1.1...", level: "medium" },
  { id: "offbeat", name: "אופביט", steps: "..1...1...1...1.", level: "medium" },
  { id: "clave", name: "קלאבה (סון)", steps: "1..1..1...1.1...", level: "hard" },
  { id: "tresillo", name: "טרסיו", steps: "1..1..1.1..1..1.", level: "hard" },
  { id: "sixteenths", name: "שש־עשריות", steps: "1.111.111.111.11", level: "hard" },
  { id: "bossa", name: "בוסה נובה", steps: "1..1..1...1..1..", level: "hard" },
];

export function patternsFor(level: RhythmLevel) {
  return PATTERNS.filter((pattern) => pattern.level === level);
}

/** Seconds from the bar's start at which each hit falls. */
export function hitTimes(pattern: Pattern, bpm: number, bars = 1): number[] {
  const sixteenth = 60 / bpm / 4;
  const times: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let step = 0; step < pattern.steps.length; step += 1) {
      if (pattern.steps[step] === "1") times.push((bar * pattern.steps.length + step) * sixteenth);
    }
  }
  return times;
}

export type TapVerdict = "perfect" | "good" | "early" | "late" | "miss";

export type TapResult = {
  /** Seconds from the bar's start. */
  at: number;
  /** The nearest expected hit, or null when none is close. */
  target: number | null;
  /** Milliseconds; negative is early. */
  offset: number;
  verdict: TapVerdict;
};

/** Windows in milliseconds: within `perfect` is perfect, within `good` good, within `miss` counted. */
export const WINDOWS = { perfect: 40, good: 90, miss: 180 };

/** Judges one tap against the hits: the nearest hit within the miss window. */
export function judgeTap(at: number, hits: number[]): TapResult {
  let target: number | null = null;
  let best = Infinity;
  for (const hit of hits) {
    const distance = Math.abs(at - hit);
    if (distance < best) {
      best = distance;
      target = hit;
    }
  }
  const offset = target === null ? 0 : Math.round((at - target) * 1000);
  if (target === null || Math.abs(offset) > WINDOWS.miss) return { at, target: null, offset, verdict: "miss" };
  const size = Math.abs(offset);
  const verdict: TapVerdict = size <= WINDOWS.perfect ? "perfect" : size <= WINDOWS.good ? "good" : offset < 0 ? "early" : "late";
  return { at, target, offset, verdict };
}

export type RoundScore = {
  hits: number;
  taps: number;
  perfect: number;
  good: number;
  early: number;
  late: number;
  missed: number;
  extra: number;
  /** 0..100 */
  accuracy: number;
  /** Mean signed offset in ms: negative means rushing. */
  tendency: number;
};

/** The round's score: each hit wants exactly one tap, and every tap is judged. */
export function scoreRound(taps: TapResult[], hits: number[]): RoundScore {
  const claimed = new Set<number>();
  let perfect = 0;
  let good = 0;
  let early = 0;
  let late = 0;
  let extra = 0;
  let offsetSum = 0;
  let offsetCount = 0;
  for (const tap of taps) {
    if (tap.target === null || claimed.has(tap.target)) {
      extra += 1;
      continue;
    }
    claimed.add(tap.target);
    offsetSum += tap.offset;
    offsetCount += 1;
    if (tap.verdict === "perfect") perfect += 1;
    else if (tap.verdict === "good") good += 1;
    else if (tap.verdict === "early") early += 1;
    else late += 1;
  }
  const missed = hits.length - claimed.size;
  // Perfect counts fully, good most of the way, early and late a little; a
  // missed hit or an extra tap costs a whole point.
  const points = perfect + good * 0.8 + (early + late) * 0.4;
  const accuracy = hits.length ? Math.max(0, Math.round((100 * (points - extra * 0.5)) / hits.length)) : 0;
  return {
    hits: hits.length,
    taps: taps.length,
    perfect,
    good,
    early,
    late,
    missed,
    extra,
    accuracy: Math.min(100, accuracy),
    tendency: offsetCount ? Math.round(offsetSum / offsetCount) : 0,
  };
}

export function describeTendency(tendency: number) {
  if (Math.abs(tendency) < 15) return "מדויק — לא מקדים ולא מאחר";
  return tendency < 0 ? `נוטה להקדים בכ־${Math.abs(tendency)} אלפיות` : `נוטה לאחר בכ־${tendency} אלפיות`;
}
