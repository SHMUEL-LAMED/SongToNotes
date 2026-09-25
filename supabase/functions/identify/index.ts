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
 * Settings (function secrets, or private.stt_settings from the admin area):
 *   IDENTIFY_API_KEY   an AudD api_token — required ("test" works for a few lookups a day)
 *   IDENTIFY_DAILY     lookups per account per day, default 30
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";

const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_DAILY = 30;
const AUDD = "https://api.audd.io/";
const MAX_CLIPS = 3;

/** A session id from the site: letters, digits and dashes, as a UUID has. */
function cleanSession(value: FormDataEntryValue | null) {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = adminClient();
  const setting = await settings(admin);
  const apiKey = setting("IDENTIFY_API_KEY");
  if (req.method === "GET" && new URL(req.url).searchParams.get("availability")) {
    return json(200, { configured: Boolean(apiKey) });
  }
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!apiKey) return json(503, { error: "not_configured" });
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

  const upstream = new FormData();
  upstream.append("api_token", apiKey);
  upstream.append("file", file, "clip.wav");
  upstream.append("return", "apple_music,spotify,deezer");
  let response: Response;
  try {
    response = await fetch(AUDD, { method: "POST", body: upstream, signal: AbortSignal.timeout(25_000) });
  } catch (caught) {
    console.error("recognition service unreachable", caught);
    return json(502, { error: "provider_unreachable" });
  }
  const parsed = (await response.json().catch(() => null)) as {
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
    } | null;
  } | null;
  if (!parsed || parsed.status !== "success") {
    console.error("recognition refused", response.status, JSON.stringify(parsed).slice(0, 300));
    const code = parsed?.error?.error_code;
    // 900 bad token, 901 the token's allowance is used up (the "test" token has a small daily one)
    if (code === 900) return json(502, { error: "provider_key", code });
    if (code === 901 || code === 902) return json(503, { error: "provider_busy", code });
    return json(502, { error: "provider_error", status: response.status });
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
    },
    artwork,
    used: usedNow,
    limit,
  });
});
