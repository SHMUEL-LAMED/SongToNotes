import {
  selectBackend,
  transcribeSamples,
  type Timings,
} from "../lib/pitchModel";
import type { DetectedNote } from "../lib/types";

export type WorkerRequest = {
  type: "transcribe";
  jobId: number;
  samples: Float32Array;
  /** 0..1 — lower values keep only the notes the model is sure about. */
  detectionLevel: number;
  /**
   * Refuse the job rather than running it on the CPU kernels, so the caller
   * can retry on the main thread where a real canvas may unlock the GPU.
   */
  requireGpu: boolean;
};

export type WorkerResponse =
  | { type: "progress"; jobId: number; progress: number }
  | { type: "backend"; jobId: number; backend: string }
  | { type: "no-gpu"; jobId: number; samples: Float32Array }
  | { type: "done"; jobId: number; notes: DetectedNote[]; timings: Timings }
  | { type: "error"; jobId: number; message: string };

// The project's tsconfig uses the DOM lib, so `self` is typed as a Window and
// its postMessage overloads do not match the worker one.
const postToHost = self.postMessage.bind(self) as (
  message: WorkerResponse,
  transfer?: Transferable[],
) => void;

function post(message: WorkerResponse, transfer?: Transferable[]) {
  postToHost(message, transfer);
}

async function handle(request: WorkerRequest) {
  const { jobId, samples, detectionLevel, requireGpu } = request;

  const backend = await selectBackend();
  post({ type: "backend", jobId, backend });

  if (requireGpu && backend !== "webgl") {
    // Hand the audio back untouched so the retry costs nothing but a message.
    post({ type: "no-gpu", jobId, samples }, [samples.buffer]);
    return;
  }

  const { notes, timings } = await transcribeSamples(
    samples,
    detectionLevel,
    (progress) => post({ type: "progress", jobId, progress }),
  );

  post({ type: "done", jobId, notes, timings });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "transcribe") return;
  try {
    await handle(request);
  } catch (error) {
    post({
      type: "error",
      jobId: request.jobId,
      message: error instanceof Error ? error.message : "שגיאה לא ידועה",
    });
  }
};
