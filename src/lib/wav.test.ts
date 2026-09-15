import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

async function header(blob: Blob) {
  const view = new DataView(await blob.arrayBuffer());
  const text = (offset: number, length: number) =>
    String.fromCharCode(...new Uint8Array(view.buffer, offset, length));
  return {
    riff: text(0, 4),
    size: view.getUint32(4, true),
    wave: text(8, 4),
    fmt: text(12, 4),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    data: text(36, 4),
    dataBytes: view.getUint32(40, true),
    view,
  };
}

describe("encodeWav", () => {
  it("writes a canonical 16-bit PCM header", async () => {
    const frames = 128;
    const wav = await header(
      encodeWav({ channels: [new Float32Array(frames)], sampleRate: 44100 }),
    );
    expect(wav.riff).toBe("RIFF");
    expect(wav.wave).toBe("WAVE");
    expect(wav.fmt).toBe("fmt ");
    expect(wav.data).toBe("data");
    expect(wav.format).toBe(1);
    expect(wav.bits).toBe(16);
    expect(wav.channels).toBe(1);
    expect(wav.sampleRate).toBe(44100);
    expect(wav.blockAlign).toBe(2);
    expect(wav.byteRate).toBe(44100 * 2);
    expect(wav.dataBytes).toBe(frames * 2);
    expect(wav.size).toBe(36 + frames * 2);
  });

  it("interleaves stereo frames", async () => {
    const left = Float32Array.from([1, 1, 1]);
    const right = Float32Array.from([-1, -1, -1]);
    const wav = await header(encodeWav({ channels: [left, right], sampleRate: 48000 }));
    expect(wav.channels).toBe(2);
    expect(wav.blockAlign).toBe(4);
    expect(wav.dataBytes).toBe(3 * 2 * 2);
    expect(wav.view.getInt16(44, true)).toBe(32767);
    expect(wav.view.getInt16(46, true)).toBe(-32767);
  });

  it("clips rather than wrapping around on overshoot", async () => {
    const wav = await header(
      encodeWav({ channels: [Float32Array.from([4, -4])], sampleRate: 8000 }),
    );
    expect(wav.view.getInt16(44, true)).toBe(32767);
    expect(wav.view.getInt16(46, true)).toBe(-32767);
  });

  it("still produces a valid empty file", async () => {
    const blob = encodeWav({ channels: [], sampleRate: 44100 });
    const wav = await header(blob);
    expect(wav.channels).toBe(1);
    expect(wav.dataBytes).toBe(0);
    expect(blob.size).toBe(44);
    expect(blob.type).toBe("audio/wav");
  });
});
