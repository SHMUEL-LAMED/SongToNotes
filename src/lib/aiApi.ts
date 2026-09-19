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
  unsupported_language: "הקול שמוגדר בשרת לא מדבר בשפה הזאת. אפשר להקשיב בדפדפן, או שמנהל האתר יגדיר ספק עם עברית (TTS_*).",
  not_found: "לא זוהה שיר בקטע הזה. נסה קטע ארוך יותר או ברור יותר.",
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

export type AiAction = "polish" | "summarize" | "translate" | "speakers" | "chat";
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AssistantMode = "question" | "execute";
export type AssistantAction = { type: "navigate"; route: string };
export type AiReply = {
  text: string;
  model: string;
  tokens: number;
  used: number;
  limit: number;
  action?: AssistantAction | null;
};

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

/** What the page tells the model about itself before each reply. */
export type ChatContext = {
  /** A few lines about what is on screen, from the mounted tools. */
  state?: string;
  /** The actions the site offers, as the model reads them; only in execute mode. */
  catalog?: string;
};

export type ChatOptions = {
  /** The tool the visitor is looking at, so the answer can be about it. */
  tool?: string | null;
  detailed?: boolean;
  mode?: AssistantMode;
  context?: ChatContext;
  signal?: AbortSignal;
};

/** The assistant's next reply to a conversation, all at once. */
export function chat(messages: ChatMessage[], options: ChatOptions = {}) {
  return call<AiReply & { tools?: string[] }>("ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "chat", messages, tool: options.tool ?? undefined, detailed: options.detailed ?? false, mode: options.mode ?? "question", context: options.context }),
    signal: options.signal,
  });
}

/**
 * The same reply as it is written: `onDelta` gets each piece of text and
 * the promise resolves with the whole. Falls back to one reply when the
 * server does not stream.
 */
export async function chatStream(
  messages: ChatMessage[],
  options: ChatOptions,
  onDelta: (piece: string) => void,
): Promise<string> {
  const access = await token();
  let response: Response;
  try {
    response = await fetch(`${FUNCTIONS}/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        action: "chat",
        messages,
        tool: options.tool ?? undefined,
        detailed: options.detailed ?? false,
        mode: options.mode ?? "question",
        context: options.context,
        stream: true,
      }),
      signal: options.signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw new AiError("cancelled", MESSAGES.cancelled);
    throw new AiError("network", MESSAGES.network);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    const code = body?.error ?? (response.status === 401 ? "signed_out" : "http");
    throw new AiError(code, describeAiError(code, response.status));
  }
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.includes("text/event-stream") || !response.body) {
    const body = (await response.json()) as AiReply;
    onDelta(body.text);
    return body.text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let whole = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const piece = parsed.choices?.[0]?.delta?.content;
        if (piece) {
          whole += piece;
          onDelta(piece);
        }
      } catch {
        // A partial or keep-alive line; the next chunk completes it.
      }
    }
  }
  return whole;
}

// ---------------------------------------------------------------------------
// Vocal separation
// ---------------------------------------------------------------------------

export type SeparationJob = { id: string; used: number; limit: number };
export type SeparationStatus =
  | { status: "starting" | "processing" | "queued"; percent: number | null }
  | { status: "done"; vocals: string | null; instrumental: string | null; stems?: Record<string, string> }
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
export function startSeparation(file: File, signal?: AbortSignal, mode: "vocals" | "stems" = "vocals") {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("mode", mode);
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
  mode: "vocals" | "stems" = "vocals",
): Promise<{ vocals: AudioBuffer | null; instrumental: AudioBuffer | null; stems: Record<string, AudioBuffer>; used: number; limit: number }> {
  report("שולח את השיר לשרת…", 5);
  const job = await startSeparation(file, signal, mode);
  report("השרת מפריד את השירה מהליווי…", 10);
  const startedAt = Date.now();
  for (;;) {
    if (signal?.aborted) throw new AiError("cancelled", MESSAGES.cancelled);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const state = await separationStatus(job.id, signal);
    if (state.status === "done") {
      report("מוריד את התוצאה…", 90);
      if (mode === "stems") {
        const entries = Object.entries(state.stems ?? {});
        const decoded = await Promise.all(entries.map(([, url]) => fetchStem(url, signal).then(decode)));
        const stems: Record<string, AudioBuffer> = {};
        entries.forEach(([name], index) => {
          stems[name] = decoded[index];
        });
        report("ההפרדה הושלמה.", 100);
        return { vocals: stems.vocals ?? null, instrumental: null, stems, used: job.used, limit: job.limit };
      }
      const [vocals, instrumental] = await Promise.all([
        state.vocals ? fetchStem(state.vocals, signal).then(decode) : Promise.resolve(null),
        state.instrumental ? fetchStem(state.instrumental, signal).then(decode) : Promise.resolve(null),
      ]);
      report("ההפרדה הושלמה.", 100);
      return { vocals, instrumental, stems: {}, used: job.used, limit: job.limit };
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

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

/** A spoken recording of the text, as a file, from the server's voice. */
export async function speakToFile(
  text: string,
  options: { voice?: string; speed?: number; format?: "mp3" | "wav"; signal?: AbortSignal } = {},
): Promise<File> {
  const access = await token();
  let response: Response;
  try {
    response = await fetch(`${FUNCTIONS}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ text, voice: options.voice, speed: options.speed, format: options.format ?? "mp3" }),
      signal: options.signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw new AiError("cancelled", MESSAGES.cancelled);
    throw new AiError("network", MESSAGES.network);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    const code = body?.error ?? (response.status === 401 ? "signed_out" : "http");
    throw new AiError(code, describeAiError(code, response.status));
  }
  const bytes = await response.arrayBuffer();
  const format = options.format ?? "mp3";
  return new File([bytes], `speech.${format}`, { type: format === "wav" ? "audio/wav" : "audio/mpeg" });
}

// ---------------------------------------------------------------------------
// Song identification
// ---------------------------------------------------------------------------

export type Identification =
  | { found: false; used: number; limit: number }
  | {
      found: true;
      artist: string | null;
      title: string | null;
      album: string | null;
      releaseDate: string | null;
      label: string | null;
      timecode: string | null;
      links: { song: string | null; appleMusic: string | null; spotify: string | null; deezer: string | null };
      artwork: string | null;
      used: number;
      limit: number;
    };

export function identifyAvailability(signal?: AbortSignal) {
  return call<{ configured: boolean }>("identify", { method: "GET", query: { availability: "1" }, signal });
}

/** Asks the recognition service about a clip of a few seconds. */
export function identifySong(clip: Blob, signal?: AbortSignal) {
  const form = new FormData();
  form.append("file", clip, "clip.wav");
  return call<Identification>("identify", { method: "POST", body: form, signal });
}
