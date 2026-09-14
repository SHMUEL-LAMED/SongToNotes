import type { DemucsResult, DemucsStem } from "demucs-web";

export type SeparationProgress = {
  phase: "model" | "separation";
  progress: number;
  message: string;
};
export type SeparatedStems = {
  vocals: [Float32Array, Float32Array];
  instrumental: [Float32Array, Float32Array];
  sampleRate: number;
};

const MODEL_SAMPLE_RATE = 44_100;
let processorPromise: Promise<import("demucs-web").DemucsProcessor> | null = null;

async function resampleStereo(buffer: AudioBuffer) {
  const frameCount = Math.max(1, Math.ceil(buffer.duration * MODEL_SAMPLE_RATE));
  const offline = new OfflineAudioContext(2, frameCount, MODEL_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0).slice();
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1).slice() : left.slice();
  return { left, right };
}

function sumInstrumental(result: DemucsResult): [Float32Array, Float32Array] {
  const tracks: DemucsStem[] = [result.drums, result.bass, result.other];
  const length = result.vocals.left.length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const track of tracks) {
    for (let index = 0; index < length; index += 1) {
      left[index] += track.left[index] ?? 0;
      right[index] += track.right[index] ?? 0;
    }
  }
  return [left, right];
}

async function getProcessor(onProgress: (update: SeparationProgress) => void) {
  if (!processorPromise) {
    processorPromise = (async () => {
      const [ort, demucs] = await Promise.all([import("onnxruntime-web"), import("demucs-web")]);
      ort.env.wasm.numThreads = 1;
      const processor = new demucs.DemucsProcessor({
        ort,
        sessionOptions: {
          executionProviders: "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"],
          graphOptimizationLevel: "all",
          enableCpuMemArena: false,
          enableMemPattern: false,
        },
        onDownloadProgress: (loaded, total) => {
          const progress = total > 0 ? loaded / total : 0;
          onProgress({ phase: "model", progress, message: `מוריד את מודל ההפרדה בפעם הראשונה… ${Math.round(progress * 100)}%` });
        },
      });
      await processor.loadModel(demucs.CONSTANTS.DEFAULT_MODEL_URL);
      return processor;
    })().catch((error) => {
      processorPromise = null;
      throw error;
    });
  }
  return processorPromise;
}

export async function separateStems(buffer: AudioBuffer, onProgress: (update: SeparationProgress) => void): Promise<SeparatedStems> {
  onProgress({ phase: "model", progress: 0, message: "מכין את מודל ה־AI…" });
  const processor = await getProcessor(onProgress);
  const { left, right } = await resampleStereo(buffer);
  processor.onProgress = ({ progress, currentSegment, totalSegments }) => {
    onProgress({ phase: "separation", progress, message: `מפריד את השיר באמת… קטע ${currentSegment} מתוך ${totalSegments}` });
  };
  const result = await processor.separate(left, right);
  return {
    vocals: [result.vocals.left, result.vocals.right],
    instrumental: sumInstrumental(result),
    sampleRate: MODEL_SAMPLE_RATE,
  };
}
