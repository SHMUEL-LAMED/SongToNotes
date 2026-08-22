import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import * as tf from "@tensorflow/tfjs";
import {
  modelJson as bundledModelJson,
  modelWeightsBase64,
} from "virtual:basic-pitch-model";
import type { DetectedNote } from "../lib/types";

export type WorkerRequest = {
  type: "transcribe";
  jobId: number;
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

function decodeModelWeights(base64: string) {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

/**
 * The weights ship inside the bundle rather than being fetched, because
 * serving them as a separate binary produced truncated, unusable downloads.
 * Decoding them here keeps that work off the main thread as well.
 */
async function loadBundledModel() {
  const modelJson = JSON.parse(bundledModelJson) as {
    modelTopology: tf.io.ModelArtifacts["modelTopology"];
    weightsManifest: tf.io.WeightsManifestConfig;
    format?: string;
    generatedBy?: string;
    convertedBy?: string;
  };
  const weightSpecs = modelJson.weightsManifest.flatMap(
    (group) => group.weights,
  );
  const weightData = decodeModelWeights(modelWeightsBase64);

  if (weightData.byteLength % 4 !== 0) {
    throw new Error("מודל זיהוי התווים נטען באופן חלקי. יש לרענן את הדף.");
  }

  return tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: modelJson.modelTopology,
      weightSpecs,
      weightData,
      format: modelJson.format,
      generatedBy: modelJson.generatedBy,
      convertedBy: modelJson.convertedBy,
    }),
  );
}

function getEngine() {
  if (!engine) engine = new BasicPitch(loadBundledModel());
  return engine;
}

function post(message: WorkerResponse) {
  self.postMessage(message);
}

async function transcribe(request: WorkerRequest) {
  const { jobId, samples, detectionLevel } = request;

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  post({ type: "progress", jobId, progress: 4 });

  const pitchEngine = getEngine();
  await pitchEngine.model;
  tf.engine().startScope();
  try {
    await pitchEngine.evaluateModel(
      samples,
      (frameBatch, onsetBatch, contourBatch) => {
        // Concatenating with a spread would blow the argument limit on long
        // recordings, so the batches are appended one row at a time.
        for (const row of frameBatch) frames.push(row);
        for (const row of onsetBatch) onsets.push(row);
        for (const row of contourBatch) contours.push(row);
      },
      (progress) => {
        post({
          type: "progress",
          jobId,
          progress: 4 + Math.round(progress * 90),
        });
      },
    );
  } finally {
    // Basic Pitch creates temporary tensors for every chunk. Keeping them
    // around eventually crashes repeated analyses on phones and long songs.
    tf.engine().endScope();
  }

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
