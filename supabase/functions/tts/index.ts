/**
 * Text to speech, on the server, for a file the visitor can keep.
 *
 * The browser's own voices read aloud without any of this; this is for a
 * downloadable recording, through an OpenAI-compatible `/audio/speech`
 * endpoint. Groq's PlayAI voices (the default account) speak English and
 * Arabic; Hebrew needs a provider that has it, set with the TTS_* settings.
 *
 * Settings (secrets or private.stt_settings):
 *   TTS_API_KEY    falls back to STT_API_KEY
 *   TTS_BASE_URL   falls back to STT_BASE_URL
 *   TTS_MODEL      default playai-tts on Groq, tts-1 elsewhere
 *   TTS_VOICE      default Fritz-PlayAI on Groq, alloy elsewhere
 *   TTS_DAILY_CHARS  default 60000
 *
 * A recording is paid for in credits: the "tts" price for every 1,000
 * characters (supabase/credits.sql), given back if the voice service fails.
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";
import { charge, creditHeaders, refund, refused } from "../_shared/credits.ts";
import { ttsUnits } from "../_shared/pricing.ts";

const MAX_CHARS = 4000;
const DEFAULT_DAILY = 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const admin = adminClient();
  const setting = await settings(admin);
  const apiKey = setting("TTS_API_KEY", "STT_API_KEY");
  if (!apiKey) return json(503, { error: "not_configured" });
  const base = (setting("TTS_BASE_URL", "STT_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const onGroq = /groq\.com/.test(base);
  const model = setting("TTS_MODEL") ?? (onGroq ? "playai-tts" : "tts-1");
  const defaultVoice = setting("TTS_VOICE") ?? (onGroq ? "Fritz-PlayAI" : "alloy");
  const limit = Number(setting("TTS_DAILY_CHARS")) || DEFAULT_DAILY;

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  let body: { text?: string; voice?: string; speed?: number; format?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "bad_request" });
  if (text.length > MAX_CHARS) return json(413, { error: "too_large" });
  const voice = typeof body.voice === "string" && /^[\w.-]{1,40}$/.test(body.voice) ? body.voice : defaultVoice;
  const speed = typeof body.speed === "number" ? Math.max(0.5, Math.min(2, body.speed)) : 1;
  const format = body.format === "wav" ? "wav" : "mp3";

  const { used } = await usedToday(admin, user.id, "tts");
  if (used + text.length > limit) return json(429, { error: "quota", used, limit });

  const paid = await charge(admin, user, "tts", "tts", ttsUnits(text.length));
  if (!paid.ok) return refused(paid);
  const fail = async (status: number, reply: Record<string, unknown>) => {
    await refund(admin, user, paid);
    return json(status, reply);
  };

  let response: Response;
  try {
    response = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice, input: text, response_format: format, ...(onGroq ? {} : { speed }) }),
    });
  } catch (caught) {
    console.error("speech service unreachable", caught);
    return await fail(502, { error: "provider_unreachable" });
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    console.error("speech service refused", response.status, detail);
    if (response.status === 401 || response.status === 403) return await fail(502, { error: "provider_key" });
    if (response.status === 429) return await fail(502, { error: "provider_busy" });
    // A language the voice does not speak comes back as a validation error.
    if (response.status === 400 || response.status === 422) return await fail(422, { error: "unsupported_language", detail });
    return await fail(502, { error: "provider_error", status: response.status });
  }
  const bytes = await response.arrayBuffer();
  await recordUsage(admin, user.id, "tts", text.length);
  return new Response(bytes, {
    headers: {
      ...CORS,
      "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg",
      "X-Voice": voice,
      "X-Model": model,
      ...creditHeaders(paid),
    },
  });
});
