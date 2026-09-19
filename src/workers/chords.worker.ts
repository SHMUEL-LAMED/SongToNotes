/// <reference lib="webworker" />
import { detectChordTimeline, type ChordSegment } from "../lib/audioChords";

export type ChordsRequest = { jobId: number; mono: Float32Array; sampleRate: number };
export type ChordsResponse =
  | { type: "done"; jobId: number; segments: ChordSegment[]; elapsed: number }
  | { type: "error"; jobId: number; message: string };

self.onmessage = (event: MessageEvent<ChordsRequest>) => {
  const { jobId, mono, sampleRate } = event.data;
  const startedAt = Date.now();
  try {
    const segments = detectChordTimeline(mono, sampleRate);
    const reply: ChordsResponse = { type: "done", jobId, segments, elapsed: Date.now() - startedAt };
    self.postMessage(reply);
  } catch (caught) {
    const reply: ChordsResponse = {
      type: "error",
      jobId,
      message: caught instanceof Error ? caught.message : "זיהוי האקורדים נכשל.",
    };
    self.postMessage(reply);
  }
};
