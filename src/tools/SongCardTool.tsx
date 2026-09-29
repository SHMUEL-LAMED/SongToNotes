import { Check, Copy, Download, FolderOpen, ImagePlus, Link2, Share2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ShareTargetButtons } from "../components/SiteShare";
import { useAuth } from "../lib/auth";
import { canShareFiles, downloadFile } from "../lib/export";
import { guitarShape } from "../lib/guitarShapes";
import { encodeQr, type QrCode } from "../lib/qr";
import { markShared } from "../lib/siteShare";
import {
  CARD_DIMENSIONS,
  CARD_SIZES,
  CARD_THEMES,
  LIMITS,
  METERS,
  SITE_URL,
  bpmValue,
  cardFileName,
  cardFont,
  cardPalette,
  chordsFromSong,
  isSize,
  isTheme,
  layoutCard,
  normalizeFields,
  normalizeHue,
  parseChords,
  readStoredCard,
  shareText,
  shortKeyName,
  writeStoredCard,
  type CardFields,
  type CardLayout,
  type CardPalette,
  type DiagramBox,
  type Measure,
  type Rect,
  type TextItem,
} from "../lib/songCard";
import { useAssistantTool } from "../lib/useAssistantTool";
import { listWorks, type SavedWork } from "../lib/works";
import "./songcard.css";

/* ---- fonts ---- */

let fontsPromise: Promise<void> | null = null;

/**
 * The canvas does not wait for web fonts: text drawn before Rubik arrives is
 * drawn in a fallback face and stays that way in the PNG. So the card asks
 * for every weight it uses — with Hebrew and Latin sample text, since each
 * script is its own file — and draws again once they are in. A slow network
 * gets four seconds, then the card is drawn with what there is.
 */
function loadCardFonts() {
  if (fontsPromise) return fontsPromise;
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return (fontsPromise = Promise.resolve());
  const sample = "אבגדהוזחטיכלמנסעפצקרשת ABCabc 0123456789 /.-";
  const loads = [400, 500, 600, 700, 800].map((weight) => fonts.load(`${weight} 64px "Rubik Variable"`, sample));
  fontsPromise = Promise.race([
    Promise.all(loads).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 4000)),
  ]).catch(() => undefined);
  return fontsPromise;
}

/* ---- drawing ---- */

const SITE_QR: QrCode | null = encodeQr(SITE_URL);

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  ctx.closePath();
}

/** The picture scaled to fill the box and cropped from the centre, like CSS object-fit: cover. */
function drawImageCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, r: Rect) {
  const scale = Math.max(r.w / image.naturalWidth, r.h / image.naturalHeight);
  const w = r.w / scale;
  const h = r.h / scale;
  ctx.drawImage(image, (image.naturalWidth - w) / 2, (image.naturalHeight - h) / 2, w, h, r.x, r.y, r.w, r.h);
}

function drawBackground(ctx: CanvasRenderingContext2D, layout: CardLayout, palette: CardPalette, fields: CardFields) {
  const { width: W, height: H } = layout;
  const gradient = ctx.createLinearGradient(0, 0, W, H);
  palette.background.forEach((stop, index) => gradient.addColorStop(index / (palette.background.length - 1), stop));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // A soft light from the corner the text starts at, so the flat colour has depth.
  const gx = layout.dir === "rtl" ? W * 0.85 : W * 0.15;
  const glow = ctx.createRadialGradient(gx, H * 0.08, 0, gx, H * 0.08, W * 0.9);
  glow.addColorStop(0, palette.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  if (fields.theme === "gradient") {
    // Two faint rings off the far corner: a hint of sound waves, never behind the words.
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    const cx = layout.dir === "rtl" ? -W * 0.08 : W * 1.08;
    for (const [radius, width] of [
      [W * 0.42, 28],
      [W * 0.6, 14],
      [W * 0.76, 6],
    ]) {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(cx, H * 0.05, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  } else if (fields.theme === "light") {
    // A band of the chosen colour along the reading edge.
    ctx.fillStyle = palette.accent;
    ctx.fillRect(layout.dir === "rtl" ? W - 14 : 0, 0, 14, layout.footer.rect.y);
  }
}

function drawCoverArt(ctx: CanvasRenderingContext2D, image: HTMLImageElement, r: Rect) {
  const radius = r.w * 0.07;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = r.w * 0.09;
  ctx.shadowOffsetY = r.w * 0.03;
  roundRect(ctx, r, radius);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, r, radius);
  ctx.clip();
  drawImageCover(ctx, image, r);
  ctx.restore();
}

/** A record: grooves, a sheen, and a label that is the cover picture when there is one. */
function drawRecord(ctx: CanvasRenderingContext2D, r: Rect, palette: CardPalette, image: HTMLImageElement | null) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const radius = r.w / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = radius * 0.16;
  ctx.shadowOffsetY = radius * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  const body = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
  body.addColorStop(0, "#1d1c20");
  body.addColorStop(1, "#070708");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.lineWidth = Math.max(1, radius * 0.006);
  for (let rr = radius * 0.96, i = 0; rr > radius * 0.38; rr -= radius * 0.022, i += 1) {
    ctx.strokeStyle = i % 3 === 0 ? "rgba(255, 255, 255, 0.07)" : "rgba(255, 255, 255, 0.03)";
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Light catching the grooves: two opposite wedges, where the browser can draw a conic gradient.
  if (typeof ctx.createConicGradient === "function") {
    const sheen = ctx.createConicGradient(-Math.PI / 4, cx, cy);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.08, "rgba(255, 255, 255, 0.13)");
    sheen.addColorStop(0.16, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.5, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.58, "rgba(255, 255, 255, 0.1)");
    sheen.addColorStop(0.66, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.97, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const labelR = radius * 0.36;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    drawImageCover(ctx, image, { x: cx - labelR, y: cy - labelR, w: labelR * 2, h: labelR * 2 });
  } else {
    const label = ctx.createRadialGradient(cx, cy - labelR * 0.4, 0, cx, cy, labelR);
    label.addColorStop(0, palette.accent);
    label.addColorStop(1, palette.label);
    ctx.fillStyle = label;
    ctx.fillRect(cx - labelR, cy - labelR, labelR * 2, labelR * 2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
    ctx.lineWidth = labelR * 0.03;
    ctx.beginPath();
    ctx.arc(cx, cy, labelR * 0.72, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = "#0b0a0d";
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(4, radius * 0.028), 0, Math.PI * 2);
  ctx.fill();
}

/** The same chord box as ChordDiagram.tsx, drawn on the canvas. */
function drawDiagram(ctx: CanvasRenderingContext2D, box: DiagramBox, palette: CardPalette) {
  const shape = guitarShape(box.root, box.quality);
  roundRect(ctx, box, box.w * 0.1);
  ctx.fillStyle = palette.diagramBg;
  ctx.fill();

  const nameH = box.h * 0.22;
  const padX = box.w * 0.2;
  const top = box.y + box.h * 0.2;
  const gridW = box.w - padX * 2;
  const gridH = box.h - nameH - box.h * 0.24;
  const stringGap = gridW / 5;
  const fretGap = gridH / 4;
  const sx = (string: number) => box.x + padX + string * stringGap;
  const fy = (fret: number) => top + (fret - shape.base + 0.5) * fretGap;
  const unit = box.w / 100;

  ctx.save();
  ctx.strokeStyle = palette.diagramInk;
  ctx.fillStyle = palette.diagramInk;
  if (shape.base === 1) {
    ctx.fillRect(sx(0) - unit, top - unit * 3, gridW + unit * 2, unit * 3.2);
  } else {
    ctx.font = cardFont(600, unit * 11);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.direction = "ltr";
    ctx.fillText(String(shape.base), sx(0) - unit * 4, top + fretGap / 2);
  }
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, unit * 0.9);
  for (let fret = 0; fret <= 4; fret += 1) {
    ctx.beginPath();
    ctx.moveTo(sx(0), top + fret * fretGap);
    ctx.lineTo(sx(5), top + fret * fretGap);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.7;
  for (let string = 0; string < 6; string += 1) {
    ctx.beginPath();
    ctx.moveTo(sx(string), top);
    ctx.lineTo(sx(string), top + gridH);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = palette.diagramDot;
  const dotR = Math.min(stringGap, fretGap) * 0.36;
  if (shape.barre) {
    const y = fy(shape.barre.fret);
    roundRect(ctx, { x: sx(shape.barre.from) - dotR, y: y - dotR, w: sx(5) - sx(shape.barre.from) + dotR * 2, h: dotR * 2 }, dotR);
    ctx.fill();
  }
  shape.frets.forEach((fret, string) => {
    const x = sx(string);
    if (fret < 0) {
      ctx.strokeStyle = palette.diagramInk;
      ctx.lineWidth = Math.max(1.5, unit * 1.6);
      const s = unit * 3.4;
      const y = top - unit * 9;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.stroke();
    } else if (fret === 0) {
      ctx.strokeStyle = palette.diagramInk;
      ctx.lineWidth = Math.max(1.5, unit * 1.4);
      ctx.beginPath();
      ctx.arc(x, top - unit * 9, unit * 3.6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (!(shape.barre && fret === shape.barre.fret && string >= shape.barre.from)) {
      ctx.beginPath();
      ctx.arc(x, fy(fret), dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.fillStyle = palette.diagramInk;
  ctx.font = cardFont(700, Math.min(nameH * 0.62, unit * 20));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "ltr";
  ctx.fillText(box.name, box.x + box.w / 2, box.y + box.h - nameH * 0.62);
  ctx.restore();
}

/** The QR code on a white tile, with a quiet zone so phones find it. */
function drawQr(ctx: CanvasRenderingContext2D, qr: QrCode, r: Rect) {
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, r, r.w * 0.08);
  ctx.fill();
  const quiet = 3;
  const cell = r.w / (qr.size + quiet * 2);
  ctx.fillStyle = "#111014";
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (!qr.modules[y][x]) continue;
      // Rounded edges on whole pixels, so neighbouring modules leave no hairline seams.
      const x0 = Math.round(r.x + (x + quiet) * cell);
      const y0 = Math.round(r.y + (y + quiet) * cell);
      const x1 = Math.round(r.x + (x + quiet + 1) * cell);
      const y1 = Math.round(r.y + (y + quiet + 1) * cell);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
}

const TEXT_COLOR: Record<TextItem["role"], keyof CardPalette> = {
  title: "text",
  artist: "soft",
  pill: "pillText",
  label: "muted",
  chip: "chipText",
  note: "soft",
  siteName: "footerText",
  siteUrl: "footerSoft",
};

function drawText(ctx: CanvasRenderingContext2D, item: TextItem, palette: CardPalette) {
  ctx.save();
  ctx.font = cardFont(item.weight, item.size);
  // Hebrew needs an RTL base direction for its punctuation and mixed runs to land right;
  // Latin-only strings get LTR. The alignment is absolute, so it means the same in both.
  ctx.direction = item.dir;
  ctx.textAlign = item.align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette[TEXT_COLOR[item.role]] as string;
  if (item.faint) ctx.globalAlpha = 0.45;
  ctx.fillText(item.text, item.x, item.y);
  ctx.restore();
}

function drawCard(ctx: CanvasRenderingContext2D, layout: CardLayout, palette: CardPalette, fields: CardFields, cover: HTMLImageElement | null) {
  ctx.save();
  ctx.clearRect(0, 0, layout.width, layout.height);
  drawBackground(ctx, layout, palette, fields);

  if (layout.art) {
    if (layout.art.kind === "vinyl") drawRecord(ctx, layout.art, palette, cover);
    else if (cover) drawCoverArt(ctx, cover, layout.art);
  }

  for (const pill of layout.pills) {
    roundRect(ctx, pill, pill.h / 2);
    ctx.fillStyle = palette.pillBg;
    ctx.fill();
  }
  for (const chip of layout.chips) {
    roundRect(ctx, chip, chip.h * 0.3);
    ctx.fillStyle = palette.chipBg;
    ctx.fill();
  }
  for (const box of layout.diagrams) drawDiagram(ctx, box, palette);

  // The link to the site: drawn on every card, whatever the fields say.
  const { rect, qr } = layout.footer;
  ctx.fillStyle = palette.footerBg;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = palette.footerLine;
  ctx.fillRect(rect.x, rect.y, rect.w, layout.size === "post" ? 6 : 8);
  if (SITE_QR) drawQr(ctx, SITE_QR, qr);

  for (const item of layout.texts) drawText(ctx, item, palette);
  ctx.restore();
}

/* ---- images ---- */

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}

/**
 * A picked cover, scaled down to what the card can use and re-encoded as
 * JPEG: a phone photo is several megabytes, and the cover is kept in
 * localStorage with the rest of the card.
 */
async function prepareCover(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

/* ---- the page ---- */

type Importable = { id: string; label: string; kind: "song" | "analysis"; apply: Partial<CardFields> };

function importableFrom(work: SavedWork): Importable | null {
  if (work.kind === "song") {
    const body = typeof work.payload.body === "string" ? work.payload.body : "";
    const transpose = typeof work.payload.transpose === "number" ? work.payload.transpose : 0;
    return { id: work.id, label: work.title || "שיר", kind: "song", apply: { title: work.title.slice(0, LIMITS.title), chords: chordsFromSong(body, transpose) } };
  }
  if (work.kind === "analysis") {
    const apply: Partial<CardFields> = {};
    if (typeof work.summary.keyName === "string") apply.key = shortKeyName(work.summary.keyName);
    if (typeof work.summary.bpm === "number" && bpmValue(work.summary.bpm)) apply.bpm = String(bpmValue(work.summary.bpm));
    if (!apply.key && !apply.bpm) return null;
    return { id: work.id, label: work.title || "ניתוח", kind: "analysis", apply };
  }
  return null;
}

const SHARE_PROBE = typeof File !== "undefined" ? canShareFiles(new File([new Uint8Array(1)], "probe.png", { type: "image/png" })) : false;

/**
 * A shareable picture of a song, drawn live on a canvas: title, artist,
 * key, tempo, chords (as chips, and optionally as guitar boxes), a line of
 * text and an optional cover — with the site's name, address and QR code on
 * every card. Download it as PNG, hand it to the share sheet with the link,
 * or send the link and a description to WhatsApp or Telegram.
 */
export function SongCardTool() {
  const { user } = useAuth();
  const [initial] = useState(readStoredCard);
  const [fields, setFields] = useState<CardFields>(initial.fields);
  const [coverUrl, setCoverUrl] = useState<string | null>(initial.cover);
  // The decoded picture, tagged with the data URL it came from, so a removed or
  // replaced cover never shows its predecessor while the new one decodes.
  const [loadedCover, setLoadedCover] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  const cover = coverUrl && loadedCover?.url === coverUrl ? loadedCover.image : null;
  const [fontsReady, setFontsReady] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [imports, setImports] = useState<Importable[] | null>(null);
  const [showImports, setShowImports] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = useCallback((patch: Partial<CardFields>) => setFields((current) => normalizeFields({ ...current, ...patch }, current)), []);

  useEffect(() => {
    let alive = true;
    void loadCardFonts().then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!coverUrl) return;
    let alive = true;
    loadImage(coverUrl)
      .then((image) => alive && setLoadedCover({ url: coverUrl, image }))
      .catch(() => alive && setCoverUrl(null));
    return () => {
      alive = false;
    };
  }, [coverUrl]);

  useEffect(() => {
    writeStoredCard({ fields, cover: coverUrl });
  }, [fields, coverUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const { width, height } = CARD_DIMENSIONS[fields.size];
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const measure: Measure = (text, font) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    };
    const layout = layoutCard(fields, Boolean(cover), measure);
    drawCard(ctx, layout, cardPalette(fields.theme, fields.hue), fields, cover);
    return canvas;
  }, [fields, cover]);

  // Drawn on every change, and once more when the fonts arrive.
  useEffect(() => {
    draw();
  }, [draw, fontsReady]);

  const renderFile = useCallback(async () => {
    await loadCardFonts();
    const canvas = draw();
    if (!canvas) return null;
    const blob = await canvasBlob(canvas);
    return blob ? new File([blob], cardFileName(fields), { type: "image/png" }) : null;
  }, [draw, fields]);

  const share = useMemo(() => shareText(fields), [fields]);
  const { chords, invalid } = useMemo(() => parseChords(fields.chords), [fields.chords]);

  const download = useCallback(async () => {
    const file = await renderFile();
    if (!file) {
      setStatus({ tone: "error", text: "לא הצלחנו ליצור את התמונה" });
      return null;
    }
    downloadFile(file, file.name, file.type);
    setStatus({ tone: "ok", text: `${file.name} ירד` });
    return file;
  }, [renderFile]);

  const shareImage = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const file = await renderFile();
    if (!file) return { ok: false, message: "לא הצלחנו ליצור את התמונה" };
    if (!canShareFiles(file)) return { ok: false, message: "המכשיר הזה לא משתף תמונות — אפשר להוריד את התמונה, או לשלוח את הקישור בוואטסאפ ובטלגרם" };
    try {
      // The text already ends with the address; passing it as `url` too makes
      // some share sheets (iOS) print the link twice.
      await navigator.share({ files: [file], title: share.title, text: share.text });
      markShared();
      return { ok: true, message: "הכרטיס נשלח" };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { ok: true, message: "השיתוף בוטל" };
      return { ok: false, message: "השיתוף נכשל — אפשר להוריד את התמונה ולצרף אותה ידנית" };
    }
  }, [renderFile, share]);

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(share.text);
      markShared();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setStatus({ tone: "error", text: "ההעתקה לא עבדה כאן — אפשר לסמן את הטקסט ולהעתיק ידנית" });
    }
  }, [share.text]);

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus({ tone: "error", text: "זה לא קובץ תמונה" });
      return;
    }
    try {
      setCoverUrl(await prepareCover(file));
      setStatus(null);
    } catch {
      setStatus({ tone: "error", text: "לא הצלחנו לפתוח את התמונה" });
    }
  };

  const openImports = async () => {
    if (showImports) {
      setShowImports(false);
      return;
    }
    setShowImports(true);
    setImports(null);
    const works = await listWorks(user?.id ?? null).catch(() => [] as SavedWork[]);
    setImports(works.map(importableFrom).filter((item): item is Importable => item !== null).slice(0, 24));
  };

  useAssistantTool("songcard", {
    state: () => {
      const theme = CARD_THEMES.find((item) => item.id === fields.theme)?.label;
      const size = CARD_SIZES.find((item) => item.id === fields.size)?.label;
      return `כרטיס שיר: „${fields.title || "ללא שם"}”${fields.artist ? ` של ${fields.artist}` : ""}, סולם ${fields.key || "—"}, קצב ${bpmValue(fields.bpm) ?? "—"}, אקורדים: ${chords.join(" ") || "אין"}; עיצוב ${theme}, גודל ${size}, צבע ${fields.hue}${cover ? ", עם תמונה" : ""}. הקישור לאתר מופיע תמיד בתחתית הכרטיס.`;
    },
    handlers: {
      "songcard.set": (params) => {
        const patch: Partial<CardFields> = {};
        const done: string[] = [];
        for (const key of ["title", "artist", "key", "chords"] as const) {
          if (typeof params[key] === "string") patch[key] = params[key] as string;
        }
        if (params.bpm !== undefined) {
          const bpm = bpmValue(Number(params.bpm));
          if (bpm === null) return { ok: false, message: "קצב לא תקין (20–400)" };
          patch.bpm = String(bpm);
        }
        if (params.theme !== undefined) {
          if (!isTheme(params.theme)) return { ok: false, message: "עיצוב לא מוכר" };
          patch.theme = params.theme;
        }
        if (params.size !== undefined) {
          if (!isSize(params.size)) return { ok: false, message: "גודל לא מוכר" };
          patch.size = params.size;
        }
        if (typeof params.hue === "number") patch.hue = normalizeHue(params.hue);
        if (!Object.keys(patch).length) return { ok: false, message: "לא צוין מה לשנות" };
        if (patch.title !== undefined) done.push(`שם: ${patch.title}`);
        if (patch.artist !== undefined) done.push(`אמן: ${patch.artist}`);
        if (patch.key !== undefined) done.push(`סולם: ${patch.key}`);
        if (patch.bpm !== undefined) done.push(`קצב: ${patch.bpm}`);
        if (patch.chords !== undefined) {
          const parsed = parseChords(patch.chords);
          done.push(`אקורדים: ${parsed.chords.join(" ") || "אין"}${parsed.invalid.length ? ` (לא זוהו: ${parsed.invalid.join(", ")})` : ""}`);
        }
        if (patch.theme) done.push(`עיצוב: ${CARD_THEMES.find((item) => item.id === patch.theme)?.label}`);
        if (patch.size) done.push(`גודל: ${CARD_SIZES.find((item) => item.id === patch.size)?.label}`);
        if (patch.hue !== undefined) done.push(`צבע: ${patch.hue}`);
        update(patch);
        return { ok: true, message: `הכרטיס עודכן — ${done.join(", ")}` };
      },
      "songcard.download": async () => {
        const file = await download();
        return file ? { ok: true, message: `${file.name} ירד` } : { ok: false, message: "לא הצלחנו ליצור את התמונה" };
      },
      "songcard.share": async () => {
        const result = await shareImage();
        return result.ok ? result : { ...result, data: { text: share.text, url: share.url } };
      },
    },
  });

  const { width, height } = CARD_DIMENSIONS[fields.size];

  return (
    <section className="tool-body songcard-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Share2 size={26} />
        </span>
        <div>
          <h1>כרטיס שיר לשיתוף</h1>
          <p>ממלאים שם, אמן, סולם ואקורדים ומקבלים תמונה מעוצבת לפוסט או לסטורי — עם קישור לאתר — להורדה או לשליחה בוואטסאפ.</p>
        </div>
      </div>

      <div className="songcard-layout">
        <div className="songcard-preview-column">
          <div className="songcard-preview" data-size={fields.size}>
            <canvas
              ref={canvasRef}
              className="songcard-canvas"
              width={width}
              height={height}
              role="img"
              aria-label={`תצוגה מקדימה של הכרטיס: ${fields.title || "שיר ללא שם"}`}
            />
          </div>

          <div className="download-buttons songcard-actions">
            <button type="button" onClick={() => void download()}>
              <Download size={20} />
              <span>
                הורדת התמונה
                <small>
                  <bdi dir="ltr">PNG · {width}×{height}</bdi>
                </small>
              </span>
            </button>
            {SHARE_PROBE && (
              <button
                type="button"
                className="share-button"
                onClick={() =>
                  void shareImage().then((result) => setStatus(result.message === "השיתוף בוטל" ? null : { tone: result.ok ? "ok" : "error", text: result.message }))
                }
              >
                <Share2 size={20} />
                <span>
                  שיתוף התמונה
                  <small>עם הקישור לאתר</small>
                </span>
              </button>
            )}
          </div>
          {status && (
            <p className={status.tone === "error" ? "error-message" : "songcard-status"} role="status">
              {status.text}
            </p>
          )}

          <div className="settings-panel songcard-send">
            <div className="settings-title">
              <Share2 size={17} /> שליחת קישור עם תיאור השיר
            </div>
            <p className="songcard-send-note">הטקסט כולל את פרטי השיר ואת הקישור לאתר. את התמונה מצרפים מההורדה.</p>
            <ShareTargetButtons url={share.url} text={share.body} title={share.title} />
            <button type="button" className={`secondary-button compact songcard-copy ${copied ? "is-on" : ""}`} onClick={() => void copyText()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "הטקסט הועתק" : "העתקת הטקסט עם הקישור"}
            </button>
          </div>
        </div>

        <div className="songcard-form">
          <div className="settings-panel">
            <div className="settings-title">
              פרטי השיר
              <em>
                <button type="button" className="link-button" onClick={() => void openImports()} aria-expanded={showImports}>
                  <FolderOpen size={14} /> ייבוא משיר שמור
                </button>
              </em>
            </div>
            {showImports && (
              <div className="songcard-imports">
                {imports === null && <p className="table-footnote">טוען…</p>}
                {imports?.length === 0 && <p className="table-footnote">אין עדיין שירים שמורים. שירים מהשירון וניתוחי סולם וקצב יופיעו כאן.</p>}
                {imports && imports.length > 0 && (
                  <div className="songcard-import-list" role="list">
                    {imports.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="listitem"
                        className="chip-toggle"
                        onClick={() => {
                          update(item.apply);
                          setShowImports(false);
                        }}
                        title={item.kind === "song" ? "שם ואקורדים מהשירון" : "סולם וקצב מהניתוח"}
                      >
                        <span className="songcard-import-kind">{item.kind === "song" ? "שירון" : "ניתוח"}</span>
                        <span dir="auto">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="settings-grid songcard-grid">
              <label className="setting-field songcard-wide">
                <span>שם השיר</span>
                <input type="text" dir="auto" value={fields.title} maxLength={LIMITS.title} placeholder="למשל: ירושלים של זהב" onChange={(event) => update({ title: event.target.value })} />
              </label>
              <label className="setting-field songcard-wide">
                <span>אמן</span>
                <input type="text" dir="auto" value={fields.artist} maxLength={LIMITS.artist} placeholder="מי שר או כתב" onChange={(event) => update({ artist: event.target.value })} />
              </label>
              <label className="setting-field">
                <span>סולם</span>
                <input type="text" dir="ltr" value={fields.key} maxLength={LIMITS.key} placeholder="Am" onChange={(event) => update({ key: event.target.value })} />
              </label>
              <label className="setting-field">
                <span>קצב (BPM)</span>
                <input type="number" inputMode="numeric" min={20} max={400} value={fields.bpm} placeholder="120" onChange={(event) => update({ bpm: event.target.value })} />
              </label>
              <label className="setting-field">
                <span>משקל</span>
                <select value={fields.meter} onChange={(event) => update({ meter: event.target.value })}>
                  <option value="">בלי</option>
                  {METERS.map((meter) => (
                    <option key={meter} value={meter}>
                      {meter}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-field songcard-wide">
                <span>אקורדים</span>
                <input type="text" dir="ltr" value={fields.chords} maxLength={LIMITS.chords} placeholder="Am F C G" onChange={(event) => update({ chords: event.target.value })} spellCheck={false} />
                {chords.length > 0 && (
                  <div className="songcard-chips" dir="ltr" aria-label="האקורדים שזוהו">
                    {chords.map((chord, index) => (
                      <span key={`${chord}-${index}`} className="songcard-chip">
                        {chord}
                      </span>
                    ))}
                  </div>
                )}
                {invalid.length > 0 ? <small className="songcard-warning">לא זוהו כאקורדים: {invalid.join(", ")}</small> : <small>מפרידים ברווח. אפשר גם ♯ ו־♭.</small>}
              </label>
              <label className="checkbox-field songcard-wide">
                <input type="checkbox" checked={fields.diagrams} onChange={(event) => update({ diagrams: event.target.checked })} />
                <span>להציג אחיזות גיטרה של האקורדים</span>
              </label>
              <label className="setting-field songcard-wide">
                <span>
                  שורה קצרה <b>{fields.note.length}/{LIMITS.note}</b>
                </span>
                <input type="text" dir="auto" value={fields.note} maxLength={LIMITS.note} placeholder="מה מיוחד בשיר, למי הוא מוקדש…" onChange={(event) => update({ note: event.target.value })} />
              </label>
              <div className="setting-field songcard-wide">
                <span>תמונת עטיפה (לא חובה)</span>
                <div className="songcard-cover-row">
                  <input ref={fileRef} type="file" accept="image/*" className="songcard-file" onChange={(event) => {
                    void pickCover(event.target.files?.[0]);
                    event.target.value = "";
                  }} aria-label="בחירת תמונת עטיפה" />
                  <button type="button" className="secondary-button compact" onClick={() => fileRef.current?.click()}>
                    <ImagePlus size={16} /> {coverUrl ? "החלפת תמונה" : "בחירת תמונה"}
                  </button>
                  {coverUrl && (
                    <>
                      <img className="songcard-cover-thumb" src={coverUrl} alt="תמונת העטיפה שנבחרה" />
                      <button type="button" className="secondary-button compact is-danger" onClick={() => setCoverUrl(null)}>
                        <Trash2 size={16} /> הסרה
                      </button>
                    </>
                  )}
                </div>
                <small>בעיצוב „תקליט” התמונה מופיעה במרכז התקליט.</small>
              </div>
            </div>
          </div>

          <div className="settings-panel" style={{ "--accent-hue": fields.hue } as CSSProperties}>
            <div className="settings-title">עיצוב</div>
            <div className="settings-grid songcard-grid">
              <div className="setting-field songcard-wide">
                <span>סגנון</span>
                <div className="segmented-control wrap" role="group" aria-label="סגנון הכרטיס">
                  {CARD_THEMES.map((theme) => (
                    <button key={theme.id} type="button" className={fields.theme === theme.id ? "active" : ""} aria-pressed={fields.theme === theme.id} onClick={() => update({ theme: theme.id })}>
                      {theme.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-field songcard-wide">
                <span>גודל</span>
                <div className="segmented-control" role="group" aria-label="גודל הכרטיס">
                  {CARD_SIZES.map((size) => (
                    <button key={size.id} type="button" className={fields.size === size.id ? "active" : ""} aria-pressed={fields.size === size.id} onClick={() => update({ size: size.id })}>
                      {size.label} <small className="songcard-size-hint" dir="ltr">{size.hint}</small>
                    </button>
                  ))}
                </div>
              </div>
              <label className="setting-field songcard-wide">
                <span>
                  צבע <b className="songcard-swatch" style={{ background: cardPalette(fields.theme, fields.hue).background[0] }} aria-hidden="true" />
                </span>
                <input type="range" className="songcard-hue" min={0} max={359} value={fields.hue} onChange={(event) => update({ hue: Number(event.target.value) })} aria-label="גוון הכרטיס" />
              </label>
            </div>
            <p className="songcard-link-note">
              <Link2 size={15} aria-hidden="true" />
              בתחתית כל כרטיס מופיעים שם האתר, הקישור אליו וקוד QR — כדי שמי שרואה את התמונה יוכל להגיע לכלים.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
