import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
  type NoteEventTime,
} from "@spotify/basic-pitch";
import * as tf from "@tensorflow/tfjs";
import {
  modelJson as bundledModelJson,
  modelWeightsBase64,
} from "virtual:basic-pitch-model";

export type TranscriptionOptions = {
  sensitivity: number;
};

let engine: BasicPitch | null = null;
const MODEL_SAMPLE_RATE = 22_050;

function decodeModelWeights(base64: string) {
  const binary = window.atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return buffer;
}

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

  const modelArtifacts: tf.io.ModelArtifacts = {
    modelTopology: modelJson.modelTopology,
    weightSpecs,
    weightData,
    format: modelJson.format,
    generatedBy: modelJson.generatedBy,
    convertedBy: modelJson.convertedBy,
  };

  return tf.loadGraphModel(tf.io.fromMemory(modelArtifacts));
}

function getEngine() {
  if (!engine) {
    engine = new BasicPitch(loadBundledModel());
  }
  return engine;
}

async function normalizeAudioBuffer(audioBuffer: AudioBuffer) {
  if (
    audioBuffer.sampleRate === MODEL_SAMPLE_RATE &&
    audioBuffer.numberOfChannels === 1
  ) {
    return audioBuffer;
  }

  const OfflineAudioContextClass =
    window.OfflineAudioContext ||
    (window as typeof window & {
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
    }).webkitOfflineAudioContext;

  if (!OfflineAudioContextClass) {
    throw new Error("הדפדפן הזה אינו תומך בהמרת קצב הדגימה של השיר.");
  }

  const frameCount = Math.max(
    1,
    Math.ceil(audioBuffer.duration * MODEL_SAMPLE_RATE),
  );
  const offlineContext = new OfflineAudioContextClass(
    1,
    frameCount,
    MODEL_SAMPLE_RATE,
  );
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);

  return offlineContext.startRendering();
}

export async function transcribeAudio(
  file: File,
  options: TranscriptionOptions,
  onProgress: (progress: number) => void,
): Promise<NoteEventTime[]> {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  }

  onProgress(2);
  const audioContext = new AudioContextClass();

  try {
    const decodedAudioBuffer = await audioContext.decodeAudioData(
      await file.arrayBuffer(),
    );
    onProgress(5);
    const audioBuffer = await normalizeAudioBuffer(decodedAudioBuffer);
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    onProgress(8);
    await getEngine().evaluateModel(
      audioBuffer,
      (frameBatch, onsetBatch, contourBatch) => {
        frames.push(...frameBatch);
        onsets.push(...onsetBatch);
        contours.push(...contourBatch);
      },
      (progress) => onProgress(8 + Math.round(progress * 82)),
    );

    const normalizedSensitivity = Math.min(
      1,
      Math.max(0, options.sensitivity / 100),
    );
    const onsetThreshold = 0.48 - normalizedSensitivity * 0.25;
    const frameThreshold = 0.38 - normalizedSensitivity * 0.2;

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

    const notes = noteFramesToTime(
      addPitchBendsToNoteEvents(contours, noteEvents),
    )
      .filter((note) => note.durationSeconds >= 0.045)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    onProgress(100);
    return notes;
  } catch (error) {
    const message = error instanceof Error ? error.message : "שגיאה לא ידועה";
    throw new Error(`לא הצלחנו לנתח את הקובץ. ${message}`);
  } finally {
    await audioContext.close();
  }
}
