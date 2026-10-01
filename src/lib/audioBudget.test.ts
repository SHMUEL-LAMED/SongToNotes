import { describe, expect, it } from "vitest";
import { detectDevice, deviceLimits, judgeFit, probeAudio, SAFE_BYTES } from "./audioBudget";

const MB = 1024 * 1024;

function wavHead(channels: number, sampleRate: number, bits = 16) {
  const out = new Uint8Array(44);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  out.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, 0xffffffff, true);
  return out;
}

/** A run of CBR MPEG-1 Layer III frames: 128 kbit/s, 44.1 kHz, joint stereo. */
function mp3Head(frames = 8) {
  const length = Math.floor((1152 / 8) * 128_000 / 44_100);
  const out = new Uint8Array(length * frames);
  for (let index = 0; index < frames; index += 1) out.set([0xff, 0xfb, 0x90, 0x40], index * length);
  return out;
}

function flacHead(sampleRate: number, channels: number, total: number) {
  const out = new Uint8Array(42);
  out.set([0x66, 0x4c, 0x61, 0x43], 0);
  out[4] = 0x80; // last block, STREAMINFO
  out[7] = 34;
  out[18] = (sampleRate >> 12) & 0xff;
  out[19] = (sampleRate >> 4) & 0xff;
  out[20] = ((sampleRate & 0x0f) << 4) | ((channels - 1) << 1);
  out[21] = Math.floor(total / 2 ** 32) & 0x0f;
  new DataView(out.buffer).setUint32(22, total >>> 0);
  return out;
}

describe("probeAudio", () => {
  it("measures a WAV by the file's length, not its placeholder header", () => {
    const probe = probeAudio(wavHead(2, 44_100), 44 + 44_100 * 4 * 600);
    expect(probe?.channels).toBe(2);
    expect(probe?.seconds).toBeCloseTo(600, 3);
  });

  it("reads a FLAC's sample count", () => {
    const probe = probeAudio(flacHead(48_000, 2, 48_000 * 3600), 500 * MB);
    expect(probe).toEqual({ seconds: 3600, channels: 2 });
  });

  it("works out a CBR MP3's length from its bitrate", () => {
    const size = 128_000 / 8 * 1800;
    const probe = probeAudio(mp3Head(), size);
    expect(probe?.channels).toBe(2);
    expect(probe!.seconds!).toBeCloseTo(1800, -1);
  });

  it("knows nothing of a format it cannot read", () => {
    expect(probeAudio(new Uint8Array(64), 100 * MB)).toBeNull();
  });
});

describe("judgeFit", () => {
  const computer = deviceLimits("computer");
  const phone = deviceLimits("phone");

  it("never turns away a file the old limit took", () => {
    const longMp3 = { seconds: 5 * 3600, channels: 2 };
    expect(judgeFit({ name: "a.mp3", type: "audio/mpeg", size: SAFE_BYTES }, longMp3, phone)).toEqual({ ok: true });
  });

  it("takes a half-hour 300MB WAV on a phone and a computer", () => {
    const file = { name: "take.wav", type: "audio/wav", size: 300 * MB };
    const probe = { seconds: 1800, channels: 2 };
    expect(judgeFit(file, probe, computer).ok).toBe(true);
    expect(judgeFit({ ...file, size: 150 * MB }, { seconds: 900, channels: 2 }, phone).ok).toBe(true);
  });

  it("turns a three-hour MP3 away on a phone but takes it on a computer up to the budget", () => {
    const file = { name: "set.mp3", type: "audio/mpeg", size: 170 * MB };
    expect(judgeFit(file, { seconds: 3 * 3600, channels: 2 }, phone)).toMatchObject({ ok: false, reason: "length" });
    expect(judgeFit(file, { seconds: 2 * 3600, channels: 2 }, computer).ok).toBe(true);
  });

  it("refuses anything past the device's byte limit", () => {
    const file = { name: "huge.wav", type: "audio/wav", size: computer.maxBytes + 1 };
    expect(judgeFit(file, { seconds: 60, channels: 1 }, computer)).toMatchObject({ ok: false, reason: "bytes" });
  });

  it("guesses conservatively when the header says nothing", () => {
    const file = { name: "song.m4a", type: "audio/mp4", size: 200 * MB };
    expect(judgeFit(file, null, computer).ok).toBe(false);
    expect(judgeFit({ ...file, size: 100 * MB }, null, computer).ok).toBe(true);
  });
});

describe("detectDevice", () => {
  const nav = (fields: Record<string, unknown>) => fields as unknown as Navigator;

  it("tells phones and tablets from computers", () => {
    expect(detectDevice(nav({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }))).toBe("phone");
    expect(detectDevice(nav({ userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 }))).toBe("phone");
    expect(detectDevice(nav({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", deviceMemory: 8 }))).toBe("computer");
    expect(detectDevice(nav({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", deviceMemory: 2 }))).toBe("phone");
  });
});
