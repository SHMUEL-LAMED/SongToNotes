/**
 * The server's voice (supabase/functions/tts), the part that is plain logic:
 * which voice services the project has a key for, where a long text is cut
 * into pieces a request can carry, how the audio is read out of Google's
 * answer, and how the pieces become one WAV. No imports, so the site's own
 * tests run it as it is (src/lib/voice.test.ts), and the admin's health check
 * reads the same list of services the voice itself tries.
 */

/**
 * Google's speech models, tried in this order: Flash-Lite is the one Google
 * made for reading aloud, and Flash takes over when it is busy or gone. Both
 * speak Hebrew, Arabic, English and more than a hundred other languages, and
 * both have a free tier.
 */
export const GEMINI_TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];
/** One of Google's prebuilt voices; it speaks whatever language the text is in. */
export const GEMINI_VOICE = "Kore";
/** What Google is asked for: 16-bit mono PCM at this rate. */
export const SAMPLE_RATE = 24_000;
/** Characters in one request. A longer text goes in pieces, all at once. */
export const PIECE_CHARS = 1_500;

type Setting = (name: string, ...fallbacks: string[]) => string | undefined;

export type VoiceService =
  | { id: "gemini"; apiKey: string }
  | { id: "custom"; apiKey: string; base: string; model: string; voice: string };

/**
 * The services that can read a text aloud, in the order to try them. A key
 * set for this purpose (TTS_API_KEY) is a deliberate choice and goes first;
 * then Google Gemini, with the same key the assistant reads; then the transcription
 * key, when its service also speaks (OpenAI, the default).
 *
 * Groq is passed over: the model this page used there (playai-tts) was
 * retired, and its voices now (Orpheus) take 200 characters a request, speak
 * only English and Arabic, and allow a hundred requests a day on the free plan.
 */
export function voiceServices(setting: Setting): VoiceService[] {
  const own = setting("TTS_API_KEY");
  const apiKey = own ?? setting("STT_API_KEY");
  const base = ((own ? setting("TTS_BASE_URL") : setting("TTS_BASE_URL", "STT_BASE_URL")) ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const custom: VoiceService | null =
    apiKey && !/groq\.com/i.test(base)
      ? { id: "custom", apiKey, base, model: setting("TTS_MODEL") ?? "tts-1", voice: setting("TTS_VOICE") ?? "alloy" }
      : null;
  const gemini = setting("GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_GEMINI_KEY");
  const services: VoiceService[] = [];
  if (own && custom) services.push(custom);
  if (gemini) services.push({ id: "gemini", apiKey: gemini });
  if (!own && custom) services.push(custom);
  return services;
}

/** Places to cut, best first: a line break, the end of a sentence, a comma, a space. */
const PAUSES = [/\n\s*/g, /[.!?…׃؟]+["'”’»)\]]*\s+/g, /[,;:،—–]\s+/g, /\s+/g];

/**
 * The text in pieces of at most `max` characters, each cut where a reader
 * would pause anyway. A piece is only cut in its first half when there is
 * nowhere better further on; with no pause at all, it is cut at `max`.
 */
export function splitText(text: string, max = PIECE_CHARS): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = max;
    for (const pause of PAUSES) {
      const found = [...window.matchAll(pause)].filter((match) => match.index >= max / 2).at(-1);
      if (found) {
        cut = found.index + found[0].length;
        break;
      }
    }
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Google gives no speed setting; the pace is asked for in words, and only
 * when the slider is plainly off the middle.
 */
export function paceStyle(speed: number): string | undefined {
  if (speed <= 0.75) return "speaking slowly";
  if (speed < 0.9) return "speaking a little slowly";
  if (speed >= 1.5) return "speaking quickly";
  if (speed > 1.1) return "speaking a little quickly";
  return undefined;
}

/**
 * The last audio in an answer from Google's Interactions API: base64 in
 * `steps[].content[]` (and in `outputs[]`, the shape it had before).
 */
export function audioFromInteraction(answer: unknown): { data: string; mimeType: string } | null {
  const found: { data: string; mimeType: string }[] = [];
  const read = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks as { type?: unknown; data?: unknown; mime_type?: unknown; mimeType?: unknown }[]) {
      if (block?.type === "audio" && typeof block.data === "string" && block.data) {
        found.push({ data: block.data, mimeType: String(block.mime_type ?? block.mimeType ?? "") });
      }
    }
  };
  const { steps, outputs } = (answer ?? {}) as { steps?: unknown; outputs?: unknown };
  if (Array.isArray(steps)) for (const step of steps) read((step as { content?: unknown } | null)?.content);
  read(outputs);
  return found.at(-1) ?? null;
}

/** Base64 to bytes, with nothing but the platform; nothing for anything that is not base64. */
export function fromBase64(data: string) {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * The 16-bit mono samples in a piece of Google's audio, and their rate. It is
 * asked for as raw PCM (audio/l16), and a WAV is read just as well; anything
 * else is null.
 */
export function pcmOf(bytes: Uint8Array, mimeType = ""): { samples: Uint8Array; sampleRate: number } | null {
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length >= 12 && tag(0) === "RIFF" && tag(8) === "WAVE") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let sampleRate = 0;
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = view.getUint32(at + 4, true);
      if (tag(at) === "fmt " && size >= 16) {
        const format = view.getUint16(at + 8, true);
        const channels = view.getUint16(at + 10, true);
        const bits = view.getUint16(at + 22, true);
        if ((format !== 1 && format !== 0xfffe) || channels !== 1 || bits !== 16) return null;
        sampleRate = view.getUint32(at + 12, true);
      } else if (tag(at) === "data") {
        if (!sampleRate) return null;
        // A WAV written as it streams claims more than it holds.
        const end = Math.min(bytes.length, at + 8 + size);
        return { samples: bytes.subarray(at + 8, end - ((end - at - 8) % 2)), sampleRate };
      }
      at += 8 + size + (size % 2);
    }
    return null;
  }
  if (mimeType && !/^audio\/l16\b/i.test(mimeType)) return null;
  const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1]) || SAMPLE_RATE;
  return { samples: bytes.subarray(0, bytes.length - (bytes.length % 2)), sampleRate: rate };
}

/** One WAV from pieces of 16-bit mono PCM, with a breath of silence between them. */
export function wavFile(pieces: Uint8Array[], sampleRate: number, gapSeconds = 0.25) {
  const gap = Math.round(sampleRate * gapSeconds) * 2;
  const dataBytes = pieces.reduce((sum, piece) => sum + piece.length, 0) + gap * Math.max(0, pieces.length - 1);
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const write = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) out[at + index] = text.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  pieces.forEach((piece, index) => {
    if (index) at += gap;
    out.set(piece, at);
    at += piece.length;
  });
  return out;
}

/**
 * What a refusal means for the next step: a key the service rejects, a
 * service that is busy or out of quota, a model it no longer serves, or
 * anything else. A retired model is not a language the voice lacks.
 */
export type Trouble = "key" | "busy" | "model" | "unreachable" | "other";

export function troubleOf(status: number, detail: string): Trouble {
  if (status === 401 || status === 403 || (status === 400 && /api[ _]?key/i.test(detail))) return "key";
  if (status === 429) return "busy";
  if (status === 404 || /model_not_found|decommissioned|no longer (supported|available)|model\b.{0,80}\bnot (found|supported)/i.test(detail)) return "model";
  return "other";
}

const TELLING: Trouble[] = ["key", "busy", "unreachable", "other", "model"];

/** Of two troubles, the one to tell the visitor about. */
export function worse(a: Trouble | null, b: Trouble): Trouble {
  return a !== null && TELLING.indexOf(a) <= TELLING.indexOf(b) ? a : b;
}

/** The error the page shows for each trouble (the messages are in src/lib/aiApi.ts). */
export const ERROR_CODES: Record<Trouble, string> = {
  key: "provider_key",
  busy: "provider_busy",
  unreachable: "provider_unreachable",
  model: "provider_error",
  other: "provider_error",
};
