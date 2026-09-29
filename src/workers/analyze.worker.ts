/// <reference lib="webworker" />
import {
  averageLoudness,
  detectKeyFromAudio,
  detectTempoFromAudio,
  type AudioKey,
  type AudioTempo,
} from "../lib/dsp";

export type AnalyzeRequest = { mono: Float32Array; sampleRate: number };
export type AnalyzeResponse =
  | { type: "done"; tempo: AudioTempo; key: AudioKey; loudness: number }
  | { type: "error"; message: string };

/**
 * The tempo, key and loudness readers of "מזהה קצב וסולם". On a three-minute
 * song they take one to several seconds, which on the page's own thread froze
 * the whole site — the "listening" animation included — for that long.
 */
self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { mono, sampleRate } = event.data;
  try {
    // The readers take an AudioBuffer but only ever read its samples, so a
    // one-channel stand-in over the transferred mono copy is all they need.
    const buffer = {
      numberOfChannels: 1,
      length: mono.length,
      sampleRate,
      duration: mono.length / sampleRate,
      getChannelData: () => mono,
    } as unknown as AudioBuffer;
    const reply: AnalyzeResponse = {
      type: "done",
      tempo: detectTempoFromAudio(buffer),
      key: detectKeyFromAudio(buffer),
      loudness: averageLoudness(buffer),
    };
    self.postMessage(reply);
  } catch (caught) {
    const reply: AnalyzeResponse = {
      type: "error",
      message: caught instanceof Error ? caught.message : "הניתוח נכשל.",
    };
    self.postMessage(reply);
  }
};
