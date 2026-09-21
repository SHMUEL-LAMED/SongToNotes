/**
 * The admin area's server side.
 *
 * One address — `ADMIN_EMAILS`, the site owner — may call this; everybody
 * else gets 403, signed in or not. The check is on the verified address in
 * the caller's own token, so nothing in the browser can grant it: the site
 * ships with the same publishable key for everyone, and the row policies in
 * `schema.sql` still hide every account from every other account. Only this
 * function, with the service role, sees across them.
 *
 * GET  ?view=overview&days=30  everything the dashboard draws, in one reply
 * GET  ?view=settings          which server keys are set (never their values)
 * GET  ?view=audit             the log of what the admin area did
 * POST {action, …}             one change: delete a work, revoke a link,
 *                              block or remove an account, set a key, clear
 *                              today's allowance
 *
 * The overview sends rows rather than finished figures — capped, trimmed and
 * without any payload — so the dashboard can slice by day, tool, account and
 * range without asking again. Totals come from exact counts, so they stay
 * right even when the rows were capped.
 */
import { CORS, adminClient, json, visitor } from "../_shared/common.ts";
import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";

const BUCKET = "works";

/** The owner of this site, unless `ADMIN_EMAILS` says otherwise. */
const DEFAULT_ADMINS = ["0534169095@xn--4dbjbascrao3i.com", "0534169095@שמואלליווי.com"];

/** Enough for a site of this size; the reply says when a list was cut. */
const CAPS = { works: 4000, users: 2000, shares: 1000, usage: 20_000 };

const PREVIEW_METHODS = { ...CORS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

/** Lower case, trimmed, and one Unicode spelling — the address may be typed
 *  either in Hebrew letters or in the punycode the browser sends. */
function normalize(email: string) {
  return email.trim().toLowerCase().normalize("NFC");
}

function admins() {
  const configured = (Deno.env.get("ADMIN_EMAILS") ?? "")
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set((configured.length ? configured : DEFAULT_ADMINS).map(normalize));
}

/**
 * The caller, when they are the admin. An unverified address never counts:
 * otherwise anyone could sign up with the owner's address and be believed.
 */
function isAdmin(user: User | null) {
  if (!user?.email) return false;
  const verified =
    Boolean(user.email_confirmed_at) || user.user_metadata?.email_verified === true;
  return verified && admins().has(normalize(user.email));
}

type Row = Record<string, unknown>;

/** One saved work, whichever of the three tables it lives in. */
type WorkRow = {
  id: string;
  origin: "works" | "transcriptions" | "ringtones";
  userId: string;
  kind: string;
  title: string;
  source: string | null;
  createdAt: string;
  hasFile: boolean;
};

function text(value: unknown, max = 120) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

async function exactCount(admin: SupabaseClient, table: string) {
  const { count } = await admin.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

/** Every account, with the name and picture the profile keeps. */
async function accounts(admin: SupabaseClient) {
  const out: Row[] = [];
  for (let page = 1; out.length < CAPS.users; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const batch = data?.users ?? [];
    for (const user of batch) {
      out.push({
        id: user.id,
        email: user.email ?? null,
        name:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
        avatar: (user.user_metadata?.avatar_url as string | undefined) ?? null,
        provider: user.app_metadata?.provider ?? null,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        bannedUntil: (user as { banned_until?: string | null }).banned_until ?? null,
      });
    }
    if (batch.length < 200) break;
  }
  return out;
}

async function overview(admin: SupabaseClient, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDay = sinceIso.slice(0, 10);

  const [
    users,
    works,
    transcriptions,
    ringtones,
    shares,
    ai,
    stt,
    storage,
    profiles,
    totalWorks,
    totalTranscriptions,
    totalRingtones,
    totalShares,
  ] = await Promise.all([
    accounts(admin),
    admin
      .from("works")
      .select("client_id, user_id, kind, title, source_name, file_name, file_path, created_at")
      .order("created_at", { ascending: false })
      .limit(CAPS.works),
    admin
      .from("transcriptions")
      .select("id, user_id, title, source_name, note_count, created_at")
      .order("created_at", { ascending: false })
      .limit(CAPS.works),
    admin
      .from("ringtones")
      .select("client_id, user_id, title, source_name, file_path, created_at")
      .order("created_at", { ascending: false })
      .limit(CAPS.works),
    admin
      .from("shares")
      .select("token, user_id, origin, work_id, kind, title, views, created_at, revoked_at")
      .order("created_at", { ascending: false })
      .limit(CAPS.shares),
    admin.from("ai_usage").select("user_id, day, kind, amount").gte("day", sinceDay).limit(CAPS.usage),
    admin.from("stt_usage").select("user_id, day, seconds").gte("day", sinceDay).limit(CAPS.usage),
    admin.rpc("admin_storage_usage"),
    admin.from("profiles").select("id, full_name, avatar_url").limit(CAPS.users),
    exactCount(admin, "works"),
    exactCount(admin, "transcriptions"),
    exactCount(admin, "ringtones"),
    exactCount(admin, "shares"),
  ]);

  const named = new Map(
    (profiles.data ?? []).map((row: Row) => [
      row.id as string,
      { name: row.full_name as string | null, avatar: row.avatar_url as string | null },
    ]),
  );
  for (const user of users) {
    const profile = named.get(user.id as string);
    if (profile?.name) user.name = profile.name;
    if (profile?.avatar) user.avatar ??= profile.avatar;
  }

  const rows: WorkRow[] = [
    ...(works.data ?? []).map((row: Row) => ({
      id: text(row.client_id, 80),
      origin: "works" as const,
      userId: row.user_id as string,
      kind: text(row.kind, 24) || "notes",
      title: text(row.title),
      source: row.source_name ? text(row.source_name) : null,
      createdAt: row.created_at as string,
      hasFile: Boolean(row.file_path || row.file_name),
    })),
    ...(transcriptions.data ?? []).map((row: Row) => ({
      id: text(row.id, 80),
      origin: "transcriptions" as const,
      userId: row.user_id as string,
      kind: "notes",
      title: text(row.title),
      source: row.source_name ? text(row.source_name) : null,
      createdAt: row.created_at as string,
      hasFile: false,
    })),
    ...(ringtones.data ?? []).map((row: Row) => ({
      id: text(row.client_id, 80),
      origin: "ringtones" as const,
      userId: row.user_id as string,
      kind: "ringtone",
      title: text(row.title),
      source: row.source_name ? text(row.source_name) : null,
      createdAt: row.created_at as string,
      hasFile: Boolean(row.file_path),
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return {
    generatedAt: new Date().toISOString(),
    days,
    truncated: {
      works: (works.data?.length ?? 0) >= CAPS.works,
      users: users.length >= CAPS.users,
    },
    totals: {
      users: users.length,
      works: totalWorks + totalTranscriptions + totalRingtones,
      shares: totalShares,
    },
    users,
    works: rows,
    ai: ai.data ?? [],
    stt: stt.data ?? [],
    shares: shares.data ?? [],
    storage: storage.data ?? [],
  };
}

/** The names of the server keys and what is set — never a value. */
const KNOWN_KEYS = [
  "STT_API_KEY",
  "STT_BASE_URL",
  "STT_MODEL",
  "STT_DAILY_SECONDS",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_PROVIDERS",
  "AI_DAILY_TOKENS",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "GEMINI_API_KEY",
  "GITHUB_TOKEN",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "SAMBANOVA_API_KEY",
  "NVIDIA_API_KEY",
  "HF_TOKEN",
  "TOGETHER_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "SEPARATION_API_KEY",
  "SEPARATION_MODEL",
  "SEPARATION_INPUT",
  "SEPARATION_STEMS_INPUT",
  "SEPARATION_DAILY",
  "TTS_API_KEY",
  "TTS_BASE_URL",
  "TTS_MODEL",
  "TTS_VOICE",
  "TTS_DAILY_CHARS",
  "IDENTIFY_API_KEY",
  "ADMIN_EMAILS",
];

/** A name that only ever says which service it is may be shown in full. */
const OPEN_KEYS = new Set(
  KNOWN_KEYS.filter((key) => !/KEY|TOKEN|SECRET|PASSWORD/.test(key)),
);

function mask(value: string) {
  const clean = value.trim();
  if (clean.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, clean.length - 4))}${clean.slice(-4)}`;
}

async function settingsView(admin: SupabaseClient) {
  const { data } = await admin.rpc("stt_settings");
  const stored = new Map(
    ((data ?? []) as { key: string; value: string }[]).map((row) => [row.key, row.value]),
  );
  const names = [...new Set([...KNOWN_KEYS, ...stored.keys()])].sort();
  return {
    keys: names.map((key) => {
      const secret = Deno.env.get(key)?.trim() ?? "";
      const row = stored.get(key)?.trim() ?? "";
      const value = secret || row;
      return {
        key,
        set: Boolean(value),
        // A secret set on the function itself wins over the table, and the
        // admin area cannot change it from here — only the table row.
        source: secret ? "secret" : row ? "table" : null,
        editable: !secret,
        preview: value ? (OPEN_KEYS.has(key) ? value.slice(0, 80) : mask(value)) : null,
      };
    }),
  };
}

async function log(
  admin: SupabaseClient,
  actor: string,
  action: string,
  target: string | null,
  detail: Row = {},
) {
  await admin.from("admin_audit").insert({ actor_email: actor, action, target, detail });
}

/** Removes a work from whichever table holds it, with its file in the cloud. */
async function deleteWork(admin: SupabaseClient, origin: string, userId: string, id: string) {
  if (origin === "transcriptions") {
    const { error } = await admin.from("transcriptions").delete().eq("user_id", userId).eq("id", id);
    return error;
  }
  const table = origin === "ringtones" ? "ringtones" : "works";
  const { data } = await admin
    .from(table)
    .select("file_path")
    .eq("user_id", userId)
    .eq("client_id", id)
    .maybeSingle();
  const { error } = await admin.from(table).delete().eq("user_id", userId).eq("client_id", id);
  if (!error && data?.file_path) {
    await admin.storage.from(BUCKET).remove([data.file_path as string]);
  }
  return error;
}

/** Everything one account put in the private bucket. */
async function removeFiles(admin: SupabaseClient, userId: string) {
  const { data } = await admin.storage.from(BUCKET).list(userId, { limit: 1000 });
  const paths = (data ?? []).map((file) => `${userId}/${file.name}`);
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
  return paths.length;
}

async function act(admin: SupabaseClient, user: User, body: Row) {
  const action = text(body.action, 40);
  const userId = text(body.userId, 40);
  const actor = user.email ?? user.id;
  const today = new Date().toISOString().slice(0, 10);

  switch (action) {
    case "work.delete": {
      const id = text(body.id, 80);
      const origin = text(body.origin, 20) || "works";
      if (!userId || !id) return json(400, { error: "bad_request" });
      const error = await deleteWork(admin, origin, userId, id);
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, id, { origin, userId });
      return json(200, { ok: true });
    }
    case "share.revoke": {
      const token = text(body.token, 40).replace(/[^a-f0-9]/g, "");
      if (!token) return json(400, { error: "bad_request" });
      await admin.from("shares").update({ revoked_at: new Date().toISOString() }).eq("token", token);
      await log(admin, actor, action, token, {});
      return json(200, { ok: true });
    }
    case "usage.reset": {
      if (!userId) return json(400, { error: "bad_request" });
      await admin.from("ai_usage").delete().eq("user_id", userId).eq("day", today);
      await admin.from("stt_usage").delete().eq("user_id", userId).eq("day", today);
      await log(admin, actor, action, userId, { day: today });
      return json(200, { ok: true });
    }
    case "user.ban":
    case "user.unban": {
      if (!userId) return json(400, { error: "bad_request" });
      if (userId === user.id) return json(400, { error: "self" });
      const hours = Math.max(1, Math.min(8760, Number(body.hours) || 720));
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: action === "user.ban" ? `${hours}h` : "none",
      } as { ban_duration: string });
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, userId, { hours });
      return json(200, { ok: true });
    }
    case "user.delete": {
      if (!userId) return json(400, { error: "bad_request" });
      if (userId === user.id) return json(400, { error: "self" });
      const files = await removeFiles(admin, userId);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, userId, { files });
      return json(200, { ok: true });
    }
    case "setting.set": {
      const key = text(body.key, 60).toUpperCase().replace(/[^A-Z0-9_]/g, "");
      const value = text(body.value, 400).trim();
      if (!key || !value) return json(400, { error: "bad_request" });
      if (Deno.env.get(key)) return json(409, { error: "secret_wins" });
      const { error } = await admin.rpc("stt_set_setting", { setting_key: key, setting_value: value });
      if (error) return json(502, { error: "storage" });
      // The value itself never reaches the log.
      await log(admin, actor, action, key, {});
      return json(200, { ok: true });
    }
    case "setting.delete": {
      const key = text(body.key, 60).toUpperCase().replace(/[^A-Z0-9_]/g, "");
      if (!key) return json(400, { error: "bad_request" });
      const { error } = await admin.rpc("stt_delete_setting", { setting_key: key });
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, key, {});
      return json(200, { ok: true });
    }
    default:
      return json(400, { error: "unknown_action" });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: PREVIEW_METHODS });

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!isAdmin(user)) return json(403, { error: "forbidden" });

  const admin = adminClient();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const view = url.searchParams.get("view") ?? "overview";
      if (view === "settings") return json(200, await settingsView(admin));
      if (view === "audit") {
        const { data } = await admin
          .from("admin_audit")
          .select("id, actor_email, action, target, detail, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        return json(200, { entries: data ?? [] });
      }
      const days = Math.max(7, Math.min(365, Number(url.searchParams.get("days")) || 30));
      return json(200, await overview(admin, days));
    }

    if (req.method === "POST") {
      let body: Row;
      try {
        body = (await req.json()) as Row;
      } catch {
        return json(400, { error: "bad_request" });
      }
      return await act(admin, user, body);
    }
  } catch (error) {
    console.error("admin failed", error);
    return json(502, { error: "storage" });
  }

  return json(405, { error: "method" });
});
