/**
 * A transcript: what was said, and when.
 *
 * The recogniser hands back the text in timed pieces; everything else here is
 * turning those pieces into the formats people paste and upload — plain text
 * for a document, SRT and VTT for a video's subtitles — and back again from
 * the personal area.
 */

export type TranscriptSegment = {
  /** Seconds from the start of the audio. `end` is null when the model lost track of it. */
  start: number;
  end: number | null;
  text: string;
};

export type Transcript = {
  segments: TranscriptSegment[];
  /** The language the recogniser worked in, as an ISO code, or null for auto. */
  language: string | null;
  /** Which model produced it. */
  model: string;
};

/** Reads segments back from a saved work, dropping anything malformed. */
export function normalizeSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): TranscriptSegment | null => {
      if (!item || typeof item !== "object") return null;
      const { start, end, text } = item as Record<string, unknown>;
      if (typeof start !== "number" || !Number.isFinite(start) || typeof text !== "string") return null;
      return {
        start: Math.max(0, start),
        end: typeof end === "number" && Number.isFinite(end) && end >= start ? end : null,
        text: text.trim(),
      };
    })
    .filter((item): item is TranscriptSegment => item !== null && item.text.length > 0);
}

/** The whole transcript as one text, a paragraph per segment. */
export function segmentsToText(segments: TranscriptSegment[]) {
  return segments.map((segment) => segment.text).join("\n");
}

/**
 * Applies edits made in a single text box back onto the segments: line `n`
 * replaces segment `n`, extra lines join the last segment, and a blank line
 * drops its segment. Timestamps are kept, which is the point of editing in
 * place rather than pasting the text elsewhere.
 */
export function textToSegments(text: string, segments: TranscriptSegment[]): TranscriptSegment[] {
  const lines = text.split("\n");
  const next: TranscriptSegment[] = [];
  lines.forEach((line, index) => {
    const source = segments[Math.min(index, segments.length - 1)];
    const clean = line.trim();
    if (!clean) return;
    if (index < segments.length || !next.length) {
      next.push({ ...(source ?? { start: 0, end: null }), text: clean });
    } else {
      const last = next[next.length - 1];
      last.text = `${last.text} ${clean}`;
    }
  });
  return next;
}

function pad(value: number, width = 2) {
  return String(value).padStart(width, "0");
}

/** 00:01:02,345 for SRT, 00:01:02.345 for VTT. */
export function formatTimestamp(seconds: number, separator: "," | "." = ",") {
  const whole = Math.max(0, seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = Math.floor(whole % 60);
  const millis = Math.round((whole - Math.floor(whole)) * 1000) % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(millis, 3)}`;
}

/** A segment with no end runs until the next one starts, or a beat after it began. */
function endOf(segments: TranscriptSegment[], index: number) {
  const segment = segments[index];
  if (segment.end !== null) return segment.end;
  const next = segments[index + 1];
  return next ? next.start : segment.start + 2;
}

export function segmentsToSrt(segments: TranscriptSegment[]) {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatTimestamp(segment.start, ",")} --> ${formatTimestamp(endOf(segments, index), ",")}\n${segment.text}\n`,
    )
    .join("\n");
}

export function segmentsToVtt(segments: TranscriptSegment[]) {
  const cues = segments.map(
    (segment, index) =>
      `${formatTimestamp(segment.start, ".")} --> ${formatTimestamp(endOf(segments, index), ".")}\n${segment.text}\n`,
  );
  return `WEBVTT\n\n${cues.join("\n")}`;
}

/** Words, the way a person counts them: runs of letters and digits. */
export function countWords(text: string) {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

export const LANGUAGES: { id: string | null; label: string }[] = [
  { id: null, label: "זיהוי אוטומטי" },
  { id: "he", label: "עברית" },
  { id: "en", label: "אנגלית" },
  { id: "ar", label: "ערבית" },
  { id: "ru", label: "רוסית" },
  { id: "fr", label: "צרפתית" },
  { id: "es", label: "ספרדית" },
  { id: "yi", label: "יידיש" },
];

export function languageLabel(id: string | null) {
  return LANGUAGES.find((item) => item.id === id)?.label ?? id ?? "זיהוי אוטומטי";
}

// ---------------------------------------------------------------------------
// Long recordings
// ---------------------------------------------------------------------------

export type SampleWindow = { start: number; end: number };

/** Loudness of a short frame, for finding the quiet moments. */
function frameRms(samples: Float32Array, from: number, to: number) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/**
 * Cuts a long recording into windows of about `windowSeconds`, each ending at
 * the quietest moment within `searchSeconds` of the mark, so a cut lands in
 * a pause between sentences rather than through a word. The recogniser sees
 * one window at a time: a two-hour lecture becomes two dozen short jobs whose
 * text arrives as each finishes, and a failure loses one window, not all.
 * A tail shorter than a third of a window is folded into the one before it.
 */
export function splitIntoWindows(
  samples: Float32Array,
  sampleRate: number,
  windowSeconds = 300,
  searchSeconds = 8,
  from = 0,
  to = samples.length,
): SampleWindow[] {
  const windowLength = Math.max(1, Math.round(windowSeconds * sampleRate));
  const search = Math.round(searchSeconds * sampleRate);
  const frame = Math.max(1, Math.round(sampleRate * 0.1));
  const first = Math.max(0, Math.min(from, samples.length));
  const last = Math.max(first, Math.min(to, samples.length));
  const windows: SampleWindow[] = [];
  let start = first;
  while (start < last) {
    const target = start + windowLength;
    if (target + windowLength / 3 >= last) {
      windows.push({ start, end: last });
      break;
    }
    let cut = target;
    let quietest = Infinity;
    const lower = Math.max(start + frame, target - search);
    const upper = Math.min(last - frame, target + search);
    for (let at = lower; at + frame <= upper; at += frame) {
      const level = frameRms(samples, at, at + frame);
      if (level < quietest) {
        quietest = level;
        cut = at + Math.floor(frame / 2);
      }
    }
    windows.push({ start, end: cut });
    start = cut;
  }
  return windows;
}
