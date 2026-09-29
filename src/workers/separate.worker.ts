import { changeChannelsSpeedAndPitch } from "../lib/dsp";
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

/**
 * The practice slow-downer's tempo and pitch change. It shares this worker
 * because it is the same kind of work — seconds of arithmetic over a whole
 * song — that froze the page when it ran in the slider's handler.
 */
export type StretchRequest = {
  type: "stretch";
  jobId: number;
  channels: Float32Array[];
  sampleRate: number;
  speed: number;
  semitones: number;
};

export type StretchResponse =
  | { type: "stretched"; jobId: number; channels: Float32Array[] }
  | { type: "error"; jobId: number; message: string };

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

function stretch(request: StretchRequest) {
  const { jobId, channels, sampleRate, speed, semitones } = request;
  try {
    const result = changeChannelsSpeedAndPitch(channels, sampleRate, speed, semitones);
    const message: StretchResponse = { type: "stretched", jobId, channels: result };
    self.postMessage(message, result.map((channel) => channel.buffer));
  } catch (error) {
    const message: StretchResponse = {
      type: "error",
      jobId,
      message: error instanceof Error ? error.message : "העיבוד נכשל.",
    };
    self.postMessage(message);
  }
}

self.onmessage = (event: MessageEvent<SeparateRequest | StretchRequest>) => {
  const request = event.data;
  if (request.type === "stretch") {
    stretch(request);
    return;
  }
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
