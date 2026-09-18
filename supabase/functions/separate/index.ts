/**
 * Vocal separation, on the server.
 *
 * The browser used to pull a 180MB network down to the device for this.
 * Now the song goes up once, into the visitor's private folder in storage,
 * and a separation model on Replicate (any model that takes an `audio` URL
 * and answers with stem URLs) does the work. The site asks for the job,
 * polls it, and fetches the two stems — through here, so the provider never
 * sees a browser and the browser never needs CORS from the provider.
 *
 * Settings (secrets or private.stt_settings):
 *   SEPARATION_API_KEY   a Replicate token — required
 *   SEPARATION_MODEL     default ryan5453/demucs
 *   SEPARATION_INPUT     extra input fields as JSON, default {"stem":"vocals","output_format":"wav"}
 *   SEPARATION_DAILY     songs per account per day, default 12
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";

const BUCKET = "works";
const MAX_BYTES = 60 * 1024 * 1024;
const DEFAULT_DAILY = 12;
const REPLICATE = "https://api.replicate.com/v1";

const MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/mp4",
  flac: "audio/flac",
};

/** The vocals and the rest, from whatever names the model gives its outputs. */
function pickStems(output: unknown): { vocals: string | null; instrumental: string | null } {
  const urls = new Map<string, string>();
  if (output && typeof output === "object" && !Array.isArray(output)) {
    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      if (typeof value === "string" && /^https?:/.test(value)) urls.set(key.toLowerCase(), value);
    }
  } else if (Array.isArray(output)) {
    output.forEach((value, index) => {
      if (typeof value === "string") urls.set(String(index), value);
    });
  }
  const find = (test: (key: string) => boolean) => [...urls.entries()].find(([key]) => test(key))?.[1] ?? null;
  return {
    vocals: find((key) => /vocal/.test(key) && !/no[_-]?vocal|instrumental|accomp/.test(key)),
    instrumental: find((key) => /no[_-]?vocal|instrumental|accomp|karaoke|backing/.test(key)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = adminClient();
  const setting = await settings(admin);
  const apiKey = setting("SEPARATION_API_KEY");
  // "Is the server path set up?" — asked before a song is uploaded, so the
  // tool can fall back to the browser without a wasted upload.
  if (req.method === "GET" && new URL(req.url).searchParams.get("availability")) {
    return json(200, { configured: Boolean(apiKey) });
  }
  if (!apiKey) return json(503, { error: "not_configured" });
  const model = setting("SEPARATION_MODEL") ?? "ryan5453/demucs";
  let extra: Record<string, unknown> = { stem: "vocals", output_format: "wav" };
  try {
    const raw = setting("SEPARATION_INPUT");
    if (raw) extra = JSON.parse(raw);
  } catch {
    // A malformed override keeps the default input.
  }
  const limit = Number(setting("SEPARATION_DAILY")) || DEFAULT_DAILY;

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const url = new URL(req.url);

  // --- a running job: how far, and the stems when done ---
  if (req.method === "GET" && url.searchParams.get("id")) {
    const id = url.searchParams.get("id")!.replace(/[^a-z0-9]/gi, "");
    const response = await fetch(`${REPLICATE}/predictions/${id}`, { headers });
    if (!response.ok) return json(502, { error: "provider_error", status: response.status });
    const prediction = (await response.json()) as {
      status: string;
      output?: unknown;
      error?: string | null;
      logs?: string;
    };
    if (prediction.status === "succeeded") {
      const stems = pickStems(prediction.output);
      if (!stems.vocals && !stems.instrumental) {
        console.error("separation output had no stems", JSON.stringify(prediction.output).slice(0, 300));
        return json(502, { error: "provider_error" });
      }
      return json(200, { status: "done", ...stems });
    }
    if (prediction.status === "failed" || prediction.status === "canceled") {
      console.error("separation failed", prediction.error, (prediction.logs ?? "").slice(-300));
      return json(200, { status: "failed", message: String(prediction.error ?? "").slice(0, 200) });
    }
    // A rough sense of progress from the model's own log lines, when it prints percentages.
    const percent = [...(prediction.logs ?? "").matchAll(/(\d{1,3})%/g)].map((match) => Number(match[1])).pop() ?? null;
    return json(200, { status: prediction.status, percent });
  }

  // --- a stem, fetched through here so the browser needs nothing from the provider ---
  if (req.method === "GET" && url.searchParams.get("fetch")) {
    const target = url.searchParams.get("fetch")!;
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return json(400, { error: "bad_request" });
    }
    if (!/(^|\.)replicate\.(delivery|com)$/.test(parsed.hostname)) return json(400, { error: "bad_request" });
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok || !upstream.body) return json(502, { error: "provider_error", status: upstream.status });
    return new Response(upstream.body, {
      headers: {
        ...CORS,
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  if (req.method !== "POST") return json(405, { error: "method" });

  // --- a new job ---
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "bad_request" });
  if (file.size > MAX_BYTES) return json(413, { error: "too_large" });

  const { used } = await usedToday(admin, user.id, "separation");
  if (used >= limit) return json(429, { error: "quota", used, limit });

  const extension = (file.name.split(".").pop() ?? "").toLowerCase();
  const contentType = MIME[extension] ?? (MIME[file.type.split("/")[1] ?? ""] ?? "audio/mpeg");
  const path = `${user.id}/separate/${crypto.randomUUID()}.${MIME[extension] ? extension : "bin"}`;
  const upload = await admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType });
  if (upload.error) {
    console.error("upload failed", upload.error);
    return json(502, { error: "storage" });
  }
  const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (signed.error || !signed.data?.signedUrl) {
    console.error("signing failed", signed.error);
    return json(502, { error: "storage" });
  }

  const [owner, name] = model.split("/");
  const response = await fetch(`${REPLICATE}/models/${owner}/${name}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { audio: signed.data.signedUrl, ...extra } }),
  }).catch((caught) => {
    console.error("separation service unreachable", caught);
    return null;
  });
  if (!response) return json(502, { error: "provider_unreachable" });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 400);
    console.error("separation service refused", response.status, detail);
    await admin.storage.from(BUCKET).remove([path]);
    if (response.status === 401 || response.status === 403) return json(502, { error: "provider_key" });
    if (response.status === 402) return json(502, { error: "provider_credit" });
    if (response.status === 429) return json(502, { error: "provider_busy" });
    return json(502, { error: "provider_error", status: response.status });
  }
  const prediction = (await response.json()) as { id: string };
  const total = await recordUsage(admin, user.id, "separation", 1);
  return json(200, { id: prediction.id, path, used: total, limit });
});
