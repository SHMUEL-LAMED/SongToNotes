import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cutMp3, cutWav, fillFrames, streamWav } from "./bigAudio";
import { readMp3Frame } from "./longAudio";

function wav(samples: Int16Array, channels: number, sampleRate: number, declared = samples.length * 2) {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + declared, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, declared, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, value, true));
  return new File([out], "take.wav", { type: "audio/wav" });
}

class FakeAudioBuffer {
  readonly channels: Float32Array[];
  readonly length: number;
  readonly sampleRate: number;
  constructor({ numberOfChannels, length, sampleRate }: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    this.length = length;
    this.sampleRate = sampleRate;
  }
  get numberOfChannels() {
    return this.channels.length;
  }
  getChannelData(index: number) {
    return this.channels[index];
  }
}

describe("fillFrames", () => {
  it("reads 16-bit, 24-bit and float samples into their channels", () => {
    const left = new Float32Array(2);
    const right = new Float32Array(2);
    const pcm16 = new Int16Array([16384, -32768, 0, 32767]).buffer;
    expect(fillFrames([left, right], pcm16, { format: "int", bits: 16 }, 0)).toBe(2);
    expect([...left]).toEqual([0.5, 0]);
    expect(right[0]).toBe(-1);

    const mono = new Float32Array(2);
    const pcm24 = new Uint8Array([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]).buffer;
    fillFrames([mono], pcm24, { format: "int", bits: 24 }, 0);
    expect([...mono]).toEqual([0.5, -0.5]);

    const floats = new Float32Array(1);
    fillFrames([floats], new Float32Array([0.25]).buffer, { format: "float", bits: 32 }, 0);
    expect(floats[0]).toBe(0.25);
  });
});

describe("streamWav", () => {
  const original = (globalThis as { AudioBuffer?: unknown }).AudioBuffer;
  beforeEach(() => {
    (globalThis as { AudioBuffer?: unknown }).AudioBuffer = FakeAudioBuffer;
  });
  afterEach(() => {
    (globalThis as { AudioBuffer?: unknown }).AudioBuffer = original;
  });

  it("reads every frame at the file's own rate, and only as much as it is told to keep", async () => {
    const samples = new Int16Array(16_000 * 2);
    for (let index = 0; index < samples.length; index += 1) samples[index] = index % 2 ? -8192 : 8192;
    const file = wav(samples, 2, 8000);
    const progress: number[] = [];
    const whole = await streamWav(file, undefined, (fraction) => progress.push(fraction));
    expect(whole.length).toBe(16_000);
    expect(whole.sampleRate).toBe(8000);
    expect(whole.getChannelData(0)[15_999]).toBe(0.25);
    expect(whole.getChannelData(1)[0]).toBe(-0.25);
    expect(progress.at(-1)).toBe(1);

    const part = await streamWav(file, 1);
    expect(part.length).toBe(8000);
  });

  it("trusts the file's length over a header that claims more", async () => {
    const buffer = await streamWav(wav(new Int16Array(200), 1, 8000, 0xffffffff));
    expect(buffer.length).toBe(200);
  });
});

describe("cutWav", () => {
  it("keeps the header and the first seconds, and writes their length into it", async () => {
    const samples = Int16Array.from({ length: 8000 * 3 }, (_, index) => index);
    const part = await cutWav(wav(samples, 1, 8000), 2);
    expect(part.name).toBe("take (חלק ראשון).wav");
    const bytes = new Uint8Array(await part.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(44 + 8000 * 2 * 2);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint32(40, true)).toBe(8000 * 2 * 2);
    expect(view.getInt16(44 + 2 * 15_999, true)).toBe(15_999);
  });
});

describe("cutMp3", () => {
  // CBR MPEG-1 Layer III: 128 kbit/s, 44.1 kHz, joint stereo; 417 bytes a frame.
  const LENGTH = 417;
  function mp3(frames: number, xing: boolean) {
    const out = new Uint8Array(LENGTH * frames);
    for (let index = 0; index < frames; index += 1) out.set([0xff, 0xfb, 0x90, 0x40], index * LENGTH);
    if (xing) {
      const view = new DataView(out.buffer);
      out.set([0x58, 0x69, 0x6e, 0x67], 36); // "Xing" after 32 bytes of side info
      view.setUint32(40, 3); // frames and bytes
      view.setUint32(44, frames - 1);
      view.setUint32(48, out.length);
    }
    return new File([out], "set.mp3", { type: "audio/mpeg" });
  }

  it("cuts after a whole frame once enough seconds are counted", async () => {
    const seconds = 1152 / 44_100;
    const part = await cutMp3(mp3(100, false), seconds * 9.5);
    const bytes = new Uint8Array(await part.arrayBuffer());
    expect(bytes.length).toBe(LENGTH * 10);
    expect(readMp3Frame(bytes, LENGTH * 9)).not.toBeNull();
  });

  it("rewrites the Xing header to the frames and bytes that remain", async () => {
    const part = await cutMp3(mp3(100, true), (1152 / 44_100) * 19.5);
    const view = new DataView(await part.arrayBuffer());
    expect(view.byteLength).toBe(LENGTH * 20);
    expect(view.getUint32(44)).toBe(19);
    expect(view.getUint32(48)).toBe(LENGTH * 20);
  });
});
