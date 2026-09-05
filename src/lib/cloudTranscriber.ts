import { MODEL_SAMPLE_RATE } from "./audio";
import { supabase } from "./supabase";
import type { Timings } from "./pitchModel";
import type { DetectedNote } from "./types";

const CLOUD_API_URL = (import.meta.env.VITE_GPU_API_URL as string | undefined)
  ?.trim()
  .replace(/\/$/, "");

type CloudResponse = {
  notes?: unknown;
  timings?: Partial<Timings>;
};

export type CloudTranscriptionResult = {
  notes: DetectedNote[];
  timings: Timings;
};

export function isCloudTranscriptionConfigured() {
  return Boolean(CLOUD_API_URL);
}

function isDetectedNote(value: unknown): value is DetectedNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<DetectedNote>;
  return (
    typeof note.midi === "number" &&
    Number.isFinite(note.midi) &&
    typeof note.start === "number" &&
    Number.isFinite(note.start) &&
    typeof note.duration === "number" &&
    Number.isFinite(note.duration) &&
    typeof note.confidence === "number" &&
    Number.isFinite(note.confidence)
  );
}

function serverMessage(xhr: XMLHttpRequest) {
  try {
    const parsed = JSON.parse(xhr.responseText) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // The status text below is enough when the server did not return JSON.
  }
  return xhr.statusText || "שרת ה־GPU אינו זמין כרגע.";
}

/**
 * Sends the already down-mixed 22.05 kHz samples to the GPU. No API secret is
 * exposed in the page: the endpoint accepts only a current Supabase session.
 * The upload uses XHR so the user sees real upload progress; while inference
 * is running the bar advances smoothly up to 92% instead of appearing frozen.
 */
export async function transcribeInCloud(
  samples: Float32Array,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<CloudTranscriptionResult> {
  if (!CLOUD_API_URL) throw new Error("שרת ה־GPU עדיין לא הוגדר.");

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("יש להתחבר מחדש לפני ניתוח השיר.");
  }

  // Own the upload bytes so TypeScript and XHR both see a plain ArrayBuffer,
  // even on browsers where the source view could theoretically be shared.
  const uploadBytes = new Uint8Array(samples.byteLength);
  uploadBytes.set(
    new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
  );
  const body = uploadBytes.buffer;

  return new Promise<CloudTranscriptionResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let simulatedProgress = 18;
    let progressTimer: number | null = null;

    const stopTimer = () => {
      if (progressTimer !== null) window.clearInterval(progressTimer);
      progressTimer = null;
    };
    const startInferenceProgress = () => {
      if (progressTimer !== null) return;
      progressTimer = window.setInterval(() => {
        simulatedProgress = Math.min(92, simulatedProgress + Math.max(1, Math.round((92 - simulatedProgress) / 12)));
        onProgress(simulatedProgress);
      }, 900);
    };
    const abort = () => xhr.abort();

    xhr.open("POST", `${CLOUD_API_URL}/transcribe`);
    xhr.timeout = 20 * 60 * 1000;
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Audio-Sample-Rate", String(MODEL_SAMPLE_RATE));

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const uploaded = event.loaded / event.total;
      onProgress(2 + Math.round(uploaded * 16));
      if (uploaded >= 1) startInferenceProgress();
    };
    xhr.upload.onload = startInferenceProgress;

    xhr.onload = () => {
      stopTimer();
      signal.removeEventListener("abort", abort);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(serverMessage(xhr)));
        return;
      }
      try {
        const parsed = JSON.parse(xhr.responseText) as CloudResponse;
        if (!Array.isArray(parsed.notes) || !parsed.notes.every(isDetectedNote)) {
          throw new Error("שרת ה־GPU החזיר תוצאה לא תקינה.");
        }
        const timings = parsed.timings ?? {};
        resolve({
          notes: parsed.notes,
          timings: {
            backend: "cloud-gpu",
            load: Number(timings.load) || 0,
            infer: Number(timings.infer) || 0,
            decode: Number(timings.decode) || 0,
          },
        });
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("שרת ה־GPU החזיר תוצאה לא תקינה."),
        );
      }
    };
    xhr.onerror = () => {
      stopTimer();
      signal.removeEventListener("abort", abort);
      reject(new Error("לא ניתן להגיע לשרת ה־GPU."));
    };
    xhr.ontimeout = () => {
      stopTimer();
      signal.removeEventListener("abort", abort);
      reject(new Error("שרת ה־GPU לא סיים בזמן."));
    };
    xhr.onabort = () => {
      stopTimer();
      signal.removeEventListener("abort", abort);
      reject(new Error("הניתוח בוטל."));
    };

    signal.addEventListener("abort", abort, { once: true });
    onProgress(1);
    xhr.send(body);
  });
}
