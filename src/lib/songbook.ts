/**
 * The songbook's text: lyrics with chords in square brackets where they are
 * struck — the ChordPro way — rendered as chord lines above lyric lines.
 * A sheet written the other way round (a line of chords over a line of
 * words) is recognised and folded into the same form.
 */
import { ROOT_NAMES, FLAT_NAMES, type ChordQuality } from "./audioChords";

export type SongLine = { chords: { at: number; name: string }[]; lyric: string; kind: "line" | "heading" | "blank" };

const DRAFT_KEY = "musictools.songbook.draft.v1";

export function setSongbookDraft(draft: { title: string; body: string }) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Nothing to hand over without storage; the page starts empty.
  }
}

export function takeSongbookDraft(): { title: string; body: string } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    const parsed = JSON.parse(raw) as { title?: unknown; body?: unknown };
    return typeof parsed.body === "string" ? { title: typeof parsed.title === "string" ? parsed.title : "", body: parsed.body } : null;
  } catch {
    return null;
  }
}

const CHORD_TOKEN = /^([A-G])([#b]?)(m|maj7|m7|7|sus4|sus2|dim|aug|add9|m6|6|9|m9|maj9|13|11)?(?:\/([A-G][#b]?))?$/;

/** True for "Am", "F#m7", "G/B" — a bare chord symbol. */
export function isChordToken(token: string) {
  return CHORD_TOKEN.test(token.trim());
}

/** A line made only of chord symbols (and spaces) is a chord line. */
export function isChordLine(line: string) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(isChordToken);
}

/**
 * Chords-over-lyrics → bracketed: each chord goes in front of the word the
 * column under it begins, so the two forms carry the same information.
 */
export function foldChordLines(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    if (isChordLine(line) && next !== undefined && next.trim() && !isChordLine(next)) {
      const positions: { at: number; name: string }[] = [];
      const pattern = /\S+/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line))) positions.push({ at: match.index, name: match[0] });
      let merged = "";
      let cursor = 0;
      for (const { at, name } of positions) {
        const column = Math.min(at, next.length);
        merged += next.slice(cursor, column) + `[${name}]`;
        cursor = column;
      }
      merged += next.slice(cursor);
      out.push(merged);
      index += 1;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

/** Parses bracketed text into lines the renderer can lay out. */
export function parseSong(text: string): SongLine[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((raw): SongLine => {
      if (!raw.trim()) return { chords: [], lyric: "", kind: "blank" };
      const heading = raw.match(/^\s*\[(?:(?:verse|chorus|bridge|intro|outro|בית|פזמון|גשר|פתיחה|סיום)[^\]]*)\]\s*$/i) ?? raw.match(/^\s*\{(?:c|comment|soc|start_of_chorus|sov|start_of_verse|title|t):?\s*([^}]*)\}\s*$/i);
      if (heading) return { chords: [], lyric: raw.trim().replace(/^[[{]|[\]}]$/g, "").replace(/^(c|comment|title|t):\s*/i, ""), kind: "heading" };
      const chords: { at: number; name: string }[] = [];
      let lyric = "";
      const pattern = /\[([^\]]+)\]/g;
      let cursor = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(raw))) {
        lyric += raw.slice(cursor, match.index);
        chords.push({ at: lyric.length, name: match[1].trim() });
        cursor = match.index + match[0].length;
      }
      lyric += raw.slice(cursor);
      return { chords, lyric, kind: "line" };
    });
}

/** Moves one chord symbol by semitones, keeping its quality and bass note. */
export function transposeChord(name: string, semitones: number, flats = false) {
  const match = name.trim().match(CHORD_TOKEN);
  if (!match || semitones === 0) return name;
  const shift = (letter: string, accidental: string) => {
    const base = ROOT_NAMES.indexOf(letter);
    const root = base + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
    const moved = (((root + semitones) % 12) + 12) % 12;
    return (flats ? FLAT_NAMES : ROOT_NAMES)[moved];
  };
  const bass = match[4] ? `/${shift(match[4][0], match[4][1] ?? "")}` : "";
  return `${shift(match[1], match[2])}${match[3] ?? ""}${bass}`;
}

/** The whole text moved by semitones: every bracketed chord, nothing else. */
export function transposeSong(text: string, semitones: number, flats = false) {
  return text.replace(/\[([^\]]+)\]/g, (whole, inner: string) => (isChordToken(inner) ? `[${transposeChord(inner, semitones, flats)}]` : whole));
}

/** Every distinct chord in the song, in order of appearance. */
export function songChords(text: string) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const name = match[1].trim();
    if (!isChordToken(name) || seen.has(name)) continue;
    seen.add(name);
    list.push(name);
  }
  return list;
}

/** A chord symbol as the diagram wants it: pitch class and quality. */
export function parseChordSymbol(name: string): { root: number; quality: ChordQuality } | null {
  const match = name.trim().match(CHORD_TOKEN);
  if (!match) return null;
  const base = ROOT_NAMES.indexOf(match[1]);
  const root = (((base + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0)) % 12) + 12) % 12;
  const raw = match[3] ?? "";
  const quality: ChordQuality = raw === "m" || raw === "m6" || raw === "m9" ? "m" : raw === "7" || raw === "9" || raw === "13" || raw === "11" ? "7" : raw === "m7" ? "m7" : raw === "maj7" || raw === "maj9" ? "maj7" : raw === "sus4" ? "sus4" : raw === "sus2" ? "sus2" : raw === "dim" ? "dim" : raw === "aug" ? "aug" : "";
  return { root, quality };
}

/** The song as chords-over-lyrics plain text, for printing and copying. */
export function songToText(text: string) {
  return parseSong(text)
    .map((line) => {
      if (line.kind === "blank") return "";
      if (line.kind === "heading") return `[${line.lyric}]`;
      if (!line.chords.length) return line.lyric;
      let chordLine = "";
      for (const chord of line.chords) {
        while (chordLine.length < chord.at) chordLine += " ";
        if (chordLine.length > 0 && chordLine[chordLine.length - 1] !== " ") chordLine += " ";
        chordLine += chord.name;
      }
      return `${chordLine}\n${line.lyric}`;
    })
    .join("\n");
}
