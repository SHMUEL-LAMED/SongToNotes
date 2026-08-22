export const MODEL_SAMPLE_RATE = 22_050;

export type PreparedAudio = {
  /** Mono, 22.05 kHz — exactly what the model expects. */
  samples: Float32Array;
  /** Seconds of the source that were kept. */
  duration: number;
  /** Offset of the kept region inside the original file, in seconds. */
  startOffset: number;
  /** Full length of the decoded file, in seconds. */
  sourceDuration: number;
  /** Coarse min/max envelope of the whole file, for the waveform strip. */
  peaks: Float32Array;
};

export type TrimRange = { start: number; end: number } | null;

function getAudioContextClass() {
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function getOfflineAudioContextClass() {
  return (
    window.OfflineAudioContext ||
    (window as typeof window & {
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
    }).webkitOfflineAudioContext
  );
}

export function isAudioSupported() {
  return Boolean(getAudioContextClass() && getOfflineAudioContextClass());
}

export async function decodeAudioFile(data: ArrayBuffer): Promise<AudioBuffer> {
  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) {
    throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  }
  const context = new AudioContextClass();
  try {
    return await context.decodeAudioData(data);
  } finally {
    void context.close();
  }
}

/**
 * Builds the peak envelope used by the waveform strip. Two values per bucket
 * (min, max) so quiet passages stay visible.
 */
export function buildPeaks(buffer: AudioBuffer, buckets = 900): Float32Array {
  const channel = buffer.getChannelData(0);
  const peaks = new Float32Array(buckets * 2);
  const perBucket = Math.max(1, Math.floor(channel.length / buckets));
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = bucket * perBucket;
    const to = Math.min(channel.length, from + perBucket);
    let min = 0;
    let max = 0;
    for (let index = from; index < to; index += 1) {
      const value = channel[index];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    peaks[bucket * 2] = min;
    peaks[bucket * 2 + 1] = max;
  }
  return peaks;
}

/**
 * Downmixes to mono at the model's sample rate, optionally keeping only the
 * selected region. Rendering happens offline so it is not tied to playback.
 */
export async function prepareForModel(
  buffer: AudioBuffer,
  trim: TrimRange,
): Promise<PreparedAudio> {
  const OfflineAudioContextClass = getOfflineAudioContextClass();
  if (!OfflineAudioContextClass) {
    throw new Error("הדפדפן הזה אינו תומך בהמרת קצב הדגימה של השיר.");
  }

  const sourceDuration = buffer.duration;
  const start = trim ? Math.max(0, Math.min(trim.start, sourceDuration)) : 0;
  const end = trim
    ? Math.max(start + 0.05, Math.min(trim.end, sourceDuration))
    : sourceDuration;
  const duration = end - start;

  const frameCount = Math.max(1, Math.ceil(duration * MODEL_SAMPLE_RATE));
  const offline = new OfflineAudioContextClass(
    1,
    frameCount,
    MODEL_SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0, start, duration);
  const rendered = await offline.startRendering();

  return {
    samples: rendered.getChannelData(0).slice(),
    duration,
    startOffset: start,
    sourceDuration,
    peaks: buildPeaks(buffer),
  };
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
