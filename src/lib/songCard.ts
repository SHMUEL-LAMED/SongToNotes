/**
 * The song card: a picture of a song — title, artist, key, tempo, chords —
 * sized for a post or a story, that always carries the site's name and
 * address at the bottom. Everything here is pure: the fields, the chord
 * parsing, the palettes, the text fitting and the layout are computed without
 * a canvas (text is measured through an injected function), so the page only
 * paints what this module decides and the tests can check every decision.
 */
import type { ChordQuality } from "./audioChords";
import { isChordToken, parseChordSymbol, songChords, transposeChord } from "./songbook";

/**
 * The address printed on every card and sent with every share. It is fixed
 * rather than taken from siteUrl(): the card leaves the site as an image, and
 * a preview or dev origin (localhost, a branch deploy) must never end up
 * printed on something people pass around. Same address as index.html's
 * canonical link.
 */
export const SITE_URL = "https://shmuel-lamed.github.io/SongToNotes/";
/** The address as printed: without the scheme and trailing slash, so it reads at a glance. */
export const SITE_LABEL = "shmuel-lamed.github.io/SongToNotes";
export const SITE_NAME = "כלי מוזיקה";
export const STORAGE_KEY = "musictools.songcard.v1";

export type CardTheme = "gradient" | "dark" | "light" | "vinyl";
export type CardSize = "post" | "story";

export const CARD_THEMES: { id: CardTheme; label: string }[] = [
  { id: "gradient", label: "צבעוני" },
  { id: "dark", label: "כהה" },
  { id: "light", label: "בהיר" },
  { id: "vinyl", label: "תקליט" },
];

export const CARD_SIZES: { id: CardSize; label: string; hint: string }[] = [
  { id: "post", label: "פוסט", hint: "1080×1080" },
  { id: "story", label: "סטורי", hint: "1080×1920" },
];

export const CARD_DIMENSIONS: Record<CardSize, { width: number; height: number }> = {
  post: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

export const METERS = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "12/8"];

export type CardFields = {
  title: string;
  artist: string;
  key: string;
  /** Kept as typed, so a half-typed number does not jump in the box. */
  bpm: string;
  meter: string;
  /** Space-separated chord symbols, e.g. "Am F C G". */
  chords: string;
  note: string;
  theme: CardTheme;
  size: CardSize;
  /** 0..359, the colour the theme is tinted with. */
  hue: number;
  /** Small guitar chord boxes under the chord chips. */
  diagrams: boolean;
};

export const LIMITS = { title: 80, artist: 60, key: 12, meter: 8, chords: 120, note: 140 } as const;
export const MAX_CHORDS = 16;

export const DEFAULT_FIELDS: CardFields = {
  title: "",
  artist: "",
  key: "",
  bpm: "",
  meter: "",
  chords: "",
  note: "",
  theme: "gradient",
  size: "post",
  hue: 350,
  diagrams: true,
};

export function normalizeHue(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_FIELDS.hue;
  return ((Math.round(value) % 360) + 360) % 360;
}

export function isTheme(value: unknown): value is CardTheme {
  return value === "gradient" || value === "dark" || value === "light" || value === "vinyl";
}

export function isSize(value: unknown): value is CardSize {
  return value === "post" || value === "story";
}

/** The tempo to print, or null when the box holds no sensible number. */
export function bpmValue(bpm: string | number): number | null {
  const value = typeof bpm === "number" ? bpm : Number(String(bpm).trim());
  if (!Number.isFinite(value) || value < 20 || value > 400) return null;
  return Math.round(value);
}

/**
 * Anything that claims to be card fields — stored JSON from an older
 * version, an assistant call — made safe: known values only, strings cut to
 * their limits, the hue wrapped into 0..359.
 */
export function normalizeFields(value: unknown, base: CardFields = DEFAULT_FIELDS): CardFields {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: keyof typeof LIMITS) => (typeof input[key] === "string" ? (input[key] as string).slice(0, LIMITS[key]) : base[key]);
  const bpmRaw = input.bpm;
  return {
    title: text("title"),
    artist: text("artist"),
    key: text("key"),
    bpm: typeof bpmRaw === "number" && Number.isFinite(bpmRaw) ? String(Math.round(bpmRaw)) : typeof bpmRaw === "string" ? bpmRaw.replace(/[^\d.]/g, "").slice(0, 5) : base.bpm,
    meter: text("meter"),
    chords: text("chords"),
    note: text("note"),
    theme: isTheme(input.theme) ? input.theme : base.theme,
    size: isSize(input.size) ? input.size : base.size,
    hue: typeof input.hue === "number" ? normalizeHue(input.hue) : base.hue,
    diagrams: typeof input.diagrams === "boolean" ? input.diagrams : base.diagrams,
  };
}

/* ---- chords ---- */

/**
 * One typed token as a chord symbol: typographic sharps and flats become
 * ASCII, a lower-case root is capitalised ("am" → "Am"), and the common
 * spelled-out minor ("Amin") is shortened.
 */
export function normalizeChordToken(raw: string) {
  let token = raw.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  token = token.replace(/^([a-g])/, (letter) => letter.toUpperCase());
  token = token.replace(/^([A-G][#b]?)min(?=$|\/|\d)/, "$1m");
  return token;
}

/** The chord list as typed: valid symbols in order (repeats kept), and the rest. */
export function parseChords(text: string): { chords: string[]; invalid: string[] } {
  const chords: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,|;–—]+|(?<=\S)-(?=\S)/)) {
    if (!raw.trim()) continue;
    const token = normalizeChordToken(raw);
    if (isChordToken(token)) {
      if (chords.length < MAX_CHORDS) chords.push(token);
    } else {
      invalid.push(raw.trim());
    }
  }
  return { chords, invalid };
}

export type ParsedChord = { name: string; root: number; quality: ChordQuality };

/** Each chord once, in order, with what a diagram needs. */
export function distinctChords(chords: string[]): ParsedChord[] {
  const seen = new Set<string>();
  const out: ParsedChord[] = [];
  for (const name of chords) {
    if (seen.has(name)) continue;
    seen.add(name);
    const parsed = parseChordSymbol(name);
    if (parsed) out.push({ name, ...parsed });
  }
  return out;
}

/** The chords of a saved songbook entry, moved by its transposition. */
export function chordsFromSong(body: string, transpose = 0, limit = 8) {
  return songChords(body)
    .map((name) => transposeChord(name, transpose))
    .slice(0, limit)
    .join(" ");
}

/**
 * A key as the analysis tool labels it ("A מינור", "C מז׳ור") or as people
 * type it ("A minor", "Am") → the short symbol the card prints ("Am", "C").
 */
export function shortKeyName(label: string) {
  const match = label.trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(.*)$/);
  if (!match) return label.trim().slice(0, LIMITS.key);
  const root = match[1].toUpperCase() + match[2].replace("♯", "#").replace("♭", "b");
  const rest = match[3].trim().toLowerCase();
  const minor = /^(m(?!aj)|min|minor|מינור)/.test(rest);
  return minor ? `${root}m` : root;
}

/* ---- direction ---- */

const RTL_LETTERS = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LATIN_LETTERS = /[A-Za-z\u00C0-\u024F]/;

/** True for "Imagine" or "The Beatles": Latin letters and no Hebrew or Arabic. */
export function isLatinOnly(text: string) {
  return LATIN_LETTERS.test(text) && !RTL_LETTERS.test(text);
}

export type TextDir = "rtl" | "ltr";

/**
 * The base direction to draw a string with. The page is Hebrew, so anything
 * that is not plainly Latin — Hebrew, mixed, digits alone — is right to left;
 * mixed strings still come out right because the canvas runs the bidi
 * algorithm within the base direction.
 */
export function textDirection(text: string): TextDir {
  return isLatinOnly(text) ? "ltr" : "rtl";
}

/* ---- measuring and fitting text ---- */

/** Width in pixels of `text` drawn in the CSS `font`. The page passes the canvas's measureText. */
export type Measure = (text: string, font: string) => number;

export const FONT_STACK = `"Rubik Variable", "Rubik", "Heebo", "Arial Hebrew", system-ui, sans-serif`;

export function cardFont(weight: number, size: number) {
  return `${weight} ${Math.round(size)}px ${FONT_STACK}`;
}

const ELLIPSIS = "…";

/** Breaks a word that alone is wider than the line into pieces that fit. */
function breakWord(word: string, maxWidth: number, font: string, measure: Measure) {
  const pieces: string[] = [];
  let current = "";
  for (const char of Array.from(word)) {
    if (current && measure(current + char, font) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Greedy word wrap; a word wider than the line is broken by characters. */
export function wrapText(text: string, maxWidth: number, font: string, measure: Measure): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, font) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (measure(word, font) <= maxWidth) {
      current = word;
    } else {
      const pieces = breakWord(word, maxWidth, font, measure);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? "";
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Cuts a line and adds "…" until it fits. */
export function ellipsize(text: string, maxWidth: number, font: string, measure: Measure) {
  if (measure(text, font) <= maxWidth) return text;
  let chars = Array.from(text);
  while (chars.length && measure(chars.join("").trimEnd() + ELLIPSIS, font) > maxWidth) chars = chars.slice(0, -1);
  return chars.join("").trimEnd() + ELLIPSIS;
}

export type FitOptions = { maxWidth: number; maxLines: number; maxSize: number; minSize: number; weight: number; step?: number };
export type Fitted = { size: number; lines: string[]; truncated: boolean };

/**
 * The largest font size, from maxSize down to minSize, at which the text
 * wraps into maxLines or fewer. Past the smallest size the last line is cut
 * with an ellipsis — a title never spills off the card.
 */
export function fitText(text: string, options: FitOptions, measure: Measure): Fitted {
  const { maxWidth, maxLines, maxSize, minSize, weight, step = 2 } = options;
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return { size: maxSize, lines: [], truncated: false };
  for (let size = maxSize; size >= minSize; size -= step) {
    const lines = wrapText(clean, maxWidth, cardFont(weight, size), measure);
    if (lines.length <= maxLines) return { size, lines, truncated: false };
  }
  const font = cardFont(weight, minSize);
  const lines = wrapText(clean, maxWidth, font, measure);
  const kept = lines.slice(0, maxLines);
  // The rest of the text joins the last kept line before it is cut, so the ellipsis marks real loss.
  kept[kept.length - 1] = ellipsize(`${kept[kept.length - 1]} ${lines.slice(maxLines).join(" ")}`, maxWidth, font, measure);
  return { size: minSize, lines: kept, truncated: true };
}

/* ---- colours ---- */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = normalizeHue(h);
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}

const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** An opaque colour as #rrggbb, so tests (and the canvas) can read it back. */
export function hslHex(h: number, s: number, l: number) {
  return hex(hslToRgb(h, s, l));
}

export function hsla(h: number, s: number, l: number, a: number) {
  const [r, g, b] = hslToRgb(h, s, l);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(color: string) {
  const value = color.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * The lightness at which a hue still carries white text. Yellow at 50% is far
 * brighter than blue at 50%, so a fixed lightness would leave white titles
 * unreadable on a yellow card; stepping down until the contrast holds keeps
 * every hue on the slider legible.
 */
function darkEnough(h: number, s: number, l: number, min: number) {
  let light = l;
  while (light > 5 && contrast(hslHex(h, s, light), "#ffffff") < min) light -= 1;
  return light;
}

/** The mirror of darkEnough: lighter until dark text on the colour holds its contrast. */
function lightEnough(h: number, s: number, l: number, ink: string, min: number) {
  let light = l;
  while (light < 95 && contrast(hslHex(h, s, light), ink) < min) light += 1;
  return light;
}

export type CardPalette = {
  /** Top-left to bottom-right gradient stops, opaque. */
  background: string[];
  glow: string;
  text: string;
  soft: string;
  muted: string;
  accent: string;
  pillBg: string;
  pillText: string;
  chipBg: string;
  chipText: string;
  footerBg: string;
  footerText: string;
  footerSoft: string;
  footerLine: string;
  diagramBg: string;
  diagramInk: string;
  diagramDot: string;
  /** The record label's colour, for the vinyl theme. */
  label: string;
};

export function cardPalette(theme: CardTheme, hueInput: number): CardPalette {
  const h = normalizeHue(hueInput);
  switch (theme) {
    case "dark":
      return {
        background: ["#15131d", "#0b0a10"],
        glow: hsla(h, 80, 55, 0.34),
        text: "#f6f4fb",
        soft: "#cdc9da",
        muted: "#9a95ab",
        accent: hslHex(h, 85, 72),
        pillBg: hsla(h, 70, 60, 0.16),
        pillText: hslHex(h, 90, 84),
        chipBg: hslHex(h, 75, lightEnough(h, 75, 70, "#0d0b12", 7)),
        chipText: "#0d0b12",
        footerBg: "#07060a",
        footerText: "#ffffff",
        footerSoft: hslHex(h, 85, 80),
        footerLine: hslHex(h, 85, 66),
        diagramBg: "rgba(255, 255, 255, 0.05)",
        diagramInk: "#ebe8f3",
        diagramDot: hslHex(h, 85, 72),
        label: hslHex(h, 75, 60),
      };
    case "light":
      return {
        background: ["#fdfcf8", "#f0ece3"],
        glow: hsla(h, 85, 65, 0.22),
        text: "#17151f",
        soft: "#46424f",
        muted: "#6f6b7b",
        accent: hslHex(h, 70, darkEnough(h, 70, 42, 4.5)),
        pillBg: hsla(h, 70, 50, 0.12),
        pillText: hslHex(h, 70, darkEnough(h, 70, 30, 7)),
        chipBg: hslHex(h, 68, darkEnough(h, 68, 44, 4.5)),
        chipText: "#ffffff",
        footerBg: "#17151f",
        footerText: "#ffffff",
        footerSoft: hslHex(h, 80, 82),
        footerLine: hslHex(h, 68, 50),
        diagramBg: "#ffffff",
        diagramInk: "#2a2733",
        diagramDot: hslHex(h, 68, darkEnough(h, 68, 44, 4.5)),
        label: hslHex(h, 68, 50),
      };
    case "vinyl":
      return {
        background: [hslHex(h, 30, 17), hslHex(h + 20, 36, 8)],
        glow: hsla(h, 70, 50, 0.32),
        text: "#fbf8f2",
        soft: "#ddd8cf",
        muted: "#aaa49a",
        accent: hslHex(h, 80, 68),
        pillBg: "rgba(255, 255, 255, 0.1)",
        pillText: "#fbf8f2",
        chipBg: hslHex(h, 75, lightEnough(h, 75, 66, "#120f14", 7)),
        chipText: "#120f14",
        footerBg: "#060508",
        footerText: "#ffffff",
        footerSoft: hslHex(h, 80, 80),
        footerLine: hslHex(h, 80, 62),
        diagramBg: "rgba(255, 255, 255, 0.06)",
        diagramInk: "#f3efe6",
        diagramDot: hslHex(h, 80, 68),
        label: hslHex(h, 72, 56),
      };
    case "gradient":
    default: {
      const top = darkEnough(h, 78, 56, 3.2);
      const mid = darkEnough(h + 28, 72, 44, 4);
      const end = darkEnough(h + 56, 70, 30, 5);
      return {
        background: [hslHex(h, 78, top), hslHex(h + 28, 72, mid), hslHex(h + 56, 70, end)],
        glow: "rgba(255, 255, 255, 0.22)",
        text: "#ffffff",
        soft: "#f4f1f8",
        muted: "#e6e1ee",
        accent: "#ffffff",
        pillBg: "rgba(255, 255, 255, 0.2)",
        pillText: "#ffffff",
        chipBg: "#ffffff",
        chipText: hslHex(h + 28, 70, Math.min(30, darkEnough(h + 28, 70, 30, 7))),
        footerBg: hslHex(h + 56, 45, 11),
        footerText: "#ffffff",
        footerSoft: hslHex(h, 80, 86),
        footerLine: "#ffffff",
        diagramBg: "rgba(255, 255, 255, 0.16)",
        diagramInk: "#ffffff",
        diagramDot: "#ffffff",
        label: hslHex(h, 78, top),
      };
    }
  }
}

/* ---- layout ---- */

export type Align = "left" | "right" | "center";
export type TextRole = "title" | "artist" | "pill" | "label" | "chip" | "note" | "siteName" | "siteUrl";
/** One line of text; y is its vertical centre (the canvas draws with textBaseline "middle"). */
export type TextItem = { role: TextRole; text: string; x: number; y: number; size: number; weight: number; align: Align; dir: TextDir; maxWidth: number; faint?: boolean };
export type Rect = { x: number; y: number; w: number; h: number };
export type ArtBox = Rect & { kind: "cover" | "vinyl" };
export type DiagramBox = Rect & ParsedChord;

export type CardLayout = {
  width: number;
  height: number;
  size: CardSize;
  pad: number;
  dir: TextDir;
  art: ArtBox | null;
  texts: TextItem[];
  pills: Rect[];
  chips: (Rect & { chord: string })[];
  diagrams: DiagramBox[];
  /** The link to the site. Always present; the renderer always draws it. */
  footer: { rect: Rect; qr: Rect; siteName: TextItem; url: TextItem };
  /** How much the content had to be squeezed to fit (0 = not at all). */
  level: number;
};

/** The title drawn when the box is empty, faintly, so the preview never looks broken. */
export const TITLE_PLACEHOLDER = "שם השיר";

type Level = { art: number; title: number; titleLines: number; diagrams: boolean; diagramScale: number; note: boolean; noteLines: number };

/** Ever tighter settings; the first that fits wins, and the last always fits. */
const LEVELS: Level[] = [
  { art: 1, title: 1, titleLines: 3, diagrams: true, diagramScale: 1, note: true, noteLines: 3 },
  { art: 0.9, title: 0.9, titleLines: 3, diagrams: true, diagramScale: 0.82, note: true, noteLines: 2 },
  { art: 0.8, title: 0.82, titleLines: 2, diagrams: true, diagramScale: 0.66, note: true, noteLines: 2 },
  { art: 0.72, title: 0.76, titleLines: 2, diagrams: false, diagramScale: 0, note: true, noteLines: 1 },
  { art: 0.6, title: 0.7, titleLines: 2, diagrams: false, diagramScale: 0, note: false, noteLines: 0 },
  { art: 0, title: 0.62, titleLines: 1, diagrams: false, diagramScale: 0, note: false, noteLines: 0 },
];

const SPEC = {
  post: {
    pad: 76,
    footer: 164,
    qr: 128,
    footerGap: 40,
    art: 300,
    artGap: 44,
    title: [88, 108],
    titleMin: 40,
    artist: 48,
    pill: { font: 30, h: 58, padX: 24, gap: 12 },
    chip: { font: 34, h: 66, padX: 26, gap: 12, min: 78 },
    diagram: { cell: 150, perRow: 6, rows: 1, gap: 18 },
    note: 38,
    siteName: 44,
    url: 32,
    label: 26,
  },
  story: {
    pad: 96,
    footer: 220,
    qr: 172,
    footerGap: 64,
    art: 620,
    artGap: 64,
    title: [124, 124],
    titleMin: 48,
    artist: 58,
    pill: { font: 36, h: 70, padX: 30, gap: 14 },
    chip: { font: 40, h: 78, padX: 24, gap: 14, min: 86 },
    // One row: two rows of large boxes crowd out the art on a story.
    diagram: { cell: 196, perRow: 6, rows: 1, gap: 20 },
    note: 46,
    siteName: 58,
    url: 40,
    label: 32,
  },
} as const;

/** Lays boxes of given widths into rows no wider than maxWidth. */
function flowRows(widths: number[], maxWidth: number, gap: number, maxRows = Infinity) {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  widths.forEach((w, index) => {
    const need = row.length ? used + gap + w : w;
    if (row.length && need > maxWidth) {
      rows.push(row);
      row = [];
      used = 0;
    }
    if (rows.length >= maxRows) return;
    row.push(index);
    used = row.length === 1 ? w : used + gap + w;
  });
  if (row.length && rows.length < maxRows) rows.push(row);
  return rows;
}

/**
 * Where everything goes on the card. The block of text reads from the right
 * for Hebrew, or from the left when the title (or artist) is Latin only; chord
 * chips keep the order they were typed in, left to right, as chord sheets do,
 * but sit against the same edge. The footer with the site's name, address and
 * QR code is laid out first and nothing is allowed into it.
 */
export function layoutCard(fields: CardFields, hasCover: boolean, measure: Measure): CardLayout {
  const size = fields.size;
  const { width: W, height: H } = CARD_DIMENSIONS[size];
  const spec = SPEC[size];
  const pad = spec.pad;
  const innerW = W - pad * 2;

  const footerRect: Rect = { x: 0, y: H - spec.footer, w: W, h: spec.footer };
  const qr: Rect = { x: pad, y: footerRect.y + (spec.footer - spec.qr) / 2, w: spec.qr, h: spec.qr };
  const footerTextW = innerW - spec.qr - 36;
  const siteName: TextItem = { role: "siteName", text: SITE_NAME, x: W - pad, y: footerRect.y + spec.footer * 0.37, size: spec.siteName, weight: 800, align: "right", dir: "rtl", maxWidth: footerTextW };
  // The address is shrunk, never cut: an ellipsis would break the one thing the footer is for.
  const urlFit = fitText(SITE_LABEL, { maxWidth: footerTextW, maxLines: 1, maxSize: spec.url, minSize: 12, weight: 600, step: 1 }, measure);
  const url: TextItem = { role: "siteUrl", text: SITE_LABEL, x: W - pad, y: footerRect.y + spec.footer * 0.67, size: urlFit.size, weight: 600, align: "right", dir: "ltr", maxWidth: footerTextW };

  const title = fields.title.trim();
  const artist = fields.artist.trim();
  const dir = textDirection(title || artist || TITLE_PLACEHOLDER);
  const rtl = dir === "rtl";
  const align: Align = rtl ? "right" : "left";
  const edge = rtl ? W - pad : pad;
  const hasArt = hasCover || fields.theme === "vinyl";
  const artKind = hasCover && fields.theme !== "vinyl" ? "cover" : "vinyl";
  const { chords } = parseChords(fields.chords);
  const distinct = distinctChords(chords);
  const bpm = bpmValue(fields.bpm);
  const pillLabels = [fields.key.trim() && `סולם ${fields.key.trim()}`, bpm && `${bpm} BPM`, fields.meter.trim() && `משקל ${fields.meter.trim()}`].filter(Boolean) as string[];
  const note = fields.note.trim();

  const contentTop = pad;
  const contentBottom = footerRect.y - spec.footerGap;
  const available = contentBottom - contentTop;

  const build = (level: Level) => {
    const texts: TextItem[] = [];
    const pills: Rect[] = [];
    const chips: (Rect & { chord: string })[] = [];
    const diagrams: DiagramBox[] = [];
    let art: ArtBox | null = null;
    const side = size === "post";
    const artSize = hasArt ? Math.round(spec.art * level.art) : 0;
    let y = 0;

    // Stacked art (story): centred above the text.
    if (artSize && !side) {
      art = { x: (W - artSize) / 2, y: 0, w: artSize, h: artSize, kind: artKind };
      y = artSize + spec.artGap;
    }
    const headerTop = y;
    const textW = side && artSize ? innerW - artSize - spec.artGap : innerW;
    const header: TextItem[] = [];
    const headerPills: Rect[] = [];

    const titleFit = fitText(
      title || TITLE_PLACEHOLDER,
      { maxWidth: textW, maxLines: level.titleLines, maxSize: Math.round(spec.title[side && artSize ? 0 : 1] * level.title), minSize: spec.titleMin, weight: 800 },
      measure,
    );
    const titleLh = Math.round(titleFit.size * 1.16);
    const titleDir = textDirection(title || TITLE_PLACEHOLDER);
    for (const line of titleFit.lines) {
      header.push({ role: "title", text: line, x: edge, y: y + titleLh / 2, size: titleFit.size, weight: 800, align, dir: titleDir, maxWidth: textW, faint: !title });
      y += titleLh;
    }
    if (artist) {
      y += 8;
      const fit = fitText(artist, { maxWidth: textW, maxLines: 1, maxSize: spec.artist, minSize: Math.round(spec.artist * 0.66), weight: 500 }, measure);
      const lh = Math.round(fit.size * 1.3);
      header.push({ role: "artist", text: fit.lines[0], x: edge, y: y + lh / 2, size: fit.size, weight: 500, align, dir: textDirection(artist), maxWidth: textW });
      y += lh;
    }
    if (pillLabels.length) {
      y += 26;
      const p = spec.pill;
      const font = cardFont(600, p.font);
      const widths = pillLabels.map((label) => Math.min(textW, Math.ceil(measure(label, font)) + p.padX * 2));
      const rows = flowRows(widths, textW, p.gap);
      rows.forEach((row, r) => {
        const top = y + r * (p.h + p.gap);
        // Pills are Hebrew phrases, so in an RTL block the first sits at the right.
        let cursor = rtl ? W - pad : pad;
        for (const index of row) {
          const w = widths[index];
          const x = rtl ? cursor - w : cursor;
          headerPills.push({ x, y: top, w, h: p.h });
          header.push({ role: "pill", text: pillLabels[index], x: x + w / 2, y: top + p.h / 2, size: p.font, weight: 600, align: "center", dir: textDirection(pillLabels[index]), maxWidth: w - p.padX });
          cursor = rtl ? x - p.gap : x + w + p.gap;
        }
      });
      y += rows.length * p.h + (rows.length - 1) * p.gap;
    }

    // Side art (post): the text block sits beside it, centred on it when shorter.
    if (artSize && side) {
      const textH = y - headerTop;
      const block = Math.max(artSize, textH);
      const shift = (block - textH) / 2;
      for (const item of header) item.y += shift;
      for (const pill of headerPills) pill.y += shift;
      art = { x: rtl ? pad : W - pad - artSize, y: headerTop + (block - artSize) / 2, w: artSize, h: artSize, kind: artKind };
      y = headerTop + block;
    }
    texts.push(...header);
    pills.push(...headerPills);

    if (chords.length) {
      y += 40;
      const labelLh = Math.round(spec.label * 1.4);
      texts.push({ role: "label", text: "אקורדים", x: edge, y: y + labelLh / 2, size: spec.label, weight: 600, align, dir: "rtl", maxWidth: innerW });
      y += labelLh + 10;
      const c = spec.chip;
      const font = cardFont(700, c.font);
      const widths = chords.map((chord) => Math.max(c.min, Math.ceil(measure(chord, font)) + c.padX * 2));
      const rows = flowRows(widths, innerW, c.gap, 3);
      rows.forEach((row, r) => {
        const top = y + r * (c.h + c.gap);
        const rowW = row.reduce((sum, index) => sum + widths[index], 0) + (row.length - 1) * c.gap;
        let x = rtl ? W - pad - rowW : pad;
        for (const index of row) {
          chips.push({ x, y: top, w: widths[index], h: c.h, chord: chords[index] });
          texts.push({ role: "chip", text: chords[index], x: x + widths[index] / 2, y: top + c.h / 2, size: c.font, weight: 700, align: "center", dir: "ltr", maxWidth: widths[index] });
          x += widths[index] + c.gap;
        }
      });
      y += rows.length * c.h + (rows.length - 1) * c.gap;
    }

    if (fields.diagrams && level.diagrams && distinct.length) {
      y += 28;
      const d = spec.diagram;
      const shown = distinct.slice(0, d.perRow * d.rows);
      const perRow = Math.min(d.perRow, shown.length);
      const cell = Math.floor(Math.min(d.cell * level.diagramScale, (innerW - d.gap * (perRow - 1)) / perRow));
      const cellH = Math.round(cell * 1.32);
      for (let start = 0, r = 0; start < shown.length; start += perRow, r += 1) {
        const row = shown.slice(start, start + perRow);
        const rowW = row.length * cell + (row.length - 1) * d.gap;
        let x = rtl ? W - pad - rowW : pad;
        for (const chord of row) {
          diagrams.push({ x, y: y + r * (cellH + d.gap), w: cell, h: cellH, ...chord });
          x += cell + d.gap;
        }
      }
      const rowCount = Math.ceil(shown.length / perRow);
      y += rowCount * cellH + (rowCount - 1) * d.gap;
    }

    if (note && level.note) {
      y += 34;
      const fit = fitText(note, { maxWidth: innerW, maxLines: level.noteLines, maxSize: spec.note, minSize: Math.round(spec.note * 0.74), weight: 400 }, measure);
      const lh = Math.round(fit.size * 1.42);
      for (const line of fit.lines) {
        texts.push({ role: "note", text: line, x: edge, y: y + lh / 2, size: fit.size, weight: 400, align, dir: textDirection(note), maxWidth: innerW });
        y += lh;
      }
    }
    return { texts, pills, chips, diagrams, art, height: y };
  };

  let level = 0;
  let result = build(LEVELS[0]);
  while (result.height > available && level < LEVELS.length - 1) {
    level += 1;
    result = build(LEVELS[level]);
  }
  // Centred in the space above the footer, a little above the middle, where the eye lands.
  const offset = contentTop + Math.max(0, (available - result.height) * 0.45);
  const move = <T extends { y: number }>(item: T) => ({ ...item, y: item.y + offset });

  return {
    width: W,
    height: H,
    size,
    pad,
    dir,
    art: result.art ? move(result.art) : null,
    texts: [...result.texts.map(move), siteName, url],
    pills: result.pills.map(move),
    chips: result.chips.map(move),
    diagrams: result.diagrams.map(move),
    footer: { rect: footerRect, qr, siteName, url },
    level,
  };
}

/* ---- sharing ---- */

export type ShareText = {
  /** A title for the share sheet. */
  title: string;
  /** The message without the address, for targets that add the address themselves. */
  body: string;
  /** The message with the address on its own last line. Always contains SITE_URL. */
  text: string;
  url: string;
};

/**
 * What travels with the picture. The address is always part of `text`, not
 * only the separate `url` field: several share targets drop `url` when files
 * are attached, and the owner asked that the link always go along.
 */
export function shareText(fields: CardFields): ShareText {
  const title = fields.title.trim();
  const artist = fields.artist.trim();
  const { chords } = parseChords(fields.chords);
  const bpm = bpmValue(fields.bpm);
  const lines: string[] = [];
  if (title && artist) lines.push(`„${title}” — ${artist}`);
  else if (title) lines.push(`„${title}”`);
  else if (artist) lines.push(artist);
  const meta = [fields.key.trim() && `סולם ${fields.key.trim()}`, bpm && `${bpm} BPM`, fields.meter.trim() && `משקל ${fields.meter.trim()}`].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));
  if (chords.length) lines.push(`אקורדים: ${chords.join(" ")}`);
  if (fields.note.trim()) lines.push(fields.note.trim());
  if (lines.length) lines.push("");
  lines.push(`הכרטיס נוצר ב„${SITE_NAME}” — כלים חינמיים למוזיקה בדפדפן:`);
  const body = lines.join("\n");
  return {
    title: title ? `${title} — ${SITE_NAME}` : `כרטיס שיר — ${SITE_NAME}`,
    body,
    text: `${body}\n${SITE_URL}`,
    url: SITE_URL,
  };
}

/** A file name for the PNG: the title where there is one, and the size. */
export function cardFileName(fields: CardFields) {
  const base = fields.title
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "song-card"}-${fields.size}.png`;
}

/* ---- remembering the last card ---- */

export type StoredCard = { fields: CardFields; cover: string | null };

export function readStoredCard(storage: Pick<Storage, "getItem"> | null = safeLocalStorage()): StoredCard {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { fields: DEFAULT_FIELDS, cover: null };
    const parsed = JSON.parse(raw) as { fields?: unknown; cover?: unknown };
    const cover = typeof parsed.cover === "string" && parsed.cover.startsWith("data:image/") ? parsed.cover : null;
    return { fields: normalizeFields(parsed.fields), cover };
  } catch {
    return { fields: DEFAULT_FIELDS, cover: null };
  }
}

/**
 * Keeps the card for the next visit. A cover picture can push past the
 * storage quota, in which case the fields are kept without it rather than
 * losing both.
 */
export function writeStoredCard(card: StoredCard, storage: Pick<Storage, "setItem"> | null = safeLocalStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(card));
    return true;
  } catch {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ fields: card.fields, cover: null }));
    } catch {
      // No storage at all: the card lasts as long as the page.
    }
    return false;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
