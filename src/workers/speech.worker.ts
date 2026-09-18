/**
 * Speech to text, off the page's thread.
 *
 * The recogniser is Whisper, run in the browser through transformers.js: the
 * model is fetched once from the Hugging Face hub into the browser's cache
 * and then runs on the device — WebGPU where the browser offers it, plain
 * WebAssembly otherwise. The audio never leaves the device.
 *
 * transformers.js and its runtime are several megabytes, so they are
 * imported only when the first transcription is asked for.
 */
import type { TranscriptSegment } from "../lib/transcript";

export type SpeechRequest = {
  type: "transcribe";
  jobId: number;
  /** Mono, 16 kHz — what the model was trained on. */
  samples: Float32Array;
  model: string;
  language: string | null;
};

export type SpeechResponse =
  | { type: "loading"; jobId: number; file: string; progress: number; device: string }
  | { type: "status"; jobId: number; message: string }
  | { type: "progress"; jobId: number; progress: number; text: string }
  | { type: "done"; jobId: number; segments: TranscriptSegment[]; elapsed: number; device: string }
  | { type: "error"; jobId: number; message: string };

const SAMPLE_RATE = 16_000;

const post = self.postMessage.bind(self) as (message: SpeechResponse) => void;

type Transformers = typeof import("@huggingface/transformers");
type Recogniser = Awaited<ReturnType<Transformers["pipeline"]>>;

let library: Promise<Transformers> | null = null;
const recognisers = new Map<string, Promise<{ pipe: Recogniser; device: string }>>();

function loadLibrary() {
  if (!library) {
    library = import("@huggingface/transformers").then((module) => {
      const { env } = module;
      // The runtime's WebAssembly ships with the site rather than being
      // fetched from a CDN by every visitor.
      env.backends.onnx.wasm!.wasmPaths = new URL(
        `${import.meta.env.BASE_URL}ort/`,
        self.location.origin,
      ).toString();
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return module;
    });
  }
  return library;
}

function hasWebGpu() {
  return typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";
}

/**
 * One recogniser per model, built on first use and kept for the next file.
 * WebGPU is tried first where the browser exposes it; a device that exposes
 * it and then fails to build the session falls back to WebAssembly.
 */
function loadRecogniser(model: string, jobId: number) {
  const existing = recognisers.get(model);
  if (existing) return existing;
  const attempt = (async () => {
    const { pipeline } = await loadLibrary();
    const devices: ("webgpu" | "wasm")[] = hasWebGpu() ? ["webgpu", "wasm"] : ["wasm"];
    let lastError: unknown = null;
    for (const device of devices) {
      try {
        const pipe = await pipeline("automatic-speech-recognition", model, {
          device,
          // Full precision for the encoder on the GPU; the decoder and the
          // whole CPU path run quantised, which is what fits a phone.
          dtype:
            device === "webgpu"
              ? { encoder_model: "fp32", decoder_model_merged: "q4" }
              : { encoder_model: "q8", decoder_model_merged: "q8" },
          progress_callback: (event: { status: string; file?: string; progress?: number }) => {
            if (event.status === "progress" && event.file) {
              post({
                type: "loading",
                jobId,
                file: event.file,
                progress: Math.round(event.progress ?? 0),
                device,
              });
            }
          },
        });
        return { pipe, device };
      } catch (error) {
        lastError = error;
        // A download that failed will fail again on the other device.
        if (isNetworkError(error)) break;
      }
    }
    throw lastError ?? new Error("no device");
  })();
  recognisers.set(model, attempt);
  attempt.catch(() => recognisers.delete(model));
  return attempt;
}

function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network|Failed to load|404|403|ENOTFOUND|NetworkError|Unable to load/i.test(message);
}

function describe(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isNetworkError(error)) {
    return "לא הצלחנו להוריד את מודל הזיהוי. בדוק את החיבור לאינטרנט ונסה שוב — ההורדה נדרשת רק בפעם הראשונה.";
  }
  if (/memory|allocation|OOM/i.test(message)) {
    return "נגמר הזיכרון בזמן הזיהוי. נסה את המודל המהיר, או קטע קצר יותר.";
  }
  return `הזיהוי נכשל: ${message}`;
}

self.onmessage = async (event: MessageEvent<SpeechRequest>) => {
  const request = event.data;
  if (request.type !== "transcribe") return;
  const { jobId, samples, model, language } = request;
  const started = Date.now();
  const duration = samples.length / SAMPLE_RATE;

  try {
    post({ type: "status", jobId, message: "מכין את מנוע הזיהוי…" });
    const { pipe, device } = await loadRecogniser(model, jobId);
    const { WhisperTextStreamer } = await loadLibrary();
    post({ type: "status", jobId, message: "מאזין…" });

    // The streamer is how progress and the running text reach the page: a
    // chunk starts at a known second, so the fraction done is that over the
    // whole length; every finished sentence is sent as it lands.
    let partial = "";
    const tokenizer = (pipe as unknown as { tokenizer: ConstructorParameters<typeof WhisperTextStreamer>[0] }).tokenizer;
    const streamer = new WhisperTextStreamer(tokenizer, {
      skip_prompt: true,
      time_precision: 0.02,
      on_chunk_start: (time: number) => {
        post({
          type: "progress",
          jobId,
          progress: Math.min(99, Math.round((time / Math.max(1, duration)) * 100)),
          text: partial,
        });
      },
      callback_function: (text: string) => {
        partial += text;
        post({ type: "progress", jobId, progress: -1, text: partial });
      },
    });

    const output = (await (pipe as unknown as (
      audio: Float32Array,
      options: Record<string, unknown>,
    ) => Promise<unknown>)(samples, {
      // Whisper hears thirty seconds at a time; overlapping the windows keeps
      // a word cut by the boundary from being lost or said twice.
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      language: language ?? undefined,
      task: "transcribe",
      streamer,
    })) as { text?: string; chunks?: { timestamp: [number, number | null]; text: string }[] };

    const segments: TranscriptSegment[] = (output.chunks ?? [])
      .map((chunk) => ({
        start: Math.max(0, Number(chunk.timestamp?.[0] ?? 0)),
        end: typeof chunk.timestamp?.[1] === "number" ? chunk.timestamp[1] : null,
        text: (chunk.text ?? "").trim(),
      }))
      .filter((segment) => segment.text.length > 0);
    // A model that returned no chunk boundaries still returned the text.
    if (segments.length === 0 && output.text?.trim()) {
      segments.push({ start: 0, end: duration, text: output.text.trim() });
    }

    post({ type: "done", jobId, segments, elapsed: Date.now() - started, device });
  } catch (error) {
    post({ type: "error", jobId, message: describe(error) });
  }
};
