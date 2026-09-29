import { describe, expect, it } from "vitest";
import {
  CARD_DIMENSIONS,
  CARD_SIZES,
  CARD_THEMES,
  DEFAULT_FIELDS,
  SITE_LABEL,
  SITE_NAME,
  SITE_URL,
  STORAGE_KEY,
  TITLE_PLACEHOLDER,
  bpmValue,
  cardFileName,
  cardPalette,
  chordsFromSong,
  contrast,
  distinctChords,
  ellipsize,
  fitText,
  isLatinOnly,
  layoutCard,
  normalizeFields,
  normalizeHue,
  parseChords,
  readStoredCard,
  shareText,
  shortKeyName,
  textDirection,
  wrapText,
  writeStoredCard,
  type CardFields,
  type CardLayout,
  type Measure,
} from "./songCard";

/**
 * A stand-in for canvas measureText: every character is 11/20 of the font
 * size wide (Rubik's average is close), read from the CSS font string.
 */
const measure: Measure = (text, font) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 16);
  return (Array.from(text).length * size * 11) / 20;
};

const FULL: CardFields = {
  ...DEFAULT_FIELDS,
  title: "ירושלים של זהב",
  artist: "נעמי שמר",
  key: "Am",
  bpm: "92",
  meter: "3/4",
  chords: "Am Dm E7 Am F G C E",
  note: "שיר שכולם מכירים — מנגנים ביחד בערב שירה",
};

const LONG: CardFields = {
  ...FULL,
  title: "שיר ארוך מאוד מאוד עם שם שלא נגמר אף פעם ועוד כמה מילים נוספות כדי למלא שלוש שורות שלמות ויותר",
  artist: "להקה עם שם ארוך במיוחד שלא נכנס בשורה אחת בשום אופן",
  chords: "Am F C G Em Dm E7 Bb Fmaj7 Cadd9 Gsus4 D/F# A7 Bm C#m F#m",
  note: "הערה ארוכה ".repeat(20),
};

const EMPTY: CardFields = { ...DEFAULT_FIELDS };

const ALL_FIELDS = [EMPTY, FULL, LONG, { ...FULL, title: "Hotel California", artist: "Eagles" }];

function everyCombination() {
  const out: { fields: CardFields; cover: boolean }[] = [];
  for (const base of ALL_FIELDS) {
    for (const { id: theme } of CARD_THEMES) {
      for (const { id: size } of CARD_SIZES) {
        for (const cover of [false, true]) {
          for (const diagrams of [true, false]) out.push({ fields: { ...base, theme, size, diagrams }, cover });
        }
      }
    }
  }
  return out;
}

function inside(layout: CardLayout, r: { x: number; y: number; w: number; h: number }) {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= layout.width + 0.5 && r.y + r.h <= layout.height + 0.5;
}

/** The horizontal extent of a line of text, from its anchor and alignment. */
function textBox(item: CardLayout["texts"][number]) {
  const w = measure(item.text, `${item.weight} ${item.size}px x`);
  const x = item.align === "right" ? item.x - w : item.align === "center" ? item.x - w / 2 : item.x;
  return { x, y: item.y - item.size / 2, w, h: item.size };
}

describe("songCard: chords", () => {
  it("parses space-separated chords, keeping order and repeats", () => {
    expect(parseChords("Am F C G")).toEqual({ chords: ["Am", "F", "C", "G"], invalid: [] });
    expect(parseChords("C G Am G").chords).toEqual(["C", "G", "Am", "G"]);
  });

  it("accepts commas, bars and dashes, typographic accidentals and lower-case roots", () => {
    expect(parseChords("am, f | c - g").chords).toEqual(["Am", "F", "C", "G"]);
    expect(parseChords("Am-F-C-G").chords).toEqual(["Am", "F", "C", "G"]);
    expect(parseChords("F♯m B♭ Amin G/B C#m7").chords).toEqual(["F#m", "Bb", "Am", "G/B", "C#m7"]);
  });

  it("reports what is not a chord instead of printing it", () => {
    expect(parseChords("Am שלום X7 G")).toEqual({ chords: ["Am", "G"], invalid: ["שלום", "X7"] });
    expect(parseChords("   ")).toEqual({ chords: [], invalid: [] });
  });

  it("caps the list and gives each chord once for the diagrams", () => {
    expect(parseChords(Array(30).fill("C").join(" ")).chords).toHaveLength(16);
    const distinct = distinctChords(["Am", "F", "Am", "C#m7", "G/B"]);
    expect(distinct.map((chord) => chord.name)).toEqual(["Am", "F", "C#m7", "G/B"]);
    expect(distinct[0]).toMatchObject({ root: 9, quality: "m" });
    expect(distinct[2]).toMatchObject({ root: 1, quality: "m7" });
  });

  it("imports chords from a saved song and keys from the analysis tool", () => {
    expect(chordsFromSong("[Am]שורה [F]אחת\n[C]שתיים [Am]שוב [G]")).toBe("Am F C G");
    expect(chordsFromSong("[Am]א [F]ב", 2)).toBe("Bm G");
    expect(shortKeyName("A מינור")).toBe("Am");
    expect(shortKeyName("C מז׳ור")).toBe("C");
    expect(shortKeyName("F# minor")).toBe("F#m");
    expect(shortKeyName("Bb")).toBe("Bb");
    expect(shortKeyName("Cmaj")).toBe("C");
  });
});

describe("songCard: direction and text fitting", () => {
  it("draws Latin-only strings left to right and everything else right to left", () => {
    expect(isLatinOnly("Hotel California")).toBe(true);
    expect(textDirection("Hotel California")).toBe("ltr");
    expect(textDirection("ירושלים של זהב")).toBe("rtl");
    expect(textDirection("שיר Love")).toBe("rtl");
    expect(textDirection("120")).toBe("rtl");
  });

  it("wraps at word boundaries within the width, breaking only words that cannot fit", () => {
    const font = "400 20px x"; // 11px per character
    const lines = wrapText("אחת שתיים שלוש ארבע חמש", 110, font, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, font)).toBeLessThanOrEqual(110);
    expect(lines.join(" ")).toBe("אחת שתיים שלוש ארבע חמש");
    const broken = wrapText("א".repeat(25), 110, font, measure);
    expect(broken).toEqual(["א".repeat(10), "א".repeat(10), "א".repeat(5)]);
  });

  it("shrinks a long title before wrapping past the allowed lines", () => {
    const short = fitText("שיר", { maxWidth: 900, maxLines: 2, maxSize: 100, minSize: 40, weight: 800 }, measure);
    expect(short).toEqual({ size: 100, lines: ["שיר"], truncated: false });
    const long = fitText("מילה ".repeat(30), { maxWidth: 900, maxLines: 2, maxSize: 100, minSize: 40, weight: 800 }, measure);
    expect(long.size).toBeLessThan(100);
    expect(long.lines.length).toBeLessThanOrEqual(2);
  });

  it("cuts with an ellipsis only past the smallest size, and never overflows", () => {
    const fit = fitText("מילה ".repeat(80), { maxWidth: 500, maxLines: 2, maxSize: 60, minSize: 40, weight: 800 }, measure);
    expect(fit.truncated).toBe(true);
    expect(fit.size).toBe(40);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines[1].endsWith("…")).toBe(true);
    for (const line of fit.lines) expect(measure(line, "800 40px x")).toBeLessThanOrEqual(500);
    expect(ellipsize("קצר", 500, "400 20px x", measure)).toBe("קצר");
  });

  it("shows text whole when it fits at the smallest size even if the steps skipped it", () => {
    // 61 → 41 in steps of 2 never tries 40, where these 20 letters fit one line (440 ≤ 445).
    const text = "אבגדהוזחטיכלמנסעפצקר";
    const fit = fitText(text, { maxWidth: 445, maxLines: 1, maxSize: 61, minSize: 40, weight: 800 }, measure);
    expect(fit).toEqual({ size: 40, lines: [text], truncated: false });
  });
});

describe("songCard: palettes", () => {
  it("wraps the hue into 0..359", () => {
    expect(normalizeHue(370)).toBe(10);
    expect(normalizeHue(-10)).toBe(350);
    expect(normalizeHue(Number.NaN)).toBe(DEFAULT_FIELDS.hue);
  });

  it("builds a different gradient for each hue, with the same hue wrapping to the same palette", () => {
    expect(cardPalette("gradient", 10).background).not.toEqual(cardPalette("gradient", 200).background);
    expect(cardPalette("gradient", 370)).toEqual(cardPalette("gradient", 10));
    for (const { id } of CARD_THEMES) {
      const palette = cardPalette(id, 120);
      expect(palette.background.length).toBeGreaterThanOrEqual(2);
      for (const color of palette.background) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps the title and the footer legible on every theme at every hue", () => {
    for (const { id } of CARD_THEMES) {
      for (let hue = 0; hue < 360; hue += 15) {
        const p = cardPalette(id, hue);
        for (const stop of p.background) expect(contrast(p.text, stop), `${id} ${hue} title on ${stop}`).toBeGreaterThanOrEqual(3);
        expect(contrast(p.footerText, p.footerBg), `${id} ${hue} footer`).toBeGreaterThanOrEqual(7);
        expect(contrast(p.footerSoft, p.footerBg), `${id} ${hue} address`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.chipText, p.chipBg), `${id} ${hue} chips`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("songCard: layout", () => {
  it("matches the canvas sizes for post and story", () => {
    expect(CARD_DIMENSIONS.post).toEqual({ width: 1080, height: 1080 });
    expect(CARD_DIMENSIONS.story).toEqual({ width: 1080, height: 1920 });
    expect(layoutCard({ ...FULL, size: "story" }, false, measure)).toMatchObject({ width: 1080, height: 1920 });
  });

  it("keeps every box and line of text inside the card, in every theme and size", () => {
    for (const { fields, cover } of everyCombination()) {
      const layout = layoutCard(fields, cover, measure);
      const label = `${fields.theme}/${fields.size}/${fields.title.slice(0, 10) || "empty"}/cover=${cover}`;
      for (const box of [...layout.pills, ...layout.chips, ...layout.diagrams]) expect(inside(layout, box), label).toBe(true);
      if (layout.art) expect(inside(layout, layout.art), label).toBe(true);
      for (const item of layout.texts) expect(inside(layout, textBox(item)), `${label}: ${item.text}`).toBe(true);
    }
  });

  it("never lets the content run into the footer", () => {
    for (const { fields, cover } of everyCombination()) {
      const layout = layoutCard(fields, cover, measure);
      const top = layout.footer.rect.y;
      const content = [...layout.pills, ...layout.chips, ...layout.diagrams, ...(layout.art ? [layout.art] : [])];
      for (const box of content) expect(box.y + box.h).toBeLessThanOrEqual(top);
      for (const item of layout.texts) {
        if (item.role === "siteName" || item.role === "siteUrl") continue;
        expect(item.y + item.size / 2).toBeLessThanOrEqual(top);
      }
    }
  });

  it("always includes the link footer with the site's name, address and QR code", () => {
    for (const { fields, cover } of everyCombination()) {
      const layout = layoutCard(fields, cover, measure);
      const { rect, qr, siteName, url } = layout.footer;
      expect(rect.y + rect.h).toBe(layout.height);
      expect(rect.w).toBe(layout.width);
      expect(siteName.text).toBe(SITE_NAME);
      expect(url.text).toBe(SITE_LABEL);
      expect(url.dir).toBe("ltr");
      // The address is shrunk if need be, never cut.
      expect(measure(url.text, `600 ${url.size}px x`)).toBeLessThanOrEqual(url.maxWidth);
      expect(url.size).toBeGreaterThanOrEqual(24);
      expect(layout.texts).toContain(siteName);
      expect(layout.texts).toContain(url);
      expect(qr.y).toBeGreaterThanOrEqual(rect.y);
      expect(qr.y + qr.h).toBeLessThanOrEqual(rect.y + rect.h);
      expect(inside(layout, qr)).toBe(true);
      // The QR code and the words do not overlap.
      expect(qr.x + qr.w).toBeLessThan(textBox(url).x);
      expect(qr.x + qr.w).toBeLessThan(textBox(siteName).x);
    }
  });

  it("aligns Hebrew to the right and a Latin title to the left", () => {
    const hebrew = layoutCard(FULL, false, measure);
    expect(hebrew.dir).toBe("rtl");
    const title = hebrew.texts.find((item) => item.role === "title")!;
    expect(title).toMatchObject({ align: "right", dir: "rtl", x: 1080 - hebrew.pad });
    const latin = layoutCard({ ...FULL, title: "Hotel California", artist: "Eagles" }, false, measure);
    expect(latin.dir).toBe("ltr");
    expect(latin.texts.find((item) => item.role === "title")).toMatchObject({ align: "left", dir: "ltr", x: latin.pad });
    // Chord names read left to right whatever the block's direction.
    expect(hebrew.texts.filter((item) => item.role === "chip").every((item) => item.dir === "ltr")).toBe(true);
    const chips = hebrew.chips.slice(0, 2);
    expect(chips[0].x).toBeLessThan(chips[1].x);
  });

  it("shows a faint placeholder title on an empty card", () => {
    const layout = layoutCard(EMPTY, false, measure);
    const title = layout.texts.filter((item) => item.role === "title");
    expect(title.map((item) => item.text)).toEqual([TITLE_PLACEHOLDER]);
    expect(title[0].faint).toBe(true);
    expect(layout.chips).toHaveLength(0);
  });

  it("draws chord diagrams when asked, and a record for the vinyl theme", () => {
    const withDiagrams = layoutCard(FULL, false, measure);
    expect(withDiagrams.diagrams.map((d) => d.name)).toEqual(["Am", "Dm", "E7", "F", "G", "C"]);
    expect(layoutCard({ ...FULL, diagrams: false }, false, measure).diagrams).toHaveLength(0);
    expect(layoutCard({ ...FULL, theme: "vinyl" }, false, measure).art?.kind).toBe("vinyl");
    expect(layoutCard({ ...FULL, theme: "vinyl" }, true, measure).art?.kind).toBe("vinyl");
    expect(layoutCard(FULL, true, measure).art?.kind).toBe("cover");
    expect(layoutCard(FULL, false, measure).art).toBeNull();
  });

  it("squeezes a crowded card instead of overflowing it", () => {
    expect(layoutCard(FULL, false, measure).level).toBe(0);
    expect(layoutCard({ ...LONG, size: "post" }, true, measure).level).toBeGreaterThan(0);
  });
});

describe("songCard: share text", () => {
  it("always carries the full address, for every theme and size, even with nothing filled in", () => {
    for (const base of ALL_FIELDS) {
      for (const { id: theme } of CARD_THEMES) {
        for (const { id: size } of CARD_SIZES) {
          const share = shareText({ ...base, theme, size });
          expect(share.text).toContain(SITE_URL);
          expect(share.text.trim().endsWith(SITE_URL)).toBe(true);
          expect(share.url).toBe(SITE_URL);
          expect(share.body).not.toContain(SITE_URL);
          expect(share.body).toContain(SITE_NAME);
        }
      }
    }
    expect(SITE_URL).toBe("https://shmuel-lamed.github.io/SongToNotes/");
  });

  it("describes the song in natural Hebrew", () => {
    const share = shareText(FULL);
    expect(share.body).toContain("„ירושלים של זהב” — נעמי שמר");
    expect(share.body).toContain("סולם Am · 92 BPM · משקל 3/4");
    expect(share.body).toContain("אקורדים: Am Dm E7 Am F G C E");
    expect(share.title).toBe(`ירושלים של זהב — ${SITE_NAME}`);
    expect(shareText(EMPTY).title).toBe(`כרטיס שיר — ${SITE_NAME}`);
  });
});

describe("songCard: fields and storage", () => {
  it("cleans up whatever comes in", () => {
    const fields = normalizeFields({ title: "x".repeat(200), theme: "neon", size: "story", hue: 725, bpm: 128.4, diagrams: "yes" });
    expect(fields.title).toHaveLength(80);
    expect(fields.theme).toBe("gradient");
    expect(fields.size).toBe("story");
    expect(fields.hue).toBe(5);
    expect(fields.bpm).toBe("128");
    expect(fields.diagrams).toBe(true);
    expect(normalizeFields(null)).toEqual(DEFAULT_FIELDS);
    expect(bpmValue("120")).toBe(120);
    expect(bpmValue("abc")).toBeNull();
    expect(bpmValue("5")).toBeNull();
  });

  it("names the file after the song and the size", () => {
    expect(cardFileName({ ...FULL, size: "story" })).toBe("ירושלים-של-זהב-story.png");
    expect(cardFileName(EMPTY)).toBe("song-card-post.png");
  });

  it("remembers the last card and survives broken or full storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(writeStoredCard({ fields: FULL, cover: "data:image/jpeg;base64,AAAA" }, storage)).toBe(true);
    expect(store.has(STORAGE_KEY)).toBe(true);
    expect(readStoredCard(storage)).toEqual({ fields: FULL, cover: "data:image/jpeg;base64,AAAA" });

    store.set(STORAGE_KEY, "{not json");
    expect(readStoredCard(storage)).toEqual({ fields: DEFAULT_FIELDS, cover: null });

    // A cover over the quota: the fields are still kept.
    const tight = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > 2000) throw new DOMException("full", "QuotaExceededError");
        store.set(k, v);
      },
    };
    expect(writeStoredCard({ fields: FULL, cover: `data:image/jpeg;base64,${"A".repeat(5000)}` }, tight)).toBe(false);
    expect(readStoredCard(tight)).toEqual({ fields: FULL, cover: null });

    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredCard(throwing)).toEqual({ fields: DEFAULT_FIELDS, cover: null });
    expect(writeStoredCard({ fields: FULL, cover: null }, throwing)).toBe(false);
  });
});
