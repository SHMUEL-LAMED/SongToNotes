/**
 * "What song is this?" — a few seconds of audio, answered by AudD's music
 * recognition (https://audd.io). The token stays here, on the server; a
 * signed-in visitor gets a daily allowance of lookups.
 *
 * One identification may take several clips — the site tries the start of
 * the song, about 35% and about 65% of it, one after another, until one is
 * recognised. The clips carry the same `session` id, and the allowance goes
 * down once per session (public.identify_sessions, see
 * supabase/identify_sessions.sql), whatever the number of clips. A session
 * may send at most MAX_CLIPS clips.
 *
 * With a song come links to it: Apple Music, Spotify and Deezer from AudD,
 * and its video on YouTube, a watch address found by youtube.ts.
 *
 * Settings (function secrets, or private.stt_settings from the admin area):
 *   IDENTIFY_API_KEY   an AudD api_token — required ("test" works for a few lookups a day)
 *   IDENTIFY_API_KEY_2, IDENTIFY_API_KEY_3
 *                      further tokens, optional: when a token is refused or its
 *                      allowance is used up, the same clip goes to the next one
 *   IDENTIFY_DAILY     lookups per account per day, default 30
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";
import { videoFromLyricsMedia, videoFromSongLink } from "./youtube.ts";

const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_DAILY = 30;
const AUDD = "https://api.audd.io/";
const MAX_CLIPS = 3;

/**
 * Tokens that were out of allowance (or refused), and until when to skip
 * them, so each clip does not first knock on a token known to be spent. Kept
 * for the life of this function instance only.
 */
const resting = new Map<string, number>();
const REST_MS = 60 * 60 * 1000;

/** A session id from the site: letters, digits and dashes, as a UUID has. */
function cleanSession(value: FormDataEntryValue | null) {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = adminClient();
  const setting = await settings(admin);
  const apiKeys = [...new Set(["IDENTIFY_API_KEY", "IDENTIFY_API_KEY_2", "IDENTIFY_API_KEY_3"].map((name) => setting(name)).filter((key): key is string => Boolean(key)))];
  if (req.method === "GET" && new URL(req.url).searchParams.get("availability")) {
    return json(200, { configured: apiKeys.length > 0 });
  }
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!apiKeys.length) return json(503, { error: "not_configured" });
  const limit = Number(setting("IDENTIFY_DAILY")) || DEFAULT_DAILY;

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "bad_request" });
  if (file.size > MAX_BYTES) return json(413, { error: "too_large" });

  const { used } = await usedToday(admin, user.id, "identify");
  const session = cleanSession(form.get("session"));
  let charged = false;
  if (session) {
    const { data, error } = await admin.rpc("identify_claim", { p_user: user.id, p_session: session });
    const claim = (Array.isArray(data) ? data[0] : data) as { attempts?: number; charged?: boolean } | null;
    if (error || !claim) {
      console.error("identify session", error);
      return json(500, { error: "provider_error" });
    }
    if ((claim.attempts ?? 0) > MAX_CLIPS) return json(429, { error: "session_limit", used, limit });
    charged = Boolean(claim.charged);
  }
  // A session already charged for this identification goes on without a new charge.
  if (!charged && used >= limit) return json(429, { error: "quota", used, limit });

  type AudDReply = {
    status?: string;
    error?: { error_code?: number; error_message?: string };
    result?: {
      artist?: string;
      title?: string;
      album?: string;
      release_date?: string;
      label?: string;
      timecode?: string;
      song_link?: string;
      apple_music?: { url?: string; artwork?: { url?: string } };
      spotify?: { external_urls?: { spotify?: string }; album?: { images?: { url?: string }[] } };
      deezer?: { link?: string };
      // Asked for only for `media`, the song's video among them (a JSON string).
      lyrics?: { media?: string } | null;
    } | null;
  };

  // Tokens that are not resting come first; if all are, try them anyway.
  const now = Date.now();
  const ready = apiKeys.filter((key) => (resting.get(key) ?? 0) <= now);
  const order = ready.length ? ready : apiKeys;
  let parsed: AudDReply | null = null;
  let lastCode: number | undefined;
  let lastStatus = 0;
  for (const apiKey of order) {
    const upstream = new FormData();
    upstream.append("api_token", apiKey);
    upstream.append("file", file, "clip.wav");
    upstream.append("return", "apple_music,spotify,deezer,lyrics");
    let response: Response;
    try {
      response = await fetch(AUDD, { method: "POST", body: upstream, signal: AbortSignal.timeout(25_000) });
    } catch (caught) {
      console.error("recognition service unreachable", caught);
      return json(502, { error: "provider_unreachable" });
    }
    const reply = (await response.json().catch(() => null)) as AudDReply | null;
    if (reply?.status === "success") {
      resting.delete(apiKey);
      parsed = reply;
      break;
    }
    lastCode = reply?.error?.error_code;
    lastStatus = response.status;
    console.error("recognition refused", response.status, JSON.stringify(reply).slice(0, 300));
    // 900 bad token, 901/902 the token's allowance is used up: on to the next token.
    if (lastCode === 900 || lastCode === 901 || lastCode === 902) {
      resting.set(apiKey, now + REST_MS);
      continue;
    }
    // Any other refusal is about the clip or the service, not the token.
    break;
  }
  if (!parsed) {
    if (lastCode === 900) return json(502, { error: "provider_key", code: lastCode });
    if (lastCode === 901 || lastCode === 902) return json(503, { error: "provider_busy", code: lastCode });
    return json(502, { error: "provider_error", status: lastStatus });
  }
  // Charged once per identification: the first clip of a session that the
  // service answers (with a song or without) is the one that counts.
  let usedNow = used;
  if (session) {
    const { data: first } = await admin.rpc("identify_charge", { p_user: user.id, p_session: session });
    if (first === true) usedNow = await recordUsage(admin, user.id, "identify", 1);
  } else {
    usedNow = await recordUsage(admin, user.id, "identify", 1);
  }
  const result = parsed.result;
  if (!result) return json(200, { found: false, used: usedNow, limit });
  const artwork = result.apple_music?.artwork?.url?.replace("{w}", "600").replace("{h}", "600") ?? result.spotify?.album?.images?.[0]?.url ?? null;
  const youtube = videoFromLyricsMedia(result.lyrics?.media) ?? (await videoFromSongLink(result.song_link));
  return json(200, {
    found: true,
    artist: result.artist ?? null,
    title: result.title ?? null,
    album: result.album ?? null,
    releaseDate: result.release_date ?? null,
    label: result.label ?? null,
    timecode: result.timecode ?? null,
    links: {
      song: result.song_link ?? null,
      appleMusic: result.apple_music?.url ?? null,
      spotify: result.spotify?.external_urls?.spotify ?? null,
      deezer: result.deezer?.link ?? null,
      youtube,
    },
    artwork,
    used: usedNow,
    limit,
  });
});
