/**
 * "What song is this?" — a few seconds of audio, answered by ACRCloud's music
 * recognition (https://www.acrcloud.com). The credentials stay here, on the
 * server; a signed-in visitor gets a daily allowance of lookups.
 *
 * Settings (function secrets, or private.stt_settings from the admin area):
 *   ACRCLOUD_HOST           the project's host, e.g. identify-eu-west-1.acrcloud.com
 *   ACRCLOUD_ACCESS_KEY     the project's Access Key
 *   ACRCLOUD_ACCESS_SECRET  the project's Access Secret
 *   IDENTIFY_DAILY          lookups per account per day, default 30
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";

const MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_DAILY = 30;
const ENDPOINT = "/v1/identify";

/** Only a bare ACRCloud host name is accepted — no scheme, path or other domain. */
function cleanHost(value: string | undefined) {
  const host = (value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.acrcloud\.(com|cn)$/.test(host) ? host : null;
}

async function sign(secret: string, text: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function timecode(ms: number | undefined) {
  if (!ms || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

type AcrMusic = {
  title?: string;
  artists?: { name?: string }[];
  album?: { name?: string };
  release_date?: string;
  label?: string;
  play_offset_ms?: number;
  external_metadata?: {
    spotify?: { track?: { id?: string }; album?: { id?: string } };
    deezer?: { track?: { id?: string | number } };
    youtube?: { vid?: string };
  };
};

type AcrReply = {
  status?: { code?: number; msg?: string };
  metadata?: { music?: AcrMusic[] };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = adminClient();
  const setting = await settings(admin);
  const host = cleanHost(setting("ACRCLOUD_HOST"));
  const accessKey = setting("ACRCLOUD_ACCESS_KEY");
  const accessSecret = setting("ACRCLOUD_ACCESS_SECRET");
  const configured = Boolean(host && accessKey && accessSecret);
  if (req.method === "GET" && new URL(req.url).searchParams.get("availability")) {
    return json(200, { configured });
  }
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!configured) return json(503, { error: "not_configured" });
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

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await sign(
    accessSecret!,
    ["POST", ENDPOINT, accessKey, "audio", "1", timestamp].join("\n"),
  );
  const upstream = new FormData();
  upstream.append("sample", file, "clip.wav");
  upstream.append("sample_bytes", String(file.size));
  upstream.append("access_key", accessKey!);
  upstream.append("data_type", "audio");
  upstream.append("signature_version", "1");
  upstream.append("signature", signature);
  upstream.append("timestamp", timestamp);

  let response: Response;
  try {
    response = await fetch(`https://${host}${ENDPOINT}`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (caught) {
    console.error("recognition service unreachable", caught);
    return json(502, { error: "provider_unreachable" });
  }
  const parsed = (await response.json().catch(() => null)) as AcrReply | null;
  const code = parsed?.status?.code;
  if (code === undefined) {
    console.error("recognition refused", response.status);
    return json(502, { error: "provider_error", status: response.status });
  }
  // 1001: no match — a real answer, counted against the allowance.
  if (code !== 0 && code !== 1001) {
    console.error("recognition refused", response.status, code, parsed?.status?.msg);
    // 3001 missing/invalid key, 3014 bad signature, 3000 client error, 3002 / 3004 key not allowed
    if ([3000, 3001, 3002, 3004, 3014].includes(code)) return json(502, { error: "provider_key", code });
    // 3003 quota over, 3015 QPS limit
    if (code === 3003 || code === 3015) return json(503, { error: "provider_busy", code });
    // 2004 fingerprint failed (silence / unreadable audio)
    if (code === 2004 || code === 2005) return json(422, { error: "provider_error", code });
    return json(502, { error: "provider_error", code });
  }
  await recordUsage(admin, user.id, "identify", 1);
  const music = code === 0 ? parsed?.metadata?.music?.[0] : undefined;
  if (!music) return json(200, { found: false, used: used + 1, limit });

  const meta = music.external_metadata ?? {};
  const spotify = meta.spotify?.track?.id;
  const deezer = meta.deezer?.track?.id;
  const youtube = meta.youtube?.vid;
  const artist = (music.artists ?? []).map((item) => item.name).filter(Boolean).join(", ");
  return json(200, {
    found: true,
    artist: artist || null,
    title: music.title ?? null,
    album: music.album?.name ?? null,
    releaseDate: music.release_date ?? null,
    label: music.label ?? null,
    timecode: timecode(music.play_offset_ms),
    links: {
      song: youtube ? `https://www.youtube.com/watch?v=${encodeURIComponent(youtube)}` : null,
      appleMusic: null,
      spotify: spotify ? `https://open.spotify.com/track/${encodeURIComponent(spotify)}` : null,
      deezer: deezer ? `https://www.deezer.com/track/${encodeURIComponent(String(deezer))}` : null,
    },
    artwork: null,
    used: used + 1,
    limit,
  });
});
