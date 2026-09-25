/**
 * The plain-logic half of the server's voice (supabase/functions/_shared/voice.ts),
 * run with the site's tests.
 */
import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  PIECE_CHARS,
  audioFromInteraction,
  fromBase64,
  paceStyle,
  pcmOf,
  splitText,
  troubleOf,
  voiceServices,
  wavFile,
  worse,
} from "../../supabase/functions/_shared/voice";

/** Settings as the functions read them: the first name that has a value wins. */
const settingsOf = (values: Record<string, string>) => (name: string, ...fallbacks: string[]) =>
  [name, ...fallbacks].map((key) => values[key]).find(Boolean);

const GROQ = "https://api.groq.com/openai/v1";

describe("voiceServices", () => {
  it("has nothing to offer without a key", () => {
    expect(voiceServices(settingsOf({}))).toEqual([]);
  });

  it("passes over Groq, whose voices no longer fit the page", () => {
    // This project's own set-up: the transcription key is Groq's.
    expect(voiceServices(settingsOf({ STT_API_KEY: "gsk", STT_BASE_URL: GROQ }))).toEqual([]);
    expect(voiceServices(settingsOf({ TTS_API_KEY: "gsk", TTS_BASE_URL: `${GROQ}/` }))).toEqual([]);
  });

  it("speaks with Google's voice given the assistant's Gemini key", () => {
    expect(voiceServices(settingsOf({ STT_API_KEY: "gsk", STT_BASE_URL: GROQ, GEMINI_API_KEY: "g" }))).toEqual([{ id: "gemini", apiKey: "g" }]);
    expect(voiceServices(settingsOf({ GOOGLE_API_KEY: "g2" }))).toEqual([{ id: "gemini", apiKey: "g2" }]);
  });

  it("puts a service set up for speech first, at its own address", () => {
    const services = voiceServices(settingsOf({ TTS_API_KEY: "sk", STT_BASE_URL: GROQ, TTS_MODEL: "gpt-4o-mini-tts", TTS_VOICE: "nova", GEMINI_API_KEY: "g" }));
    expect(services).toEqual([
      { id: "custom", apiKey: "sk", base: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", voice: "nova" },
      { id: "gemini", apiKey: "g" },
    ]);
  });

  it("keeps an OpenAI transcription key as a voice, after Gemini", () => {
    expect(voiceServices(settingsOf({ STT_API_KEY: "sk", GEMINI_API_KEY: "g" }))).toEqual([
      { id: "gemini", apiKey: "g" },
      { id: "custom", apiKey: "sk", base: "https://api.openai.com/v1", model: "tts-1", voice: "alloy" },
    ]);
  });
});

describe("splitText", () => {
  const sentence = "זה משפט בעברית שנקרא בקול, והוא ארוך מספיק כדי למלא שורה. ";

  it("leaves a short text whole", () => {
    expect(splitText("  שלום עולם  ")).toEqual(["שלום עולם"]);
    expect(splitText("")).toEqual([]);
  });

  it("cuts a long text after whole sentences, and loses nothing", () => {
    const text = sentence.repeat(70).trim();
    const pieces = splitText(text);
    expect(pieces.length).toBe(Math.ceil(text.length / PIECE_CHARS));
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(PIECE_CHARS);
      expect(piece.endsWith(".")).toBe(true);
    }
    expect(pieces.join(" ")).toBe(text);
  });

  it("prefers a line break, but not one in the first half", () => {
    const early = `${"א".repeat(10)}\n${"ב ".repeat(30)}`;
    expect(splitText(early, 40)[0]).toBe(`${"א".repeat(10)}\n${"ב ".repeat(14)}ב`);
    const late = `${"א ".repeat(15)}\n${"ב ".repeat(30)}`;
    expect(splitText(late, 40)[0]).toBe("א ".repeat(15).trim());
  });

  it("falls back to a comma, then a space, then a hard cut", () => {
    expect(splitText("אחת שתיים שלוש, ארבע חמש שש שבע", 20)[0]).toBe("אחת שתיים שלוש,");
    expect(splitText("אחת שתיים שלוש ארבע חמש", 20)[0]).toBe("אחת שתיים שלוש ארבע");
    expect(splitText("א".repeat(45), 20)).toEqual(["א".repeat(20), "א".repeat(20), "א".repeat(5)]);
  });
});

describe("paceStyle", () => {
  it("asks for a pace only when the slider is well off the middle", () => {
    expect(paceStyle(1)).toBeUndefined();
    expect(paceStyle(1.1)).toBeUndefined();
    expect(paceStyle(1.3)).toBe("speaking a little quickly");
    expect(paceStyle(2)).toBe("speaking quickly");
    expect(paceStyle(0.8)).toBe("speaking a little slowly");
    expect(paceStyle(0.5)).toBe("speaking slowly");
  });
});

describe("audioFromInteraction", () => {
  it("reads the last audio of the model's output, as the Interactions API returns it", () => {
    const answer = {
      id: "v1_abc",
      status: "completed",
      steps: [
        { type: "thought", content: [{ type: "text", text: "…" }] },
        { type: "model_output", content: [{ type: "audio", data: "AAA=", mime_type: "audio/l16;rate=24000" }] },
        { type: "model_output", content: [{ type: "audio", data: "AQE=", mime_type: "audio/l16;rate=24000" }] },
      ],
    };
    expect(audioFromInteraction(answer)).toEqual({ data: "AQE=", mimeType: "audio/l16;rate=24000" });
  });

  it("also reads the older outputs list, and nothing from anything else", () => {
    expect(audioFromInteraction({ outputs: [{ type: "audio", data: "AAA=", mimeType: "audio/wav" }] })).toEqual({ data: "AAA=", mimeType: "audio/wav" });
    expect(audioFromInteraction({ steps: [{ type: "model_output", content: [{ type: "text", text: "no" }] }] })).toBeNull();
    expect(audioFromInteraction(null)).toBeNull();
    expect(audioFromInteraction({ steps: "nope", outputs: [null] })).toBeNull();
  });
});

describe("the audio", () => {
  const samples = (...values: number[]) => new Uint8Array(Int16Array.from(values).buffer);

  it("stitches pieces into one 16-bit mono WAV with silence between them", () => {
    const wav = wavFile([samples(1, 2), samples(3)], 8000, 0.001);
    const view = new DataView(wav.buffer);
    const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    // 3 samples, and 8 of silence (a millisecond at 8 kHz) between the two pieces.
    expect(view.getUint32(40, true)).toBe(22);
    expect(view.getUint32(4, true)).toBe(36 + 22);
    expect([...new Int16Array(wav.buffer.slice(44))]).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
  });

  it("reads raw PCM at the rate its type names, and a WAV by its header", () => {
    expect(pcmOf(samples(5, 6), "audio/L16;codec=pcm;rate=16000")).toEqual({ samples: samples(5, 6), sampleRate: 16000 });
    expect(pcmOf(samples(5), "")?.sampleRate).toBe(24000);
    expect(pcmOf(new Uint8Array([1, 2, 3]), "audio/l16")?.samples.length).toBe(2);
    const wav = pcmOf(wavFile([samples(7, 8, 9)], 22050));
    expect(wav?.sampleRate).toBe(22050);
    expect([...new Int16Array(wav!.samples.slice().buffer)]).toEqual([7, 8, 9]);
  });

  it("reads what a WAV holds when its header claims more", () => {
    const wav = wavFile([samples(1, 2, 3)], 24000);
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true);
    expect(pcmOf(wav)?.samples.length).toBe(6);
  });

  it("refuses what it cannot join: stereo, other encodings", () => {
    const stereo = wavFile([samples(1, 2)], 24000);
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(pcmOf(stereo)).toBeNull();
    expect(pcmOf(samples(1), "audio/mpeg")).toBeNull();
  });

  it("decodes base64, and nothing from what is not", () => {
    expect([...fromBase64(btoa("\u0001ÿ"))]).toEqual([1, 255]);
    expect(fromBase64("***").length).toBe(0);
  });
});

describe("troubleOf", () => {
  it("does not take a retired model for a language the voice lacks", () => {
    // Groq's answer to this page on 2026-09-25, word for word.
    const retired =
      '{"error":{"message":"The model `playai-tts` has been decommissioned and is no longer supported. Please refer to https://console.groq.com/docs/deprecations for a recommendation on which model to use instead.","type":"invalid_request_error","code":"model_decommissioned"}}';
    expect(troubleOf(400, retired)).toBe("model");
    expect(troubleOf(404, '{"error":{"code":404,"message":"models/gemini-x is not found for API version v1beta","status":"NOT_FOUND"}}')).toBe("model");
  });

  it("tells a rejected key, a busy service and anything else apart", () => {
    expect(troubleOf(401, "")).toBe("key");
    expect(troubleOf(403, "PERMISSION_DENIED")).toBe("key");
    expect(troubleOf(400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')).toBe("key");
    expect(troubleOf(429, "RESOURCE_EXHAUSTED")).toBe("busy");
    expect(troubleOf(400, '{"error":{"message":"Invalid value at \'voice\'"}}')).toBe("other");
    expect(troubleOf(500, "")).toBe("other");
  });

  it("tells the visitor about the most useful of several troubles", () => {
    expect(worse(null, "model")).toBe("model");
    expect(worse("model", "busy")).toBe("busy");
    expect(worse("key", "busy")).toBe("key");
    expect(worse("unreachable", "other")).toBe("unreachable");
    expect(ERROR_CODES[worse("other", "model")]).toBe("provider_error");
    expect(ERROR_CODES.key).toBe("provider_key");
  });
});
