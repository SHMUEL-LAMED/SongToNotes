import { safeFilename } from "./export";

/**
 * The drawing side of the song visualizer. Everything here is either pure
 * maths (bar layout, log-spaced binning, smoothing, colour ramps, sizes,
 * file naming) or a function that paints one frame onto a 2D context from
 * values it is handed. Nothing reaches for the audio graph or React, so the
 * same frame is produced by the live preview and by the recording, and the
 * maths can be tested without a browser.
 */

export type VisualizerStyle = "bars" | "wave" | "circle" | "particles";
export type VisualizerAspect = "square" | "portrait" | "landscape";
export type VisualizerBackground = "gradient" | "dark" | "image";

export const STYLES: VisualizerStyle[] = ["bars", "wave", "circle", "particles"];
export const ASPECTS: VisualizerAspect[] = ["square", "portrait", "landscape"];
export const BACKGROUNDS: VisualizerBackground[] = ["gradient", "dark", "image"];

/** The longest clip a video is recorded from. Recording runs in real time, so this is also the longest wait. */
export const MAX_REGION_SECONDS = 180;
export const DEFAULT_REGION_SECONDS = 30;
export const MIN_REGION_SECONDS = 1;

export const WATERMARK_NAME = "כלי מוזיקה";
export const WATERMARK_URL = "shmuel-lamed.github.io/SongToNotes";

/** Output sizes: the ones the social networks crop to without letterboxing. */
export function aspectSize(aspect: VisualizerAspect): { width: number; height: number } {
  switch (aspect) {
    case "portrait":
      return { width: 1080, height: 1920 };
    case "landscape":
      return { width: 1920, height: 1080 };
    default:
      return { width: 1080, height: 1080 };
  }
}

export function isStyle(value: unknown): value is VisualizerStyle {
  return typeof value === "string" && (STYLES as string[]).includes(value);
}
export function isAspect(value: unknown): value is VisualizerAspect {
  return typeof value === "string" && (ASPECTS as string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Region                                                               */
/* ------------------------------------------------------------------ */

export type Region = { start: number; end: number };

export function defaultRegion(duration: number): Region {
  return { start: 0, end: Math.max(0, Math.min(duration, DEFAULT_REGION_SECONDS)) };
}

/**
 * Keeps a region inside the file and within the recording limits. A region
 * that is too long keeps its start and loses its tail, which is what someone
 * dragging the end handle past the limit expects to see.
 */
export function clampRegion(region: Region, duration: number, max = MAX_REGION_SECONDS, min = MIN_REGION_SECONDS): Region {
  const floor = Math.min(min, duration);
  const start = Math.max(0, Math.min(region.start, Math.max(0, duration - floor)));
  let end = Math.max(start + floor, Math.min(region.end, duration));
  if (end - start > max) end = start + max;
  return { start, end };
}

/** "30 שניות", "2:05 דקות" — the length as it is said, for the render button. */
export function describeLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return total === 1 ? "שנייה אחת" : `${total} שניות`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (rest === 0) return minutes === 1 ? "דקה אחת" : `${minutes} דקות`;
  return `${minutes}:${String(rest).padStart(2, "0")} דקות`;
}

/* ------------------------------------------------------------------ */
/* Spectrum → bars                                                      */
/* ------------------------------------------------------------------ */

/** A half-open range of FFT bins, [start, end). */
export type BinRange = [number, number];

/**
 * Log-spaced bands over the spectrum. Hearing is logarithmic in pitch, so
 * equal-width bins would give the top octave (a quarter of the spectrum's
 * bins but little of the music) most of the bars and squeeze the bass and
 * the voice into a handful. Each band is at least one bin wide so the lowest
 * bars, where the bins are coarser than the bands, never read nothing.
 */
export function logBinRanges(
  bars: number,
  fftSize: number,
  sampleRate: number,
  minHz = 35,
  maxHz = 14_000,
): BinRange[] {
  const binCount = fftSize / 2;
  const binHz = sampleRate / fftSize;
  const top = Math.min(maxHz, sampleRate / 2);
  const ranges: BinRange[] = [];
  let previousEnd = Math.max(1, Math.floor(minHz / binHz));
  for (let index = 0; index < bars; index += 1) {
    const high = minHz * Math.pow(top / minHz, (index + 1) / bars);
    const start = Math.min(previousEnd, binCount - 1);
    const end = Math.min(binCount, Math.max(start + 1, Math.round(high / binHz)));
    ranges.push([start, end]);
    previousEnd = end;
  }
  return ranges;
}

/**
 * Collapses a spectrum (the analyser's 0..255 bytes, or anything with a
 * known full scale) into one 0..1 level per band. The band's peak and mean
 * are blended: the peak alone flickers on single partials, the mean alone
 * flattens a wide band into mush. `tilt` lifts the upper bands a little,
 * because music's energy falls with frequency and untreated the right-hand
 * bars would barely move.
 */
export function binLevels(
  spectrum: ArrayLike<number>,
  ranges: BinRange[],
  out: Float32Array = new Float32Array(ranges.length),
  fullScale = 255,
  tilt = 0.3,
): Float32Array {
  const last = Math.max(1, ranges.length - 1);
  for (let index = 0; index < ranges.length; index += 1) {
    const [start, end] = ranges[index];
    let sum = 0;
    let peak = 0;
    let count = 0;
    for (let bin = start; bin < end && bin < spectrum.length; bin += 1) {
      const value = spectrum[bin];
      sum += value;
      if (value > peak) peak = value;
      count += 1;
    }
    const mean = count ? sum / count : 0;
    const level = ((peak + mean) / 2 / fullScale) * (1 + (tilt * index) / last);
    out[index] = Math.max(0, Math.min(1, level));
  }
  return out;
}

/**
 * Fast rise, slow fall — the way a VU meter moves. Rising instantly keeps
 * the drums punchy, falling slowly keeps the bars from jittering between
 * frames. `dt` makes the rates independent of the display's refresh rate:
 * the factors are the fraction covered in one 60 Hz frame.
 */
export function smoothLevels(
  current: Float32Array,
  target: ArrayLike<number>,
  attack = 0.65,
  release = 0.14,
  dt = 1 / 60,
): Float32Array {
  const frames = Math.max(0, dt * 60);
  const up = 1 - Math.pow(1 - attack, frames);
  const down = 1 - Math.pow(1 - release, frames);
  for (let index = 0; index < current.length; index += 1) {
    const goal = target[index] ?? 0;
    const value = current[index];
    current[index] = value + (goal - value) * (goal > value ? up : down);
  }
  return current;
}

/** The average of the lowest bands: what the kick drum and bass line push. */
export function bassLevel(levels: ArrayLike<number>, fraction = 0.12): number {
  const count = Math.max(1, Math.round(levels.length * fraction));
  let sum = 0;
  for (let index = 0; index < count && index < levels.length; index += 1) sum += levels[index];
  return Math.min(1, sum / count);
}

/**
 * FFT magnitudes (unnormalised, as `Fft.magnitudes` writes them) mapped to
 * the analyser's 0..255 decibel scale, so a still frame computed from the
 * file looks like the frames the live analyser produces.
 */
export function magnitudesToBytes(
  magnitudes: ArrayLike<number>,
  fftSize: number,
  out: Uint8Array,
  minDecibels: number,
  maxDecibels: number,
): Uint8Array {
  const range = maxDecibels - minDecibels;
  for (let index = 0; index < out.length; index += 1) {
    const magnitude = (magnitudes[index] ?? 0) / fftSize;
    const db = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity;
    const scaled = ((db - minDecibels) / range) * 255;
    out[index] = Math.max(0, Math.min(255, Math.round(Number.isFinite(scaled) ? scaled : 0)));
  }
  return out;
}

/** How many bands each style draws, per side where the style is mirrored. */
export function barCount(style: VisualizerStyle, aspect: VisualizerAspect): number {
  if (style === "bars") return aspect === "landscape" ? 56 : 36;
  if (style === "circle") return 60;
  return 32;
}

/**
 * Positions for mirrored bars: the bass sits in the middle and the treble
 * runs out to both edges, so the picture is symmetric the way a logo is.
 * Returns the width of one bar and the distance between bar centres.
 */
export function mirroredBarLayout(barsPerSide: number, areaWidth: number, gapRatio = 0.35) {
  const step = areaWidth / (barsPerSide * 2);
  const barWidth = Math.max(1, step * (1 - gapRatio));
  return { step, barWidth };
}

/* ------------------------------------------------------------------ */
/* Colour                                                               */
/* ------------------------------------------------------------------ */

export function normaliseHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  return ((Math.round(hue) % 360) + 360) % 360;
}

/**
 * A colour along the style's ramp. `t` runs 0..1 (bass to treble, or the
 * inside of the circle to the outside) and walks the hue 70° while getting
 * a little lighter, which reads as one family rather than a rainbow.
 */
export function rampColor(hue: number, t: number, alpha = 1): string {
  const clamped = Math.max(0, Math.min(1, t));
  const h = normaliseHue(hue + clamped * 70);
  const l = Math.round(58 + clamped * 12);
  return `hsla(${h}, 92%, ${l}%, ${Number(alpha.toFixed(3))})`;
}

/** The two ends of the background gradient for a hue: deep, and deeper still. */
export function backgroundStops(hue: number): [string, string] {
  return [`hsl(${normaliseHue(hue)}, 62%, 20%)`, `hsl(${normaliseHue(hue + 40)}, 70%, 7%)`];
}

/* ------------------------------------------------------------------ */
/* Recording format and file name                                       */
/* ------------------------------------------------------------------ */

export type RecordingType = { mimeType: string; extension: "mp4" | "webm" };

/**
 * In order of preference. MP4 plays everywhere a video is shared (WhatsApp
 * and Instagram both choke on WebM from a phone), so it wins wherever the
 * browser can record it — Safari, and recent Chrome. Everything else gets
 * WebM, VP9 before VP8 for the smaller file at the same quality.
 */
export const RECORDING_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1,opus",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function extensionForMime(mimeType: string): "mp4" | "webm" {
  return /^video\/mp4/i.test(mimeType) ? "mp4" : "webm";
}

/** The container part of a MIME type, which is what the finished Blob is labelled with. */
export function containerMime(mimeType: string): string {
  return mimeType.split(";")[0].trim() || "video/webm";
}

export function chooseRecordingType(isTypeSupported: (type: string) => boolean): RecordingType | null {
  for (const candidate of RECORDING_CANDIDATES) {
    let supported = false;
    try {
      supported = isTypeSupported(candidate);
    } catch {
      supported = false;
    }
    if (supported) return { mimeType: candidate, extension: extensionForMime(candidate) };
  }
  return null;
}

const ASPECT_FILE_LABEL: Record<VisualizerAspect, string> = {
  square: "ריבוע",
  portrait: "סטורי",
  landscape: "רחב",
};

/**
 * "שם-השיר-סרטון-סטורי.mp4". The title the visitor typed wins over the file
 * name, and both go through the site's one filename cleaner so Hebrew
 * survives and slashes or emoji do not.
 */
export function videoFilename(title: string, sourceName: string, aspect: VisualizerAspect, extension: string): string {
  const base = safeFilename(title.trim() || sourceName || "שיר");
  return `${base}-סרטון-${ASPECT_FILE_LABEL[aspect]}.${extension}`;
}

/** The file's name without its extension: the title a song starts with. */
export function titleFromFilename(name: string): string {
  return name.replace(/\.[^/.]+$/, "").replace(/[_]+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* Text                                                                 */
/* ------------------------------------------------------------------ */

const RTL_CHARS = /[֐-׿؀-ۿיִ-ﭏ]/;

/** Whether a string should be laid out right to left on the canvas. */
export function isRtl(text: string): boolean {
  return RTL_CHARS.test(text);
}

/**
 * The largest font size (between min and max) at which the text fits the
 * width; below the minimum the text is cut with an ellipsis instead of
 * spilling off the frame. `measure` returns the text's width at a size.
 */
export function fitText(
  text: string,
  measure: (text: string, size: number) => number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
): { text: string; size: number } {
  let size = maxSize;
  while (size > minSize && measure(text, size) > maxWidth) size = Math.max(minSize, Math.floor(size * 0.92));
  if (measure(text, size) <= maxWidth) return { text, size };
  const characters = Array.from(text);
  while (characters.length > 1 && measure(`${characters.join("")}…`, size) > maxWidth) characters.pop();
  return { text: `${characters.join("").trimEnd()}…`, size };
}

/* ------------------------------------------------------------------ */
/* Particles                                                            */
/* ------------------------------------------------------------------ */

export type Particle = {
  angle: number;
  /** Distance from the centre, 0..1 of the way to the edge. */
  radius: number;
  speed: number;
  size: number;
  /** 0..1, where along the colour ramp it sits. */
  tone: number;
};

/** A small seeded generator, so a still frame looks the same every time it is drawn. */
export function seededRandom(seed = 1): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function spawn(random: () => number, anywhere: boolean): Particle {
  return {
    angle: random() * Math.PI * 2,
    radius: anywhere ? random() : random() * 0.08,
    speed: 0.05 + random() * 0.12,
    size: 0.6 + random() * 1.6,
    tone: random(),
  };
}

export function createParticles(count: number, random: () => number): Particle[] {
  return Array.from({ length: count }, () => spawn(random, true));
}

/**
 * Moves every particle outwards. The bass multiplies the speed — that is
 * what makes the cloud breathe with the kick — and a particle that leaves
 * the frame is reborn near the centre, so the count never changes.
 */
export function stepParticles(particles: Particle[], dt: number, energy: number, random: () => number): Particle[] {
  const boost = 0.25 + energy * energy * 3.2;
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    particle.radius += particle.speed * boost * dt;
    particle.angle += dt * 0.08 * (index % 2 ? 1 : -1);
    if (particle.radius > 1) particles[index] = spawn(random, false);
  }
  return particles;
}

/* ------------------------------------------------------------------ */
/* Layout                                                               */
/* ------------------------------------------------------------------ */

export type Box = { x: number; y: number; width: number; height: number };

export type SceneLayout = {
  /** Where the style draws. */
  area: Box;
  /** The cover picture, when there is one and the style does not use it itself. */
  cover: Box | null;
  /** The centre and radius of the circle style's disc. */
  disc: { x: number; y: number; radius: number };
  titleY: number;
  artistY: number;
  titleSize: number;
  artistSize: number;
  textWidth: number;
  watermarkY: number;
  watermarkSize: number;
};

/**
 * Where everything goes on each canvas. The numbers are laid out by eye for
 * each of the three sizes rather than derived from one formula: a story has
 * room for a large cover above the text, a wide frame does not, and a single
 * proportional rule made one of the three look wrong whichever way it leant.
 */
export function sceneLayout(aspect: VisualizerAspect, style: VisualizerStyle, hasCover: boolean): SceneLayout {
  const { width, height } = aspectSize(aspect);
  const margin = aspect === "landscape" ? 110 : 80;
  const textWidth = width - margin * 2;
  const watermarkSize = aspect === "portrait" ? 30 : 26;
  const watermarkY = height - (aspect === "portrait" ? 70 : 44);

  if (style === "circle") {
    const radius = aspect === "portrait" ? 250 : aspect === "square" ? 190 : 185;
    const y = aspect === "portrait" ? 800 : aspect === "square" ? 430 : 410;
    const titleY = aspect === "portrait" ? 1380 : aspect === "square" ? 830 : 820;
    const titleSize = aspect === "portrait" ? 80 : 64;
    return {
      area: { x: margin, y: y - radius * 2, width: textWidth, height: radius * 4 },
      cover: null,
      disc: { x: width / 2, y, radius },
      titleY,
      artistY: titleY + titleSize * 1.05,
      titleSize,
      artistSize: Math.round(titleSize * 0.6),
      textWidth,
      watermarkY,
      watermarkSize,
    };
  }

  if (aspect === "portrait") {
    const coverSize = 600;
    const cover = hasCover ? { x: (width - coverSize) / 2, y: 260, width: coverSize, height: coverSize } : null;
    const titleY = hasCover ? 1010 : 470;
    const areaTop = hasCover ? 1170 : 640;
    return {
      area: { x: margin, y: areaTop, width: textWidth, height: 1700 - areaTop },
      cover,
      disc: { x: width / 2, y: areaTop + (1700 - areaTop) / 2, radius: 170 },
      titleY,
      artistY: titleY + 86,
      titleSize: 84,
      artistSize: 50,
      textWidth,
      watermarkY,
      watermarkSize,
    };
  }

  if (aspect === "landscape") {
    // Cover on the right, text beside it on the left of it — the reading
    // order of a Hebrew page — and the visual across the lower half.
    const coverSize = 360;
    const cover = hasCover ? { x: width - margin - coverSize, y: 90, width: coverSize, height: coverSize } : null;
    const textRight = hasCover ? width - margin - coverSize - 60 : width - margin;
    const textLeft = margin;
    const areaTop = hasCover ? 500 : 380;
    return {
      area: { x: margin, y: areaTop, width: textWidth, height: 960 - areaTop },
      cover,
      disc: { x: width / 2, y: areaTop + (960 - areaTop) / 2, radius: 150 },
      titleY: hasCover ? 240 : 190,
      artistY: hasCover ? 320 : 262,
      titleSize: 76,
      artistSize: 46,
      textWidth: textRight - textLeft,
      watermarkY,
      watermarkSize,
    };
  }

  const coverSize = 380;
  const cover = hasCover ? { x: (width - coverSize) / 2, y: 90, width: coverSize, height: coverSize } : null;
  const titleY = hasCover ? 560 : 190;
  const areaTop = hasCover ? 690 : 330;
  return {
    area: { x: margin, y: areaTop, width: textWidth, height: 980 - areaTop },
    cover,
    disc: { x: width / 2, y: areaTop + (980 - areaTop) / 2, radius: 140 },
    titleY,
    artistY: titleY + 64,
    titleSize: 66,
    artistSize: 40,
    textWidth,
    watermarkY,
    watermarkSize,
  };
}

/* ------------------------------------------------------------------ */
/* Painting                                                             */
/* ------------------------------------------------------------------ */

export type SizedImage = { image: CanvasImageSource; width: number; height: number };

export type SceneFrame = {
  aspect: VisualizerAspect;
  style: VisualizerStyle;
  hue: number;
  background: VisualizerBackground;
  /** The uploaded background, already blurred and darkened to the canvas size. */
  backgroundImage: CanvasImageSource | null;
  cover: SizedImage | null;
  title: string;
  artist: string;
  /** One 0..1 level per band, bass first. */
  levels: Float32Array;
  /** The waveform, -1..1. */
  wave: Float32Array;
  bass: number;
  /** Seconds since playback started; turns the disc and drifts the glow. */
  time: number;
  particles: Particle[];
};

export const CANVAS_FONT = '"Rubik Variable", Rubik, Heebo, "Segoe UI", system-ui, "Arial Hebrew", sans-serif';

/** Draws `image` to fill `box` without distorting it, cropping what spills over. */
export function coverFit(sourceWidth: number, sourceHeight: number, box: Box) {
  const scale = Math.max(box.width / Math.max(1, sourceWidth), box.height / Math.max(1, sourceHeight));
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

function roundedRect(ctx: CanvasRenderingContext2D, box: Box, radius: number) {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  ctx.beginPath();
  ctx.moveTo(box.x + r, box.y);
  ctx.arcTo(box.x + box.width, box.y, box.x + box.width, box.y + box.height, r);
  ctx.arcTo(box.x + box.width, box.y + box.height, box.x, box.y + box.height, r);
  ctx.arcTo(box.x, box.y + box.height, box.x, box.y, r);
  ctx.arcTo(box.x, box.y, box.x + box.width, box.y, r);
  ctx.closePath();
}

function paintBackground(ctx: CanvasRenderingContext2D, frame: SceneFrame, width: number, height: number) {
  if (frame.background === "image" && frame.backgroundImage) {
    ctx.drawImage(frame.backgroundImage, 0, 0, width, height);
  } else if (frame.background === "dark") {
    ctx.fillStyle = "#07070b";
    ctx.fillRect(0, 0, width, height);
  } else {
    const [from, to] = backgroundStops(frame.hue);
    const gradient = ctx.createLinearGradient(0, 0, width * 0.4, height);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  // A soft glow behind the visual that swells with the bass: the one piece
  // of movement that reaches the whole frame, whatever the style.
  const glow = ctx.createRadialGradient(width / 2, height * 0.55, 0, width / 2, height * 0.55, Math.max(width, height) * 0.6);
  glow.addColorStop(0, `hsla(${normaliseHue(frame.hue)}, 90%, 60%, ${0.1 + frame.bass * 0.22})`);
  glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function paintBars(ctx: CanvasRenderingContext2D, frame: SceneFrame, area: Box) {
  const count = frame.levels.length;
  const { step, barWidth } = mirroredBarLayout(count, area.width);
  const centreX = area.x + area.width / 2;
  const baseline = area.y + area.height * 0.62;
  const up = area.height * 0.6;
  const down = area.height * 0.3;
  for (let index = 0; index < count; index += 1) {
    const level = frame.levels[index];
    const barHeight = Math.max(barWidth * 0.6, level * up);
    const t = index / Math.max(1, count - 1);
    const offset = (index + 0.5) * step;
    for (const x of [centreX + offset, centreX - offset]) {
      ctx.fillStyle = rampColor(frame.hue, t, 0.95);
      roundedRect(ctx, { x: x - barWidth / 2, y: baseline - barHeight, width: barWidth, height: barHeight }, barWidth / 2);
      ctx.fill();
      // The reflection below the line, fainter and shorter: it gives the
      // bars a floor to stand on.
      ctx.fillStyle = rampColor(frame.hue, t, 0.22);
      roundedRect(ctx, { x: x - barWidth / 2, y: baseline + 6, width: barWidth, height: Math.max(barWidth * 0.4, level * down) }, barWidth / 2);
      ctx.fill();
    }
  }
}

function paintWave(ctx: CanvasRenderingContext2D, frame: SceneFrame, area: Box) {
  const points = Math.min(frame.wave.length, 600);
  if (points < 2) return;
  const midY = area.y + area.height / 2;
  const amplitude = area.height * 0.45;
  const stride = frame.wave.length / points;
  ctx.beginPath();
  for (let index = 0; index < points; index += 1) {
    // Tapering the ends to zero keeps the line from being cut off abruptly
    // at the edges of the frame.
    const taper = Math.sin((Math.PI * index) / (points - 1));
    const value = frame.wave[Math.floor(index * stride)] * taper;
    const x = area.x + (area.width * index) / (points - 1);
    const y = midY - value * amplitude;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // The glow is the same path stroked wide and faint, then narrower and
  // brighter — cheaper than shadowBlur at 1080p, and the same in every browser.
  const passes: Array<[number, number, number]> = [
    [28, 0.08, 0],
    [14, 0.16, 0.3],
    [6, 0.55, 0.6],
    [2.5, 1, 1],
  ];
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  for (const [lineWidth, alpha, t] of passes) {
    ctx.lineWidth = lineWidth + frame.bass * lineWidth * 0.6;
    ctx.strokeStyle = rampColor(frame.hue, t, alpha);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = previous;
}

function paintDisc(ctx: CanvasRenderingContext2D, frame: SceneFrame, x: number, y: number, radius: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(frame.time * 0.35);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (frame.cover) {
    const fit = coverFit(frame.cover.width, frame.cover.height, { x: -radius, y: -radius, width: radius * 2, height: radius * 2 });
    ctx.drawImage(frame.cover.image, fit.x, fit.y, fit.width, fit.height);
  } else {
    // No picture: a record, with grooves and a label in the tool's colour.
    ctx.fillStyle = "#101014";
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 2;
    for (let groove = radius * 0.42; groove < radius; groove += radius * 0.06) {
      ctx.beginPath();
      ctx.arc(0, 0, groove, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = rampColor(frame.hue, 0.2);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(radius * 0.12, -radius * 0.02, radius * 0.14, radius * 0.04);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = rampColor(frame.hue, 0.1, 0.9);
  ctx.stroke();
  ctx.fillStyle = "#07070b";
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.04, 0, Math.PI * 2);
  ctx.fill();
}

function paintCircle(ctx: CanvasRenderingContext2D, frame: SceneFrame, layout: SceneLayout) {
  const { x, y } = layout.disc;
  const radius = layout.disc.radius * (1 + frame.bass * 0.06);
  const count = frame.levels.length;
  const reach = layout.disc.radius * 0.95;
  const total = count * 2;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(4, ((Math.PI * 2 * radius) / total) * 0.55);
  for (let index = 0; index < total; index += 1) {
    // Mirrored left and right, so the bass meets itself at the top and the
    // ring is symmetric rather than having a seam.
    const band = index < count ? index : total - 1 - index;
    const level = frame.levels[band];
    const angle = -Math.PI / 2 + (Math.PI * 2 * (index + 0.5)) / total;
    const inner = radius + 14;
    const outer = inner + 6 + level * reach;
    ctx.strokeStyle = rampColor(frame.hue, band / Math.max(1, count - 1), 0.95);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  paintDisc(ctx, frame, x, y, radius);
}

function paintParticles(ctx: CanvasRenderingContext2D, frame: SceneFrame, area: Box) {
  const x = area.x + area.width / 2;
  const y = area.y + area.height / 2;
  const reach = Math.hypot(area.width, area.height) / 2;
  const orb = Math.min(area.width, area.height) * (0.12 + frame.bass * 0.1);
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(x, y, 0, x, y, orb * 2.4);
  halo.addColorStop(0, rampColor(frame.hue, 0.4, 0.55 + frame.bass * 0.35));
  halo.addColorStop(0.4, rampColor(frame.hue, 0.2, 0.2));
  halo.addColorStop(1, rampColor(frame.hue, 0, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, orb * 2.4, 0, Math.PI * 2);
  ctx.fill();
  const scale = 3 + frame.bass * 5;
  for (const particle of frame.particles) {
    const distance = particle.radius * reach;
    const px = x + Math.cos(particle.angle) * distance;
    const py = y + Math.sin(particle.angle) * distance * 0.8;
    // Fading in from the centre and out at the edge hides both the birth
    // and the respawn.
    const alpha = Math.min(1, particle.radius * 6) * (1 - particle.radius) * 0.9;
    ctx.fillStyle = rampColor(frame.hue, particle.tone, alpha);
    ctx.beginPath();
    ctx.arc(px, py, particle.size * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = previous;
}

function paintCover(ctx: CanvasRenderingContext2D, frame: SceneFrame, box: Box) {
  if (!frame.cover) return;
  const pulse = 1 + frame.bass * 0.025;
  const width = box.width * pulse;
  const height = box.height * pulse;
  const scaled = { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#000";
  roundedRect(ctx, scaled, 36);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, scaled, 36);
  ctx.clip();
  const fit = coverFit(frame.cover.width, frame.cover.height, scaled);
  ctx.drawImage(frame.cover.image, fit.x, fit.y, fit.width, fit.height);
  ctx.restore();
}

/**
 * Fitted titles, remembered between frames. Fitting a long title measures it
 * once per character it loses, and the live preview and the recording paint
 * 30–60 frames a second, which made a long title cost more than the bars.
 * The key includes the width of a sample string in the current face, so a
 * fit measured before the web font arrived is not reused after it does.
 */
const fitCache = new Map<string, { text: string; size: number }>();

/** Text drawn with the direction its script needs, so Hebrew punctuation lands where it should. */
function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  weight: number,
  color: string,
  align: CanvasTextAlign,
) {
  if (!text.trim()) return;
  ctx.direction = isRtl(text) ? "rtl" : "ltr";
  ctx.font = `${weight} ${maxSize}px ${CANVAS_FONT}`;
  const key = `${weight}|${maxSize}|${Math.round(maxWidth)}|${ctx.direction}|${ctx.measureText("אבגABC").width.toFixed(2)}|${text}`;
  let fitted = fitCache.get(key);
  if (!fitted) {
    fitted = fitText(
      text,
      (candidate, size) => {
        ctx.font = `${weight} ${size}px ${CANVAS_FONT}`;
        return ctx.measureText(candidate).width;
      },
      maxWidth,
      maxSize,
      Math.round(maxSize * 0.55),
    );
    // A handful of entries covers title and artist at every size; typing
    // makes a new key per keystroke, so the old ones are dropped wholesale.
    if (fitCache.size > 48) fitCache.clear();
    fitCache.set(key, fitted);
  }
  ctx.font = `${weight} ${fitted.size}px ${CANVAS_FONT}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(fitted.text, x, y);
}

/**
 * The site's name and address along the bottom: small, half-transparent,
 * and always there, so a video shared on its own still says where it was
 * made. The two parts are placed by hand rather than joined into one string,
 * because a Hebrew name beside a Latin URL is exactly the mix the canvas's
 * bidi handling reorders unpredictably.
 */
function paintWatermark(ctx: CanvasRenderingContext2D, width: number, layout: SceneLayout) {
  const size = layout.watermarkSize;
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${size}px ${CANVAS_FONT}`;
  ctx.direction = "rtl";
  const nameWidth = ctx.measureText(WATERMARK_NAME).width;
  ctx.font = `500 ${Math.round(size * 0.86)}px ${CANVAS_FONT}`;
  ctx.direction = "ltr";
  const urlWidth = ctx.measureText(WATERMARK_URL).width;
  const gap = size * 0.9;
  const total = nameWidth + gap + urlWidth;
  const right = width / 2 + total / 2;
  const left = width / 2 - total / 2;
  ctx.textAlign = "left";
  ctx.fillText(WATERMARK_URL, left, layout.watermarkY);
  ctx.beginPath();
  ctx.arc(left + urlWidth + gap / 2, layout.watermarkY, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 ${size}px ${CANVAS_FONT}`;
  ctx.direction = "rtl";
  // With rtl, "right" is the start of the line, which is the same edge.
  ctx.textAlign = "right";
  ctx.fillText(WATERMARK_NAME, right, layout.watermarkY);
  ctx.restore();
}

/** Paints one whole frame. */
export function drawScene(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
  const { width, height } = aspectSize(frame.aspect);
  const layout = sceneLayout(frame.aspect, frame.style, Boolean(frame.cover));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  paintBackground(ctx, frame, width, height);

  if (frame.style === "bars") paintBars(ctx, frame, layout.area);
  else if (frame.style === "wave") paintWave(ctx, frame, layout.area);
  else if (frame.style === "circle") paintCircle(ctx, frame, layout);
  else paintParticles(ctx, frame, layout.area);

  if (layout.cover) paintCover(ctx, frame, layout.cover);

  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 18;
  // In the wide frame with a cover the text block sits to the cover's left,
  // aligned to the edge that faces it; everywhere else it is centred.
  const beside = frame.aspect === "landscape" && layout.cover;
  const textX = beside ? layout.cover!.x - 60 : width / 2;
  const align: CanvasTextAlign = beside ? "right" : "center";
  paintText(ctx, frame.title, textX, layout.titleY, layout.textWidth, layout.titleSize, 800, "#ffffff", align);
  paintText(ctx, frame.artist, textX, layout.artistY, layout.textWidth, layout.artistSize, 500, "rgba(255,255,255,0.78)", align);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  paintWatermark(ctx, width, layout);
  ctx.restore();
}

/**
 * Pre-renders the uploaded background: scaled to cover the frame, blurred by
 * shrinking it hard and stretching it back (the same look as a CSS blur, and
 * unlike `ctx.filter` it works in Safari), then darkened so white text on
 * top always reads. Done once per picture and size, not per frame.
 */
export function blurredBackground(image: SizedImage, width: number, height: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = Math.max(6, Math.round(width / 60));
  small.height = Math.max(6, Math.round(height / 60));
  const smallCtx = small.getContext("2d");
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d");
  if (!smallCtx || !ctx) return output;
  smallCtx.imageSmoothingQuality = "high";
  const fit = coverFit(image.width, image.height, { x: 0, y: 0, width: small.width, height: small.height });
  smallCtx.drawImage(image.image, fit.x, fit.y, fit.width, fit.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Two stretches (tiny → medium → full) smooth away the blockiness a single
  // big bilinear stretch leaves behind.
  const middle = document.createElement("canvas");
  middle.width = small.width * 6;
  middle.height = small.height * 6;
  const middleCtx = middle.getContext("2d");
  if (middleCtx) {
    middleCtx.imageSmoothingEnabled = true;
    middleCtx.imageSmoothingQuality = "high";
    middleCtx.drawImage(small, 0, 0, middle.width, middle.height);
    ctx.drawImage(middle, 0, 0, width, height);
  } else {
    ctx.drawImage(small, 0, 0, width, height);
  }
  ctx.fillStyle = "rgba(6, 6, 12, 0.55)";
  ctx.fillRect(0, 0, width, height);
  return output;
}
