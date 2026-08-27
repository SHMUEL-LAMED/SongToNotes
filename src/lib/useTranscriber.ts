import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../workers/transcribe.worker";
import type { DetectedNote } from "./types";

/**
 * The model runs permissively and every user-facing control filters the notes
 * afterwards, so the expensive pass happens once per recording rather than
 * once per slider move.
 */
const DETECTION_LEVEL = 0.8;

import type { Timings } from "./pitchModel";

export type { Timings };

export type TranscriberState = {
  isRunning: boolean;
  progress: number;
  error: string | null;
  /** Which tfjs backend the run settled on, once it has chosen. */
  backend: string | null;
  timings: Timings | null;
  /** True while the run has moved to the main thread for GPU access. */
  onMainThread: boolean;
};

/**
 * Whether this thread could give tfjs a GPU. Used to decide if it is worth
 * asking the worker to hand a job back: if there is no WebGL here either, the
 * retry would only cost a round trip and lose the responsive UI for nothing.
 */
function mainThreadHasWebgl() {
  try {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    if (!context) return false;
    (context as WebGLRenderingContext)
      .getExtension("WEBGL_lose_context")
      ?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function useTranscriber() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const pendingRef = useRef<{
    resolve: (notes: DetectedNote[]) => void;
    reject: (error: Error) => void;
  } | null>(null);
  // Set once a main-thread retry has also landed on the CPU kernels. Some
  // browsers hand out a WebGL context that tfjs then cannot use, so the only
  // reliable evidence is having tried; after that, runs stay in the worker
  // where at least the page keeps responding.
  const mainThreadGpuFailedRef = useRef(false);

  const [state, setState] = useState<TranscriberState>({
    isRunning: false,
    progress: 0,
    error: null,
    backend: null,
    timings: null,
    onMainThread: false,
  });

  const teardown = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  /**
   * Second attempt when the worker could not reach the GPU. A worker needs a
   * WebGL2 context on an OffscreenCanvas, which several browsers — notably
   * older mobile Safari — do not provide, and falling through to the
   * JavaScript kernels there turns a few seconds of work into a minute or
   * more. The main thread has a real canvas, so the GPU is usually available;
   * the page stops responding for the duration, which is far the lesser cost.
   *
   * The model code is pulled in on demand so this path adds nothing to the
   * initial download.
   */
  const runOnMainThread = useCallback(
    async (jobId: number, samples: Float32Array) => {
      if (jobRef.current !== jobId) return;
      setState((previous) => ({ ...previous, onMainThread: true }));
      try {
        const { transcribeSamples } = await import("./pitchModel");
        const { notes, timings } = await transcribeSamples(
          samples,
          DETECTION_LEVEL,
          (progress) => {
            if (jobRef.current !== jobId) return;
            setState((previous) => ({ ...previous, progress }));
          },
        );
        if (timings.backend !== "webgl") mainThreadGpuFailedRef.current = true;
        if (jobRef.current !== jobId) return;
        setState((previous) => ({
          ...previous,
          isRunning: false,
          progress: 100,
          error: null,
          backend: timings.backend,
          timings,
        }));
        pendingRef.current?.resolve(notes);
        pendingRef.current = null;
      } catch (error) {
        if (jobRef.current !== jobId) return;
        const message =
          error instanceof Error ? error.message : "העיבוד נכשל.";
        setState((previous) => ({
          ...previous,
          isRunning: false,
          progress: 0,
          error: message,
        }));
        pendingRef.current?.reject(new Error(message));
        pendingRef.current = null;
      }
    },
    [],
  );

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(
      new URL("../workers/transcribe.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.jobId !== jobRef.current) return;
      if (message.type === "progress") {
        setState((previous) => ({ ...previous, progress: message.progress }));
      } else if (message.type === "backend") {
        setState((previous) => ({ ...previous, backend: message.backend }));
      } else if (message.type === "no-gpu") {
        void runOnMainThread(message.jobId, message.samples);
      } else if (message.type === "done") {
        setState((previous) => ({
          ...previous,
          isRunning: false,
          progress: 100,
          error: null,
          timings: message.timings,
        }));
        pendingRef.current?.resolve(message.notes);
        pendingRef.current = null;
      } else if (message.type === "error") {
        setState((previous) => ({
          ...previous,
          isRunning: false,
          progress: 0,
          error: message.message,
        }));
        pendingRef.current?.reject(new Error(message.message));
        pendingRef.current = null;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };
    worker.onerror = (event) => {
      const message = event.message || "העיבוד נכשל.";
      setState((previous) => ({
        ...previous,
        isRunning: false,
        progress: 0,
        error: message,
      }));
      pendingRef.current?.reject(new Error(message));
      pendingRef.current = null;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    workerRef.current = worker;
    return worker;
  }, [runOnMainThread]);

  const cancel = useCallback(() => {
    if (!pendingRef.current) return;
    // Inference cannot be interrupted mid-tensor, so the worker is discarded
    // and a fresh one is created for the next run.
    jobRef.current += 1;
    pendingRef.current.reject(new Error("הניתוח בוטל."));
    pendingRef.current = null;
    teardown();
    setState((previous) => ({
      ...previous,
      isRunning: false,
      progress: 0,
      error: null,
    }));
  }, [teardown]);

  const transcribe = useCallback(
    (samples: Float32Array) => {
      const worker = ensureWorker();
      jobRef.current += 1;
      const jobId = jobRef.current;
      setState((previous) => ({
        ...previous,
        isRunning: true,
        progress: 0,
        error: null,
        onMainThread: false,
      }));

      return new Promise<DetectedNote[]>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        const request: WorkerRequest = {
          type: "transcribe",
          jobId,
          samples,
          detectionLevel: DETECTION_LEVEL,
          requireGpu: !mainThreadGpuFailedRef.current && mainThreadHasWebgl(),
        };
        // The sample buffer is handed over rather than copied.
        worker.postMessage(request, [samples.buffer]);
      });
    },
    [ensureWorker],
  );

  return { ...state, transcribe, cancel };
}
