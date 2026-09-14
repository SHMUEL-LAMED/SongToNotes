import { detectNotes } from "../lib/noteEngine";
import type { DetectedNote, ViewMode } from "../lib/types";

export type NoteEngineId = "fast" | "deep";

export type NotesRequest = {
  type: "transcribe";
  jobId: number;
  samples: Float32Array;
  engine: NoteEngineId;
  mode: ViewMode;
  /** 0..1 — how much benefit of the doubt a quiet pitch is given. */
  sensitivity: number;
};

export type NotesResponse =
  | { type: "progress"; jobId: number; progress: number }
  | {
      type: "done";
      jobId: number;
      notes: DetectedNote[];
      engine: NoteEngineId;
      elapsed: number;
    }
  | { type: "error"; jobId: number; message: string };

// The project's tsconfig uses the DOM lib, so `self` is typed as a Window and
// its postMessage overloads do not match the worker one.
const post = self.postMessage.bind(self) as (message: NotesResponse) => void;

async function handle(request: NotesRequest) {
  const { jobId, samples, engine, mode, sensitivity } = request;
  const report = (progress: number) =>
    post({ type: "progress", jobId, progress: Math.round(progress) });

  if (engine === "deep") {
    // The neural model, TensorFlow and the bundled weights are several
    // megabytes; pulling them in here rather than at the top of the file
    // keeps them out of the download for everyone who never asks for them.
    const started = Date.now();
    const { transcribeSamples } = await import("../lib/pitchModel");
    const { notes } = await transcribeSamples(samples, sensitivity, report);
    post({
      type: "done",
      jobId,
      notes,
      engine,
      elapsed: Date.now() - started,
    });
    return;
  }

  const { notes, elapsed } = detectNotes(
    samples,
    { sensitivity, mode },
    report,
  );
  post({ type: "done", jobId, notes, engine, elapsed });
}

// A failure inside a library's own polling loop is a rejection nobody awaits.
// Left alone it would leave the page waiting forever, so it is reported.
let currentJobId: number | null = null;
self.onunhandledrejection = (event: PromiseRejectionEvent) => {
  event.preventDefault();
  if (currentJobId === null) return;
  const reason: unknown = event.reason;
  post({
    type: "error",
    jobId: currentJobId,
    message: reason instanceof Error ? reason.message : "העיבוד נכשל.",
  });
  currentJobId = null;
};

self.onmessage = async (event: MessageEvent<NotesRequest>) => {
  const request = event.data;
  if (request.type !== "transcribe") return;
  currentJobId = request.jobId;
  try {
    await handle(request);
  } catch (error) {
    post({
      type: "error",
      jobId: request.jobId,
      message: error instanceof Error ? error.message : "שגיאה לא ידועה",
    });
  } finally {
    currentJobId = null;
  }
};
