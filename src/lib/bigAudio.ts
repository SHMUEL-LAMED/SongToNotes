/**
 * Opening files too big for the usual way.
 *
 * The usual way reads the whole file into memory and hands it to the
 * browser's decoder, so a long WAV is held twice: once as the file, once as
 * samples. A WAV is only samples behind a header, though, so here it is read
 * straight from the disk into the samples a slice at a time, and only the
 * samples are ever held.
 *
 * And a file longer than the device can hold at all need not be turned
 * away: a WAV or an MP3 can be cut at any frame without decoding it, so the
 * part that fits is opened, as a file of its own — the player, the hand-off
 * to the next tool and saving then all see the same audio.
 */
import { firstMp3Frame, readHead, wavSamples, xingHeader, type WavSamples } from "./audioBudget";
import { getOfflineAudioContextClass } from "./audio";
import { readMp3Frame, readWav, type DecodeProgress, type WavLayout } from "./longAudio";

/** About four megabytes of the file per read. */
const SLICE_BYTES = 4 * 1024 * 1024;

function makeBuffer(channels: number, length: number, sampleRate: number) {
  try {
    return new AudioBuffer({ numberOfChannels: channels, length, sampleRate });
  } catch {
    const Offline = getOfflineAudioContextClass();
    if (!Offline) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
    return new Offline(1, 1, sampleRate).createBuffer(channels, length, sampleRate);
  }
}

type WavInfo = { layout: WavLayout; samples: WavSamples; frames: number };

async function readWavInfo(file: Blob): Promise<WavInfo> {
  const head = await readHead(file);
  const layout = readWav(head);
  const samples = layout && wavSamples(layout.fmtChunk);
  if (!layout || !samples) throw new Error("קובץ ה־WAV הזה בפורמט שלא נתמך כאן.");
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const declared = view.getUint32(layout.dataOffset - 4, true);
  const present = file.size - layout.dataOffset;
  // A WAV written as it streams claims more than it holds, or nothing at all.
  const bytes = declared > 0 && declared < present ? declared : present;
  return { layout, samples, frames: Math.floor(bytes / layout.blockAlign) };
}

/** Converts one slice of interleaved samples into the channels, from frame `at` on. */
export function fillFrames(
  channels: Float32Array[],
  bytes: ArrayBuffer,
  samples: WavSamples,
  at: number,
) {
  const view = new DataView(bytes);
  const count = channels.length;
  const width = samples.bits / 8;
  const frames = Math.floor(bytes.byteLength / (width * count));
  let offset = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < count; channel += 1) {
      let value: number;
      if (samples.format === "float") value = view.getFloat32(offset, true);
      else if (width === 2) value = view.getInt16(offset, true) / 32768;
      else if (width === 3) value = ((view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16))) / 8388608;
      else if (width === 4) value = view.getInt32(offset, true) / 2147483648;
      else value = (view.getUint8(offset) - 128) / 128;
      channels[channel][at + frame] = value;
      offset += width;
    }
  }
  return frames;
}

/**
 * Reads a PCM WAV into an AudioBuffer at its own rate, a slice at a time,
 * keeping at most `keepSeconds` of it.
 */
export async function streamWav(file: Blob, keepSeconds?: number, onProgress?: DecodeProgress) {
  const { layout, samples, frames: available } = await readWavInfo(file);
  const frames = Math.max(
    1,
    keepSeconds === undefined ? available : Math.min(available, Math.floor(keepSeconds * layout.sampleRate)),
  );
  const buffer = makeBuffer(layout.channels, frames, layout.sampleRate);
  const channels = Array.from({ length: layout.channels }, (_, index) => buffer.getChannelData(index));
  const sliceFrames = Math.max(1, Math.floor(SLICE_BYTES / layout.blockAlign));
  for (let at = 0; at < frames; at += sliceFrames) {
    const count = Math.min(sliceFrames, frames - at);
    const start = layout.dataOffset + at * layout.blockAlign;
    const bytes = await file.slice(start, start + count * layout.blockAlign).arrayBuffer();
    // Frames past what a short read returned stay silent rather than failing.
    fillFrames(channels, bytes, samples, at);
    onProgress?.(Math.min(1, (at + count) / frames));
  }
  return buffer;
}

/** A name that says the file is a part of the one chosen. */
function partName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (חלק ראשון)${name.slice(dot)}` : `${name} (חלק ראשון)`;
}

/** The first `keepSeconds` of a PCM WAV, as a file of its own; nothing is copied but the header. */
export async function cutWav(file: File, keepSeconds: number): Promise<File> {
  const { layout, frames } = await readWavInfo(file);
  const keep = Math.min(frames, Math.floor(keepSeconds * layout.sampleRate));
  const dataBytes = keep * layout.blockAlign;
  // A chunk of odd length is followed by a pad byte.
  const fmtLength = layout.fmtChunk.length + (layout.fmtChunk.length & 1);
  const header = new Uint8Array(12 + fmtLength + 8);
  const view = new DataView(header.buffer);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, header.length - 8 + dataBytes + (dataBytes & 1), true);
  header.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  header.set(layout.fmtChunk, 12);
  header.set([0x64, 0x61, 0x74, 0x61], 12 + fmtLength); // data
  view.setUint32(12 + fmtLength + 4, dataBytes, true);
  const parts: BlobPart[] = [header, file.slice(layout.dataOffset, layout.dataOffset + dataBytes)];
  if (dataBytes & 1) parts.push(new Uint8Array(1));
  return new File(parts, partName(file.name), { type: file.type || "audio/wav" });
}

/**
 * The first `keepSeconds` of an MP3, cut after a whole frame, as a file of
 * its own. A Xing header, where there is one, is rewritten to the frames and
 * bytes that remain, or players would show the length of the whole file.
 */
export async function cutMp3(file: File, keepSeconds: number): Promise<File> {
  const head = await readHead(file);
  const first = firstMp3Frame(head);
  if (!first) throw new Error("לא הצלחנו לקרוא את קובץ ה־MP3.");
  const target = keepSeconds * first.sampleRate;
  let offset = first.offset;
  let samples = 0;
  let frames = 0;
  let chunk = new Uint8Array(0);
  let chunkStart = 0;
  while (offset + 4 <= file.size && samples < target) {
    if (offset + 4 > chunkStart + chunk.length) {
      chunkStart = offset;
      chunk = new Uint8Array(await file.slice(offset, offset + SLICE_BYTES).arrayBuffer());
      if (chunk.length < 4) break;
    }
    const frame = readMp3Frame(chunk, offset - chunkStart);
    if (frame) {
      samples += frame.samples;
      frames += 1;
      offset += frame.length;
    } else {
      // Garbage between frames: step over it the way a decoder resyncs.
      offset += 1;
    }
  }
  const cut = Math.min(offset, file.size);
  const xing = xingHeader(head, first.offset);
  const parts: BlobPart[] = [];
  if (xing !== null && xing + 16 <= head.length && xing + 16 <= cut) {
    const patched = head.slice(0, xing + 16);
    const view = new DataView(patched.buffer);
    const flags = view.getUint32(xing + 4);
    let field = xing + 8;
    // The Xing frame itself carries no audio and is not counted.
    if (flags & 1) {
      view.setUint32(field, Math.max(0, frames - 1));
      field += 4;
    }
    if (flags & 2 && field + 4 <= patched.length) view.setUint32(field, cut - first.offset);
    parts.push(patched, file.slice(patched.length, cut));
  } else {
    parts.push(file.slice(0, cut));
  }
  return new File(parts, partName(file.name), { type: file.type || "audio/mpeg" });
}
