/**
 * Bringing a long recording in without running out of memory.
 *
 * `decodeAudioData` turns a two-hour MP3 into a gigabyte and a half of
 * stereo samples at 44.1 kHz before anything can be done with it, which is
 * where a phone gives up and a laptop starts to swap. The speech recogniser
 * only ever wanted mono at 16 kHz — a fifth of that — so this decodes to that
 * directly, and for the two formats that allow it, in pieces: WAV, which is
 * plain samples with a header, and MP3, whose frames can be counted and cut
 * at. Every other format is decoded whole at the low rate, which still cuts
 * the memory several times over.
 *
 * Cutting an MP3 mid-stream costs a few milliseconds of silence at each cut
 * as the decoder finds its feet, so each piece is padded or trimmed to the
 * length its frames add up to and the timestamps stay true to the end.
 */
import { decodeWithContext, getOfflineAudioContextClass } from "./audio";

export type DecodeProgress = (fraction: number) => void;

/** Two minutes of WAV per piece: about 20MB of 16-bit stereo. */
const WAV_PIECE_SECONDS = 120;
/** About six minutes of MP3 at 128 kbit/s per piece. */
const MP3_PIECE_BYTES = 6 * 1024 * 1024;

type Kind = "wav" | "mp3" | "other";

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function sniff(bytes: Uint8Array): Kind {
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "wav";
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && ((bytes[1] >> 1) & 3) === 1) return "mp3";
  return "other";
}

// ---------------------------------------------------------------------------
// WAV: a header, then samples. Pieces are the header again over a slice.
// ---------------------------------------------------------------------------

export type WavLayout = {
  /** The `fmt ` chunk, header included, copied verbatim into every piece. */
  fmtChunk: Uint8Array;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  dataOffset: number;
  dataBytes: number;
};

export function readWav(bytes: Uint8Array): WavLayout | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let fmtChunk: Uint8Array | null = null;
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmtChunk = bytes.slice(offset, offset + 8 + size);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      blockAlign = view.getUint16(offset + 20, true);
    } else if (id === "data") {
      if (!fmtChunk || !channels || !sampleRate || !blockAlign) return null;
      const dataBytes = Math.min(size, bytes.length - offset - 8);
      return { fmtChunk, channels, sampleRate, blockAlign, dataOffset: offset + 8, dataBytes };
    }
    // Chunks are padded to an even length.
    offset += 8 + size + (size & 1);
  }
  return null;
}

function wavPiece(bytes: Uint8Array, layout: WavLayout, start: number, length: number) {
  const header = 12 + layout.fmtChunk.length + 8;
  const out = new Uint8Array(header + length);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, out.length - 8, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  out.set(layout.fmtChunk, 12);
  const dataAt = 12 + layout.fmtChunk.length;
  out.set([0x64, 0x61, 0x74, 0x61], dataAt); // data
  view.setUint32(dataAt + 4, length, true);
  out.set(bytes.subarray(start, start + length), header);
  return out.buffer;
}

// ---------------------------------------------------------------------------
// MP3: a run of frames, each with a header that says how long it is.
// ---------------------------------------------------------------------------

const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

export type Mp3Frame = { offset: number; length: number; samples: number; sampleRate: number };

/** Reads one Layer III frame header, or null where there is no valid one. */
export function readMp3Frame(bytes: Uint8Array, offset: number): Mp3Frame | null {
  if (offset + 4 > bytes.length) return null;
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = (b2 >> 4) & 15;
  const rateIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const padding = (b2 >> 1) & 1;
  const bitrate = (version === 3 ? MPEG1_BITRATES : MPEG2_BITRATES)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor((samples / 8) * bitrate / sampleRate) + padding;
  if (length < 24) return null;
  return { offset, length, samples, sampleRate };
}

/** The length of an ID3v2 tag at the start of the file, or 0. */
export function id3Length(bytes: Uint8Array) {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return 0;
  const size =
    ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const footer = bytes[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Walks every frame. A header that does not check out is skipped byte by
 * byte until one does — that is how a decoder resyncs too — and a header is
 * trusted when the next one lands where it says it will, or when it sits
 * exactly where the previous frame ended (the last frame before a trailing
 * tag has nothing after it to vouch for it).
 */
export function walkMp3(bytes: Uint8Array): Mp3Frame[] {
  const frames: Mp3Frame[] = [];
  let offset = id3Length(bytes);
  let runEnd = -1;
  while (offset + 4 <= bytes.length) {
    const frame = readMp3Frame(bytes, offset);
    const next = frame ? offset + frame.length : -1;
    const trusted =
      frame !== null &&
      (offset === runEnd || next >= bytes.length - 4 || readMp3Frame(bytes, next) !== null);
    if (frame && trusted) {
      frames.push(frame);
      offset = next;
      runEnd = next;
    } else {
      offset += 1;
    }
  }
  return frames;
}

export type Piece = { start: number; end: number; samples: number; sampleRate: number };

/** Groups frames into byte ranges of roughly `pieceBytes`, cut only between frames. */
export function mp3Pieces(frames: Mp3Frame[], pieceBytes = MP3_PIECE_BYTES): Piece[] {
  const pieces: Piece[] = [];
  let current: Piece | null = null;
  for (const frame of frames) {
    if (!current || current.end - current.start >= pieceBytes || current.sampleRate !== frame.sampleRate) {
      current = { start: frame.offset, end: frame.offset, samples: 0, sampleRate: frame.sampleRate };
      pieces.push(current);
    }
    current.end = frame.offset + frame.length;
    current.samples += frame.samples;
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

function downmix(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  const scale = 1 / buffer.numberOfChannels;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < out.length; index += 1) out[index] += data[index] * scale;
  }
  return out;
}

/** Pads with silence or trims, so a piece is exactly as long as its frames say. */
function fit(samples: Float32Array<ArrayBuffer>, length: number) {
  if (samples.length === length) return samples;
  const out = new Float32Array(length);
  out.set(samples.subarray(0, Math.min(length, samples.length)));
  return out;
}

function concat(parts: Float32Array<ArrayBuffer>[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function toBuffer(context: OfflineAudioContext, samples: Float32Array<ArrayBuffer>, sampleRate: number) {
  const buffer = context.createBuffer(1, Math.max(1, samples.length), sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

/**
 * Decodes a file to mono at `sampleRate`, in pieces where the format allows.
 * `data` is left intact: every piece is a copy, and the whole-file fallback
 * takes a copy too, because `decodeAudioData` detaches what it is given.
 */
export async function decodeMonoAt(
  data: ArrayBuffer,
  sampleRate: number,
  onProgress?: DecodeProgress,
): Promise<AudioBuffer> {
  const Offline = getOfflineAudioContextClass();
  if (!Offline) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  const context = new Offline(1, 1, sampleRate);
  const bytes = new Uint8Array(data);
  const kind = sniff(bytes);

  const whole = async () => {
    const decoded = await decodeWithContext(context, data.slice(0));
    onProgress?.(1);
    return toBuffer(context, downmix(decoded), sampleRate);
  };

  try {
    if (kind === "wav") {
      const layout = readWav(bytes);
      if (!layout) return await whole();
      const pieceBytes = WAV_PIECE_SECONDS * layout.sampleRate * layout.blockAlign;
      const parts: Float32Array<ArrayBuffer>[] = [];
      for (let start = 0; start < layout.dataBytes; start += pieceBytes) {
        const length = Math.min(pieceBytes, layout.dataBytes - start);
        const aligned = length - (length % layout.blockAlign);
        if (aligned <= 0) break;
        const decoded = await decodeWithContext(
          context,
          wavPiece(bytes, layout, layout.dataOffset + start, aligned),
        );
        parts.push(downmix(decoded));
        onProgress?.(Math.min(1, (start + aligned) / layout.dataBytes));
      }
      if (!parts.length) return await whole();
      return toBuffer(context, concat(parts), sampleRate);
    }

    if (kind === "mp3") {
      const frames = walkMp3(bytes);
      const pieces = mp3Pieces(frames);
      // Too few frames means the stream is not what the sync bytes claimed.
      if (frames.length < 8) return await whole();
      const parts: Float32Array<ArrayBuffer>[] = [];
      let done = 0;
      for (const piece of pieces) {
        const decoded = await decodeWithContext(context, data.slice(piece.start, piece.end));
        const expected = Math.round((piece.samples * sampleRate) / piece.sampleRate);
        // The first piece carries the encoder's own delay, which the decoder
        // trims; after it the count is exact, so a short piece here means a
        // real gap and is padded rather than let slide.
        parts.push(fit(downmix(decoded), expected));
        done += piece.end - piece.start;
        onProgress?.(Math.min(1, done / bytes.length));
      }
      return toBuffer(context, concat(parts), sampleRate);
    }
  } catch {
    // A piece the decoder would not take: the whole file, the slow way.
  }
  return whole();
}
