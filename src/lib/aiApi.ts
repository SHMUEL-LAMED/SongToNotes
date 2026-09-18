/**
 * The site's side of the server AI: the language model (tidying, summary,
 * translation, the assistant) and vocal separation. Both run in Supabase
 * functions that hold the keys; the browser sends the work and shows the
 * result, and nothing is installed or fetched onto the device.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";

const FUNCTIONS = `${SUPABASE_URL}/functions/v1`;

export class AiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  signed_out: "כדי להשתמש ב־AI צריך להתחבר לחשבון. ההתחברות חינמית ולוקחת רגע.",
  not_configured: "היכולת הזאת עדיין לא הופעלה באתר. מנהל האתר צריך להזין מפתח לשירות.",
  quota: "נגמרה המכסה היומית של החשבון לפעולה הזאת. אפשר להמשיך מחר.",
  too_large: "הטקסט או הקובץ גדולים מדי לשליחה.",
  provider_key: "השירות דחה את המפתח של האתר. מנהל האתר צריך לבדוק אותו.",
  provider_credit: "נגמר האשראי של האתר בשירות ההפרדה. מנהל האתר צריך לטעון אותו.",
  provider_busy: "השירות עמוס כרגע. המתן דקה ונסה שוב.",
  provider_unreachable: "לא הצלחנו להגיע לשירות. נסה שוב בעוד רגע.",
  provider_error: "השירות החזיר שגיאה. נסה שוב בעוד רגע.",
  storage: "לא הצלחנו להעלות את הקובץ לשרת. נסה שוב.",
  network: "החיבור לשרת נכשל. בדוק את האינטרנט ונסה שוב.",
  cancelled: "בוטל.",
};

export function describeAiError(code: string, status?: number) {
  return MESSAGES[code] ?? `הפעולה נכשלה${status ? ` (${status})` : ""}. נסה שוב בעוד רגע.`;
}

async function token() {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new AiError("signed_out", MESSAGES.signed_out);
  return value;
}

/** One call to a site function; the error, if any, comes back ready to show. */
async function call<T>(name: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
  const access = await token();
  const query = init.query ? `?${new URLSearchParams(init.query)}` : "";
  let response: Response;
  try {
    response = await fetch(`${FUNCTIONS}/${name}${query}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${access}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new AiError("cancelled", MESSAGES.cancelled);
    }
    throw new AiError("network", MESSAGES.network);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    const code = body?.error ?? (response.status === 401 ? "signed_out" : "http");
    throw new AiError(code, describeAiError(code, response.status));
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// The language model
// ---------------------------------------------------------------------------

export type AiAction = "polish" | "summarize" | "translate" | "chat";
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AiReply = { text: string; model: string; tokens: number; used: number; limit: number };

/** Tidies, summarises or translates a text. */
export function transformText(
  action: Exclude<AiAction, "chat">,
  text: string,
  options: { language?: string; signal?: AbortSignal } = {},
) {
  return call<AiReply>("ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, text, language: options.language }),
    signal: options.signal,
  });
}

/** The assistant's next reply to a conversation. */
export function chat(messages: ChatMessage[], signal?: AbortSignal) {
  return call<AiReply>("ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "chat", messages }),
    signal,
  });
}

// ---------------------------------------------------------------------------
// Vocal separation
// ---------------------------------------------------------------------------

export type SeparationJob = { id: string; used: number; limit: number };
export type SeparationStatus =
  | { status: "starting" | "processing" | "queued"; percent: number | null }
  | { status: "done"; vocals: string | null; instrumental: string | null }
  | { status: "failed"; message: string };

/** Checks whether server-side separation is configured without uploading the song. */
export function separationAvailability(signal?: AbortSignal) {
  return call<{ configured: boolean }>("separate", {
    method: "GET",
    query: { availability: "1" },
    signal,
  });
}

/** Sends the song up and starts the job. */
export function startSeparation(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", file, file.name);
  return call<SeparationJob>("separate", { method: "POST", body: form, signal });
}

export function separationStatus(id: string, signal?: AbortSignal) {
  return call<SeparationStatus>("separate", { method: "GET", query: { id }, signal });
}

/** A finished stem, as decoded audio. */
export async function fetchStem(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const access = await token();
  const response = await fetch(`${FUNCTIONS}/separate?${new URLSearchParams({ fetch: url })}`, {
    headers: { Authorization: `Bearer ${access}`, apikey: SUPABASE_PUBLISHABLE_KEY },
    signal,
  }).catch(() => {
    throw new AiError("network", MESSAGES.network);
  });
  if (!response.ok) throw new AiError("provider_error", MESSAGES.provider_error);
  return response.arrayBuffer();
}

/**
 * Runs a whole separation: upload, wait, fetch. Reports what it is doing;
 * resolves with the decoded stems the visitor asked for.
 */
export async function separateOnServer(
  file: File,
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
  report: (message: string, percent: number | null) => void,
  signal?: AbortSignal,
): Promise<{ vocals: AudioBuffer | null; instrumental: AudioBuffer | null; used: number; limit: number }> {
  report("שולח את השיר לשרת…", 5);
  const job = await startSeparation(file, signal);
  report("השרת מפריד את השירה מהליווי…", 10);
  const startedAt = Date.now();
  for (;;) {
    if (signal?.aborted) throw new AiError("cancelled", MESSAGES.cancelled);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const state = await separationStatus(job.id, signal);
    if (state.status === "done") {
      report("מוריד את התוצאה…", 90);
      const [vocals, instrumental] = await Promise.all([
        state.vocals ? fetchStem(state.vocals, signal).then(decode) : Promise.resolve(null),
        state.instrumental ? fetchStem(state.instrumental, signal).then(decode) : Promise.resolve(null),
      ]);
      report("ההפרדה הושלמה.", 100);
      return { vocals, instrumental, used: job.used, limit: job.limit };
    }
    if (state.status === "failed") {
      throw new AiError("provider_error", state.message ? `ההפרדה נכשלה: ${state.message}` : MESSAGES.provider_error);
    }
    // Without a percentage from the model, the wait itself is the progress:
    // a song takes about a minute, so the bar creeps toward the end.
    const elapsed = (Date.now() - startedAt) / 1000;
    const guessed = Math.min(85, 10 + Math.round(elapsed * 1.2));
    report(
      state.status === "starting" || state.status === "queued" ? "ממתין לתור בשרת…" : "השרת מפריד את השירה מהליווי…",
      state.percent !== null ? 10 + Math.round(state.percent * 0.75) : guessed,
    );
  }
}
