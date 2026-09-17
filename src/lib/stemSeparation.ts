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

/**
 * Download the model ourselves instead of asking demucs-web to fetch it.
 * Besides exposing real progress, this lets us reject a filtered/login/error
 * page before ONNX tries (and fails) to treat its HTML as a music model.
 */
async function downloadModel(
  url: string,
  onProgress: (update: SeparationProgress) => void,
): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "force-cache" });
  } catch {
    throw new Error("לא הצלחנו להגיע לשרת של מודל ההפרדה. בדוק חיבור לאינטרנט או חסימה של סינון הרשת.");
  }

  if (!response.ok) {
    throw new Error(`שרת מודל ההפרדה החזיר שגיאה (${response.status}). נסה שוב מאוחר יותר.`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) {
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error("מודל ההפרדה ירד כריק. נסה שוב.");
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress({
        phase: "model",
        progress: loaded / total,
        message: `מוריד את מודל ההפרדה בפעם הראשונה… ${Math.round((loaded / total) * 100)}%`,
      });
    }
  }
  if (loaded !== total) {
    throw new Error("הורדת מודל ההפרדה לא הושלמה. נסה שוב עם חיבור יציב.");
  }
  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

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
      const model = await downloadModel(demucs.CONSTANTS.DEFAULT_MODEL_URL, onProgress);
      const makeProcessor = (executionProviders: string[]) =>
        new demucs.DemucsProcessor({
          ort,
          sessionOptions: {
            executionProviders,
            graphOptimizationLevel: "all",
            enableCpuMemArena: false,
            enableMemPattern: false,
          },
        });

      // WebGPU is faster but some phones expose it without supporting the
      // operators used by Demucs. Retry with WebAssembly using the already
      // downloaded model instead of leaving the user with a dead button.
      if ("gpu" in navigator) {
        try {
          const processor = makeProcessor(["webgpu"]);
          await processor.loadModel(model);
          return processor;
        } catch {
          onProgress({ phase: "model", progress: 1, message: "WebGPU אינו נתמך במכשיר הזה; ממשיך במצב תאימות…" });
        }
      }
      const processor = makeProcessor(["wasm"]);
      await processor.loadModel(model);
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
