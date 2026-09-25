/**
 * Where to listen in a song for the song identifier. One clip of a dozen
 * seconds is easy to miss — a long intro, a quiet bridge, a live recording —
 * so a file gives up to three different clips, tried one after another: the
 * start of the song once the silence and the opening are past, about 35% of
 * the way in, and about 65%. "Try another part" moves to other places.
 */
import { AiError, describeAiError, type Identification } from "./aiApi";
import { announceCredits, announceEmpty } from "./credits";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getSupabase } from "./supabase";
import { encodeWav } from "./wav";

/** How long each clip is, in seconds (the service wants 15–20). */
export const CLIP_SECONDS = 18;
/** How long the microphone listens. */
export const MIC_SECONDS = 20;
/** How many clips one identification may try. */
export const MAX_CLIPS = 3;
/** The rate the clips are sent at: small, and plenty for recognition. */
export const CLIP_RATE = 16_000;

/**
 * The places tried, round by round, as a share of the song. `null` is the
 * start of the song after the silence and the opening. A further round, from
 * "try another part", uses the next row.
 */
const ROUNDS: (number | null)[][] = [
  [null, 0.35, 0.65],
  [0.5, 0.2, 0.8],
  [0.12, 0.42, 0.9],
];

/** Seconds into the audio where the sound begins (past leading silence). */
export function soundStart(samples: Float32Array, rate: number): number {
  const window = Math.max(1, Math.round(rate * 0.05));
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
  if (peak === 0) return 0;
  const threshold = Math.max(0.01, peak * 0.05);
  for (let from = 0; from < samples.length; from += window) {
    let sum = 0;
    const to = Math.min(samples.length, from + window);
    for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
    if (Math.sqrt(sum / (to - from)) >= threshold) return from / rate;
  }
  return 0;
}

/**
 * Where each clip of a round starts, in seconds. Clips stay inside the audio,
 * and one that would overlap an earlier clip by more than half is left out,
 * so a short file gets fewer clips rather than the same one twice.
 */
export function clipStarts(duration: number, soundAt: number, round = 0, clip = CLIP_SECONDS): number[] {
  if (!(duration > 0)) return [];
  const first = Math.min(Math.max(0, soundAt), Math.max(0, duration - 1));
  if (duration - first <= clip) return [first];
  const last = duration - clip;
  // Past the opening: a few seconds, never more than 8.
  const intro = Math.min(8, duration * 0.05);
  const starts: number[] = [];
  for (const place of ROUNDS[round % ROUNDS.length]) {
    const wanted = place === null ? first + intro : duration * place - clip / 2;
    const start = Math.round(Math.min(last, Math.max(first, wanted)) * 10) / 10;
    if (starts.every((other) => Math.abs(other - start) >= clip / 2)) starts.push(start);
  }
  return starts.slice(0, MAX_CLIPS);
}

type Offline = typeof OfflineAudioContext;

function offlineContext(): Offline {
  const Offline = window.OfflineAudioContext || (window as typeof window & { webkitOfflineAudioContext?: Offline }).webkitOfflineAudioContext;
  if (!Offline) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  return Offline;
}

/** One clip of the audio, downmixed and resampled to a small WAV. */
export async function renderClip(buffer: AudioBuffer, start: number, seconds = CLIP_SECONDS): Promise<Blob> {
  const Offline = offlineContext();
  const from = Math.max(0, Math.min(start, buffer.duration));
  const length = Math.max(0.5, Math.min(seconds, buffer.duration - from));
  const offline = new Offline(1, Math.ceil(length * CLIP_RATE), CLIP_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0, from, length);
  const rendered = await offline.startRendering();
  return encodeWav({ channels: [rendered.getChannelData(0)], sampleRate: CLIP_RATE });
}

/** The places to try in a decoded file, for one round. */
export function fileClipStarts(buffer: AudioBuffer, round = 0) {
  return clipStarts(buffer.duration, soundStart(buffer.getChannelData(0), buffer.sampleRate), round);
}

/** A fresh id shared by the clips of one identification, so it is charged once. */
export function newSession() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Asks the recognition service about one clip. The clips of one
 * identification share `session`, and the allowance goes down once for them.
 */
export async function identifyClip(clip: Blob, session: string, signal?: AbortSignal): Promise<Identification> {
  const { data } = await (await getSupabase()).auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new AiError("signed_out", describeAiError("signed_out"));
  const form = new FormData();
  form.append("file", clip, "clip.wav");
  form.append("session", session);
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/identify`, {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${access}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw new AiError("cancelled", describeAiError("cancelled"));
    throw new AiError("network", describeAiError("network"));
  }
  const body = (await response.json().catch(() => null)) as (Identification & { error?: string; credits?: unknown }) | null;
  if (!response.ok || !body) {
    const code = body?.error ?? (response.status === 401 ? "signed_out" : "http");
    if (code === "credits") announceEmpty(body?.credits);
    throw new AiError(code, code === "session_limit" ? "הזיהוי הזה כבר ניסה את כל הקטעים שלו. לחץ על „נסה שוב בקטע אחר”." : describeAiError(code, response.status));
  }
  if (body.credits) announceCredits(body.credits);
  return body;
}
