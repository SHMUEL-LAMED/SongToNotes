/**
 * Text to speech, on the server, for a file the visitor can keep.
 *
 * The browser's own voices read aloud without any of this; this is for a
 * downloadable recording. The voice is Google Gemini's, which reads Hebrew,
 * Arabic, English and more than a hundred other languages, with the same
 * GEMINI_API_KEY the assistant can use. A text longer than one request
 * carries is read in pieces at the same time and stitched into one WAV,
 * which the page turns into an MP3. Google answers with the speech in several
 * audio blocks, and all of them are joined; a reading that still stops well
 * short of its text is asked for again. A service of the project's own choosing,
 * set with TTS_API_KEY, still goes first: voiceServices() in
 * ../_shared/voice.ts has the order.
 *
 * Settings (secrets or private.stt_settings):
 *   GEMINI_API_KEY   Google AI Studio's key (or GOOGLE_API_KEY), free to get
 *   TTS_API_KEY      an OpenAI-compatible speech service instead; falls back
 *                    to STT_API_KEY, unless that one is Groq's
 *   TTS_BASE_URL     its address, default OpenAI
 *   TTS_MODEL        default tts-1
 *   TTS_VOICE        default alloy
 *   TTS_DAILY_CHARS  default 60000
 *
 * A recording is paid for in credits: the "tts" price for every 1,000
 * characters (supabase/credits.sql), given back if the voice service fails.
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";
import { charge, creditHeaders, refund, refused } from "../_shared/credits.ts";
import { ttsUnits } from "../_shared/pricing.ts";
import {
  ERROR_CODES,
  GEMINI_TTS_MODELS,
  GEMINI_VOICE,
  SAMPLE_RATE,
  type Trouble,
  type VoiceService,
  audioBlocksOf,
  expectedSeconds,
  fromBase64,
  joinPcm,
  paceStyle,
  pcmOf,
  readsWhole,
  secondsOf,
  splitText,
  troubleOf,
  voiceServices,
  wavFile,
  worse,
} from "../_shared/voice.ts";

const MAX_CHARS = 4000;
const DEFAULT_DAILY = 60_000;
/**
 * How long the voice has, all pieces together. The platform stops a function
 * at 150 seconds on the free plan, and one stopped from outside never gets to
 * give the credits back; this leaves it time to.
 */
const BUDGET_MS = 120_000;
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
/**
 * How many times one piece is asked for when Google's reading of it stops
 * well short of the text. Each time tries the models in order again.
 */
const READINGS = 3;

type Pcm = { samples: Uint8Array; sampleRate: number };
/** One piece as Google read it, and how that went: for the logs, and for the page to show. */
type Reading = Pcm & { model: string; blocks: number; seconds: number; tries: number; refused: string[] };
type Speech = {
  bytes: Uint8Array;
  type: string;
  model: string;
  readings?: { model: string; blocks: number; seconds: number; expected: number; tries: number; refused: string[] }[];
};

/** A refusal from a voice service, and what it means. */
class VoiceError extends Error {
  constructor(
    readonly trouble: Trouble,
    readonly status: number,
    detail: string,
  ) {
    super(detail);
  }
}

/** Bytes to base64, a slice at a time so a long recording does not overflow the call stack. */
function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

async function refusal(response: Response, model: string) {
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  return new VoiceError(troubleOf(response.status, detail), response.status, `${model}: ${detail}`);
}

/**
 * The speech in one answer: all its audio blocks, joined in order. Blocks
 * that each hold the whole reading, rather than parts of one, would say it
 * twice when joined; then the longest of them is the reading.
 */
function speechOf(answer: unknown, text: string, speed: number): (Pcm & { blocks: number }) | null {
  const blocks = audioBlocksOf(answer);
  const parts = blocks
    .map((block) => pcmOf(fromBase64(block.data), block.mimeType))
    .filter((pcm): pcm is Pcm => pcm !== null && pcm.samples.length > 0);
  if (!parts.length) return null;
  const longest = parts.reduce((a, b) => (b.samples.length > a.samples.length ? b : a));
  const joined = joinPcm(parts) ?? longest;
  const expected = expectedSeconds(text, speed);
  if (parts.length > 1 && expected >= 2 && secondsOf(joined) > expected * 1.8 && readsWhole(secondsOf(longest), text, speed)) {
    return { ...longest, blocks: blocks.length };
  }
  return { ...joined, blocks: blocks.length };
}

/**
 * One piece of the text in Google's voice. The models are tried in order,
 * and a reading that stops well short of the text is asked for again, up to
 * READINGS times; if none is whole, the longest is kept.
 */
async function geminiPiece(apiKey: string, text: string, speed: number, signal: AbortSignal): Promise<Reading> {
  const style = paceStyle(speed);
  let failure = new VoiceError("other", 502, "no model tried");
  let best: Reading | null = null;
  const refused: string[] = [];
  for (let tries = 1; tries <= READINGS; tries += 1) {
    let heard = false;
    for (const model of GEMINI_TTS_MODELS) {
      const response = await fetch(`${GEMINI}/interactions`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [{ type: "user_input", content: [{ type: "text", text, ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}) }] }],
          response_format: { type: "audio", mime_type: "audio/l16", sample_rate: SAMPLE_RATE },
          generation_config: { speech_config: [{ voice: GEMINI_VOICE }] },
          // Nothing of the visitor's text is kept on Google's side once the audio is back.
          store: false,
        }),
        signal,
      });
      if (!response.ok) {
        failure = await refusal(response, model);
        if (refused.length < 6) refused.push(`${model} ${response.status}`);
        console.warn("speech model refused", model, response.status, failure.trouble);
        // A key Google turns down is turned down for every model.
        if (failure.trouble === "key") throw failure;
        continue;
      }
      const speech = speechOf(await response.json().catch(() => null), text, speed);
      if (!speech) {
        failure = new VoiceError("other", 502, `${model}: no audio in the answer`);
        continue;
      }
      const reading: Reading = { ...speech, model, seconds: secondsOf(speech), tries, refused };
      if (readsWhole(reading.seconds, text, speed)) return reading;
      console.warn("speech stopped short", model, reading.seconds.toFixed(2), expectedSeconds(text, speed).toFixed(2), speech.blocks);
      if (!best || reading.seconds > best.seconds) best = reading;
      heard = true;
      break;
    }
    // Every model refused: asking again at once would only be refused again.
    if (!heard) break;
  }
  if (best) return best;
  throw failure;
}

/** The whole text in Google's voice: its pieces read at once, joined into one WAV. */
async function geminiSpeech(apiKey: string, text: string, speed: number, signal: AbortSignal): Promise<Speech> {
  // A piece that fails stops the rest: the recording is whole or not at all.
  const stop = new AbortController();
  const pieceSignal = AbortSignal.any([signal, stop.signal]);
  try {
    const parts = splitText(text);
    const pieces = await Promise.all(parts.map((piece) => geminiPiece(apiKey, piece, speed, pieceSignal)));
    const rate = pieces[0].sampleRate;
    if (pieces.some((piece) => piece.sampleRate !== rate)) throw new VoiceError("other", 502, "pieces came back at different rates");
    const models = [...new Set(pieces.map((piece) => piece.model))].join(",");
    const round = (seconds: number) => Math.round(seconds * 100) / 100;
    const readings = pieces.map((piece, index) => ({
      model: piece.model,
      blocks: piece.blocks,
      seconds: round(piece.seconds),
      expected: round(expectedSeconds(parts[index], speed)),
      tries: piece.tries,
      refused: piece.refused,
    }));
    console.log("speech", text.length, JSON.stringify(readings));
    return { bytes: wavFile(pieces.map((piece) => piece.samples), rate), type: "audio/wav", model: models, readings };
  } finally {
    stop.abort();
  }
}

/** The whole text from an OpenAI-compatible speech service (TTS_API_KEY). */
async function customSpeech(
  service: Extract<VoiceService, { id: "custom" }>,
  text: string,
  options: { voice?: string; speed: number; format: "mp3" | "wav" },
  signal: AbortSignal,
): Promise<Speech> {
  const response = await fetch(`${service.base}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${service.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: service.model, voice: options.voice ?? service.voice, input: text, response_format: options.format, speed: options.speed }),
    signal,
  });
  if (!response.ok) throw await refusal(response, service.model);
  const said = response.headers.get("Content-Type") ?? "";
  const type = /^audio\//i.test(said) ? said.split(";")[0] : options.format === "wav" ? "audio/wav" : "audio/mpeg";
  return { bytes: new Uint8Array(await response.arrayBuffer()), type, model: service.model };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const admin = adminClient();
  const setting = await settings(admin);
  const services = voiceServices(setting);
  if (!services.length) return json(503, { error: "not_configured" });
  const limit = Number(setting("TTS_DAILY_CHARS")) || DEFAULT_DAILY;

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  let body: { text?: string; voice?: string; speed?: number; format?: string; encoding?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "bad_request" });
  if (text.length > MAX_CHARS) return json(413, { error: "too_large" });
  const voice = typeof body.voice === "string" && /^[\w.-]{1,40}$/.test(body.voice) ? body.voice : undefined;
  const speed = typeof body.speed === "number" ? Math.max(0.5, Math.min(2, body.speed)) : 1;
  const format = body.format === "wav" ? "wav" : "mp3";
  // Some filtered connections (NetFree, for one) hold back a reply that is an
  // audio file; the same audio as base64 inside JSON passes like any answer.
  const asJson = body.encoding === "base64";

  const { used } = await usedToday(admin, user.id, "tts");
  if (used + text.length > limit) return json(429, { error: "quota", used, limit });

  const paid = await charge(admin, user, "tts", "tts", ttsUnits(text.length));
  if (!paid.ok) return refused(paid);
  const fail = async (status: number, reply: Record<string, unknown>) => {
    await refund(admin, user, paid);
    return json(status, reply);
  };

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(BUDGET_MS)]);
  let trouble: Trouble | null = null;
  for (const service of services) {
    let speech: Speech;
    try {
      speech =
        service.id === "gemini"
          ? await geminiSpeech(service.apiKey, text, speed, signal)
          : await customSpeech(service, text, { voice, speed, format }, signal);
    } catch (caught) {
      if (signal.aborted) {
        console.error("speech took too long", service.id, text.length);
        return await fail(504, { error: "timeout" });
      }
      if (caught instanceof VoiceError) {
        console.error("speech service refused", service.id, caught.status, caught.message);
        trouble = worse(trouble, caught.trouble);
      } else {
        console.error("speech service unreachable", service.id, caught);
        trouble = worse(trouble, "unreachable");
      }
      continue;
    }
    await recordUsage(admin, user.id, "tts", text.length);
    if (asJson) {
      return new Response(
        JSON.stringify({
          audio: toBase64(speech.bytes),
          type: speech.type,
          provider: service.id,
          model: speech.model,
          ...(speech.readings ? { readings: speech.readings } : {}),
        }),
        {
          headers: {
            ...CORS,
            "Content-Type": "application/json; charset=utf-8",
            "X-Provider": service.id,
            "X-Model": speech.model,
            ...creditHeaders(paid),
          },
        },
      );
    }
    return new Response(speech.bytes, {
      headers: {
        ...CORS,
        "Content-Type": speech.type,
        "X-Provider": service.id,
        "X-Model": speech.model,
        ...creditHeaders(paid),
      },
    });
  }
  return await fail(502, { error: ERROR_CODES[trouble ?? "other"] });
});
