import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechRequest, SpeechResponse } from "../workers/speech.worker";
import type { TranscriptSegment } from "./transcript";

export type SpeechPhase = "idle" | "loading" | "transcribing" | "done" | "error";

export type SpeechState = {
  phase: SpeechPhase;
  /** While loading: which file of the model is coming down, and how far. */
  loadingFile: string | null;
  loadProgress: number;
  /** While transcribing: seconds done over the whole, as a percentage. */
  progress: number;
  /** The text so far, sentence by sentence. */
  partial: string;
  status: string | null;
  error: string | null;
  /** How long the last run took, and on what. */
  elapsed: number | null;
  device: string | null;
};

const IDLE: SpeechState = {
  phase: "idle",
  loadingFile: null,
  loadProgress: 0,
  progress: 0,
  partial: "",
  status: null,
  error: null,
  elapsed: null,
  device: null,
};

/** Model files are named like `onnx/encoder_model_q8.onnx`; the part a person cares about. */
function shortFileName(file: string) {
  const base = file.split("/").pop() ?? file;
  if (/encoder/.test(base)) return "המקודד";
  if (/decoder/.test(base)) return "המפענח";
  if (/tokenizer|vocab|merges/.test(base)) return "המילון";
  return base;
}

/**
 * Runs the speech worker: one transcription at a time, with the model's
 * download and the running text reported as they happen. Asking for another
 * run while one is under way discards the first.
 */
export function useSpeech() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const pendingRef = useRef<{
    resolve: (segments: TranscriptSegment[]) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [state, setState] = useState<SpeechState>(IDLE);

  const teardown = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const settle = useCallback((message: SpeechResponse) => {
    if (message.jobId !== jobRef.current) return;
    switch (message.type) {
      case "loading":
        setState((previous) => ({
          ...previous,
          phase: "loading",
          loadingFile: shortFileName(message.file),
          loadProgress: message.progress,
          device: message.device,
          status: null,
        }));
        return;
      case "status":
        setState((previous) => ({ ...previous, status: message.message }));
        return;
      case "progress":
        setState((previous) => ({
          ...previous,
          phase: "transcribing",
          loadingFile: null,
          progress: message.progress >= 0 ? message.progress : previous.progress,
          partial: message.text,
          status: null,
        }));
        return;
      case "done":
        setState({
          ...IDLE,
          phase: "done",
          progress: 100,
          elapsed: message.elapsed,
          device: message.device,
        });
        pendingRef.current?.resolve(message.segments);
        pendingRef.current = null;
        return;
      case "error":
        setState({ ...IDLE, phase: "error", error: message.message });
        pendingRef.current?.reject(new Error(message.message));
        pendingRef.current = null;
    }
  }, []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("../workers/speech.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<SpeechResponse>) => settle(event.data);
    worker.onerror = (event) => {
      settle({
        type: "error",
        jobId: jobRef.current,
        message: event.message || "מנוע הזיהוי נכשל.",
      });
      teardown();
    };
    workerRef.current = worker;
    return worker;
  }, [settle, teardown]);

  const cancel = useCallback(() => {
    jobRef.current += 1;
    pendingRef.current?.reject(new Error("התמלול בוטל."));
    pendingRef.current = null;
    // A run cannot be interrupted from outside; the worker is discarded and
    // the model is loaded again next time — from the browser's cache.
    teardown();
    setState(IDLE);
  }, [teardown]);

  const transcribe = useCallback(
    (samples: Float32Array, options: { model: string; language: string | null }) => {
      jobRef.current += 1;
      const jobId = jobRef.current;
      setState({ ...IDLE, phase: "loading", status: "מכין את מנוע הזיהוי…" });
      return new Promise<TranscriptSegment[]>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        let worker: Worker;
        try {
          worker = ensureWorker();
        } catch {
          settle({ type: "error", jobId, message: "הדפדפן הזה אינו תומך בהרצת מנוע הזיהוי ברקע." });
          return;
        }
        const request: SpeechRequest = {
          type: "transcribe",
          jobId,
          samples,
          model: options.model,
          language: options.language,
        };
        worker.postMessage(request, [samples.buffer]);
      });
    },
    [ensureWorker, settle],
  );

  return { ...state, transcribe, cancel };
}
