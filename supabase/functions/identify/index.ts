/**
 * "What song is this?" — a few seconds of audio, answered by a music
 * recognition service (AudD by default: https://audd.io). The key stays
 * here; a signed-in visitor gets a daily allowance of lookups.
 *
 * Settings (secrets or private.stt_settings):
 *   IDENTIFY_API_KEY   an AudD token — required
 *   IDENTIFY_DAILY     lookups per account per day, default 30
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";

const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_DAILY = 30;
const AUDD = "https://api.audd.io/";

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
  if (used >= limit) return json(429, { error: "quota", used, limit });

  const upstream = new FormData();
  upstream.append("api_token", apiKey);
  upstream.append("file", file, "clip.wav");
  upstream.append("return", "apple_music,spotify,deezer");
  let response: Response;
  try {
    response = await fetch(AUDD, { method: "POST", body: upstream });
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
    if (code === 900 || code === 901) return json(502, { error: "provider_key" });
    return json(502, { error: "provider_error", status: response.status });
  }
  await recordUsage(admin, user.id, "identify", 1);
  const result = parsed.result;
  if (!result) return json(200, { found: false, used: used + 1, limit });
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
    used: used + 1,
    limit,
  });
});
