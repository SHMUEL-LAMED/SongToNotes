import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SeparateRequest,
  SeparateResponse,
} from "../workers/separate.worker";
import { channelsToBuffer } from "./dsp";
import type { SeparateOptions } from "./separate";

export type SeparationResult = {
  buffer: AudioBuffer;
  wasMono: boolean;
  elapsed: number;
};

export type SeparationState = {
  isRunning: boolean;
  progress: number;
  error: string | null;
};

const IDLE: SeparationState = { isRunning: false, progress: 0, error: null };

/**
 * Runs {@link ../lib/separate} on a worker, so a four-minute song does not
 * freeze the page for the fifteen seconds it takes. One run at a time: asking
 * for another discards the first, which is what makes a dragged slider cost
 * one separation rather than thirty.
 */
export function useSeparation(context: AudioContext | null) {
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const pendingRef = useRef<{
    resolve: (result: SeparationResult) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [state, setState] = useState<SeparationState>(IDLE);

  const teardown = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  // The worker outlives any one render, so the handler reads the context from
  // a ref rather than closing over the value a particular render happened to
  // see.
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const settle = useCallback((message: SeparateResponse) => {
    if (message.jobId !== jobRef.current) return;
    if (message.type === "progress") {
      setState((previous) => ({ ...previous, progress: message.progress }));
      return;
    }
    if (message.type === "done") {
      setState({ isRunning: false, progress: 100, error: null });
      const audioContext = contextRef.current;
      if (audioContext) {
        pendingRef.current?.resolve({
          buffer: channelsToBuffer(
            audioContext,
            // A mono result comes back as the same buffer twice; copying it
            // keeps `channelsToBuffer` from writing one channel over itself.
            message.left === message.right
              ? [message.left]
              : [message.left, message.right],
            // The file's own rate, not the context's: a 48 kHz song written
            // into a 44.1 kHz buffer would play back sharp and fast.
            message.sampleRate,
          ),
          wasMono: message.wasMono,
          elapsed: message.elapsed,
        });
      } else {
        pendingRef.current?.reject(new Error("הדפדפן הזה אינו תומך בעיבוד אודיו."));
      }
      pendingRef.current = null;
      return;
    }
    setState({ isRunning: false, progress: 0, error: message.message });
    pendingRef.current?.reject(new Error(message.message));
    pendingRef.current = null;
  }, []);

  const run = useCallback(
    (buffer: AudioBuffer, options: SeparateOptions) => {
      jobRef.current += 1;
      const jobId = jobRef.current;
      setState({ isRunning: true, progress: 0, error: null });

      return new Promise<SeparationResult>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        if (!workerRef.current) {
          const worker = new Worker(
            new URL("../workers/separate.worker.ts", import.meta.url),
            { type: "module" },
          );
          worker.onmessage = (event: MessageEvent<SeparateResponse>) =>
            settle(event.data);
          worker.onerror = (event) =>
            settle({
              type: "error",
              jobId: jobRef.current,
              message: event.message || "ההפרדה נכשלה.",
            });
          workerRef.current = worker;
        }

        // Copies, because the originals belong to the decoded file and must
        // survive being handed to the worker.
        const left = buffer.getChannelData(0).slice();
        const right =
          buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : null;
        const request: SeparateRequest = {
          type: "separate",
          jobId,
          left,
          right,
          sampleRate: buffer.sampleRate,
          options,
        };
        workerRef.current.postMessage(
          request,
          right ? [left.buffer, right.buffer] : [left.buffer],
        );
      });
    },
    [settle],
  );

  const cancel = useCallback(() => {
    if (!pendingRef.current) return;
    jobRef.current += 1;
    pendingRef.current.reject(new Error("ההפרדה בוטלה."));
    pendingRef.current = null;
    teardown();
    setState(IDLE);
  }, [teardown]);

  return { ...state, run, cancel };
}
