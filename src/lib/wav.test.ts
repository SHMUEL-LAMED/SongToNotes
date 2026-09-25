import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "./wav";

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

describe("decodeWav", () => {
  /** A WAV's bytes, with its header open for the test to change. */
  async function bytes(blob: Blob) {
    const buffer = await blob.arrayBuffer();
    return { buffer, view: new DataView(buffer) };
  }

  it("reads back what encodeWav wrote, mono and stereo", async () => {
    const { buffer } = await bytes(encodeWav({ channels: [Float32Array.from([0, 0.5, -0.5])], sampleRate: 24000 }));
    const mono = decodeWav(buffer);
    expect(mono?.sampleRate).toBe(24000);
    expect(mono?.channels.length).toBe(1);
    expect([...mono!.channels[0]].map((value) => Math.round(value * 1000) / 1000)).toEqual([0, 0.5, -0.5]);

    const stereo = decodeWav((await bytes(encodeWav({ channels: [Float32Array.from([1, 0]), Float32Array.from([-1, 0])], sampleRate: 48000 }))).buffer);
    expect(stereo?.channels.map((channel) => channel.length)).toEqual([2, 2]);
    expect(stereo?.channels[0][0]).toBeCloseTo(1, 3);
    expect(stereo?.channels[1][0]).toBeCloseTo(-1, 3);
  });

  it("steps over chunks it does not need, and reads a data size that claims too much", async () => {
    const { buffer } = await bytes(encodeWav({ channels: [Float32Array.from([0.25, 0.25])], sampleRate: 16000 }));
    // A LIST chunk between the format and the samples, as some encoders write.
    const list = new Uint8Array([...new TextEncoder().encode("LIST"), 4, 0, 0, 0, ...new TextEncoder().encode("INFO")]);
    const withList = new Uint8Array(buffer.byteLength + list.length);
    withList.set(new Uint8Array(buffer, 0, 36));
    withList.set(list, 36);
    withList.set(new Uint8Array(buffer, 36), 36 + list.length);
    new DataView(withList.buffer).setUint32(36 + list.length + 4, 0xffffffff, true);
    const read = decodeWav(withList.buffer);
    expect(read?.sampleRate).toBe(16000);
    expect(read?.channels[0].length).toBe(2);
    expect(read?.channels[0][1]).toBeCloseTo(0.25, 3);
  });

  it("leaves anything but 16-bit PCM to the browser", async () => {
    const { buffer, view } = await bytes(encodeWav({ channels: [new Float32Array(4)], sampleRate: 44100 }));
    view.setUint16(20, 3, true);
    expect(decodeWav(buffer)).toBeNull();
    expect(decodeWav(new TextEncoder().encode("ID3 not a wav file").buffer)).toBeNull();
    expect(decodeWav(new ArrayBuffer(0))).toBeNull();
  });
});
