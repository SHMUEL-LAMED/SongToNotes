/**
 * Speech to text, on the server.
 *
 * The site sends one window of a recording at a time — mono, 16 kHz, WAV —
 * and this function passes it to a speech-recognition service and hands the
 * timed text back. The service's key lives here, as a secret, and never in
 * the site; a visitor has to be signed in, and each account gets a daily
 * allowance of audio so one person cannot run up the bill.
 *
 * Secrets (Project Settings → Edge Functions → Secrets):
 *   STT_API_KEY        the service's key — required
 *   STT_BASE_URL       an OpenAI-compatible base, default https://api.openai.com/v1
 *                      (Groq: https://api.groq.com/openai/v1)
 *   STT_MODEL          default whisper-1 (Groq: whisper-large-v3)
 *   STT_DAILY_SECONDS  audio allowed per account per day, default 4 hours
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_DAILY_SECONDS = 4 * 3600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Seconds of audio in a WAV file, from its header; the size otherwise. */
function wavSeconds(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  if (bytes.byteLength < 44) return 0;
  const channels = view.getUint16(22, true) || 1;
  const sampleRate = view.getUint32(24, true) || 16_000;
  const bits = view.getUint16(34, true) || 16;
  return (bytes.byteLength - 44) / (sampleRate * channels * (bits / 8));
}

/** Whisper names the language; the site works in ISO codes. */
const LANGUAGE_CODES: Record<string, string> = {
  hebrew: "he",
  english: "en",
  arabic: "ar",
  russian: "ru",
  french: "fr",
  spanish: "es",
  yiddish: "yi",
};

type Segment = { start: number; end: number | null; text: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const apiKey = Deno.env.get("STT_API_KEY");
  if (!apiKey) return json(503, { error: "not_configured" });

  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "signed_out" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const asVisitor = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: userError } = await asVisitor.auth.getUser(token);
  if (userError || !user) return json(401, { error: "signed_out" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "bad_request" });
  if (file.size > MAX_BYTES) return json(413, { error: "too_large" });
  const language = typeof form.get("language") === "string" ? String(form.get("language")).trim() : "";
  const bytes = await file.arrayBuffer();
  const seconds = Math.max(1, Math.round(wavSeconds(bytes)));

  // The daily allowance, kept with the service role so the site cannot edit it.
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const limit = Number(Deno.env.get("STT_DAILY_SECONDS")) || DEFAULT_DAILY_SECONDS;
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin
    .from("stt_usage")
    .select("seconds")
    .eq("user_id", user.id)
    .eq("day", day)
    .maybeSingle();
  const used = Number(usage?.seconds ?? 0);
  if (used + seconds > limit) {
    return json(429, { error: "quota", used, limit });
  }

  const base = (Deno.env.get("STT_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = Deno.env.get("STT_MODEL") ?? "whisper-1";
  const upstream = new FormData();
  upstream.append("file", new Blob([bytes], { type: "audio/wav" }), "audio.wav");
  upstream.append("model", model);
  upstream.append("response_format", "verbose_json");
  upstream.append("temperature", "0");
  if (language) upstream.append("language", language);

  let response: Response;
  try {
    response = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
  } catch (caught) {
    console.error("speech service unreachable", caught);
    return json(502, { error: "provider_unreachable" });
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    console.error("speech service refused", response.status, detail);
    if (response.status === 401 || response.status === 403) return json(502, { error: "provider_key" });
    if (response.status === 429) return json(502, { error: "provider_busy" });
    if (response.status === 413) return json(413, { error: "too_large" });
    return json(502, { error: "provider_error", status: response.status });
  }

  const parsed = (await response.json()) as {
    text?: string;
    language?: string;
    segments?: { start?: number; end?: number; text?: string }[];
  };
  const segments: Segment[] = Array.isArray(parsed.segments)
    ? parsed.segments
        .map((item) => ({
          start: Number(item.start) || 0,
          end: Number.isFinite(item.end) ? Number(item.end) : null,
          text: String(item.text ?? "").trim(),
        }))
        .filter((item) => item.text.length > 0)
    : parsed.text?.trim()
      ? [{ start: 0, end: seconds, text: parsed.text.trim() }]
      : [];

  await admin
    .from("stt_usage")
    .upsert({ user_id: user.id, day, seconds: used + seconds }, { onConflict: "user_id,day" });

  const heard = parsed.language?.toLowerCase();
  return json(200, {
    segments,
    language: language || (heard ? (LANGUAGE_CODES[heard] ?? heard) : null),
    model,
    seconds,
    used: used + seconds,
    limit,
  });
});
