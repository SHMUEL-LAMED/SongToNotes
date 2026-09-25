/**
 * The admin area's server side.
 *
 * One address — `ADMIN_EMAILS`, the site owner — may call this; everybody else
 * gets 403, signed in or not. The check is on the verified address in the
 * caller's own token, so nothing in the browser can grant it.
 *
 * What it answers with is deliberately narrow. It reports how the *site* is
 * used — which tools were opened, for how long, what worked and what failed,
 * on what kind of device — and never who did any of it. The rows it reads for
 * that (`site_events`) carry no account, no title and no file name to begin
 * with; the per-account tables are touched only for totals nobody can be
 * picked out of.
 *
 * GET  ?view=overview&days=30  everything the dashboard draws, in one reply
 * GET  ?view=settings          which server keys are set (never their values)
 * GET  ?view=audit             the log of what the admin area did
 * POST {action, …}             one change: a notice, maintenance, a tool off,
 *                              a key, a health check, a clean-up, the credit
 *                              rules
 */
import { CORS, adminClient, isOwner, json, visitor } from "../_shared/common.ts";
import { GEMINI_TTS_MODELS, voiceServices } from "../_shared/voice.ts";
import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";

const BUCKET = "works";
const PAGE = 1000;
/** Enough for a year of a busy site; the reply says when it was reached. */
const MAX_EVENTS = 60_000;
const PREVIEW = { ...CORS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

type Row = Record<string, unknown>;

type EventRow = {
  at: string;
  day: string;
  hour: number;
  weekday: number;
  kind: "view" | "input" | "result" | "error" | "leave";
  tool: string;
  seconds: number;
  detail: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  language: string | null;
  referrer: string | null;
  visitor: string | null;
  signed_in: boolean;
};

/* ---------------------------------------------------------------- reading */

async function readEvents(admin: SupabaseClient, sinceIso: string) {
  const out: EventRow[] = [];
  for (let from = 0; from < MAX_EVENTS; from += PAGE) {
    const { data, error } = await admin
      .from("site_events")
      .select("at, day, hour, weekday, kind, tool, seconds, detail, device, browser, os, language, referrer, visitor, signed_in")
      .gte("at", sinceIso)
      .order("at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as EventRow[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function bump(table: Map<string, number>, key: string | null | undefined, by = 1) {
  const name = (key ?? "").trim() || "לא ידוע";
  table.set(name, (table.get(name) ?? 0) + by);
}

function toList(table: Map<string, number>, limit = 12) {
  return [...table.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function average(values: number[]) {
  const real = values.filter((value) => value > 0);
  if (!real.length) return 0;
  return Math.round((real.reduce((sum, value) => sum + value, 0) / real.length) * 10) / 10;
}

/** Everything the dashboard draws, counted once over the rows. */
function aggregate(events: EventRow[], days: string[], now: number) {
  const daily = new Map(
    days.map((day) => [
      day,
      { day, views: 0, results: 0, errors: 0, visitors: new Set<string>() },
    ]),
  );
  const tools = new Map<
    string,
    {
      tool: string;
      views: number;
      inputs: number;
      results: number;
      errors: number;
      dwell: number[];
      work: number[];
      visitors: Set<string>;
    }
  >();
  const hours = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  const devices = new Map<string, number>();
  const browsers = new Map<string, number>();
  const systems = new Map<string, number>();
  const languages = new Map<string, number>();
  const referrers = new Map<string, number>();
  const failures = new Map<string, { tool: string; code: string; count: number; last: string }>();
  const seenDays = new Map<string, Set<string>>();
  const live = new Set<string>();
  let signedInViews = 0;
  let views = 0;

  for (const event of events) {
    const day = daily.get(event.day);
    const tool =
      tools.get(event.tool) ??
      {
        tool: event.tool,
        views: 0,
        inputs: 0,
        results: 0,
        errors: 0,
        dwell: [],
        work: [],
        visitors: new Set<string>(),
      };
    tools.set(event.tool, tool);
    if (event.visitor) {
      tool.visitors.add(event.visitor);
      const seen = seenDays.get(event.visitor) ?? new Set<string>();
      seen.add(event.day);
      seenDays.set(event.visitor, seen);
      day?.visitors.add(event.visitor);
      if (now - new Date(event.at).getTime() <= 5 * 60_000) live.add(event.visitor);
    }

    switch (event.kind) {
      case "view":
        views += 1;
        tool.views += 1;
        if (day) day.views += 1;
        if (event.signed_in) signedInViews += 1;
        hours[Math.min(6, Math.max(0, event.weekday))][Math.min(23, Math.max(0, event.hour))] += 1;
        bump(devices, event.device);
        bump(browsers, event.browser);
        bump(systems, event.os);
        bump(languages, event.language);
        if (event.referrer) bump(referrers, event.referrer);
        break;
      case "input":
        tool.inputs += 1;
        break;
      case "result":
        tool.results += 1;
        if (day) day.results += 1;
        if (event.seconds > 0) tool.work.push(event.seconds);
        break;
      case "error": {
        tool.errors += 1;
        if (day) day.errors += 1;
        const code = (event.detail ?? "שגיאה").slice(0, 60);
        const key = `${event.tool}|${code}`;
        const hit = failures.get(key) ?? { tool: event.tool, code, count: 0, last: event.at };
        hit.count += 1;
        if (event.at > hit.last) hit.last = event.at;
        failures.set(key, hit);
        break;
      }
      case "leave":
        if (event.seconds > 0) tool.dwell.push(event.seconds);
        break;
    }
  }

  let returning = 0;
  for (const seen of seenDays.values()) if (seen.size > 1) returning += 1;

  return {
    daily: days.map((day) => {
      const row = daily.get(day)!;
      return { day, views: row.views, results: row.results, errors: row.errors, visitors: row.visitors.size };
    }),
    tools: [...tools.values()]
      .map((tool) => ({
        tool: tool.tool,
        views: tool.views,
        inputs: tool.inputs,
        results: tool.results,
        errors: tool.errors,
        visitors: tool.visitors.size,
        dwellSeconds: average(tool.dwell),
        workSeconds: average(tool.work),
      }))
      .sort((a, b) => b.views - a.views),
    hours,
    devices: toList(devices),
    browsers: toList(browsers),
    systems: toList(systems),
    languages: toList(languages),
    referrers: toList(referrers),
    failures: [...failures.values()].sort((a, b) => b.count - a.count).slice(0, 20),
    live: live.size,
    visitors: { total: seenDays.size, returning, fresh: seenDays.size - returning },
    views,
    signedInShare: views ? Math.round((signedInViews / views) * 100) : 0,
    events: events.length,
  };
}

/* -------------------------------------------------------------- the reply */

async function exactCount(admin: SupabaseClient, table: string) {
  const { count } = await admin.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

const KNOWN_KEYS = [
  "STT_API_KEY", "STT_BASE_URL", "STT_MODEL", "STT_DAILY_SECONDS",
  "AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_PROVIDERS", "AI_DAILY_TOKENS",
  "GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN",
  "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "SAMBANOVA_API_KEY", "NVIDIA_API_KEY",
  "HF_TOKEN", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY",
  "SEPARATION_API_KEY", "SEPARATION_MODEL", "SEPARATION_INPUT", "SEPARATION_STEMS_INPUT", "SEPARATION_DAILY",
  "TTS_API_KEY", "TTS_BASE_URL", "TTS_MODEL", "TTS_VOICE", "TTS_DAILY_CHARS",
  "IDENTIFY_API_KEY", "IDENTIFY_API_KEY_2", "IDENTIFY_API_KEY_3", "IDENTIFY_DAILY",
  "ADMIN_EMAILS", "STORAGE_SOFT_GB",
];

const OPEN_KEYS = new Set(KNOWN_KEYS.filter((key) => !/KEY|TOKEN|SECRET|PASSWORD/.test(key)));

function mask(value: string) {
  const clean = value.trim();
  return clean.length <= 4 ? "••••" : `${"•".repeat(Math.min(12, clean.length - 4))}${clean.slice(-4)}`;
}

/** A setting, wherever it lives: a function secret wins over the table. */
async function settingsMap(admin: SupabaseClient) {
  const { data } = await admin.rpc("stt_settings");
  const stored = new Map(
    ((data ?? []) as { key: string; value: string }[]).map((row) => [row.key, row.value]),
  );
  const read = (key: string) => Deno.env.get(key)?.trim() || stored.get(key)?.trim() || "";
  return { stored, read };
}

async function control(admin: SupabaseClient) {
  const { data } = await admin.from("site_control").select("*").maybeSingle();
  return (
    data ?? {
      maintenance: false,
      maintenance_message: null,
      banner: null,
      banner_kind: "info",
      disabled_tools: [],
    }
  );
}

function dayRange(days: number, end: Date) {
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(end.getTime() - back * 86_400_000);
    out.push(new Date(day.getTime() - day.getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
  }
  return out;
}

async function overview(admin: SupabaseClient, days: number) {
  const now = new Date();
  const sinceIso = new Date(now.getTime() - days * 86_400_000).toISOString();
  const sinceDay = sinceIso.slice(0, 10);

  const [events, accounts, works, transcriptions, ringtones, storage, shares, ai, stt, settings, notices, credits] =
    await Promise.all([
      readEvents(admin, sinceIso),
      exactCount(admin, "profiles"),
      exactCount(admin, "works"),
      exactCount(admin, "transcriptions"),
      exactCount(admin, "ringtones"),
      admin.rpc("admin_storage_usage"),
      admin.from("shares").select("views, revoked_at"),
      admin.from("ai_usage").select("day, kind, amount").gte("day", sinceDay),
      admin.from("stt_usage").select("day, seconds").gte("day", sinceDay),
      settingsMap(admin),
      control(admin),
      creditsOverview(admin, sinceDay),
    ]);

  const stats = aggregate(events, dayRange(days, now), now.getTime());

  const files = (storage.data ?? []) as { files: number; bytes: number }[];
  const cloud = files.reduce(
    (totals, row) => ({ files: totals.files + Number(row.files ?? 0), bytes: totals.bytes + Number(row.bytes ?? 0) }),
    { files: 0, bytes: 0 },
  );

  const shareRows = (shares.data ?? []) as { views: number; revoked_at: string | null }[];
  const today = new Date().toISOString().slice(0, 10);
  const usage = new Map<string, { day: string; kind: string; amount: number }[]>();
  for (const row of (ai.data ?? []) as { day: string; kind: string; amount: number }[]) {
    usage.set(row.kind, [...(usage.get(row.kind) ?? []), row]);
  }
  const sttRows = (stt.data ?? []) as { day: string; seconds: number }[];

  const quotas = [
    ...[...usage.entries()].map(([kind, rows]) => ({
      kind,
      today: rows.filter((row) => row.day === today).reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      range: rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    })),
    {
      kind: "stt",
      today: sttRows.filter((row) => row.day === today).reduce((sum, row) => sum + Number(row.seconds ?? 0), 0),
      range: sttRows.reduce((sum, row) => sum + Number(row.seconds ?? 0), 0),
    },
  ];

  // What deserves a line at the top of the page, and nothing that does not.
  const alerts: { kind: "warn" | "bad" | "info"; text: string }[] = [];
  const errorsToday = stats.daily.at(-1)?.errors ?? 0;
  const earlier = stats.daily.slice(0, -1);
  const usual = earlier.length
    ? earlier.reduce((sum, row) => sum + row.errors, 0) / earlier.length
    : 0;
  if (errorsToday > 5 && errorsToday > usual * 2) {
    alerts.push({ kind: "bad", text: `${errorsToday} שגיאות היום — יותר מפי שניים מהרגיל` });
  }
  const softGb = Number(settings.read("STORAGE_SOFT_GB") || "2");
  if (cloud.bytes > softGb * 1024 ** 3 * 0.8) {
    alerts.push({ kind: "warn", text: `האחסון בענן מתקרב לתקרה שהגדרת (${softGb}GB)` });
  }
  if (notices.maintenance) alerts.push({ kind: "info", text: "האתר במצב תחזוקה — הגולשים רואים הודעה בלבד" });
  const off = (notices.disabled_tools ?? []) as string[];
  if (off.length) alerts.push({ kind: "info", text: `${off.length} כלים מכובים כרגע` });
  if (!settings.read("STT_API_KEY")) alerts.push({ kind: "warn", text: "אין מפתח לתמלול — הכלי לא יעבוד" });
  if (!stats.events) alerts.push({ kind: "info", text: "עדיין לא נאספו מדידות — הן מתחילות להיכנס ברגע שגולשים נכנסים" });
  if (credits.settings && !credits.settings.enabled) {
    alerts.push({ kind: "info", text: "הקרדיטים כבויים — פעולות השרת לא נגבות, רק המכסות היומיות חלות" });
  }

  return {
    generatedAt: now.toISOString(),
    days,
    truncated: events.length >= MAX_EVENTS,
    stats,
    totals: {
      accounts,
      works: works + transcriptions + ringtones,
      files: cloud.files,
      bytes: cloud.bytes,
      shares: shareRows.length,
      shareViews: shareRows.reduce((sum, row) => sum + Number(row.views ?? 0), 0),
      liveShares: shareRows.filter((row) => !row.revoked_at).length,
    },
    quotas,
    alerts,
    control: notices,
    credits,
  };
}

/* ---------------------------------------------------------------- credits */

type CreditSettingsRow = {
  enabled: boolean;
  daily: number;
  signup_bonus: number;
  friend_daily: number;
  friend_daily_max: number;
  welcome_bonus: number;
  visit_bonus: number;
  visit_daily_max: number;
  signup_daily_max: number;
  claim_hours: number;
  prices: Record<string, number>;
};

/** The rules and how credits moved in the range — totals only, never whose. */
async function creditsOverview(admin: SupabaseClient, sinceDay: string) {
  const [rules, stats] = await Promise.all([
    admin.from("credit_settings").select("*").maybeSingle(),
    admin.rpc("admin_credit_stats", { p_since: sinceDay }),
  ]);
  if (rules.error) console.warn("credit settings unavailable", rules.error.message);
  return {
    settings: (rules.data ?? null) as CreditSettingsRow | null,
    stats: (stats.data ?? null) as Row | null,
  };
}

/** The numbers the admin may set, each held to a sensible range. */
const CREDIT_FIELDS: Record<string, [number, number]> = {
  daily: [0, 100000],
  signup_bonus: [0, 100000],
  friend_daily: [0, 10000],
  friend_daily_max: [0, 100000],
  welcome_bonus: [0, 100000],
  visit_bonus: [0, 10000],
  visit_daily_max: [0, 10000],
  signup_daily_max: [0, 10000],
  claim_hours: [1, 8760],
};

const PRICE_KEYS = ["assistant", "text", "minute", "tts", "separate", "identify"];

function wholeNumber(value: unknown, [min, max]: [number, number]) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
}

async function setCredits(admin: SupabaseClient, body: Row) {
  const patch: Row = { updated_at: new Date().toISOString() };
  if ("enabled" in body) patch.enabled = Boolean(body.enabled);
  for (const [field, range] of Object.entries(CREDIT_FIELDS)) {
    if (!(field in body)) continue;
    const number = wholeNumber(body[field], range);
    if (number !== null) patch[field] = number;
  }
  if (body.prices && typeof body.prices === "object") {
    const { data } = await admin.from("credit_settings").select("prices").maybeSingle();
    const prices: Record<string, number> = { ...((data?.prices ?? {}) as Record<string, number>) };
    for (const key of PRICE_KEYS) {
      const raw = (body.prices as Row)[key];
      if (raw === undefined) continue;
      const number = wholeNumber(raw, [0, 1000]);
      if (number !== null) prices[key] = number;
    }
    patch.prices = prices;
  }
  const { error } = await admin.from("credit_settings").update(patch).eq("id", true);
  return { patch, error };
}

/* ------------------------------------------------------------- the checks */

const PING: Record<string, { key: string; url: (base: string) => string; base: string; auth: (token: string) => Record<string, string> }> = {
  stt: {
    key: "STT_API_KEY",
    base: "https://api.openai.com/v1",
    url: (base) => `${base}/models`,
    auth: (token) => ({ Authorization: `Bearer ${token}` }),
  },
  separation: {
    key: "SEPARATION_API_KEY",
    base: "https://api.replicate.com/v1",
    url: (base) => `${base}/account`,
    auth: (token) => ({ Authorization: `Token ${token}` }),
  },
};

const AI_PROVIDERS: { key: string; name: string; base: string }[] = [
  { key: "GROQ_API_KEY", name: "Groq", base: "https://api.groq.com/openai/v1" },
  { key: "CEREBRAS_API_KEY", name: "Cerebras", base: "https://api.cerebras.ai/v1" },
  { key: "OPENROUTER_API_KEY", name: "OpenRouter", base: "https://openrouter.ai/api/v1" },
  { key: "MISTRAL_API_KEY", name: "Mistral", base: "https://api.mistral.ai/v1" },
  { key: "TOGETHER_API_KEY", name: "Together", base: "https://api.together.xyz/v1" },
  { key: "DEEPSEEK_API_KEY", name: "DeepSeek", base: "https://api.deepseek.com/v1" },
  { key: "OPENAI_API_KEY", name: "OpenAI", base: "https://api.openai.com/v1" },
];

async function ping(url: string, headers: Record<string, string>) {
  const started = Date.now();
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(7000) });
    return { ok: response.ok, status: response.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - started };
  }
}

type Check = { service: string; label: string; state: "good" | "bad" | "off"; note: string; ms: number };

/** The server's voice: the first service the tts function would try. */
async function voiceCheck(read: (key: string) => string): Promise<Check> {
  const [first] = voiceServices((name, ...fallbacks) => [name, ...fallbacks].map(read).find(Boolean));
  if (!first) return { service: "tts", label: "הקראה", state: "off", note: "אין GEMINI_API_KEY", ms: 0 };
  const gemini = first.id === "gemini";
  const result = gemini
    ? await ping(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODELS[0]}`, { "x-goog-api-key": first.apiKey })
    : await ping(`${first.base}/models`, { Authorization: `Bearer ${first.apiKey}` });
  return {
    service: "tts",
    label: gemini ? "הקראה (Gemini)" : "הקראה",
    state: result.ok ? "good" : "bad",
    note: result.ok ? (gemini ? "עונה · עברית ועוד שפות רבות" : "עונה") : result.status ? `השירות החזיר ${result.status}` : "לא נענה",
    ms: result.ms,
  };
}

async function health(admin: SupabaseClient) {
  const { read } = await settingsMap(admin);
  const checks: Check[] = [];

  for (const [service, spec] of Object.entries(PING)) {
    const token = read(spec.key);
    const label = service === "stt" ? "תמלול דיבור" : "הפרדת שירה";
    if (!token) {
      checks.push({ service, label, state: "off", note: `אין ${spec.key}`, ms: 0 });
      continue;
    }
    const base = read(`${service.toUpperCase()}_BASE_URL`) || spec.base;
    const result = await ping(spec.url(base), spec.auth(token));
    checks.push({
      service,
      label,
      state: result.ok ? "good" : "bad",
      note: result.ok ? "עונה" : result.status ? `השירות החזיר ${result.status}` : "לא נענה",
      ms: result.ms,
    });
  }
  checks.push(await voiceCheck(read));

  const provider = AI_PROVIDERS.find((item) => read(item.key));
  if (!provider) {
    const custom = read("AI_API_KEY");
    checks.push({
      service: "ai",
      label: "מודל שפה",
      state: custom ? "good" : "off",
      note: custom ? "מוגדר דרך AI_API_KEY" : "אין מפתח לאף ספק",
      ms: 0,
    });
  } else {
    const result = await ping(`${provider.base}/models`, { Authorization: `Bearer ${read(provider.key)}` });
    checks.push({
      service: "ai",
      label: `מודל שפה (${provider.name})`,
      state: result.ok ? "good" : "bad",
      note: result.ok ? "עונה" : result.status ? `השירות החזיר ${result.status}` : "לא נענה",
      ms: result.ms,
    });
  }

  const identifyKeys = ["IDENTIFY_API_KEY", "IDENTIFY_API_KEY_2", "IDENTIFY_API_KEY_3"].filter((key) => read(key));
  checks.push({
    service: "identify",
    label: "זיהוי שירים (AudD)",
    state: identifyKeys.length ? "good" : "off",
    note: identifyKeys.length ? `${identifyKeys.length} מפתחות מוגדרים · נבדקים בזיהוי אמיתי` : "אין IDENTIFY_API_KEY",
    ms: 0,
  });

  return checks;
}

/** Files in the bucket that no row points at any more. */
async function orphans(admin: SupabaseClient, remove: boolean) {
  const referenced = new Set<string>();
  for (const table of ["works", "ringtones", "shares"]) {
    const { data } = await admin.from(table).select("file_path").not("file_path", "is", null);
    for (const row of (data ?? []) as { file_path: string }[]) referenced.add(row.file_path);
  }

  const { data: folders } = await admin.storage.from(BUCKET).list("", { limit: 1000 });
  const stale: { path: string; bytes: number }[] = [];
  for (const folder of folders ?? []) {
    if (!folder.name) continue;
    const { data: files } = await admin.storage.from(BUCKET).list(folder.name, { limit: 1000 });
    for (const file of files ?? []) {
      const path = `${folder.name}/${file.name}`;
      if (!referenced.has(path)) {
        stale.push({ path, bytes: (file.metadata as { size?: number } | null)?.size ?? 0 });
      }
    }
  }

  if (remove && stale.length) {
    await admin.storage.from(BUCKET).remove(stale.map((item) => item.path));
  }
  return { count: stale.length, bytes: stale.reduce((sum, item) => sum + item.bytes, 0) };
}

async function log(admin: SupabaseClient, actor: string, action: string, target: string | null, detail: Row = {}) {
  await admin.from("admin_audit").insert({ actor_email: actor, action, target, detail });
}

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

async function act(admin: SupabaseClient, user: User, body: Row) {
  const action = text(body.action, 40);
  const actor = user.email ?? user.id;

  switch (action) {
    case "control.set": {
      const patch: Row = { updated_at: new Date().toISOString() };
      if ("maintenance" in body) patch.maintenance = Boolean(body.maintenance);
      if ("maintenanceMessage" in body) patch.maintenance_message = text(body.maintenanceMessage, 300) || null;
      if ("banner" in body) patch.banner = text(body.banner, 300) || null;
      if ("bannerKind" in body) {
        const kind = text(body.bannerKind, 10);
        patch.banner_kind = kind === "warn" || kind === "good" ? kind : "info";
      }
      if ("disabledTools" in body) {
        patch.disabled_tools = Array.isArray(body.disabledTools)
          ? (body.disabledTools as unknown[]).map((tool) => text(tool, 40)).filter(Boolean).slice(0, 40)
          : [];
      }
      const { error } = await admin.from("site_control").update(patch).eq("id", true);
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, null, patch);
      return json(200, { ok: true, control: await control(admin) });
    }
    case "setting.set": {
      const key = text(body.key, 60).toUpperCase().replace(/[^A-Z0-9_]/g, "");
      const value = text(body.value, 400).trim();
      if (!key || !value) return json(400, { error: "bad_request" });
      if (Deno.env.get(key)) return json(409, { error: "secret_wins" });
      const { error } = await admin.rpc("stt_set_setting", { setting_key: key, setting_value: value });
      if (error) return json(502, { error: "storage" });
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
    case "health.check": {
      const checks = await health(admin);
      return json(200, { ok: true, checks });
    }
    case "files.scan":
      return json(200, { ok: true, orphans: await orphans(admin, false) });
    case "files.clean": {
      const result = await orphans(admin, true);
      await log(admin, actor, action, null, result);
      return json(200, { ok: true, orphans: result });
    }
    case "credits.set": {
      const { patch, error } = await setCredits(admin, body);
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, null, patch);
      const { data } = await admin.from("credit_settings").select("*").maybeSingle();
      return json(200, { ok: true, credits: data ?? null });
    }
    case "usage.reset": {
      // Today's allowances start again: every account, one kind or all of them
      // — the day's credits among them.
      const kind = text(body.kind, 20);
      const kinds = ["ai", "tts", "separation", "identify"];
      if (kind && kind !== "stt" && kind !== "credits" && !kinds.includes(kind)) return json(400, { error: "bad_request" });
      const day = new Date().toISOString().slice(0, 10);
      let removed = 0;
      if (!kind || kind === "credits") {
        const { data, error } = await admin.rpc("admin_credit_reset_today");
        if (error) console.warn("credits reset failed", error.message);
        else removed += Number(data ?? 0);
      }
      if (kind === "credits") {
        await log(admin, actor, action, kind, { removed });
        return json(200, { ok: true, removed });
      }
      if (kind !== "stt") {
        let request = admin.from("ai_usage").delete({ count: "exact" }).eq("day", day);
        request = kind ? request.eq("kind", kind) : request.in("kind", kinds);
        const { count, error } = await request;
        if (error) return json(502, { error: "storage" });
        removed += count ?? 0;
      }
      if (!kind || kind === "stt") {
        const { count, error } = await admin.from("stt_usage").delete({ count: "exact" }).eq("day", day);
        if (error) return json(502, { error: "storage" });
        removed += count ?? 0;
      }
      await log(admin, actor, action, kind || "all", { removed });
      return json(200, { ok: true, removed });
    }
    case "feedback.handle": {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0) return json(400, { error: "bad_request" });
      const handled = body.handled !== false;
      const { error } = await admin.from("site_feedback").update({ handled }).eq("id", id);
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, String(id), { handled });
      return json(200, { ok: true });
    }
    case "feedback.delete": {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0) return json(400, { error: "bad_request" });
      const { error } = await admin.from("site_feedback").delete().eq("id", id);
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, String(id), {});
      return json(200, { ok: true });
    }
    case "events.prune": {
      const days = Math.max(30, Math.min(3650, Number(body.days) || 365));
      const { data, error } = await admin.rpc("admin_prune_events", { older_than_days: days });
      if (error) return json(502, { error: "storage" });
      await log(admin, actor, action, String(days), { removed: data });
      return json(200, { ok: true, removed: Number(data ?? 0) });
    }
    default:
      return json(400, { error: "unknown_action" });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: PREVIEW });

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!isOwner(user)) return json(403, { error: "forbidden" });

  const admin = adminClient();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const view = url.searchParams.get("view") ?? "overview";
      if (view === "settings") {
        const { stored } = await settingsMap(admin);
        const names = [...new Set([...KNOWN_KEYS, ...stored.keys()])].sort();
        return json(200, {
          keys: names.map((key) => {
            const secret = Deno.env.get(key)?.trim() ?? "";
            const row = stored.get(key)?.trim() ?? "";
            const value = secret || row;
            return {
              key,
              set: Boolean(value),
              source: secret ? "secret" : row ? "table" : null,
              editable: !secret,
              preview: value ? (OPEN_KEYS.has(key) ? value.slice(0, 80) : mask(value)) : null,
            };
          }),
        });
      }
      if (view === "feedback") {
        // What visitors sent from "משוב והצעות", newest first. Before
        // supabase/site_feedback.sql has run there is no table: say so.
        const { data, error } = await admin
          .from("site_feedback")
          .select("id, created_at, kind, message, contact, page, language, device, browser, os, handled")
          .order("created_at", { ascending: false })
          .limit(300);
        if (error) return json(200, { entries: [], missing: true });
        return json(200, { entries: data ?? [] });
      }
      if (view === "audit") {
        const query = (url.searchParams.get("q") ?? "").slice(0, 60);
        let request = admin
          .from("admin_audit")
          .select("id, actor_email, action, target, detail, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (query) request = request.or(`action.ilike.%${query}%,target.ilike.%${query}%`);
        const { data } = await request;
        return json(200, { entries: data ?? [] });
      }
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
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
