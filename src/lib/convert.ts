/**
 * Turning decoded audio into a file of another shape: a different sample
 * rate, mono or stereo, trimmed, louder or quieter, normalised — and then
 * WAV or MP3. The resampling is the browser's own (an offline context), so
 * it is the same quality the page plays with.
 */
import { getOfflineAudioContextClass } from "./audio";
import { normalise } from "./dsp";
import { encodeWav } from "./wav";
import type { EncodeRequest, EncodeResponse } from "../workers/encode.worker";

export type OutputFormat = "wav" | "mp3";

export type ConvertOptions = {
  format: OutputFormat;
  sampleRate: number;
  channels: 1 | 2 | "keep";
  /** MP3 only. */
  kbps: number;
  /** Seconds; null keeps the whole file. */
  trim: { start: number; end: number } | null;
  /** 1 leaves the level alone. */
  gain: number;
  normalise: boolean;
};

export const SAMPLE_RATES = [
  { value: 48_000, label: "48 kHz (וידאו)" },
  { value: 44_100, label: "44.1 kHz (CD)" },
  { value: 32_000, label: "32 kHz" },
  { value: 22_050, label: "22 kHz" },
  { value: 16_000, label: "16 kHz (דיבור)" },
];

export const BITRATES = [
  { value: 320, label: "320 kbps (הכי טוב)" },
  { value: 256, label: "256 kbps" },
  { value: 192, label: "192 kbps (מומלץ)" },
  { value: 128, label: "128 kbps" },
  { value: 96, label: "96 kbps" },
  { value: 64, label: "64 kbps (דיבור)" },
];

/** Roughly how big the output will be, before doing the work. */
export function estimateBytes(seconds: number, options: ConvertOptions, sourceChannels: number) {
  const channels = options.channels === "keep" ? sourceChannels : options.channels;
  if (options.format === "mp3") return Math.round((seconds * options.kbps * 1000) / 8);
  return Math.round(seconds * options.sampleRate * channels * 2) + 44;
}

/** The trimmed, resampled, mixed, levelled channels. */
export async function renderChannels(
  buffer: AudioBuffer,
  options: ConvertOptions,
): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const start = options.trim ? Math.max(0, options.trim.start) : 0;
  const end = options.trim ? Math.min(buffer.duration, options.trim.end) : buffer.duration;
  const seconds = Math.max(0.05, end - start);
  const outChannels = options.channels === "keep" ? buffer.numberOfChannels : options.channels;
  const Offline = getOfflineAudioContextClass();
  if (!Offline) throw new Error("הדפדפן הזה אינו תומך בהמרת אודיו.");
  const frames = Math.ceil(seconds * options.sampleRate);
  const offline = new Offline(outChannels, frames, options.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  const gain = offline.createGain();
  gain.gain.value = options.gain;
  source.connect(gain);
  gain.connect(offline.destination);
  source.start(0, start, seconds);
  const rendered = await offline.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index).slice());
  if (options.normalise) {
    const levelled = normalise(channels);
    levelled.forEach((channel, index) => channels[index].set(channel));
  }
  return { channels, sampleRate: options.sampleRate };
}

/** Encodes to MP3 on a worker; resolves with the file's bytes. */
export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  kbps: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/encode.worker.ts", import.meta.url), { type: "module" });
    const jobId = Date.now();
    const finish = () => worker.terminate();
    signal?.addEventListener("abort", () => {
      finish();
      reject(new Error("ההמרה בוטלה."));
    });
    worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      const message = event.data;
      if (message.jobId !== jobId) return;
      if (message.type === "progress") onProgress?.(message.fraction);
      else if (message.type === "done") {
        finish();
        resolve(message.bytes);
      } else {
        finish();
        reject(new Error(message.message));
      }
    };
    worker.onerror = () => {
      finish();
      reject(new Error("הקידוד נכשל."));
    };
    const request: EncodeRequest = { jobId, channels, sampleRate, kbps };
    worker.postMessage(request, channels.map((channel) => channel.buffer));
  });
}

/** The whole conversion: a File ready to download. */
export async function convertAudio(
  buffer: AudioBuffer,
  name: string,
  options: ConvertOptions,
  onProgress?: (message: string, fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  onProgress?.("מעבד את הצליל…", 0.05);
  const { channels, sampleRate } = await renderChannels(buffer, options);
  const base = name.replace(/\.[^/.]+$/, "") || "audio";
  if (options.format === "wav") {
    onProgress?.("כותב WAV…", 0.7);
    const blob = encodeWav({ channels, sampleRate });
    return new File([blob], `${base}.wav`, { type: "audio/wav" });
  }
  onProgress?.("מקודד MP3…", 0.2);
  const bytes = await encodeMp3(channels, sampleRate, options.kbps, (fraction) => onProgress?.("מקודד MP3…", 0.2 + fraction * 0.75), signal);
  return new File([bytes], `${base}.mp3`, { type: "audio/mpeg" });
}
