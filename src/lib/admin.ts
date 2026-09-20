/**
 * The admin area's side of the site.
 *
 * Everything here is either a question put to `supabase/functions/admin` —
 * the only place that may look across accounts — or a pure reading of the
 * answer. The function checks the caller's verified address itself, so the
 * gate below is only there to keep the door out of sight: hiding a button
 * is not a permission, and the server never takes the browser's word for it.
 *
 * The overview arrives as rows rather than finished figures, so every cut the
 * dashboard offers — a day, a tool, one account, a shorter range — is a
 * matter of counting what is already here instead of another round trip.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";
import { KIND_LABELS, type WorkKind } from "./works";

const ADMIN_URL = `${SUPABASE_URL}/functions/v1/admin`;

/**
 * The site owner. The address exists in two spellings — the Hebrew domain and
 * the punycode a browser turns it into — and either may end up on the account,
 * so both count. The server holds the same list; this one only decides whether
 * the entrance is drawn.
 */
export const ADMIN_EMAILS = [
  "0534169095@xn--4dbjbascrao3i.com",
  "0534169095@שמואלליווי.com",
];

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase().normalize("NFC");
}

export function isAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  const wanted = normalizeEmail(email);
  return ADMIN_EMAILS.some((item) => normalizeEmail(item) === wanted);
}

export function isAdmin(user: { email?: string | null } | null | undefined) {
  return isAdminEmail(user?.email);
}

/* -------------------------------------------------------------------------
   What the server sends
   ------------------------------------------------------------------------- */

export type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  provider: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
};

export type WorkOrigin = "works" | "transcriptions" | "ringtones";

export type AdminWork = {
  id: string;
  origin: WorkOrigin;
  userId: string;
  kind: string;
  title: string;
  source: string | null;
  createdAt: string;
  hasFile: boolean;
};

export type AdminUsage = { userId: string; day: string; kind: string; amount: number };
export type AdminStorage = { userId: string; files: number; bytes: number };

export type AdminShare = {
  token: string;
  userId: string;
  origin: string;
  workId: string;
  kind: string;
  title: string;
  views: number;
  createdAt: string;
  revokedAt: string | null;
};

export type AdminSnapshot = {
  generatedAt: string;
  days: number;
  truncated: { works: boolean; users: boolean };
  totals: { users: number; works: number; shares: number };
  users: AdminUser[];
  works: AdminWork[];
  /** Language-model and separation tallies; `kind` says which. */
  ai: AdminUsage[];
  /** Speech-to-text seconds. */
  stt: AdminUsage[];
  shares: AdminShare[];
  storage: AdminStorage[];
};

export type AdminSetting = {
  key: string;
  set: boolean;
  source: "secret" | "table" | null;
  editable: boolean;
  preview: string | null;
};

export type AdminAuditEntry = {
  id: number;
  actorEmail: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export class AdminError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  signed_out: "צריך להתחבר לחשבון כדי לפתוח את אזור הניהול.",
  forbidden: "החשבון הזה אינו מנהל האתר.",
  self: "אי אפשר לחסום או למחוק את חשבון הניהול עצמו.",
  secret_wins: "המפתח הזה מוגדר כסוד של הפונקציה, ולכן אי אפשר לשנות אותו מכאן.",
  unknown_action: "הפעולה אינה מוכרת.",
  storage: "השרת לא הצליח לבצע את הפעולה. נסה שוב.",
  network: "החיבור לשרת נכשל. בדוק את האינטרנט ונסה שוב.",
  not_deployed: "פונקציית הניהול עדיין לא הועלתה לפרויקט (supabase/functions/admin).",
};

export function describeAdminError(code: string) {
  return MESSAGES[code] ?? "הבקשה נכשלה. נסה שוב בעוד רגע.";
}

async function headers() {
  const { data } = await supabase.auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new AdminError("signed_out", MESSAGES.signed_out);
  return {
    Authorization: `Bearer ${access}`,
    apikey: SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
  };
}

async function call<T>(query: string, init?: RequestInit): Promise<T> {
  const auth = await headers();
  let response: Response;
  try {
    response = await fetch(`${ADMIN_URL}${query}`, { ...init, headers: auth });
  } catch {
    throw new AdminError("network", MESSAGES.network);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body || body.error) {
    const code = body?.error ?? (response.status === 404 ? "not_deployed" : "storage");
    throw new AdminError(code, describeAdminError(code));
  }
  return body;
}

type RawUsage = { user_id: string; day: string; kind?: string; amount?: number; seconds?: number };
type RawShare = {
  token: string;
  user_id: string;
  origin: string;
  work_id: string;
  kind: string;
  title: string;
  views: number;
  created_at: string;
  revoked_at: string | null;
};
type RawStorage = { user_id: string; files: number; bytes: number };

/** The server's rows, in the shape the rest of the site speaks. */
export function normalizeSnapshot(raw: Record<string, unknown>): AdminSnapshot {
  const usage = (rows: unknown, field: "amount" | "seconds", fallbackKind: string) =>
    ((rows as RawUsage[]) ?? []).map((row) => ({
      userId: row.user_id,
      day: String(row.day).slice(0, 10),
      kind: row.kind ?? fallbackKind,
      amount: Number(row[field] ?? 0),
    }));

  return {
    generatedAt: String(raw.generatedAt ?? new Date().toISOString()),
    days: Number(raw.days ?? 30),
    truncated: {
      works: Boolean((raw.truncated as { works?: boolean })?.works),
      users: Boolean((raw.truncated as { users?: boolean })?.users),
    },
    totals: {
      users: Number((raw.totals as { users?: number })?.users ?? 0),
      works: Number((raw.totals as { works?: number })?.works ?? 0),
      shares: Number((raw.totals as { shares?: number })?.shares ?? 0),
    },
    users: (raw.users as AdminUser[]) ?? [],
    works: (raw.works as AdminWork[]) ?? [],
    ai: usage(raw.ai, "amount", "ai"),
    stt: usage(raw.stt, "seconds", "stt"),
    shares: ((raw.shares as RawShare[]) ?? []).map((row) => ({
      token: row.token,
      userId: row.user_id,
      origin: row.origin,
      workId: row.work_id,
      kind: row.kind,
      title: row.title,
      views: Number(row.views ?? 0),
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    })),
    storage: ((raw.storage as RawStorage[]) ?? []).map((row) => ({
      userId: row.user_id,
      files: Number(row.files ?? 0),
      bytes: Number(row.bytes ?? 0),
    })),
  };
}

export async function fetchSnapshot(days: number) {
  return normalizeSnapshot(await call<Record<string, unknown>>(`?view=overview&days=${days}`));
}

export async function fetchSettings() {
  const body = await call<{ keys: AdminSetting[] }>("?view=settings");
  return body.keys ?? [];
}

export async function fetchAudit(): Promise<AdminAuditEntry[]> {
  const body = await call<{
    entries: {
      id: number;
      actor_email: string;
      action: string;
      target: string | null;
      detail: Record<string, unknown>;
      created_at: string;
    }[];
  }>("?view=audit");
  return (body.entries ?? []).map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    target: row.target,
    detail: row.detail ?? {},
    createdAt: row.created_at,
  }));
}

export type AdminAction =
  | "work.delete"
  | "share.revoke"
  | "usage.reset"
  | "user.ban"
  | "user.unban"
  | "user.delete"
  | "setting.set"
  | "setting.delete";

export async function runAdminAction(action: AdminAction, payload: Record<string, unknown> = {}) {
  await call<{ ok: boolean }>("", { method: "POST", body: JSON.stringify({ action, ...payload }) });
}

/* -------------------------------------------------------------------------
   Reading the rows — pure, so the dashboard's figures are testable
   ------------------------------------------------------------------------- */

/** The calendar day a timestamp falls on, where the reader is standing. */
export function dayKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** The last `days` day keys, oldest first, ending today. */
export function dayRange(days: number, end: Date = new Date()) {
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(dayKey(new Date(end.getTime() - back * 86_400_000)));
  }
  return out;
}

export type Point = { day: string; value: number };

/** One point per day in the range — including the days nothing happened. */
export function seriesByDay<T>(
  items: readonly T[],
  pickDay: (item: T) => string,
  days: string[],
  weigh: (item: T) => number = () => 1,
) {
  const table = new Map(days.map((day) => [day, 0]));
  for (const item of items) {
    const day = pickDay(item);
    const current = table.get(day);
    if (current !== undefined) table.set(day, current + weigh(item));
  }
  return days.map((day) => ({ day, value: table.get(day) ?? 0 }));
}

export type Tally = { key: string; value: number };

/** How many of each, biggest first. */
export function tally<T>(
  items: readonly T[],
  pick: (item: T) => string,
  weigh: (item: T) => number = () => 1,
): Tally[] {
  const table = new Map<string, number>();
  for (const item of items) {
    const key = pick(item);
    if (!key) continue;
    table.set(key, (table.get(key) ?? 0) + weigh(item));
  }
  return [...table.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

export function sumSeries(points: readonly Point[]) {
  return points.reduce((total, point) => total + point.value, 0);
}

/**
 * How the second half of a range compares with the first, as a percentage.
 * `null` when there is nothing to compare against — a first week has no
 * "before", and pretending it grew by 100% would be a lie.
 */
export function changeOverRange(points: readonly Point[]) {
  if (points.length < 4) return null;
  const middle = Math.floor(points.length / 2);
  const before = sumSeries(points.slice(0, middle));
  const after = sumSeries(points.slice(middle));
  if (before === 0) return after === 0 ? 0 : null;
  return Math.round(((after - before) / before) * 100);
}

/** The accounts that saved something within the last `days` days. */
export function activeUsers(works: readonly AdminWork[], days: number, end: Date = new Date()) {
  const from = end.getTime() - days * 86_400_000;
  const seen = new Set<string>();
  for (const work of works) {
    if (new Date(work.createdAt).getTime() >= from) seen.add(work.userId);
  }
  return seen;
}

/** Seven rows of twenty-four cells: when, in the week, the site is used. */
export function weekHeatmap(works: readonly AdminWork[]) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const work of works) {
    const date = new Date(work.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    grid[date.getDay()][date.getHours()] += 1;
  }
  return grid;
}

/** Everything known about one account, gathered from the separate lists. */
export type UserDigest = AdminUser & {
  works: number;
  lastWorkAt: string | null;
  files: number;
  bytes: number;
  aiAmount: number;
  sttSeconds: number;
  shares: number;
  shareViews: number;
  banned: boolean;
};

export function digestUsers(snapshot: AdminSnapshot, now: Date = new Date()): UserDigest[] {
  const works = new Map<string, { count: number; last: string | null }>();
  for (const work of snapshot.works) {
    const entry = works.get(work.userId) ?? { count: 0, last: null };
    entry.count += 1;
    if (!entry.last || work.createdAt > entry.last) entry.last = work.createdAt;
    works.set(work.userId, entry);
  }
  const storage = new Map(snapshot.storage.map((row) => [row.userId, row]));
  const ai = new Map<string, number>();
  for (const row of snapshot.ai) ai.set(row.userId, (ai.get(row.userId) ?? 0) + row.amount);
  const stt = new Map<string, number>();
  for (const row of snapshot.stt) stt.set(row.userId, (stt.get(row.userId) ?? 0) + row.amount);
  const shares = new Map<string, { count: number; views: number }>();
  for (const row of snapshot.shares) {
    const entry = shares.get(row.userId) ?? { count: 0, views: 0 };
    entry.count += 1;
    entry.views += row.views;
    shares.set(row.userId, entry);
  }

  return snapshot.users.map((user) => {
    const work = works.get(user.id);
    const files = storage.get(user.id);
    const share = shares.get(user.id);
    return {
      ...user,
      works: work?.count ?? 0,
      lastWorkAt: work?.last ?? null,
      files: files?.files ?? 0,
      bytes: files?.bytes ?? 0,
      aiAmount: ai.get(user.id) ?? 0,
      sttSeconds: stt.get(user.id) ?? 0,
      shares: share?.count ?? 0,
      shareViews: share?.views ?? 0,
      banned: Boolean(user.bannedUntil && new Date(user.bannedUntil).getTime() > now.getTime()),
    };
  });
}

/* ---- writing numbers for people ---- */

const numberFormat = new Intl.NumberFormat("he-IL");

export function formatNumber(value: number) {
  return numberFormat.format(Math.round(value));
}

/** Short enough for a tile: 1,284 · 12.9K · 3.1M. */
export function compactNumber(value: number) {
  const size = Math.abs(value);
  if (size >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (size >= 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return formatNumber(value);
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} שנ׳`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} דק׳`;
  return `${(seconds / 3600).toFixed(1)} שע׳`;
}

/** "לפני רגע", "לפני 3 שעות", "לפני 12 ימים" — or nothing at all. */
export function timeAgo(value: string | null | undefined, now: Date = new Date()) {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((now.getTime() - then) / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.round(hours / 24);
  if (days < 31) return `לפני ${days} ימים`;
  const months = Math.round(days / 30);
  if (months < 12) return `לפני ${months} חודשים`;
  return `לפני ${Math.round(months / 12)} שנים`;
}

/** The tool's Hebrew name, for a kind that may have arrived from the server. */
export function kindLabel(kind: string) {
  return KIND_LABELS[kind as WorkKind] ?? kind;
}

/** A list of rows as a spreadsheet, so a number can leave the dashboard. */
export function toCsv(rows: readonly Record<string, unknown>[]) {
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(",")),
  ].join("\n");
}
