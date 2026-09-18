/**
 * The site's side of speech to text. The recogniser runs on the server
 * (supabase/functions/transcribe): a window of the recording goes up as a
 * small WAV, and the timed text comes back. Nothing is installed or fetched
 * onto the device; the account's daily allowance is what limits it.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";
import type { TranscriptSegment } from "./transcript";
import { encodeWav } from "./wav";

export const TRANSCRIBE_URL = `${SUPABASE_URL}/functions/v1/transcribe`;

export type SpeechResult = {
  segments: TranscriptSegment[];
  language: string | null;
  model: string;
  /** Seconds of audio this account has used today, and its daily allowance. */
  used: number;
  limit: number;
};

export class SpeechError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const CANCELLED = "התמלול בוטל.";

const MESSAGES: Record<string, string> = {
  signed_out: "כדי לתמלל צריך להתחבר לחשבון. ההתחברות חינמית ולוקחת רגע.",
  not_configured: "שירות התמלול עדיין לא הופעל באתר. מנהל האתר צריך להזין מפתח לשירות הזיהוי.",
  quota: "נגמרה מכסת התמלול היומית של החשבון. אפשר להמשיך מחר, מאותה נקודה.",
  too_large: "הקטע גדול מדי לשליחה. נסה לסמן קטע קצר יותר.",
  provider_key: "שירות הזיהוי דחה את המפתח של האתר. מנהל האתר צריך לבדוק אותו.",
  provider_busy: "שירות הזיהוי עמוס כרגע. המתן דקה ולחץ על המשך.",
  provider_unreachable: "לא הצלחנו להגיע לשירות הזיהוי. נסה שוב בעוד רגע.",
  provider_error: "שירות הזיהוי החזיר שגיאה. נסה שוב בעוד רגע.",
  network: "החיבור לשרת נכשל. בדוק את האינטרנט ולחץ על המשך.",
};

export function describeSpeechError(code: string, status?: number) {
  return MESSAGES[code] ?? `התמלול נכשל${status ? ` (${status})` : ""}. נסה שוב בעוד רגע.`;
}

/** "3 שעות" / "45 דקות" — a daily allowance, in words. */
export function describeAllowance(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} שעות`;
}

type Options = {
  language: string | null;
  signal?: AbortSignal;
  /** 0–100 while the window goes up. */
  onUpload?: (percent: number) => void;
};

/** Is anyone signed in? The server will refuse otherwise, so ask first. */
export async function hasSession() {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/**
 * Sends one window of mono samples and resolves with its segments, timed
 * from the start of the window. Rejects with a {@link SpeechError} whose
 * message is ready to show.
 */
export async function transcribeWindow(
  samples: Float32Array,
  sampleRate: number,
  { language, signal, onUpload }: Options,
): Promise<SpeechResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new SpeechError("signed_out", MESSAGES.signed_out);
  if (signal?.aborted) throw new SpeechError("cancelled", CANCELLED);

  const form = new FormData();
  form.append("file", encodeWav({ channels: [samples], sampleRate }), "window.wav");
  if (language) form.append("language", language);

  return new Promise<SpeechResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", TRANSCRIBE_URL);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.responseType = "json";
    const abort = () => {
      xhr.abort();
      reject(new SpeechError("cancelled", CANCELLED));
    };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onUpload) {
        onUpload(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new SpeechError("network", MESSAGES.network));
    xhr.ontimeout = () => reject(new SpeechError("network", MESSAGES.network));
    xhr.onload = () => {
      signal?.removeEventListener("abort", abort);
      const body = (xhr.response ?? null) as Partial<SpeechResult> & { error?: string } | null;
      if (xhr.status !== 200) {
        const code = body?.error ?? (xhr.status === 401 ? "signed_out" : "http");
        reject(new SpeechError(code, describeSpeechError(code, xhr.status)));
        return;
      }
      resolve({
        segments: Array.isArray(body?.segments) ? body.segments : [],
        language: typeof body?.language === "string" ? body.language : null,
        model: typeof body?.model === "string" ? body.model : "server",
        used: typeof body?.used === "number" ? body.used : 0,
        limit: typeof body?.limit === "number" ? body.limit : 0,
      });
    };
    xhr.send(form);
  });
}
