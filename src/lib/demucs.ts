/**
 * The neural separator.
 *
 * Demucs is a real source-separation network and it is a different class of
 * result from anything the stereo image can give you: it pulls a voice out of
 * a mono recording, out of a dense mix, and out of material where the singer
 * is not centred at all. The cost is that it needs WebGPU and downloads about
 * 170 MB the first time, so it is offered as a choice rather than used by
 * default, and everything still works without it.
 *
 * The model and the runtime are fetched from a CDN at the moment they are
 * asked for. Nothing is downloaded, and no network request of any kind is
 * made, unless the visitor presses the button.
 */

const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.min.mjs";
const DEMUCS_URL = "https://cdn.jsdelivr.net/npm/demucs-web@1.0.2/+esm";

/** The rate the network was trained at; anything else has to be resampled. */
export const DEMUCS_SAMPLE_RATE = 44_100;

export type Stems = {
  drums: { left: Float32Array; right: Float32Array };
  bass: { left: Float32Array; right: Float32Array };
  other: { left: Float32Array; right: Float32Array };
  vocals: { left: Float32Array; right: Float32Array };
};

type DemucsModule = {
  DemucsProcessor: new (config: {
    ort: unknown;
    sessionOptions: Record<string, unknown>;
    onDownloadProgress: (loaded: number, total: number) => void;
    onProgress: (info: { progress: number } | number) => void;
  }) => {
    loadModel: (url: string) => Promise<void>;
    separate: (left: Float32Array, right: Float32Array) => Promise<Stems>;
  };
  CONSTANTS: { DEFAULT_MODEL_URL: string };
};

export function isNeuralSeparationSupported() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export type NeuralProgress = {
  stage: "downloading" | "separating";
  /** 0..1 */
  fraction: number;
};

export async function separateWithDemucs(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  onProgress: (progress: NeuralProgress) => void,
): Promise<Stems> {
  if (!isNeuralSeparationSupported()) {
    throw new Error(
      "הפרדה בעזרת AI דורשת WebGPU, שאינו זמין בדפדפן הזה. נסה Chrome או Edge מעודכנים במחשב.",
    );
  }
  if (sampleRate !== DEMUCS_SAMPLE_RATE) {
    throw new Error("מודל ההפרדה עובד רק על קבצים בקצב דגימה של 44.1kHz.");
  }

  // Vite must not try to resolve or bundle a CDN address at build time.
  const ort = (await import(/* @vite-ignore */ ORT_URL)) as {
    env: { wasm: { numThreads: number } };
  };
  const { DemucsProcessor, CONSTANTS } = (await import(
    /* @vite-ignore */ DEMUCS_URL
  )) as DemucsModule;

  ort.env.wasm.numThreads = 1;
  const adapter = await (
    navigator as Navigator & {
      gpu: { requestAdapter: (options: unknown) => Promise<unknown> };
    }
  ).gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("לא נמצא מעבד גרפי מתאים להפרדה.");

  const processor = new DemucsProcessor({
    ort,
    sessionOptions: {
      executionProviders: ["webgpu"],
      enableCpuMemArena: false,
      enableMemPattern: false,
    },
    onDownloadProgress: (loaded, total) =>
      onProgress({
        stage: "downloading",
        fraction: total > 0 ? loaded / total : 0,
      }),
    onProgress: (info) =>
      onProgress({
        stage: "separating",
        fraction: typeof info === "number" ? info : (info?.progress ?? 0),
      }),
  });

  await processor.loadModel(CONSTANTS.DEFAULT_MODEL_URL);
  return processor.separate(left, right);
}

/** Sums the three non-vocal stems into one backing track. */
export function stemsToInstrumental(stems: Stems) {
  const length = stems.other.left.length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    left[index] =
      stems.drums.left[index] + stems.bass.left[index] + stems.other.left[index];
    right[index] =
      stems.drums.right[index] +
      stems.bass.right[index] +
      stems.other.right[index];
  }
  return { left, right };
}
