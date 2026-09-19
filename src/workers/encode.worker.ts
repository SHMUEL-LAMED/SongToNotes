/// <reference lib="webworker" />
/**
 * MP3 encoding, off the page. The encoder is a JavaScript port of LAME
 * bundled with the site — nothing is fetched — and a four-minute song takes
 * a few seconds, which is why it runs here rather than in the click handler.
 */
import { Mp3Encoder } from "@breezystack/lamejs";

export type EncodeRequest = {
  jobId: number;
  channels: Float32Array[];
  sampleRate: number;
  kbps: number;
};
export type EncodeResponse =
  | { type: "progress"; jobId: number; fraction: number }
  | { type: "done"; jobId: number; bytes: ArrayBuffer }
  | { type: "error"; jobId: number; message: string };

function toInt16(channel: Float32Array) {
  const out = new Int16Array(channel.length);
  for (let index = 0; index < channel.length; index += 1) {
    const value = Math.max(-1, Math.min(1, channel[index]));
    out[index] = value < 0 ? value * 32768 : value * 32767;
  }
  return out;
}

self.onmessage = (event: MessageEvent<EncodeRequest>) => {
  const { jobId, channels, sampleRate, kbps } = event.data;
  try {
    const stereo = channels.length > 1;
    const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps);
    const left = toInt16(channels[0]);
    const right = stereo ? toInt16(channels[1]) : null;
    const block = 1152 * 8;
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let at = 0; at < left.length; at += block) {
      const chunk = stereo
        ? encoder.encodeBuffer(left.subarray(at, at + block), right!.subarray(at, at + block))
        : encoder.encodeBuffer(left.subarray(at, at + block));
      if (chunk.length) {
        parts.push(new Uint8Array(chunk));
        total += chunk.length;
      }
      if ((at / block) % 40 === 0) {
        const progress: EncodeResponse = { type: "progress", jobId, fraction: at / left.length };
        self.postMessage(progress);
      }
    }
    const tail = encoder.flush();
    if (tail.length) {
      parts.push(new Uint8Array(tail));
      total += tail.length;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const done: EncodeResponse = { type: "done", jobId, bytes: bytes.buffer };
    self.postMessage(done, [bytes.buffer]);
  } catch (caught) {
    const failed: EncodeResponse = { type: "error", jobId, message: caught instanceof Error ? caught.message : "הקידוד נכשל." };
    self.postMessage(failed);
  }
};
