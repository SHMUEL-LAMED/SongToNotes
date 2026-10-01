/**
 * Whether a file will fit in memory once decoded.
 *
 * The bytes on disk say little about that: `decodeAudioData` turns every
 * second into 32-bit samples at the device's rate, so a 300MB WAV is half an
 * hour and decodes comfortably, while a 100MB MP3 can be two hours and
 * decodes to two gigabytes. A flat limit on bytes had to sit where the worst
 * case survived on a phone — 80MB — and so turned away long lossless
 * recordings that would have opened fine, and anything big on a laptop with
 * memory to spare. This reads the header instead, works out how long the
 * audio is, and weighs the decode against what the device can hold.
 */
import { id3Length, readMp3Frame, readWav, sniff } from "./longAudio";

/** Every file this size or smaller is accepted, as it always was. */
export const SAFE_BYTES = 80 * 1024 * 1024;

/** Enough of the head to find the format header behind most tags. */
const HEAD_BYTES = 256 * 1024;

/** What `decodeAudioData` produces per second per channel: 48 kHz of float32. */
const DECODED_BYTES_PER_CHANNEL_SECOND = 48_000 * 4;

/** Assumed when the header cannot be read: a typical compressed song. */
const ASSUMED_AUDIO_BITRATE = 128_000;
/** Assumed for a video, whose bytes are mostly picture: far more audio per byte would be a guess. */
const ASSUMED_VIDEO_BITRATE = 1_000_000;
const LOSSLESS_BITRATE = 1_411_200;

export type Device = "phone" | "computer";

export type DeviceLimits = {
  /** The largest file read at all — it is held whole while it decodes. */
  maxBytes: number;
  /** The file plus its decoded samples must stay under this. */
  budget: number;
};

const LIMITS: Record<Device, DeviceLimits> = {
  // Where a phone's tab survives: a 35-minute song at 320 kbit/s, decoded.
  phone: { maxBytes: 400 * 1024 * 1024, budget: 896 * 1024 * 1024 },
  // Chrome's decoder holds nearly twice its output while it works, and a tab
  // asked for three gigabytes of samples crashed outright; two came through.
  computer: { maxBytes: 1024 * 1024 * 1024, budget: 2 * 1024 * 1024 * 1024 },
};

type NavigatorHints = Navigator & {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
};

/** A phone or tablet, or a computer that reports little memory, gets the phone's limits. */
export function detectDevice(nav: NavigatorHints | undefined = globalThis.navigator): Device {
  if (!nav) return "computer";
  if (nav.userAgentData?.mobile) return "phone";
  const agent = nav.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobi/i.test(agent)) return "phone";
  // iPadOS asks for the desktop site and says it is a Mac.
  if (/Macintosh/.test(agent) && (nav.maxTouchPoints ?? 0) > 1) return "phone";
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return "phone";
  return "computer";
}

export function deviceLimits(device: Device = detectDevice()): DeviceLimits {
  return LIMITS[device];
}

export type AudioProbe = {
  /** Length of the audio in seconds, or null when the header did not say. */
  seconds: number | null;
  channels: number;
  /**
   * A format this site can read a piece at a time without the whole file in
   * memory, and cut short cheaply: plain PCM WAV, and MP3.
   */
  kind?: "wav" | "mp3";
  /** For a WAV: the rate its samples are kept at once read (see bigAudio.ts). */
  sampleRate?: number;
  /** Where the audio starts in the file: past the header or the ID3 tag. */
  audioStart?: number;
};

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export type WavSamples = { format: "int" | "float"; bits: number };

/** The sample format of a WAV whose `fmt ` chunk is given whole, when it is one read here. */
export function wavSamples(fmtChunk: Uint8Array): WavSamples | null {
  if (fmtChunk.length < 24) return null;
  const view = new DataView(fmtChunk.buffer, fmtChunk.byteOffset, fmtChunk.byteLength);
  let code = view.getUint16(8, true);
  const bits = view.getUint16(22, true);
  // WAVE_FORMAT_EXTENSIBLE keeps the real code in the first two bytes of its GUID.
  if (code === 0xfffe && fmtChunk.length >= 34) code = view.getUint16(32, true);
  if (code === 1 && [8, 16, 24, 32].includes(bits)) return { format: "int", bits };
  if (code === 3 && bits === 32) return { format: "float", bits };
  return null;
}

function probeWav(head: Uint8Array, size: number): AudioProbe | null {
  const layout = readWav(head);
  if (!layout) return null;
  // The size in the header is often a placeholder in a recording that was
  // streamed to disk, so the file's own length is the measure.
  const dataBytes = Math.max(0, size - layout.dataOffset);
  return {
    seconds: dataBytes / (layout.sampleRate * layout.blockAlign),
    channels: layout.channels,
    kind: wavSamples(layout.fmtChunk) ? "wav" : undefined,
    sampleRate: layout.sampleRate,
    audioStart: layout.dataOffset,
  };
}

function probeFlac(head: Uint8Array): AudioProbe | null {
  // "fLaC", then the STREAMINFO block, which always comes first.
  if (head.length < 26 || ascii(head, 0, 4) !== "fLaC" || (head[4] & 0x7f) !== 0) return null;
  const sampleRate = (head[18] << 12) | (head[19] << 4) | (head[20] >> 4);
  const channels = ((head[20] >> 1) & 7) + 1;
  const total = (head[21] & 0x0f) * 2 ** 32 + (((head[22] << 24) | (head[23] << 16) | (head[24] << 8) | head[25]) >>> 0);
  if (!sampleRate || !total) return { seconds: null, channels };
  return { seconds: total / sampleRate, channels };
}

/** The first MP3 frame that the next one vouches for, past any ID3 tag and its padding. */
export function firstMp3Frame(head: Uint8Array) {
  const start = id3Length(head);
  const limit = Math.min(head.length - 4, start + 64 * 1024);
  for (let offset = start; offset < limit; offset += 1) {
    const frame = readMp3Frame(head, offset);
    if (frame && readMp3Frame(head, offset + frame.length)) return frame;
  }
  return null;
}

/** Where a Xing (or Info) header would sit in the frame at `offset`, and whether one does. */
export function xingHeader(head: Uint8Array, offset: number) {
  const mono = head[offset + 3] >> 6 === 3;
  const mpeg1 = ((head[offset + 1] >> 3) & 3) === 3;
  const at = offset + 4 + (mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17);
  if (at + 8 > head.length) return null;
  const tag = ascii(head, at, 4);
  return tag === "Xing" || tag === "Info" ? at : null;
}

function probeMp3(head: Uint8Array, size: number): AudioProbe | null {
  const frame = firstMp3Frame(head);
  if (!frame) return null;
  const { offset } = frame;
  const channels = head[offset + 3] >> 6 === 3 ? 1 : 2;
  const base = { channels, kind: "mp3" as const, audioStart: offset };
  // A VBR file says how many frames it has in a Xing (or Info) header in its
  // first frame; without one, the first frame's bitrate stands for them all.
  const xing = xingHeader(head, offset);
  if (xing !== null && xing + 12 <= head.length) {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (view.getUint32(xing + 4) & 1) {
      const frames = view.getUint32(xing + 8);
      if (frames) return { ...base, seconds: (frames * frame.samples) / frame.sampleRate };
    }
  }
  const bitrate = (frame.length * 8 * frame.sampleRate) / frame.samples;
  return { ...base, seconds: ((size - offset) * 8) / bitrate };
}

/** Reads the length of the audio from the start of the file, where the format allows. */
export function probeAudio(head: Uint8Array, size: number): AudioProbe | null {
  try {
    if (ascii(head, 0, 4) === "fLaC") return probeFlac(head);
    const kind = sniff(head);
    if (kind === "wav") return probeWav(head, size);
    if (kind === "mp3") return probeMp3(head, size);
  } catch {
    // A header that lies about its own lengths: no better than none.
  }
  return null;
}

const LOSSLESS = /\.(wav|wave|aif|aiff|aifc|caf)$/i;
const VIDEO = /\.(mp4|m4v|mov|mkv|webm|avi|3gp)$/i;

function guessSeconds(name: string, type: string, size: number) {
  const bitrate = LOSSLESS.test(name)
    ? LOSSLESS_BITRATE
    : type.startsWith("video/") || VIDEO.test(name)
      ? ASSUMED_VIDEO_BITRATE
      : ASSUMED_AUDIO_BITRATE;
  return (size * 8) / bitrate;
}

/**
 * How a file is to be opened:
 * - `whole`: read into memory and handed to the browser's decoder, as always;
 * - `stream`: a WAV read straight from the file into samples, a slice at a
 *   time, so the file itself is never held in memory beside them;
 * - `partial`: too long for this device, but in a format that can be cut,
 *   so its first `keepSeconds` are opened instead of nothing;
 * - `refuse`: too long, and in a format that cannot be cut here.
 */
export type Fit =
  | { action: "whole" }
  | { action: "stream" }
  | { action: "partial"; kind: "wav" | "mp3"; seconds: number; keepSeconds: number }
  | { action: "refuse"; seconds: number; reason: "bytes" | "length" };

/** Anything shorter is not worth opening as "the part that fits". */
const MIN_PARTIAL_SECONDS = 60;

/**
 * Whether a file of this size and header can be decoded here, and how. Files
 * up to `SAFE_BYTES` are always opened whole, exactly as before.
 */
export function judgeFit(
  file: { name: string; type: string; size: number },
  probe: AudioProbe | null,
  limits: DeviceLimits,
  maxBytes = limits.maxBytes,
): Fit {
  if (file.size <= SAFE_BYTES) return { action: "whole" };
  const seconds = probe?.seconds ?? guessSeconds(file.name, file.type, file.size);
  const channels = Math.min(32, Math.max(1, probe?.channels ?? 2));

  if (probe?.kind === "wav" && probe.sampleRate) {
    // Read as it is stored: the file's own rate and channels, four bytes a sample.
    const perSecond = Math.max(1, probe.channels) * probe.sampleRate * 4;
    if (seconds * perSecond <= limits.budget) return { action: "stream" };
    const keepSeconds = Math.floor(limits.budget / perSecond);
    return keepSeconds >= MIN_PARTIAL_SECONDS
      ? { action: "partial", kind: "wav", seconds, keepSeconds }
      : { action: "refuse", seconds, reason: "length" };
  }

  const perSecond = Math.min(2, channels) * DECODED_BYTES_PER_CHANNEL_SECOND;
  const fitsWhole = file.size <= maxBytes && file.size + seconds * perSecond <= limits.budget;
  if (fitsWhole) return { action: "whole" };

  if (probe?.kind === "mp3" && seconds > 0) {
    // The part kept is read whole and decoded, so both count against the budget.
    const bytesPerSecond = (file.size - (probe.audioStart ?? 0)) / seconds;
    const keepSeconds = Math.floor(
      Math.min(limits.budget / (perSecond + bytesPerSecond), maxBytes / bytesPerSecond, seconds),
    );
    if (keepSeconds >= MIN_PARTIAL_SECONDS) return { action: "partial", kind: "mp3", seconds, keepSeconds };
  }
  return { action: "refuse", seconds, reason: file.size > maxBytes ? "bytes" : "length" };
}

/**
 * The start of the file, enough to read its header. A tag with cover art can
 * push an MP3's first frame past the first read, so then the bytes just past
 * the tag are read too and laid where they belong.
 */
export async function readHead(file: Blob): Promise<Uint8Array> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const tag = id3Length(head);
  if (tag <= HEAD_BYTES - 1024 || tag >= file.size) return head;
  try {
    const rest = new Uint8Array(await file.slice(tag, tag + 64 * 1024).arrayBuffer());
    const joined = new Uint8Array(tag + rest.length);
    joined.set(head.subarray(0, Math.min(head.length, tag)));
    joined.set(rest, tag);
    return joined;
  } catch {
    return head;
  }
}

/** Reads the head of the file and judges it; a file whose head cannot be read is left to the decoder. */
export async function checkFit(file: File, limits: DeviceLimits = deviceLimits(), maxBytes = limits.maxBytes): Promise<Fit> {
  if (file.size <= SAFE_BYTES) return { action: "whole" };
  let head: Uint8Array;
  try {
    head = await readHead(file);
  } catch {
    return judgeFit(file, null, limits, maxBytes);
  }
  return judgeFit(file, probeAudio(head, file.size), limits, maxBytes);
}
