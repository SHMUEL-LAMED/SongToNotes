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

/**
 * The waiting draft, left in place. The songbook reads it while it renders
 * and clears it once it is on screen: a render React throws away (one that
 * waited on a lazily loaded part) would otherwise have taken the draft with
 * it, and the page opened empty.
 */
export function peekSongbookDraft(): { title: string; body: string } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: unknown; body?: unknown };
    return typeof parsed.body === "string" ? { title: typeof parsed.title === "string" ? parsed.title : "", body: parsed.body } : null;
  } catch {
    return null;
  }
}

export function clearSongbookDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing was stored, then.
  }
}

/** The waiting draft, and it stops waiting. */
export function takeSongbookDraft(): { title: string; body: string } | null {
  const draft = peekSongbookDraft();
  clearSongbookDraft();
  return draft;
}

/**
 * A chord symbol: root, accidental, the rest of the name, and a bass note.
 * The rest is built from the usual pieces — m, maj, dim, sus, add, 7, b5,
 * (maj7) — so sheets that write Bm7b5, E7sus4, Cdim7, C5 or Cm(maj7) are
 * read, transposed and folded like the simple ones. It used to know a fixed
 * list, and a song with Bm7b5 kept that chord in the old key when moved.
 */
const CHORD_TOKEN =
  /^([A-G])([#b]?)((?:maj|min|m|M|dim|aug|sus|add|\+|°|ø)?(?:maj\d{0,2}|sus\d?|add\d{1,2}|dim\d?|aug|[#b]?\d{1,2}|\([^)\s]*\))*)(?:\/([A-G][#b]?))?$/;
/** Longer than any real chord name; keeps the pattern from chewing on a long bracketed remark. */
const MAX_CHORD_LENGTH = 16;

function matchChord(token: string) {
  const clean = token.trim();
  return clean.length <= MAX_CHORD_LENGTH ? clean.match(CHORD_TOKEN) : null;
}

/** True for "Am", "F#m7", "G/B", "Bm7b5" — a bare chord symbol. */
export function isChordToken(token: string) {
  return matchChord(token) !== null;
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

/** ChordPro's section openers, by the name the sheet shows. */
const SECTIONS: Record<string, string> = {
  soc: "פזמון",
  start_of_chorus: "פזמון",
  sov: "בית",
  start_of_verse: "בית",
  sob: "גשר",
  start_of_bridge: "גשר",
};

/** Parses bracketed text into lines the renderer can lay out. */
export function parseSong(text: string): SongLine[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((raw): SongLine => {
      if (!raw.trim()) return { chords: [], lyric: "", kind: "blank" };
      const heading = raw.match(/^\s*\[(?:(?:verse|chorus|bridge|intro|outro|בית|פזמון|גשר|פתיחה|סיום)[^\]]*)\]\s*$/i);
      if (heading) return { chords: [], lyric: raw.trim().replace(/^\[|\]$/g, ""), kind: "heading" };
      // ChordPro directives: a section's start is its heading (named in
      // Hebrew, not "soc"), its end takes no room, a comment is shown.
      const directive = raw.match(/^\s*\{\s*([a-z_]+)\s*(?::\s*([^}]*))?\}\s*$/i);
      if (directive) {
        const name = directive[1].toLowerCase();
        const label = directive[2]?.trim() ?? "";
        if (/^(eoc|eov|eob|end_of_\w+)$/.test(name)) return { chords: [], lyric: "", kind: "blank" };
        const section = SECTIONS[name];
        if (section) return { chords: [], lyric: label || section, kind: "heading" };
        if (/^(c|comment|ci|comment_italic|title|t|st|subtitle)$/.test(name)) {
          return label ? { chords: [], lyric: label, kind: "heading" } : { chords: [], lyric: "", kind: "blank" };
        }
      }
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
  const match = matchChord(name);
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
  const match = matchChord(name);
  if (!match) return null;
  const base = ROOT_NAMES.indexOf(match[1]);
  const root = (((base + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0)) % 12) + 12) % 12;
  return { root, quality: qualityOf(match[3] ?? "") };
}

/**
 * The nearest shape the diagrams know for the rest of a chord's name:
 * half-diminished shows as diminished, 9/11/13 as their seventh, 6 and
 * add9 as the plain triad.
 */
function qualityOf(raw: string): ChordQuality {
  const name = raw.replace(/[()]/g, "");
  if (/^(m7b5|min7b5|ø|dim|°)/.test(name)) return "dim";
  if (/^(aug|\+)/.test(name)) return "aug";
  const minor = /^(m|min)(?!aj)/.test(name);
  const rest = minor ? name.replace(/^(min|m)/, "") : name;
  if (rest.includes("sus2")) return "sus2";
  if (rest.includes("sus")) return "sus4";
  if (minor) return /^(7|11|13)/.test(rest) ? "m7" : "m";
  if (/^(maj|M)\d/.test(rest)) return "maj7";
  if (/^(7|9|11|13)/.test(rest)) return "7";
  return "";
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
