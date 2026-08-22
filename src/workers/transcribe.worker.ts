import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import type { DetectedNote } from "../lib/types";

export type WorkerRequest = {
  type: "transcribe";
  jobId: number;
  modelUrl: string;
  samples: Float32Array;
  /** 0..1 — lower values keep only the notes the model is sure about. */
  detectionLevel: number;
};

export type WorkerResponse =
  | { type: "ready"; jobId: number }
  | { type: "progress"; jobId: number; progress: number }
  | { type: "done"; jobId: number; notes: DetectedNote[] }
  | { type: "error"; jobId: number; message: string };

let engine: BasicPitch | null = null;
let engineUrl = "";

function getEngine(modelUrl: string) {
  if (!engine || engineUrl !== modelUrl) {
    engine = new BasicPitch(modelUrl);
    engineUrl = modelUrl;
  }
  return engine;
}

function post(message: WorkerResponse) {
  self.postMessage(message);
}

async function transcribe(request: WorkerRequest) {
  const { jobId, samples, detectionLevel, modelUrl } = request;

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  post({ type: "progress", jobId, progress: 4 });

  await getEngine(modelUrl).evaluateModel(
    samples,
    (frameBatch, onsetBatch, contourBatch) => {
      // Concatenating with a spread would blow the argument limit on long
      // recordings, so the batches are appended one row at a time.
      for (const row of frameBatch) frames.push(row);
      for (const row of onsetBatch) onsets.push(row);
      for (const row of contourBatch) contours.push(row);
    },
    (progress) => {
      post({ type: "progress", jobId, progress: 4 + Math.round(progress * 90) });
    },
  );

  post({ type: "progress", jobId, progress: 95 });

  // The model thresholds stay deliberately permissive: everything the user can
  // tune afterwards is applied to the note list, so changing a setting never
  // costs another inference pass.
  const onsetThreshold = 0.42 - detectionLevel * 0.22;
  const frameThreshold = 0.32 - detectionLevel * 0.16;

  const noteEvents = outputToNotesPoly(
    frames,
    onsets,
    onsetThreshold,
    frameThreshold,
    5,
    true,
    null,
    null,
    true,
    11,
  );

  const notes: DetectedNote[] = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, noteEvents),
  )
    .map((note) => ({
      midi: note.pitchMidi,
      start: note.startTimeSeconds,
      duration: note.durationSeconds,
      confidence: Math.max(0, Math.min(1, note.amplitude)),
    }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);

  post({ type: "done", jobId, notes });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "transcribe") return;
  try {
    await transcribe(request);
  } catch (error) {
    post({
      type: "error",
      jobId: request.jobId,
      message: error instanceof Error ? error.message : "שגיאה לא ידועה",
    });
  }
};
