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
import { runInference } from "../workers/inference";
import type { DetectedNote } from "./types";

export type Timings = {
  backend: string;
  load: number;
  infer: number;
  decode: number;
};

export type TranscribeResult = {
  notes: DetectedNote[];
  timings: Timings;
};

let modelReady: Promise<tf.GraphModel> | null = null;
let backendReady: Promise<string> | null = null;

/**
 * tfjs 3.x reads GPU results by polling through
 * `platform.setTimeoutCustom`, whose first line touches the bare `window`
 * identifier. Inside a worker that is a ReferenceError thrown from a promise
 * nobody awaits, so `tensor.array()` never settles and the run hangs at 4%.
 * A plain setTimeout on the platform instance shadows the broken method.
 */
function patchWorkerPlatform() {
  if (typeof window !== "undefined") return;
  const platform = tf.env().platform as unknown as Record<string, unknown>;
  if (!platform || typeof platform.setTimeoutCustom !== "function") return;
  platform.setTimeoutCustom = (callback: () => void, delay: number) => {
    setTimeout(callback, delay);
  };
}

/**
 * Picks the fastest backend available here. The GPU path needs a WebGL2
 * context, which inside a worker means one on an OffscreenCanvas — not every
 * browser grants that. Where it is missing the only remaining option is the
 * plain-JavaScript kernels, an order of magnitude slower, so the caller is
 * told which one we landed on and can decide to run somewhere else instead.
 *
 * The WebAssembly backend would sit neatly in between, but it cannot execute
 * this model — it fails with "Unknown dtype undefined" — so it is not offered.
 */
export async function selectBackend(): Promise<string> {
  if (backendReady) return backendReady;

  backendReady = (async () => {
    patchWorkerPlatform();
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

export function getModel() {
  if (!modelReady) modelReady = loadBundledModel();
  return modelReady;
}

/**
 * The whole detection pass. Shared so it can run either inside the worker or,
 * when the worker cannot reach the GPU, on the main thread where a plain
 * canvas is available.
 */
export async function transcribeSamples(
  samples: Float32Array,
  detectionLevel: number,
  onProgress: (progress: number) => void,
): Promise<TranscribeResult> {
  const loadStart = performance.now();
  const backend = await selectBackend();
  const model = await getModel();
  const load = performance.now() - loadStart;

  onProgress(4);

  const inferStart = performance.now();
  // An outer scope backs up the per-batch disposal inside runInference, so a
  // stray tensor cannot survive a run and pile up across repeated analyses.
  tf.engine().startScope();
  let output;
  try {
    output = await runInference(model, samples, (fraction) => {
      onProgress(4 + Math.round(fraction * 90));
    });
  } finally {
    tf.engine().endScope();
  }
  const { frames, onsets, contours } = output;
  const infer = performance.now() - inferStart;

  const decodeStart = performance.now();
  onProgress(95);

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

  return {
    notes,
    timings: {
      backend,
      load: Math.round(load),
      infer: Math.round(infer),
      decode: Math.round(performance.now() - decodeStart),
    },
  };
}
