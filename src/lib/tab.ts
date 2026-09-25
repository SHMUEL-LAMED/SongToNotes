/**
 * Guitar tablature from the score song-to-notes shows: the same bars, the
 * same notes, transposition and melody-or-everything choice included, as the
 * six lines a guitarist reads.
 *
 * Which string plays a note is the one real decision. Every note that can
 * sound on a guitar in standard tuning can be played in several places, a
 * chord in more. The choice is made for the whole song at once, as a
 * shortest path that follows the hand: it sits at a position (the index
 * finger's fret) and reaches the few frets above it; open strings need no
 * reach; moving the hand costs the frets it travels, and a higher position a
 * little more than a lower one. So a passage stays under one hand where it
 * can, low on the neck, with chords the hand can stretch to. Notes beyond the
 * guitar's range move by octaves into it.
 */
import type { Score } from "./score";

/** Standard tuning, low string to high: E2 A2 D3 G3 B3 E4. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64] as const;
const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
export const MAX_FRET = 20;
const LOWEST = STANDARD_TUNING[0];
const HIGHEST = STANDARD_TUNING[STANDARD_TUNING.length - 1] + MAX_FRET;
/** The widest a chord may stretch, in frets, open strings aside — and how far the hand reaches above its position. */
const MAX_SPAN = 4;
/** The hand's positions: the fret under the index finger. */
const POSITIONS = MAX_FRET - MAX_SPAN;
/** Shapes kept for each moment, the cheapest first: enough, and quick. */
const MAX_SHAPES = 24;

/** Where one note is played: 0 is the low E string. */
export type Position = { string: number; fret: number };

/** A note moved by octaves into the guitar's range. */
export function intoRange(midi: number) {
  let value = Math.round(midi);
  while (value < LOWEST) value += 12;
  while (value > HIGHEST) value -= 12;
  return value;
}

/** Every way to play these notes together, one note to a string. */
export function chordShapes(midis: number[]): Position[][] {
  const notes = [...new Set(midis.map(intoRange))].sort((a, b) => b - a);
  const shapes: Position[][] = [];
  const used = new Set<number>();
  const shape: Position[] = [];
  const place = (index: number) => {
    if (index === notes.length) {
      shapes.push([...shape]);
      return;
    }
    for (let string = 0; string < STANDARD_TUNING.length; string += 1) {
      const fret = notes[index] - STANDARD_TUNING[string];
      if (used.has(string) || fret < 0 || fret > MAX_FRET) continue;
      shape.push({ string, fret });
      if (span(shape) <= MAX_SPAN) {
        used.add(string);
        place(index + 1);
        used.delete(string);
      }
      shape.pop();
    }
  };
  place(0);
  return shapes;
}

function fretted(shape: Position[]) {
  return shape.filter((item) => item.fret > 0).map((item) => item.fret);
}

function span(shape: Position[]) {
  const frets = fretted(shape);
  return frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
}

/** What a shape costs on its own: the stretch, and a trifle per fret, so an open string wins a tie. */
function shapeCost(shape: Position[]) {
  return span(shape) * 0.6 + fretted(shape).reduce((sum, fret) => sum + fret, 0) * 0.01;
}

/** The positions a shape can be played from; open strings fit any. */
function positionsFor(shape: Position[]): number[] {
  const frets = fretted(shape);
  const from = frets.length ? Math.max(1, Math.max(...frets) - MAX_SPAN) : 1;
  const to = frets.length ? Math.min(POSITIONS, Math.min(...frets)) : POSITIONS;
  const out: number[] = [];
  for (let position = from; position <= to; position += 1) out.push(position);
  return out;
}

/** Staying low on the neck is a little easier. */
const HEIGHT = 0.08;

/**
 * The shapes a moment can use: all its notes if they fit on the strings,
 * else as many as fit, the top note (the melody) and the bass kept first.
 */
function candidates(midis: number[]): Position[][] {
  let notes = [...new Set(midis.map(intoRange))].sort((a, b) => b - a);
  for (;;) {
    const shapes = chordShapes(notes);
    if (shapes.length || notes.length <= 1) {
      return shapes.sort((a, b) => shapeCost(a) - shapeCost(b)).slice(0, MAX_SHAPES);
    }
    // Drop an inner voice, the one just above the bass; then the bass itself.
    notes = notes.length > 2 ? [...notes.slice(0, -2), notes[notes.length - 1]] : notes.slice(0, 1);
  }
}

/** A position for every note of every moment, chosen together (a shortest path over hand positions). */
export function fingerEvents(events: number[][]): Position[][] {
  const layers = events.map(candidates);
  if (!layers.length) return [];
  // cost[shape][position] for the current moment, and where each came from.
  type Cell = { cost: number; shape: number; position: number };
  let costs = layers[0].map((shape) => {
    const row = new Array<number>(POSITIONS + 1).fill(Number.POSITIVE_INFINITY);
    for (const position of positionsFor(shape)) row[position] = shapeCost(shape) + position * HEIGHT;
    return row;
  });
  const back: Cell[][][] = [layers[0].map(() => [])];
  for (let index = 1; index < layers.length; index += 1) {
    // The cheapest way to have the hand at each position after the last moment…
    const at: Cell[] = [];
    for (let position = 1; position <= POSITIONS; position += 1) {
      let best: Cell = { cost: Number.POSITIVE_INFINITY, shape: 0, position };
      costs.forEach((row, shape) => {
        if (row[position] < best.cost) best = { cost: row[position], shape, position };
      });
      at[position] = best;
    }
    // …and moving it from there to each position, a fret at a time.
    const moved: Cell[] = [];
    for (let position = 1; position <= POSITIONS; position += 1) {
      let best: Cell = { cost: Number.POSITIVE_INFINITY, shape: 0, position: 1 };
      for (let from = 1; from <= POSITIONS; from += 1) {
        const cost = at[from].cost + Math.abs(position - from);
        if (cost < best.cost) best = { cost, shape: at[from].shape, position: from };
      }
      moved[position] = best;
    }
    const next: number[][] = [];
    const from: Cell[][] = [];
    for (const shape of layers[index]) {
      const row = new Array<number>(POSITIONS + 1).fill(Number.POSITIVE_INFINITY);
      const came: Cell[] = [];
      for (const position of positionsFor(shape)) {
        row[position] = moved[position].cost + shapeCost(shape) + position * HEIGHT;
        came[position] = moved[position];
      }
      next.push(row);
      from.push(came);
    }
    costs = next;
    back.push(from);
  }
  // The cheapest ending, then back to the start.
  let end: Cell = { cost: Number.POSITIVE_INFINITY, shape: 0, position: 1 };
  costs.forEach((row, shape) =>
    row.forEach((cost, position) => {
      if (cost < end.cost) end = { cost, shape, position };
    }),
  );
  const chosen: Position[][] = [];
  let shape = end.shape;
  let position = end.position;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    chosen.unshift(layers[index][shape] ?? []);
    const came = back[index][shape]?.[position];
    if (!came) break;
    shape = came.shape;
    position = came.position;
  }
  return chosen;
}

export type TabOptions = {
  /** Characters a line of bars may take before the next system begins. */
  width?: number;
  lang?: "he" | "en";
};

/** The tablature, as plain text: a short header, then systems of bars. */
export function scoreToTab(score: Score, { width = 80, lang = "he" }: TabOptions = {}): string {
  // Each bar's note starts, all staves together, by step.
  const bars: Map<number, number[]>[] = [];
  for (let measure = 0; measure < score.measureCount; measure += 1) {
    const starts = new Map<number, number[]>();
    for (const staff of score.staves) {
      for (const event of staff.measures[measure] ?? []) {
        if (!event.midis.length || event.tiedFrom) continue;
        starts.set(event.offset, [...(starts.get(event.offset) ?? []), ...event.midis]);
      }
    }
    bars.push(starts);
  }
  const moments = bars.flatMap((starts, measure) => [...starts.entries()].sort((a, b) => a[0] - b[0]).map(([step, midis]) => ({ measure, step, midis })));
  const shapes = fingerEvents(moments.map((moment) => moment.midis));
  const at = new Map(moments.map((moment, index) => [`${moment.measure}:${moment.step}`, shapes[index]]));

  // A bar is a column per step: a fret where a note starts, a dash where none does.
  const drawn = bars.map((_, measure) => {
    const lines = STANDARD_TUNING.map(() => "");
    for (let step = 0; step < score.stepsPerMeasure; step += 1) {
      const shape = at.get(`${measure}:${step}`);
      if (!shape) {
        lines.forEach((_, string) => (lines[string] += "-"));
        continue;
      }
      const cell = Math.max(...shape.map((item) => String(item.fret).length)) + 1;
      lines.forEach((_, string) => {
        const played = shape.find((item) => item.string === string);
        lines[string] += (played ? String(played.fret) : "").padEnd(cell, "-");
      });
    }
    return lines;
  });

  const header =
    lang === "en"
      ? [`Guitar tab — ${score.title}`, `Standard tuning (E A D G B E) · ${Math.round(score.bpm)} BPM · ${score.meter.beats}/${score.meter.beatType}`]
      : [`טאבים לגיטרה — ${score.title}`, `כיוון רגיל (E A D G B E) · ${Math.round(score.bpm)} BPM · ${score.meter.beats}/${score.meter.beatType}`];
  if (!moments.length) return [...header, "", lang === "en" ? "(no notes)" : "(אין תווים)", ""].join("\n");

  // Systems: as many bars as fit in the width, high string on top.
  const out = [...header, ""];
  for (let first = 0; first < drawn.length; ) {
    let last = first;
    let length = 2 + drawn[first][0].length + 1;
    while (last + 1 < drawn.length && length + drawn[last + 1][0].length + 1 <= width) {
      last += 1;
      length += drawn[last][0].length + 1;
    }
    for (let string = STANDARD_TUNING.length - 1; string >= 0; string -= 1) {
      out.push(`${STRING_NAMES[string]}|${drawn.slice(first, last + 1).map((bar) => bar[string]).join("|")}|`);
    }
    out.push("");
    first = last + 1;
  }
  return out.join("\n");
}
