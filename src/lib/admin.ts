/**
 * The admin area's side of the site.
 *
 * Everything here is a question put to `supabase/functions/admin` — the only
 * place allowed to look at the site as a whole — or a pure reading of the
 * answer. The function checks the caller's verified address itself, so the
 * gate below is only there to keep the door out of sight: hiding a button is
 * not a permission, and the server never takes the browser's word for it.
 *
 * The answer says what happened on the *site*: which tools were opened, when,
 * how long they held somebody, what finished and what failed. It carries no
 * account, no title and no file name, because the rows it is counted from
 * never had any. Nothing here can be turned back into a person, by design.
 */
import { normalizeRules, type CreditRules } from "./credits";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getSupabase } from "./supabase";
import { ALL_TOOLS } from "./tools";

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

export type DailyRow = {
  day: string;
  views: number;
  results: number;
  errors: number;
  visitors: number;
};

export type ToolRow = {
  tool: string;
  views: number;
  inputs: number;
  results: number;
  errors: number;
  visitors: number;
  /** Average time a visit to the tool lasted. */
  dwellSeconds: number;
  /** Average time the tool itself took to produce something. */
  workSeconds: number;
};

export type Tally = { key: string; value: number };

export type Failure = { tool: string; code: string; count: number; last: string };

export type AdminStats = {
  daily: DailyRow[];
  tools: ToolRow[];
  /** Seven rows of twenty-four: views by weekday and hour. */
  hours: number[][];
  devices: Tally[];
  browsers: Tally[];
  systems: Tally[];
  languages: Tally[];
  referrers: Tally[];
  failures: Failure[];
  /** Anonymous visitors seen in the last five minutes. */
  live: number;
  visitors: { total: number; returning: number; fresh: number };
  views: number;
  /** Share of views made while somebody was signed in, as a percentage. */
  signedInShare: number;
  events: number;
};

export type AdminTotals = {
  accounts: number;
  works: number;
  files: number;
  bytes: number;
  shares: number;
  shareViews: number;
  liveShares: number;
};

export type QuotaRow = { kind: string; today: number; range: number };

export type Alert = { kind: "warn" | "bad" | "info"; text: string };

export type ControlState = {
  maintenance: boolean;
  maintenanceMessage: string | null;
  banner: string | null;
  bannerKind: "info" | "warn" | "good";
  disabledTools: string[];
};

/** How credits moved across the site in the range — totals only, never whose. */
export type CreditStats = {
  /** Accounts that have a credits row (every account that signed in since credits began). */
  accounts: number;
  /** New accounts that joined through a friend's link, in the range and ever. */
  referred: number;
  referredTotal: number;
  /** Visits through somebody's link, and how many of them earned a credit. */
  visits: number;
  visitsRewarded: number;
  /** Earned credits waiting in accounts, site-wide. */
  bonusOutstanding: number;
  spentToday: number;
  spent: number;
  refunds: number;
  /** Credits given, by why: visit, signup, welcome, grant. */
  granted: Record<string, number>;
  /** What each kind of work used, a pass's share included. */
  byAction: { action: string; credits: number; count: number }[];
  daily: { day: string; spent: number }[];
  /** What passes covered in the range, and how many are running now. */
  passUsed: number;
  passesActive: number;
  /** Real money taken in the range, by currency, and passes sold by plan. */
  revenue: Record<string, number>;
  sales: Record<string, number>;
  /** Test-mode payments completed in the range. */
  testSales: number;
  recentPurchases: AdminPurchase[];
};

/** A payment for a pass, as the admin area sees it: what and how it went, never who. */
export type AdminPurchase = {
  at: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  mode: "sandbox" | "live";
  orderId: string | null;
  captureId: string | null;
};

export type AdminCredits = { rules: CreditRules | null; stats: CreditStats | null };

export type AdminSnapshot = {
  generatedAt: string;
  days: number;
  /** The range held more events than the server reads in one go. */
  truncated: boolean;
  stats: AdminStats;
  totals: AdminTotals;
  quotas: QuotaRow[];
  alerts: Alert[];
  control: ControlState;
  /** Absent from a server that predates credits. */
  credits: AdminCredits;
};

export type AdminSetting = {
  key: string;
  set: boolean;
  source: "secret" | "table" | null;
  editable: boolean;
  preview: string | null;
};

export type HealthCheck = {
  service: string;
  label: string;
  state: "good" | "bad" | "off";
  note: string;
  ms: number;
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
  secret_wins: "המפתח הזה מוגדר כסוד של הפונקציה, ולכן אי אפשר לשנות אותו מכאן.",
  bad_request: "הבקשה חסרה פרטים.",
  unknown_action: "הפעולה אינה מוכרת.",
  storage: "השרת לא הצליח לבצע את הפעולה. נסה שוב.",
  network: "החיבור לשרת נכשל. בדוק את האינטרנט ונסה שוב.",
  not_deployed: "פונקציית הניהול עדיין לא הועלתה לפרויקט (supabase/functions/admin).",
  paypal_keys: "כדי להפעיל את המכירה צריך קודם להזין את המפתחות של PayPal למצב שנבחר, בטבלת המפתחות שלמטה.",
};

export function describeAdminError(code: string) {
  return MESSAGES[code] ?? "הבקשה נכשלה. נסה שוב בעוד רגע.";
}

async function headers() {
  const { data } = await (await getSupabase()).auth.getSession();
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

const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function tallies(raw: unknown): Tally[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({ key: String((row as Tally)?.key ?? ""), value: num((row as Tally)?.value) }))
    .filter((row) => row.key !== "");
}

/** Seven rows of twenty-four, whatever the server managed to send. */
export function normalizeHours(raw: unknown): number[][] {
  const rows = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 7 }, (_unused, weekday) => {
    const row = Array.isArray(rows[weekday]) ? (rows[weekday] as unknown[]) : [];
    return Array.from({ length: 24 }, (_cell, hour) => num(row[hour]));
  });
}

/** What the site looks like when nothing is switched on. */
export const OPEN_CONTROL: ControlState = {
  maintenance: false,
  maintenanceMessage: null,
  banner: null,
  bannerKind: "info",
  disabledTools: [],
};

export function normalizeControlState(raw: unknown): ControlState {
  const row = (raw ?? {}) as Record<string, unknown>;
  const kind = row.banner_kind ?? row.bannerKind;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const tools = row.disabled_tools ?? row.disabledTools;
  return {
    maintenance: Boolean(row.maintenance),
    maintenanceMessage: text(row.maintenance_message ?? row.maintenanceMessage),
    banner: text(row.banner),
    bannerKind: kind === "warn" || kind === "good" ? kind : "info",
    disabledTools: Array.isArray(tools) ? tools.map(String).filter(Boolean) : [],
  };
}

/** The server's reply, in the shape the dashboard draws from. */
export function normalizeSnapshot(raw: Record<string, unknown>): AdminSnapshot {
  const stats = (raw.stats ?? {}) as Record<string, unknown>;
  const totals = (raw.totals ?? {}) as Record<string, unknown>;
  const visitors = (stats.visitors ?? {}) as Record<string, unknown>;

  return {
    generatedAt: String(raw.generatedAt ?? new Date(0).toISOString()),
    days: num(raw.days, 30),
    truncated: Boolean(raw.truncated),
    stats: {
      daily: (Array.isArray(stats.daily) ? stats.daily : []).map((row) => {
        const day = row as Record<string, unknown>;
        return {
          day: String(day.day ?? "").slice(0, 10),
          views: num(day.views),
          results: num(day.results),
          errors: num(day.errors),
          visitors: num(day.visitors),
        };
      }),
      tools: (Array.isArray(stats.tools) ? stats.tools : []).map((row) => {
        const tool = row as Record<string, unknown>;
        return {
          tool: String(tool.tool ?? ""),
          views: num(tool.views),
          inputs: num(tool.inputs),
          results: num(tool.results),
          errors: num(tool.errors),
          visitors: num(tool.visitors),
          dwellSeconds: num(tool.dwellSeconds),
          workSeconds: num(tool.workSeconds),
        };
      }),
      hours: normalizeHours(stats.hours),
      devices: tallies(stats.devices),
      browsers: tallies(stats.browsers),
      systems: tallies(stats.systems),
      languages: tallies(stats.languages),
      referrers: tallies(stats.referrers),
      failures: (Array.isArray(stats.failures) ? stats.failures : []).map((row) => {
        const failure = row as Record<string, unknown>;
        return {
          tool: String(failure.tool ?? ""),
          code: String(failure.code ?? ""),
          count: num(failure.count),
          last: String(failure.last ?? ""),
        };
      }),
      live: num(stats.live),
      visitors: {
        total: num(visitors.total),
        returning: num(visitors.returning),
        fresh: num(visitors.fresh),
      },
      views: num(stats.views),
      signedInShare: num(stats.signedInShare),
      events: num(stats.events),
    },
    totals: {
      accounts: num(totals.accounts),
      works: num(totals.works),
      files: num(totals.files),
      bytes: num(totals.bytes),
      shares: num(totals.shares),
      shareViews: num(totals.shareViews),
      liveShares: num(totals.liveShares),
    },
    quotas: (Array.isArray(raw.quotas) ? raw.quotas : []).map((row) => {
      const quota = row as Record<string, unknown>;
      return { kind: String(quota.kind ?? ""), today: num(quota.today), range: num(quota.range) };
    }),
    alerts: (Array.isArray(raw.alerts) ? raw.alerts : []).map((row) => {
      const alert = row as Record<string, unknown>;
      const kind = alert.kind;
      return {
        kind: kind === "bad" || kind === "warn" ? kind : "info",
        text: String(alert.text ?? ""),
      };
    }),
    control: normalizeControlState(raw.control),
    credits: normalizeAdminCredits(raw.credits),
  };
}

/** An object of numbers ({"ILS": 40}), with anything else left out. */
function numbers(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => [key, Number(value)] as const)
      .filter(([, value]) => Number.isFinite(value)),
  );
}

export function normalizeAdminCredits(raw: unknown): AdminCredits {
  const row = (raw ?? {}) as Record<string, unknown>;
  const stats = row.stats && typeof row.stats === "object" ? (row.stats as Record<string, unknown>) : null;
  const granted = (stats?.granted ?? {}) as Record<string, unknown>;
  return {
    rules: row.settings && typeof row.settings === "object" ? normalizeRules(row.settings) : null,
    stats: stats
      ? {
          accounts: num(stats.accounts),
          referred: num(stats.referred),
          referredTotal: num(stats.referred_total),
          visits: num(stats.visits),
          visitsRewarded: num(stats.visits_rewarded),
          bonusOutstanding: num(stats.bonus_outstanding),
          spentToday: num(stats.spent_today),
          spent: num(stats.spent),
          refunds: num(stats.refunds),
          granted: Object.fromEntries(Object.entries(granted).map(([key, value]) => [key, num(value)])),
          byAction: (Array.isArray(stats.by_action) ? stats.by_action : []).map((item) => {
            const entry = item as Record<string, unknown>;
            return { action: String(entry.action ?? ""), credits: num(entry.credits), count: num(entry.count) };
          }),
          daily: (Array.isArray(stats.daily) ? stats.daily : []).map((item) => {
            const entry = item as Record<string, unknown>;
            return { day: String(entry.day ?? ""), spent: num(entry.spent) };
          }),
          passUsed: num(stats.pass_used),
          passesActive: num(stats.passes_active),
          revenue: numbers(stats.revenue),
          sales: numbers(stats.sales),
          testSales: num(stats.test_sales),
          recentPurchases: (Array.isArray(stats.recent_purchases) ? stats.recent_purchases : []).map((item) => {
            const entry = item as Record<string, unknown>;
            return {
              at: String(entry.at ?? ""),
              plan: String(entry.plan ?? ""),
              amount: Number(entry.amount) || 0,
              currency: String(entry.currency ?? ""),
              status: String(entry.status ?? ""),
              mode: entry.mode === "live" ? "live" : "sandbox",
              orderId: typeof entry.order_id === "string" ? entry.order_id : null,
              captureId: typeof entry.capture_id === "string" ? entry.capture_id : null,
            };
          }),
        }
      : null,
  };
}

export async function fetchSnapshot(days: number) {
  return normalizeSnapshot(await call<Record<string, unknown>>(`?view=overview&days=${days}`));
}

export async function fetchSettings() {
  const body = await call<{ keys: AdminSetting[] }>("?view=settings");
  return body.keys ?? [];
}

export async function fetchAudit(query = ""): Promise<AdminAuditEntry[]> {
  const search = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : "";
  const body = await call<{
    entries: {
      id: number;
      actor_email: string;
      action: string;
      target: string | null;
      detail: Record<string, unknown>;
      created_at: string;
    }[];
  }>(`?view=audit${search}`);
  return (body.entries ?? []).map((row) => ({
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    target: row.target,
    detail: row.detail ?? {},
    createdAt: row.created_at,
  }));
}

/** A message a visitor sent from "משוב והצעות". */
export type FeedbackEntry = {
  id: number;
  createdAt: string;
  kind: "problem" | "idea" | "other";
  message: string;
  contact: string | null;
  page: string | null;
  language: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  handled: boolean;
};

const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** The rows as the page shows them; anything malformed is left out. */
export function normalizeFeedback(raw: unknown): FeedbackEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): FeedbackEntry[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = Number(item.id);
    if (!Number.isSafeInteger(id) || typeof item.message !== "string" || typeof item.created_at !== "string") return [];
    const kind = item.kind === "idea" || item.kind === "other" ? item.kind : "problem";
    return [
      {
        id,
        createdAt: item.created_at,
        kind,
        message: item.message,
        contact: optional(item.contact),
        page: optional(item.page),
        language: optional(item.language),
        device: optional(item.device),
        browser: optional(item.browser),
        os: optional(item.os),
        handled: item.handled === true,
      },
    ];
  });
}

/** The messages, newest first; `missing` until supabase/site_feedback.sql has run. */
export async function fetchFeedback(): Promise<{ entries: FeedbackEntry[]; missing: boolean }> {
  const body = await call<{ entries?: unknown; missing?: boolean }>("?view=feedback");
  return { entries: normalizeFeedback(body.entries), missing: body.missing === true };
}

export type AdminAction =
  | "feedback.handle"
  | "feedback.delete"
  | "control.set"
  | "setting.set"
  | "setting.delete"
  | "health.check"
  | "files.scan"
  | "files.clean"
  | "events.prune"
  | "usage.reset"
  | "credits.set";

export type AdminResult = {
  ok: boolean;
  control?: unknown;
  credits?: unknown;
  checks?: HealthCheck[];
  orphans?: { count: number; bytes: number };
  removed?: number;
};

export async function runAdminAction(
  action: AdminAction,
  payload: Record<string, unknown> = {},
): Promise<AdminResult> {
  return call<AdminResult>("", {
    method: "POST",
    body: JSON.stringify({ action, ...payload }),
  });
}

/* -------------------------------------------------------------------------
   Reading the numbers — pure, so every figure on the page is testable
   ------------------------------------------------------------------------- */

/** The calendar day a timestamp falls on, where the reader is standing. */
export function dayKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** The last `days` day keys, oldest first, ending on `end`. */
export function dayRange(days: number, end: Date = new Date()) {
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(dayKey(new Date(end.getTime() - back * 86_400_000)));
  }
  return out;
}

export type Point = { day: string; value: number };

/** One measure of the daily rows, as points a chart can take. */
export function series(daily: readonly DailyRow[], field: keyof Omit<DailyRow, "day">): Point[] {
  return daily.map((row) => ({ day: row.day, value: row[field] }));
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

/**
 * How many of those who opened a tool got something out of it, as a
 * percentage. A tool nobody opened has no rate — zero would read like failure.
 */
export function successRate(tool: Pick<ToolRow, "views" | "results">) {
  if (!tool.views) return null;
  return Math.min(100, Math.round((tool.results / tool.views) * 100));
}

/** Opened → handed something → got a result, as three counts and two drops. */
export type FunnelStep = { label: string; value: number; share: number };

export function funnel(tool: Pick<ToolRow, "views" | "inputs" | "results">): FunnelStep[] {
  const top = Math.max(tool.views, tool.inputs, tool.results, 1);
  return [
    { label: "נכנסו", value: tool.views, share: Math.round((tool.views / top) * 100) },
    { label: "התחילו", value: tool.inputs, share: Math.round((tool.inputs / top) * 100) },
    { label: "קיבלו תוצאה", value: tool.results, share: Math.round((tool.results / top) * 100) },
  ];
}

/** The busiest cell of the week, for the sentence above the heatmap. */
export function busiestHour(hours: readonly number[][]) {
  let best = { weekday: 0, hour: 0, value: 0 };
  hours.forEach((row, weekday) => {
    row.forEach((value, hour) => {
      if (value > best.value) best = { weekday, hour, value };
    });
  });
  return best.value ? best : null;
}

export const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function weekdayLabel(weekday: number) {
  return WEEKDAYS[weekday] ?? "";
}

/** "14:00–15:00", the way an hour column reads out loud. */
export function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

// Every tool, hidden ones too: their past events still carry their name and colour.
const TOOL_TITLES = new Map(ALL_TOOLS.map((tool) => [tool.id, tool.title]));
const TOOL_HUES = new Map(ALL_TOOLS.map((tool) => [tool.id, tool.hue]));

const EXTRA_TITLES: Record<string, string> = {
  home: "דף הבית",
  me: "האזור האישי",
  admin: "אזור הניהול",
  share: "דף שיתוף",
  saved: "העבודות שלי",
};

/** The Hebrew name of whatever the events call a tool. */
export function toolLabel(id: string) {
  return TOOL_TITLES.get(id) ?? EXTRA_TITLES[id] ?? id;
}

/** The tool's own colour, so a chart of tools is not one flat blue. */
export function toolHue(id: string) {
  const hue = TOOL_HUES.get(id);
  if (hue !== undefined) return hue;
  // A stable colour for the pages that are not tools, from the name itself.
  let sum = 0;
  for (let index = 0; index < id.length; index += 1) sum = (sum * 31 + id.charCodeAt(index)) % 360;
  return sum;
}

const QUOTA_LABELS: Record<string, string> = {
  ai: "מודל שפה (טוקנים)",
  tts: "הקראה (תווים)",
  separation: "הפרדת שירה (קבצים)",
  identify: "זיהוי שירים",
  stt: "תמלול (שניות)",
};

export function quotaLabel(kind: string) {
  return QUOTA_LABELS[kind] ?? kind;
}

const ACTION_LABELS: Record<string, string> = {
  "control.set": "שינוי הגדרות אתר",
  "setting.set": "עדכון מפתח",
  "setting.delete": "מחיקת מפתח",
  "files.clean": "ניקוי קבצים יתומים",
  "events.prune": "מחיקת מדידות ישנות",
  "usage.reset": "איפוס מכסות היום",
  "credits.set": "שינוי כללי הקרדיטים",
};

export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
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
  if (!seconds) return "—";
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

/** The short day a chart's axis shows: "14.3". */
export function shortDay(day: string) {
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  return `${Number(parts[2])}.${Number(parts[1])}`;
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
