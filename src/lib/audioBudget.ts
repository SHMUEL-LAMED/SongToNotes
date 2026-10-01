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
  phone: { maxBytes: 400 * 1024 * 1024, budget: 1024 * 1024 * 1024 },
  computer: { maxBytes: 1024 * 1024 * 1024, budget: 3 * 1024 * 1024 * 1024 },
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
};

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function probeWav(head: Uint8Array, size: number): AudioProbe | null {
  const layout = readWav(head);
  if (!layout) return null;
  // The size in the header is often a placeholder in a recording that was
  // streamed to disk, so the file's own length is the measure.
  const dataBytes = Math.max(0, size - layout.dataOffset);
  return { seconds: dataBytes / (layout.sampleRate * layout.blockAlign), channels: layout.channels };
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

function probeMp3(head: Uint8Array, size: number): AudioProbe | null {
  let offset = id3Length(head);
  // The first frame header, past any padding the tag left behind.
  const limit = Math.min(head.length - 4, offset + 64 * 1024);
  let frame = null;
  for (; offset < limit; offset += 1) {
    frame = readMp3Frame(head, offset);
    if (frame && readMp3Frame(head, offset + frame.length)) break;
    frame = null;
  }
  if (!frame) return null;
  const mono = head[offset + 3] >> 6 === 3;
  const channels = mono ? 1 : 2;
  const mpeg1 = (head[offset + 1] >> 3 & 3) === 3;
  // A VBR file says how many frames it has in a Xing (or Info) header in its
  // first frame; without one, the first frame's bitrate stands for them all.
  const xingAt = offset + 4 + (mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17);
  if (xingAt + 12 <= head.length) {
    const tag = ascii(head, xingAt, 4);
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if ((tag === "Xing" || tag === "Info") && view.getUint32(xingAt + 4) & 1) {
      const frames = view.getUint32(xingAt + 8);
      if (frames) return { seconds: (frames * frame.samples) / frame.sampleRate, channels };
    }
  }
  const bitrate = (frame.length * 8 * frame.sampleRate) / frame.samples;
  return { seconds: ((size - offset) * 8) / bitrate, channels };
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

export type Fit = { ok: true } | { ok: false; seconds: number; reason: "bytes" | "length" };

/**
 * Whether a file of this size and header can be decoded here. Files up to
 * `SAFE_BYTES` always pass, so nothing that opened before is turned away now.
 */
export function judgeFit(
  file: { name: string; type: string; size: number },
  probe: AudioProbe | null,
  limits: DeviceLimits,
): Fit {
  const seconds = probe?.seconds ?? guessSeconds(file.name, file.type, file.size);
  if (file.size <= SAFE_BYTES) return { ok: true };
  if (file.size > limits.maxBytes) return { ok: false, seconds, reason: "bytes" };
  const channels = Math.min(2, Math.max(1, probe?.channels ?? 2));
  const needed = file.size + seconds * channels * DECODED_BYTES_PER_CHANNEL_SECOND;
  return needed <= limits.budget ? { ok: true } : { ok: false, seconds, reason: "length" };
}

/** Reads the head of the file and judges it; a file that cannot be read is left to the decoder. */
export async function checkFit(file: File, limits: DeviceLimits = deviceLimits()): Promise<Fit> {
  if (file.size <= SAFE_BYTES) return { ok: true };
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  } catch {
    return judgeFit(file, null, limits);
  }
  // A tag with cover art can push the first frame past the first read.
  const tag = id3Length(head);
  if (tag > HEAD_BYTES - 1024 && tag < file.size) {
    try {
      const rest = new Uint8Array(await file.slice(tag, tag + 64 * 1024).arrayBuffer());
      const joined = new Uint8Array(tag + rest.length);
      joined.set(head.subarray(0, Math.min(head.length, tag)));
      joined.set(rest, tag);
      head = joined;
    } catch {
      // Judged on what was read.
    }
  }
  return judgeFit(file, probeAudio(head, file.size), limits);
}
