/**
 * Finding the good bit of a song.
 *
 * Ported from the standalone ringtone site, where it is what makes the tool
 * worth using: nobody wants to scrub through four minutes of waveform to find
 * the hook. The idea is that a chorus is the passage that comes back — so the
 * song is reduced to a sequence of short feature vectors and searched for the
 * pair of well-separated stretches that resemble each other most, with a
 * nudge towards the louder of the two.
 *
 * The verse and the instrumental fall out of the same features: a verse is an
 * early passage that is quiet and unlike the rest of the song, and an
 * instrumental is a stretch where the timbre stops changing.
 *
 * On top of that sits the boundary search, which is the other half of a
 * ringtone sounding finished rather than chopped: it slides the cut to the
 * nearest dip in level, so the clip does not start or end mid-word.
 */

export type SongSections = {
  /** Seconds into the song. */
  chorus: number;
  verse: number;
  instrumental: number;
  /** 0..1 — how convincing the repetition was. */
  confidence: number;
};

/**
 * Bins of the DFT, spaced roughly logarithmically, that stand in for a
 * spectrum. A full transform per frame would be wasted here: the comparison
 * only needs to know whether two moments have a similar tone colour.
 */
const BANDS = [2, 3, 5, 7, 10, 14, 19, 26, 35, 47, 62, 82, 108];
const WINDOW_SIZE = 256;
/** Every fourth sample, so a 256-point window covers a wider span cheaply. */
const STRIDE = 4;

type Features = { vectors: number[][]; hop: number; frames: number };

function extractFeatures(buffer: AudioBuffer): Features {
  const rate = buffer.sampleRate;
  const source = buffer.getChannelData(0);
  const duration = buffer.duration;
  const hop = Math.max(0.8, Math.min(1.4, duration / 180));
  const span = Math.min(5.5, Math.max(3.2, duration * 0.06));
  const frames = Math.max(1, Math.floor((duration - span) / hop) + 1);
  const sampleRate = rate / STRIDE;
  const vectors: number[][] = [];

  for (let frame = 0; frame < frames; frame += 1) {
    const at = Math.min(
      source.length - WINDOW_SIZE * STRIDE,
      Math.max(
        0,
        Math.floor((frame * hop + (span - WINDOW_SIZE * STRIDE / sampleRate) / 2) * rate),
      ),
    );
    const spectrum: number[] = [];
    for (const band of BANDS) {
      let re = 0;
      let im = 0;
      for (let index = 0; index < WINDOW_SIZE; index += 1) {
        const sample = source[at + index * STRIDE] ?? 0;
        const angle = (2 * Math.PI * band * index) / WINDOW_SIZE;
        re += sample * Math.cos(angle);
        im -= sample * Math.sin(angle);
      }
      spectrum.push(Math.log1p(re * re + im * im));
    }

    let sumSquares = 0;
    let crossings = 0;
    let last = source[at] ?? 0;
    for (let index = 0; index < WINDOW_SIZE; index += 1) {
      const sample = source[at + index * STRIDE] ?? 0;
      sumSquares += sample * sample;
      if (sample >= 0 !== last >= 0) crossings += 1;
      last = sample;
    }

    const norm = Math.hypot(...spectrum) || 1;
    vectors.push([
      Math.log1p(Math.sqrt(sumSquares / WINDOW_SIZE) * 18),
      crossings / WINDOW_SIZE,
      ...spectrum.map((value) => value / norm),
    ]);
  }

  return { vectors, hop, frames };
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return dot / Math.sqrt(normA * normB || 1);
}

/**
 * Picks a likely chorus, verse and instrumental passage.
 *
 * `clipLength` is the length of the ringtone being cut, and only serves to
 * keep every suggestion far enough from the end of the song to fit.
 */
export function analyseStructure(
  buffer: AudioBuffer,
  clipLength: number,
): SongSections {
  const duration = buffer.duration;
  const { vectors, hop, frames } = extractFeatures(buffer);
  const cap = (frame: number) =>
    Math.max(0, Math.min(frame * hop, Math.max(0, duration - clipLength)));

  if (frames < 4) {
    return { chorus: 0, verse: 0, instrumental: 0, confidence: 0 };
  }

  const energy = vectors.map((vector) => vector[0]);
  const mean = energy.reduce((total, value) => total + value, 0) / energy.length;
  const peak = Math.max(...energy, mean + 0.001);
  const window = Math.max(5, Math.round(Math.min(14, duration * 0.12) / hop));
  // Two passages have to be at least sixteen seconds apart to count as a
  // repetition rather than the same moment seen twice.
  const gap = Math.max(window + 3, Math.round(16 / hop));

  let best = { score: -1, a: 0, b: 0 };
  for (let a = Math.max(1, Math.round(12 / hop)); a + window < frames; a += 1) {
    for (let b = a + gap; b + window < frames; b += 1) {
      let similarity = 0;
      for (let step = 0; step < window; step += 1) {
        similarity += cosine(vectors[a + step], vectors[b + step]);
      }
      similarity /= window;
      const loudness = Math.min(
        1,
        ((energy[a] + energy[b]) / 2 - mean) / Math.max(0.001, peak - mean),
      );
      const score = similarity * 0.8 + loudness * 0.2;
      if (score > best.score) best = { score, a, b };
    }
  }

  const chorusFrame =
    best.score < 0
      ? Math.round(frames * 0.38)
      : energy[best.a] >= energy[best.b]
        ? best.a
        : best.b;

  // The verse: early, quiet, and not much like anything else in the song.
  let verseFrame = 0;
  let verseScore = Infinity;
  for (
    let frame = Math.max(1, Math.round(8 / hop));
    frame < Math.max(2, chorusFrame - window);
    frame += 1
  ) {
    let similarity = 0;
    let count = 0;
    const step = Math.max(3, Math.round(8 / hop));
    for (let other = 0; other < frames; other += step) {
      if (Math.abs(other - frame) <= window) continue;
      similarity += cosine(vectors[frame], vectors[other]);
      count += 1;
    }
    const score = energy[frame] * 0.65 + (similarity / Math.max(1, count)) * 0.35;
    if (score < verseScore) {
      verseScore = score;
      verseFrame = frame;
    }
  }

  // The instrumental: the stretch where the timbre stops moving about.
  let instrumentalFrame = Math.round(frames * 0.65);
  let instrumentalScore = Infinity;
  for (let frame = Math.max(1, Math.round(frames * 0.35)); frame < frames; frame += 1) {
    const brightness = vectors[frame]
      .slice(2)
      .reduce((total, value, index) => total + value * (index + 1), 0);
    const change = frame ? 1 - cosine(vectors[frame], vectors[frame - 1]) : 1;
    const score =
      change * 0.58 + brightness * 0.22 + Math.abs(energy[frame] - mean) * 0.2;
    if (score < instrumentalScore) {
      instrumentalScore = score;
      instrumentalFrame = frame;
    }
  }

  return {
    chorus: cap(chorusFrame),
    verse: cap(verseFrame),
    instrumental: cap(instrumentalFrame),
    confidence: Math.max(0, Math.min(1, (best.score - 0.35) / 0.55)),
  };
}

/** Loudness in a tenth of a second around `at`, used to spot the quiet bits. */
function localLevel(buffer: AudioBuffer, at: number) {
  const channel = buffer.getChannelData(0);
  const centre = Math.floor(at * buffer.sampleRate);
  const radius = Math.max(64, Math.floor(buffer.sampleRate * 0.09));
  let sumSquares = 0;
  let count = 0;
  for (
    let index = Math.max(0, centre - radius);
    index < Math.min(channel.length, centre + radius);
    index += 4
  ) {
    sumSquares += channel[index] * channel[index];
    count += 1;
  }
  return Math.sqrt(sumSquares / Math.max(1, count));
}

/**
 * Slides `target` to the quietest moment within the window around it, so a cut
 * lands in a gap between phrases rather than through the middle of one. The
 * distance term keeps it from wandering off to a rest half a verse away.
 */
export function naturalBoundary(
  buffer: AudioBuffer,
  target: number,
  before: number,
  after: number,
) {
  const from = Math.max(0.15, target + before);
  const to = Math.min(buffer.duration - 0.15, target + after);
  const scale = Math.max(0.25, Math.abs(before) + Math.abs(after));
  let best = target;
  let bestScore = Infinity;
  for (let at = from; at <= to; at += 0.05) {
    const quiet = localLevel(buffer, at);
    const distance = Math.abs(at - target) / scale;
    const score = quiet * (1 + distance * 0.35) + distance * 0.012;
    if (score < bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return Math.max(0, Math.min(best, buffer.duration));
}

/**
 * Moves both ends of a selection to the nearest natural pause. The start is
 * allowed to move back further than forward, because a clip that begins
 * slightly early sounds better than one that clips the first syllable.
 */
export function snapToPhrase(
  buffer: AudioBuffer,
  start: number,
  end: number,
  minimumLength = 10,
) {
  const snappedStart = naturalBoundary(buffer, start, -5, 2);
  let snappedEnd = naturalBoundary(buffer, end, -2, 6);
  if (snappedEnd - snappedStart < minimumLength) {
    snappedEnd = Math.min(
      buffer.duration,
      snappedStart + Math.max(minimumLength + 5, end - start),
    );
  }
  return { start: snappedStart, end: snappedEnd };
}
