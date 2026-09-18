import { describe, expect, it } from "vitest";
import { id3Length, mp3Pieces, readMp3Frame, readWav, sniff, walkMp3 } from "./longAudio";

/** A Layer III header: MPEG1, 128 kbit/s, 44.1 kHz, no padding. 417 bytes. */
function frame(padding = 0, bitrateIndex = 9) {
  const length = Math.floor((1152 / 8) * [0, 32, 40, 48, 56, 64, 80, 96, 112, 128][bitrateIndex] * 1000 / 44100) + padding;
  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xfb; // sync, MPEG1, Layer III, no CRC
  bytes[2] = (bitrateIndex << 4) | (0 << 2) | (padding << 1);
  bytes[3] = 0xc0;
  return bytes;
}

function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function wav(frames: number, channels = 2, sampleRate = 44100) {
  const blockAlign = channels * 2;
  const out = new Uint8Array(44 + frames * blockAlign);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, out.length - 8, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, frames * blockAlign, true);
  return out;
}

describe("sniff", () => {
  it("tells WAV, MP3 and the rest apart", () => {
    expect(sniff(wav(10))).toBe("wav");
    expect(sniff(frame())).toBe("mp3");
    expect(sniff(join([new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), frame()]))).toBe("mp3");
    expect(sniff(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("other");
  });
});

describe("readWav", () => {
  it("finds the format and the samples", () => {
    const layout = readWav(wav(100, 2, 48000));
    expect(layout).toMatchObject({ channels: 2, sampleRate: 48000, blockAlign: 4, dataOffset: 44, dataBytes: 400 });
    expect(layout?.fmtChunk.length).toBe(24);
  });

  it("does not trust a data chunk that says more than the file holds", () => {
    const short = wav(100).subarray(0, 244);
    expect(readWav(short)?.dataBytes).toBe(200);
  });
});

describe("MP3 frames", () => {
  it("reads a header and its length", () => {
    expect(readMp3Frame(frame(), 0)).toEqual({ offset: 0, length: 417, samples: 1152, sampleRate: 44100 });
    expect(readMp3Frame(frame(1), 0)?.length).toBe(418);
    expect(readMp3Frame(new Uint8Array([0xff, 0xfb, 0xf0, 0xc0]), 0)).toBeNull(); // bad bitrate
    expect(readMp3Frame(new Uint8Array([0x00, 0xfb, 0x90, 0xc0]), 0)).toBeNull(); // no sync
  });

  it("skips an ID3 tag and walks every frame, resyncing over junk", () => {
    const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
    expect(id3Length(tag)).toBe(15);
    const junk = new Uint8Array([0x12, 0x34, 0x56]);
    const stream = join([tag, frame(), frame(1), junk, frame(), frame(), frame()]);
    const frames = walkMp3(stream);
    expect(frames).toHaveLength(5);
    expect(frames[0].offset).toBe(15);
    expect(frames[2].offset).toBe(15 + 417 + 418 + 3);
    expect(frames.reduce((sum, item) => sum + item.samples, 0)).toBe(5 * 1152);
  });

  it("cuts pieces only between frames and counts their samples", () => {
    const frames = walkMp3(join(Array.from({ length: 12 }, () => frame())));
    const pieces = mp3Pieces(frames, 417 * 5);
    expect(pieces.map((piece) => piece.samples)).toEqual([1152 * 5, 1152 * 5, 1152 * 2]);
    expect(pieces[1].start).toBe(417 * 5);
    expect(pieces[2].end).toBe(417 * 12);
  });
});
