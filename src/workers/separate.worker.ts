import {
  separate,
  separateMono,
  type SeparateOptions,
} from "../lib/separate";

export type SeparateRequest = {
  type: "separate";
  jobId: number;
  left: Float32Array;
  right: Float32Array | null;
  sampleRate: number;
  options: SeparateOptions;
};

export type SeparateResponse =
  | { type: "progress"; jobId: number; progress: number }
  | {
      type: "done";
      jobId: number;
      left: Float32Array;
      right: Float32Array;
      sampleRate: number;
      wasMono: boolean;
      elapsed: number;
    }
  | { type: "error"; jobId: number; message: string };

const post = self.postMessage.bind(self) as (
  message: SeparateResponse,
  transfer?: Transferable[],
) => void;

self.onmessage = (event: MessageEvent<SeparateRequest>) => {
  const request = event.data;
  if (request.type !== "separate") return;
  const { jobId, left, right, sampleRate, options } = request;
  const started = Date.now();
  let reported = -1;
  const onProgress = (fraction: number) => {
    const progress = Math.round(fraction * 100);
    if (progress === reported) return;
    reported = progress;
    post({ type: "progress", jobId, progress });
  };

  try {
    const result = right
      ? separate({ left, right, sampleRate }, options, onProgress)
      : separateMono(left, sampleRate, options, onProgress);
    post(
      {
        type: "done",
        jobId,
        left: result.left,
        right: result.right,
        sampleRate: result.sampleRate,
        wasMono: result.wasMono,
        elapsed: Date.now() - started,
      },
      // The two channels of a mono result are the same buffer; handing the
      // same ArrayBuffer over twice is an error, so it is only listed once.
      result.left.buffer === result.right.buffer
        ? [result.left.buffer]
        : [result.left.buffer, result.right.buffer],
    );
  } catch (error) {
    post({
      type: "error",
      jobId,
      message: error instanceof Error ? error.message : "ההפרדה נכשלה.",
    });
  }
};
