import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NoteEngineId,
  NotesRequest,
  NotesResponse,
} from "../workers/notes.worker";
import type { DetectedNote, ViewMode } from "./types";

export type { NoteEngineId };

/**
 * The detector runs permissively and every user-facing control filters the
 * notes afterwards, so moving a slider never costs another pass over the
 * audio. Only the melody/chords choice reaches the engine itself, because the
 * two readings are different algorithms rather than two filters.
 */
const DETECTION_LEVEL = 0.72;

/**
 * How long the deep engine may sit at nothing before the run is moved to the
 * page's own thread. Some driver and browser combinations accept the
 * transferred samples and then stall while setting up WebGL, which used to
 * leave the bar at 0–4% for as long as the visitor was willing to wait. The
 * fast engine is not given a watchdog: it has no GPU to stall on, and it
 * reports its first progress within a few hundred milliseconds.
 */
const DEEP_STALL_TIMEOUT = 15_000;

export type TranscribeOptions = {
  engine: NoteEngineId;
  mode: ViewMode;
};

export type TranscriberState = {
  isRunning: boolean;
  progress: number;
  error: string | null;
  /** Which engine produced the notes on screen, once one has. */
  engine: NoteEngineId | null;
  /** Milliseconds the finished run took. */
  elapsed: number | null;
  /** True while a stalled run has been moved onto the page's own thread. */
  onMainThread: boolean;
};

const IDLE: TranscriberState = {
  isRunning: false,
  progress: 0,
  error: null,
  engine: null,
  elapsed: null,
  onMainThread: false,
};

export function useTranscriber() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const progressRef = useRef(0);
  const pendingRef = useRef<{
    resolve: (notes: DetectedNote[]) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const [state, setState] = useState<TranscriberState>(IDLE);

  const teardown = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const fail = useCallback((message: string) => {
    progressRef.current = 0;
    setState((previous) => ({
      ...previous,
      isRunning: false,
      progress: 0,
      error: message,
    }));
    pendingRef.current?.reject(new Error(message));
    pendingRef.current = null;
  }, []);

  /**
   * Runs the detector here instead of on a worker — either because the worker
   * could not be created at all, or because it stalled. The page stops
   * responding for the duration, which is far the lesser cost.
   */
  const runHere = useCallback(
    async (samples: Float32Array, options: TranscribeOptions, token: number) => {
      if (jobRef.current !== token) return;
      setState((previous) => ({ ...previous, onMainThread: true }));
      try {
        const started = Date.now();
        const report = (progress: number) => {
          if (jobRef.current !== token) return;
          progressRef.current = progress;
          setState((previous) => ({ ...previous, progress }));
        };
        let notes: DetectedNote[];
        if (options.engine === "deep") {
          const { transcribeSamples } = await import("./pitchModel");
          notes = (await transcribeSamples(samples, DETECTION_LEVEL, report))
            .notes;
        } else {
          const { detectNotes } = await import("./noteEngine");
          notes = detectNotes(
            samples,
            { sensitivity: DETECTION_LEVEL, mode: options.mode },
            report,
          ).notes;
        }
        if (jobRef.current !== token) return;
        setState({
          isRunning: false,
          progress: 100,
          error: null,
          engine: options.engine,
          elapsed: Date.now() - started,
          onMainThread: true,
        });
        pendingRef.current?.resolve(notes);
        pendingRef.current = null;
      } catch (error) {
        if (jobRef.current !== token) return;
        fail(error instanceof Error ? error.message : "העיבוד נכשל.");
      }
    },
    [fail],
  );

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(
      new URL("../workers/notes.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<NotesResponse>) => {
      const message = event.data;
      if (message.jobId !== jobRef.current) return;
      if (message.type === "progress") {
        progressRef.current = message.progress;
        setState((previous) => ({ ...previous, progress: message.progress }));
        return;
      }
      if (message.type === "done") {
        setState((previous) => ({
          ...previous,
          isRunning: false,
          progress: 100,
          error: null,
          engine: message.engine,
          elapsed: message.elapsed,
        }));
        pendingRef.current?.resolve(message.notes);
        pendingRef.current = null;
        return;
      }
      fail(message.message);
      teardown();
    };
    worker.onerror = (event) => {
      fail(event.message || "העיבוד נכשל.");
      teardown();
    };
    workerRef.current = worker;
    return worker;
  }, [fail, teardown]);

  const cancel = useCallback(() => {
    if (!pendingRef.current) return;
    // A run cannot be interrupted between frames from outside, so the worker
    // is discarded and the next run starts a fresh one.
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
    (samples: Float32Array, options: TranscribeOptions) => {
      jobRef.current += 1;
      const jobId = jobRef.current;
      progressRef.current = 0;
      setState({
        isRunning: true,
        progress: 0,
        error: null,
        engine: null,
        elapsed: null,
        onMainThread: false,
      });

      return new Promise<DetectedNote[]>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        let worker: Worker;
        try {
          worker = ensureWorker();
        } catch {
          // Module workers are not available everywhere. Running here costs
          // responsiveness for a second or two, which is a great deal better
          // than not working at all.
          void runHere(samples, options, jobId);
          return;
        }

        // One copy is held back only for the deep engine, which is the one
        // that can stall; the fast engine hands its samples over outright.
        const spare = options.engine === "deep" ? samples.slice() : null;
        const request: NotesRequest = {
          type: "transcribe",
          jobId,
          samples,
          engine: options.engine,
          mode: options.mode,
          sensitivity: DETECTION_LEVEL,
        };
        worker.postMessage(request, [samples.buffer]);

        if (!spare) return;
        window.setTimeout(() => {
          if (
            jobRef.current !== jobId ||
            !pendingRef.current ||
            progressRef.current > 4
          ) {
            return;
          }
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          void runHere(spare, options, jobId);
        }, DEEP_STALL_TIMEOUT);
      });
    },
    [ensureWorker, runHere],
  );

  return { ...state, transcribe, cancel };
}
