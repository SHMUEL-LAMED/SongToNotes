/**
 * Synchronised lyrics: lines with a time each, and words with times inside
 * them, the way a karaoke display and an LRC file want them. Built from
 * the speech recogniser's segments and words; edited as plain lines, so a
 * misheard word is fixed without losing the timing.
 */
import type { SpeechWord } from "./speechApi";
import type { TranscriptSegment } from "./transcript";

export type LyricWord = { text: string; start: number; end: number };
export type LyricLine = { start: number; end: number; text: string; words: LyricWord[] };

/** Words fall into the segment whose span holds their start. */
export function buildLines(segments: TranscriptSegment[], words: SpeechWord[]): LyricLine[] {
  const lines: LyricLine[] = segments
    .filter((segment) => segment.text.trim())
    .map((segment) => ({ start: segment.start, end: segment.end ?? segment.start + 3, text: segment.text.trim(), words: [] }));
  if (!lines.length) return [];
  for (const word of words) {
    let line = lines.find((item) => word.start >= item.start - 0.05 && word.start < item.end + 0.05);
    if (!line) {
      // Between lines: attach to whichever is nearer.
      line = lines.reduce((best, item) => (Math.abs(item.start - word.start) < Math.abs(best.start - word.start) ? item : best), lines[0]);
    }
    line.words.push({ text: word.word, start: word.start, end: word.end });
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.start - b.start);
    // A line whose words were never timed still lights up as a whole.
    if (!line.words.length) line.words = [{ text: line.text, start: line.start, end: line.end }];
  }
  return lines;
}

/** Edits from a textbox, line for line, keep the line times; word times are
 *  spread evenly across the new words when the count changed. */
export function applyLineEdits(lines: LyricLine[], text: string): LyricLine[] {
  const rows = text.replace(/\r/g, "").split("\n");
  const next: LyricLine[] = [];
  rows.forEach((row, index) => {
    const clean = row.trim();
    if (!clean) return;
    const source = lines[Math.min(index, lines.length - 1)] ?? { start: 0, end: 3, text: "", words: [] };
    const tokens = clean.split(/\s+/);
    const oldTokens = source.words.map((word) => word.text);
    const same = tokens.length === oldTokens.length;
    const words: LyricWord[] = same
      ? tokens.map((token, at) => ({ ...source.words[at], text: token }))
      : tokens.map((token, at) => {
          const span = (source.end - source.start) / tokens.length;
          return { text: token, start: source.start + at * span, end: source.start + (at + 1) * span };
        });
    next.push({ start: source.start, end: source.end, text: clean, words });
  });
  return next;
}

export function linesToText(lines: LyricLine[]) {
  return lines.map((line) => line.text).join("\n");
}

function lrcTime(seconds: number) {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** LRC: a time tag per line, and with `enhanced`, one per word too. */
export function linesToLrc(lines: LyricLine[], enhanced = false, meta: { title?: string; artist?: string } = {}) {
  const head: string[] = [];
  if (meta.title) head.push(`[ti:${meta.title}]`);
  if (meta.artist) head.push(`[ar:${meta.artist}]`);
  head.push("[by:כלי מוזיקה]");
  const body = lines.map((line) => {
    if (!enhanced) return `[${lrcTime(line.start)}]${line.text}`;
    const words = line.words.map((word) => `<${lrcTime(word.start)}>${word.text}`).join(" ");
    return `[${lrcTime(line.start)}]${words}`;
  });
  return [...head, ...body].join("\n");
}

/** Which line and word are sounding at `time`. */
export function positionAt(lines: LyricLine[], time: number) {
  let lineIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (time >= lines[index].start) lineIndex = index;
    else break;
  }
  if (lineIndex < 0) return { line: -1, word: -1 };
  const line = lines[lineIndex];
  let wordIndex = -1;
  line.words.forEach((word, index) => {
    if (time >= word.start) wordIndex = index;
  });
  return { line: lineIndex, word: wordIndex };
}
