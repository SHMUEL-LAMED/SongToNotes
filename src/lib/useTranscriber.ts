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

export type TranscriberState = {
  isRunning: boolean;
  progress: number;
  error: string | null;
};

export function useTranscriber() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const pendingRef = useRef<{
    resolve: (notes: DetectedNote[]) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const [state, setState] = useState<TranscriberState>({
    isRunning: false,
    progress: 0,
    error: null,
  });

  const teardown = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

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
      } else if (message.type === "done") {
        setState({ isRunning: false, progress: 100, error: null });
        pendingRef.current?.resolve(message.notes);
        pendingRef.current = null;
      } else if (message.type === "error") {
        setState({ isRunning: false, progress: 0, error: message.message });
        pendingRef.current?.reject(new Error(message.message));
        pendingRef.current = null;
      }
    };
    worker.onerror = (event) => {
      const message = event.message || "העיבוד נכשל.";
      setState({ isRunning: false, progress: 0, error: message });
      pendingRef.current?.reject(new Error(message));
      pendingRef.current = null;
    };
    workerRef.current = worker;
    return worker;
  }, []);

  const cancel = useCallback(() => {
    if (!pendingRef.current) return;
    // Inference cannot be interrupted mid-tensor, so the worker is discarded
    // and a fresh one is created for the next run.
    jobRef.current += 1;
    pendingRef.current.reject(new Error("הניתוח בוטל."));
    pendingRef.current = null;
    teardown();
    setState({ isRunning: false, progress: 0, error: null });
  }, [teardown]);

  const transcribe = useCallback(
    (samples: Float32Array) => {
      const worker = ensureWorker();
      jobRef.current += 1;
      const jobId = jobRef.current;
      setState({ isRunning: true, progress: 0, error: null });

      const modelUrl = new URL(
        `${import.meta.env.BASE_URL}model/model.json`,
        window.location.href,
      ).href;

      return new Promise<DetectedNote[]>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        const request: WorkerRequest = {
          type: "transcribe",
          jobId,
          modelUrl,
          samples,
          detectionLevel: DETECTION_LEVEL,
        };
        // The sample buffer is handed over rather than copied.
        worker.postMessage(request, [samples.buffer]);
      });
    },
    [ensureWorker],
  );

  return { ...state, transcribe, cancel };
}
