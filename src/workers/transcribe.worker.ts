import {
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
import { runInference } from "./inference";

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
  | { type: "backend"; jobId: number; backend: string }
  | {
      type: "done";
      jobId: number;
      notes: DetectedNote[];
      timings: { backend: string; load: number; infer: number; decode: number };
    }
  | { type: "error"; jobId: number; message: string };

let modelReady: Promise<tf.GraphModel> | null = null;
let backendReady: Promise<string> | null = null;

/**
 * Picks the fastest backend available. In a worker the GPU path needs a WebGL2
 * context on an OffscreenCanvas; where that is missing the only remaining
 * option is the plain-JavaScript kernels, which are an order of magnitude
 * slower, so which one we landed on is reported back to the UI.
 *
 * The WebAssembly backend would sit neatly in between, but it cannot execute
 * this model — it fails with "Unknown dtype undefined" — so it is not offered.
 */
async function selectBackend() {
  if (backendReady) return backendReady;

  backendReady = (async () => {
    try {
      if (await tf.setBackend("webgl")) {
        await tf.ready();
        return "webgl";
      }
    } catch {
      // Fall through to the CPU kernels.
    }
    await tf.setBackend("cpu");
    await tf.ready();
    return "cpu";
  })();

  return backendReady;
}

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

function getModel() {
  if (!modelReady) modelReady = loadBundledModel();
  return modelReady;
}

function post(message: WorkerResponse) {
  self.postMessage(message);
}

async function transcribe(request: WorkerRequest) {
  const { jobId, samples, detectionLevel } = request;

  const loadStart = performance.now();
  const backend = await selectBackend();
  post({ type: "backend", jobId, backend });
  const model = await getModel();
  const load = performance.now() - loadStart;

  post({ type: "progress", jobId, progress: 4 });

  const inferStart = performance.now();
  // An outer scope backs up the per-batch disposal inside runInference, so a
  // stray tensor cannot survive a run and pile up across repeated analyses.
  tf.engine().startScope();
  let output;
  try {
    output = await runInference(model, samples, (fraction) => {
      post({ type: "progress", jobId, progress: 4 + Math.round(fraction * 90) });
    });
  } finally {
    tf.engine().endScope();
  }
  const { frames, onsets, contours } = output;
  const infer = performance.now() - inferStart;
  const decodeStart = performance.now();
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

  post({
    type: "done",
    jobId,
    notes,
    timings: {
      backend,
      load: Math.round(load),
      infer: Math.round(infer),
      decode: Math.round(performance.now() - decodeStart),
    },
  });
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
