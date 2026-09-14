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
};

const IDLE: TranscriberState = {
  isRunning: false,
  progress: 0,
  error: null,
  engine: null,
  elapsed: null,
};

export function useTranscriber() {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
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
    setState((previous) => ({
      ...previous,
      isRunning: false,
      progress: 0,
      error: message,
    }));
    pendingRef.current?.reject(new Error(message));
    pendingRef.current = null;
  }, []);

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
        setState((previous) => ({ ...previous, progress: message.progress }));
        return;
      }
      if (message.type === "done") {
        setState({
          isRunning: false,
          progress: 100,
          error: null,
          engine: message.engine,
          elapsed: message.elapsed,
        });
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
      setState({
        isRunning: true,
        progress: 0,
        error: null,
        engine: null,
        elapsed: null,
      });

      return new Promise<DetectedNote[]>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        let worker: Worker;
        try {
          worker = ensureWorker();
        } catch {
          // Module workers are not available everywhere. Falling back to the
          // page's own thread costs responsiveness for a second or two, which
          // is a great deal better than not working at all.
          void runHere(samples, options, jobId);
          return;
        }
        const request: NotesRequest = {
          type: "transcribe",
          jobId,
          samples,
          engine: options.engine,
          mode: options.mode,
          sensitivity: DETECTION_LEVEL,
        };
        // The sample buffer is handed over rather than copied.
        worker.postMessage(request, [samples.buffer]);
      });

      async function runHere(
        audio: Float32Array,
        chosen: TranscribeOptions,
        token: number,
      ) {
        try {
          const started = Date.now();
          let notes: DetectedNote[];
          if (chosen.engine === "deep") {
            const { transcribeSamples } = await import("./pitchModel");
            notes = (
              await transcribeSamples(audio, DETECTION_LEVEL, (progress) => {
                if (jobRef.current !== token) return;
                setState((previous) => ({ ...previous, progress }));
              })
            ).notes;
          } else {
            const { detectNotes } = await import("./noteEngine");
            notes = detectNotes(
              audio,
              { sensitivity: DETECTION_LEVEL, mode: chosen.mode },
              (progress) => {
                if (jobRef.current !== token) return;
                setState((previous) => ({ ...previous, progress }));
              },
            ).notes;
          }
          if (jobRef.current !== token) return;
          setState({
            isRunning: false,
            progress: 100,
            error: null,
            engine: chosen.engine,
            elapsed: Date.now() - started,
          });
          pendingRef.current?.resolve(notes);
          pendingRef.current = null;
        } catch (error) {
          if (jobRef.current !== token) return;
          fail(error instanceof Error ? error.message : "העיבוד נכשל.");
        }
      }
    },
    [ensureWorker, fail],
  );

  return { ...state, transcribe, cancel };
}
