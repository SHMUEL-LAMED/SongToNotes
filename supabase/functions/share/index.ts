/**
 * Public share links for a saved work.
 *
 * POST  {origin, workId, expiresInDays?}
 *                          (signed in) makes or returns the link for a work
 *                          the caller owns: a snapshot of it under a token.
 * POST  {token, expiresInDays}
 *                          (signed in) moves or removes the expiry of one of
 *                          the caller's links; null keeps it open.
 * DELETE ?token=           (signed in) revokes one of the caller's links.
 * GET   ?token=            (anyone) the snapshot, with a signed URL for its
 *                          file that lasts an hour; counts a view.
 */
import { CORS, adminClient, json, visitor } from "./common.ts";

const BUCKET = "works";

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" } });
  const admin = adminClient();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const key = (url.searchParams.get("token") ?? "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (!key) return json(400, { error: "bad_request" });
    const { data: share } = await admin.from("shares").select("*").eq("token", key).is("revoked_at", null).maybeSingle();
    if (!share) return json(404, { error: "not_found" });
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return json(404, { error: "not_found" });
    }
    let fileUrl: string | null = null;
    if (share.file_path) {
      const signed = await admin.storage.from(BUCKET).createSignedUrl(share.file_path, 3600);
      fileUrl = signed.data?.signedUrl ?? null;
    }
    await admin.from("shares").update({ views: (share.views ?? 0) + 1 }).eq("token", key);
    return json(200, {
      kind: share.kind,
      title: share.title,
      summary: share.summary,
      payload: share.payload,
      fileName: share.file_name,
      fileUrl,
      createdAt: share.created_at,
      views: (share.views ?? 0) + 1,
    });
  }

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  if (req.method === "DELETE") {
    const key = (url.searchParams.get("token") ?? "").replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (!key) return json(400, { error: "bad_request" });
    await admin.from("shares").update({ revoked_at: new Date().toISOString() }).eq("token", key).eq("user_id", user.id);
    return json(200, { revoked: true });
  }

  if (req.method !== "POST") return json(405, { error: "method" });
  let body: { origin?: string; workId?: string; token?: string; expiresInDays?: number | null };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }

  // A number of days from now, or nothing at all: a link that never expires.
  const expiresAt = (() => {
    const days = body.expiresInDays;
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.now() + Math.min(365, days) * 86_400_000).toISOString();
  })();

  if (typeof body.token === "string") {
    const key = body.token.replace(/[^a-f0-9]/g, "").slice(0, 32);
    if (!key) return json(400, { error: "bad_request" });
    const { error } = await admin.from("shares").update({ expires_at: expiresAt }).eq("token", key).eq("user_id", user.id);
    if (error) return json(502, { error: "storage" });
    return json(200, { token: key, expiresAt });
  }

  const origin = body.origin === "ringtones" || body.origin === "transcriptions" ? body.origin : "works";
  const workId = typeof body.workId === "string" ? body.workId.slice(0, 80) : "";
  if (!workId) return json(400, { error: "bad_request" });

  // Already shared: the same link again.
  const { data: existing } = await admin.from("shares").select("token, revoked_at").eq("user_id", user.id).eq("origin", origin).eq("work_id", workId).maybeSingle();
  if (existing && !existing.revoked_at) return json(200, { token: existing.token, created: false });

  // The work, from whichever table holds it, into one snapshot.
  let snapshot: { kind: string; title: string; summary: unknown; payload: unknown; file_path: string | null; file_name: string | null } | null = null;
  if (origin === "works") {
    const { data } = await admin.from("works").select("kind, title, summary, payload, file_path, file_name").eq("user_id", user.id).eq("client_id", workId).maybeSingle();
    if (data) snapshot = data;
  } else if (origin === "ringtones") {
    const { data } = await admin.from("ringtones").select("title, source_name, start_seconds, duration_seconds, file_path").eq("user_id", user.id).eq("client_id", workId).maybeSingle();
    if (data) snapshot = { kind: "ringtone", title: data.title, summary: { duration: data.duration_seconds, start: data.start_seconds, sourceName: data.source_name }, payload: {}, file_path: data.file_path, file_name: `${data.title}.m4r` };
  } else {
    const { data } = await admin.from("transcriptions").select("title, source_name, note_count, duration_seconds, bpm, key_name, analysis_offset, raw_notes, settings").eq("user_id", user.id).eq("id", workId).maybeSingle();
    if (data) snapshot = { kind: "notes", title: data.title, summary: { noteCount: data.note_count, duration: data.duration_seconds, bpm: data.bpm, keyName: data.key_name }, payload: { notes: data.raw_notes, analysisOffset: data.analysis_offset, settings: data.settings }, file_path: null, file_name: null };
  }
  if (!snapshot) return json(404, { error: "not_synced" });

  const key = token();
  const row = {
    token: key,
    user_id: user.id,
    origin,
    work_id: workId,
    kind: snapshot.kind,
    title: snapshot.title,
    summary: snapshot.summary ?? {},
    payload: snapshot.payload ?? {},
    file_path: snapshot.file_path,
    file_name: snapshot.file_name,
    expires_at: expiresAt,
    revoked_at: null,
  };
  const { error } = existing
    ? await admin.from("shares").update(row).eq("token", existing.token)
    : await admin.from("shares").insert(row);
  if (error) {
    console.error("share failed", error);
    return json(502, { error: "storage" });
  }
  return json(200, { token: key, created: true });
});
