/**
 * Credits, as the site sees them. The rules and the ledger live in the
 * database (supabase/credits.sql) and the server functions charge through
 * supabase/functions/_shared/credits.ts; this is the page's half:
 *
 *  - the rules, which anybody may read, and the signed-in account's position;
 *  - the private link: `?ref=<code>` on any address of the site. A visitor
 *    who arrives with one keeps it (the first link wins, for 30 days), the
 *    visit is counted once, and if the visitor opens an account the friend is
 *    rewarded and the newcomer welcomed;
 *  - the live balance: every server reply that carries credits announces
 *    them, so the top bar moves the moment something is paid for, and a
 *    refusal raises the "out of credits" notice wherever it happened;
 *  - a bought pass ("חופשי", see payments.ts): while it lasts the server
 *    work costs no credits, up to a fair-use amount a day.
 *
 * Only the server functions spend. Nothing in the browser can add a credit:
 * the page asks, and the database decides.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getSupabase } from "./supabase";

/* -------------------------------------------------------------- the rules */

/** The keys of the price list (public.credit_settings.prices). */
export type PriceKey = "assistant" | "text" | "minute" | "tts" | "separate" | "identify";

export const PRICE_KEYS: PriceKey[] = ["assistant", "minute", "text", "tts", "separate", "identify"];

export type CreditRules = {
  /** Off: nothing is charged, and the site says nothing about credits. */
  enabled: boolean;
  /** Every account, every day. */
  daily: number;
  /** For a friend who opens an account through the link: at once… */
  signupBonus: number;
  /** …and this much more every day, for good, up to `friendDailyMax`. */
  friendDaily: number;
  friendDailyMax: number;
  /** What the newcomer gets. */
  welcomeBonus: number;
  /** A first visit through the link, up to `visitDailyMax` a day. */
  visitBonus: number;
  visitDailyMax: number;
  signupDailyMax: number;
  /** How long a new account may still say which friend brought it. */
  claimHours: number;
  prices: Record<PriceKey, number>;
  /** Selling passes. */
  pay: PayRules;
};

export type PassPlan = "week" | "month";

export type PayRules = {
  /** Passes are on sale. */
  enabled: boolean;
  /** sandbox: PayPal's test mode — only the site's owner can buy, with test money. */
  mode: "sandbox" | "live";
  currency: string;
  /** The price of each pass. */
  week: number;
  month: number;
  /** What a pass covers in one day (fair use); past it, the usual credits pay. */
  passDaily: number;
};

/** The same numbers the database starts with, for when it cannot be reached. */
export const DEFAULT_RULES: CreditRules = {
  enabled: true,
  daily: 20,
  signupBonus: 50,
  friendDaily: 5,
  friendDailyMax: 100,
  welcomeBonus: 10,
  visitBonus: 1,
  visitDailyMax: 10,
  signupDailyMax: 10,
  claimHours: 72,
  prices: { assistant: 1, text: 2, minute: 1, tts: 1, separate: 5, identify: 2 },
  pay: { enabled: false, mode: "sandbox", currency: "ILS", week: 10, month: 30, passDaily: 200 },
};

const whole = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
};

type Row = Record<string, unknown>;

/** A price: money, so kept to two decimals. */
const money = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : fallback;
};

function normalizePay(row: Row): PayRules {
  const camel = (row.pay && typeof row.pay === "object" ? row.pay : {}) as Row;
  const fallback = DEFAULT_RULES.pay;
  const currency = String(row.pay_currency ?? camel.currency ?? fallback.currency).trim().toUpperCase();
  const enabled = row.pay_enabled ?? camel.enabled;
  return {
    enabled: enabled === undefined ? fallback.enabled : Boolean(enabled),
    mode: (row.pay_mode ?? camel.mode) === "live" ? "live" : "sandbox",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : fallback.currency,
    week: money(row.pass_week_price ?? camel.week, fallback.week),
    month: money(row.pass_month_price ?? camel.month, fallback.month),
    passDaily: Math.max(1, whole(row.pass_daily ?? camel.passDaily, fallback.passDaily)),
  };
}

/** The settings row, in either spelling, with anything missing filled from the defaults. */
export function normalizeRules(raw: unknown): CreditRules {
  const row = (raw && typeof raw === "object" ? raw : {}) as Row;
  const pick = (snake: string, camel: keyof CreditRules) => row[snake] ?? row[camel];
  const prices = (row.prices && typeof row.prices === "object" ? row.prices : {}) as Row;
  return {
    enabled: pick("enabled", "enabled") === undefined ? DEFAULT_RULES.enabled : Boolean(pick("enabled", "enabled")),
    daily: whole(pick("daily", "daily"), DEFAULT_RULES.daily),
    signupBonus: whole(pick("signup_bonus", "signupBonus"), DEFAULT_RULES.signupBonus),
    friendDaily: whole(pick("friend_daily", "friendDaily"), DEFAULT_RULES.friendDaily),
    friendDailyMax: whole(pick("friend_daily_max", "friendDailyMax"), DEFAULT_RULES.friendDailyMax),
    welcomeBonus: whole(pick("welcome_bonus", "welcomeBonus"), DEFAULT_RULES.welcomeBonus),
    visitBonus: whole(pick("visit_bonus", "visitBonus"), DEFAULT_RULES.visitBonus),
    visitDailyMax: whole(pick("visit_daily_max", "visitDailyMax"), DEFAULT_RULES.visitDailyMax),
    signupDailyMax: whole(pick("signup_daily_max", "signupDailyMax"), DEFAULT_RULES.signupDailyMax),
    claimHours: whole(pick("claim_hours", "claimHours"), DEFAULT_RULES.claimHours),
    prices: Object.fromEntries(
      PRICE_KEYS.map((key) => [key, whole(prices[key], DEFAULT_RULES.prices[key])]),
    ) as Record<PriceKey, number>,
    pay: normalizePay(row),
  };
}

/** The day's allowance for an account with `friends` friends. */
export function allowanceFor(friends: number, rules: CreditRules) {
  return rules.daily + Math.min(Math.max(0, friends) * rules.friendDaily, rules.friendDailyMax);
}

/** Friends still to bring before the daily boost stops growing; 0 once it is full. */
export function friendsToFullBoost(friends: number, rules: CreditRules) {
  if (rules.friendDaily <= 0) return 0;
  const needed = Math.ceil(rules.friendDailyMax / rules.friendDaily);
  return Math.max(0, needed - Math.max(0, friends));
}

/* ------------------------------------------------------------ estimates */

// The same arithmetic as supabase/functions/_shared/pricing.ts, which the
// tests hold these to.

/** A recording of `seconds`, transcribed from the start of a fresh day. */
export function minutesCost(seconds: number, rules: CreditRules) {
  return Math.ceil(Math.max(0, seconds) / 60) * rules.prices.minute;
}

/** Language-model text work on `characters` of text. */
export function textCost(characters: number, rules: CreditRules) {
  return Math.max(1, Math.ceil(Math.max(0, characters) / 10_000)) * rules.prices.text;
}

/** An MP3 of `characters` of text. */
export function ttsCost(characters: number, rules: CreditRules) {
  return Math.max(1, Math.ceil(Math.max(0, characters) / 1_000)) * rules.prices.tts;
}

/* ------------------------------------------------------- the account */

export type CreditEntryKind = "spend" | "refund" | "visit" | "signup" | "welcome" | "grant" | "purchase";

export type CreditEntry = {
  id: number;
  at: string;
  kind: CreditEntryKind;
  /** What was paid for: assistant, text, transcript, lyrics, tts, separate, identify. */
  action: string | null;
  delta: number;
  /** What a pass covered (not credits). */
  fromPass: number;
  detail: Row;
  refunded: boolean;
};

/** A bought pass that is still running. */
export type PassState = {
  until: string;
  plan: PassPlan | null;
  /** Fair use: what it covers in a day, and what is left of that today. */
  daily: number;
  left: number;
  usedToday: number;
};

export type PassPurchase = {
  id: string;
  at: string;
  plan: PassPlan;
  days: number;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "refunded";
  mode: "sandbox" | "live";
  until: string | null;
};

export type CreditStatus = {
  enabled: boolean;
  /** The private link's code. */
  code: string;
  allowance: number;
  dailyLeft: number;
  spentToday: number;
  bonus: number;
  friends: number;
  visits: number;
  visitsRewardedToday: number;
  earned: number;
  referred: boolean;
  canClaim: boolean;
  resetsAt: string | null;
  history: CreditEntry[];
  /** The pass, when one was bought and has not ended. */
  pass: PassState | null;
  purchases: PassPurchase[];
  rules: CreditRules;
};

const KINDS: CreditEntryKind[] = ["spend", "refund", "visit", "signup", "welcome", "grant", "purchase"];
const PURCHASE_STATES = ["pending", "completed", "refunded"];

const isPlan = (value: unknown): value is PassPlan => value === "week" || value === "month";

function normalizePass(row: Row): PassState | null {
  if (typeof row.pass_until !== "string" || !row.pass_until) return null;
  const daily = whole(row.pass_daily, DEFAULT_RULES.pay.passDaily);
  return {
    until: row.pass_until,
    plan: isPlan(row.pass_plan) ? row.pass_plan : null,
    daily,
    left: whole(row.pass_left, daily),
    usedToday: whole(row.pass_used_today, 0),
  };
}

function normalizePurchases(raw: unknown): PassPurchase[] {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => item as Row)
    .filter((item) => isPlan(item.plan) && PURCHASE_STATES.includes(String(item.status)))
    .map((item) => ({
      id: String(item.id ?? ""),
      at: String(item.at ?? ""),
      plan: item.plan as PassPlan,
      days: whole(item.days, 0),
      amount: money(item.amount, 0),
      currency: typeof item.currency === "string" ? item.currency : "ILS",
      status: item.status as PassPurchase["status"],
      mode: item.mode === "live" ? "live" : "sandbox",
      until: typeof item.until === "string" ? item.until : null,
    }));
}

export function normalizeStatus(raw: unknown): CreditStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Row;
  const code = typeof row.code === "string" ? row.code : "";
  if (!code) return null;
  const history = (Array.isArray(row.history) ? row.history : [])
    .map((item) => item as Row)
    .filter((item) => KINDS.includes(item.kind as CreditEntryKind))
    .map((item) => ({
      id: whole(item.id, 0),
      at: String(item.at ?? ""),
      kind: item.kind as CreditEntryKind,
      action: typeof item.action === "string" ? item.action : null,
      delta: Number.isFinite(Number(item.delta)) ? Math.round(Number(item.delta)) : 0,
      fromPass: whole(item.from_pass, 0),
      detail: (item.detail && typeof item.detail === "object" ? item.detail : {}) as Row,
      refunded: Boolean(item.refunded),
    }));
  return {
    enabled: row.enabled !== false,
    code,
    allowance: whole(row.allowance, 0),
    dailyLeft: whole(row.daily_left, 0),
    spentToday: whole(row.spent_today, 0),
    bonus: whole(row.bonus, 0),
    friends: whole(row.friends, 0),
    visits: whole(row.visits, 0),
    visitsRewardedToday: whole(row.visits_rewarded_today, 0),
    earned: whole(row.earned, 0),
    referred: Boolean(row.referred),
    canClaim: Boolean(row.can_claim),
    resetsAt: typeof row.resets_at === "string" ? row.resets_at : null,
    history,
    pass: normalizePass(row),
    purchases: normalizePurchases(row.purchases),
    rules: normalizeRules(row.config),
  };
}

/** Passes are on sale to this visitor: to everybody, or — in PayPal's test mode — to the owner alone. */
export function passesOnSale(rules: CreditRules, owner: boolean) {
  return rules.enabled && rules.pay.enabled && (rules.pay.mode === "live" || owner);
}

/** The pass is running at `now`. */
export function passActive(pass: Pick<PassState, "until"> | null | undefined, now = Date.now()) {
  if (!pass) return false;
  const until = new Date(pass.until).getTime();
  return Number.isFinite(until) && until > now;
}

/** Whole days until the pass ends, the day it ends counted. */
export function passDaysLeft(pass: Pick<PassState, "until">, now = Date.now()) {
  const until = new Date(pass.until).getTime();
  return Number.isFinite(until) ? Math.max(0, Math.ceil((until - now) / 86_400_000)) : 0;
}

/** Everything the account can spend right now. */
export function balanceOf(status: Pick<CreditStatus, "dailyLeft" | "bonus">) {
  return status.dailyLeft + status.bonus;
}

/* --------------------------------------------------------- live balance */

/** What a server reply says about the account, right after the work. */
export type CreditPulse = {
  left: number;
  daily: number;
  bonus: number;
  allowance: number;
  charged: number;
  /** Present on a refusal: what the work would have cost. */
  needed?: number;
  resetsAt: string | null;
  /** An active pass: until when, and what it still covers today. */
  passUntil?: string | null;
  passLeft?: number | null;
};

export function parsePulse(raw: unknown): CreditPulse | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  if (!Number.isFinite(Number(row.left))) return null;
  return {
    left: whole(row.left, 0),
    daily: whole(row.daily, 0),
    bonus: whole(row.bonus, 0),
    allowance: whole(row.allowance, 0),
    charged: whole(row.charged, 0),
    ...(row.needed !== undefined ? { needed: whole(row.needed, 0) } : {}),
    resetsAt: typeof row.resetsAt === "string" ? row.resetsAt : null,
    ...(typeof row.passUntil === "string" ? { passUntil: row.passUntil, passLeft: whole(row.passLeft, 0) } : {}),
  };
}

const PULSE_EVENT = "musictools:credits";
const EMPTY_EVENT = "musictools:credits-empty";

/** A server reply carried the balance (its `credits` field, or the X-Credits header). */
export function announceCredits(raw: unknown) {
  const pulse = parsePulse(raw);
  if (!pulse || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CreditPulse>(PULSE_EVENT, { detail: pulse }));
}

export function announceCreditsFrom(response: Response) {
  announceCredits(response.headers.get("X-Credits"));
}

/** The server refused the work for want of credits. */
export function announceEmpty(raw: unknown) {
  if (typeof window === "undefined") return;
  const pulse = parsePulse(raw);
  window.dispatchEvent(new CustomEvent<CreditPulse | null>(EMPTY_EVENT, { detail: pulse }));
}

export function onCredits(listener: (pulse: CreditPulse) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<CreditPulse>).detail);
  window.addEventListener(PULSE_EVENT, handle);
  return () => window.removeEventListener(PULSE_EVENT, handle);
}

export function onCreditsEmpty(listener: (pulse: CreditPulse | null) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<CreditPulse | null>).detail);
  window.addEventListener(EMPTY_EVENT, handle);
  return () => window.removeEventListener(EMPTY_EVENT, handle);
}

/* ------------------------------------------------------------ the link */

export const REF_PARAM = "ref";
const CODE_PATTERN = /^[a-z0-9]{6,16}$/;

/** A code as the database keeps it, or null. */
export function cleanCode(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toLowerCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** A code typed or pasted by a person — the bare code, or a whole invite link. */
export function codeFromInput(input: string): string | null {
  const text = input.trim();
  const inLink = text.match(/[?&]ref=([A-Za-z0-9]{6,16})/);
  return cleanCode(inLink ? inLink[1] : text);
}

/** The site's front door, wherever it is served from. */
export function siteBase() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

/** `url` with the code in its query, before any hash: /SongToNotes/?ref=abc#/s/123. */
export function withReferral(url: string, code: string | null) {
  const clean = cleanCode(code);
  if (!clean) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(REF_PARAM, clean);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The account's private link. */
export function referralLink(code: string) {
  return withReferral(siteBase(), code);
}

let ownCode: string | null = null;

/** The signed-in account's code, so every link the site hands out carries it. */
export function setOwnReferralCode(code: string | null) {
  ownCode = cleanCode(code);
}

export function ownReferralCode() {
  return ownCode;
}

/** The code in the address the visitor arrived at — taken out of the address, so it is not passed on by accident. */
export function takeReferralFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return null;
  }
  if (!url.searchParams.has(REF_PARAM)) return null;
  const code = cleanCode(url.searchParams.get(REF_PARAM));
  url.searchParams.delete(REF_PARAM);
  try {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The address keeps the code; nothing else depends on it.
  }
  return code;
}

/** Run once before the first render: keeps the invitation the address brought, if any. */
export function captureReferral() {
  const arrived = takeReferralFromUrl();
  if (arrived) rememberReferral(arrived);
}

/* --------------------------------------------- the invitation, remembered */

const PENDING_KEY = "musictools.referral.v1";
const BROWSER_KEY = "musictools.browser-id.v1";
/** How long an invitation waits for its visitor to open an account. */
export const PENDING_DAYS = 30;

export type PendingReferral = {
  code: string;
  /** When the link was followed. */
  at: number;
  /** The visit has been counted on the server. */
  visited: boolean;
  /** The friend's first name, once the server said it. */
  name: string | null;
  /** The visitor closed the invitation notice. */
  dismissed: boolean;
};

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Kept for the visit too, for a browser that will not store it. */
let pendingThisVisit: PendingReferral | null = null;

export function readPending(now = Date.now()): PendingReferral | null {
  let value: PendingReferral | null = pendingThisVisit;
  try {
    const raw = store()?.getItem(PENDING_KEY);
    if (raw) value = JSON.parse(raw) as PendingReferral;
  } catch {
    // This visit's memory, then.
  }
  if (!value || !cleanCode(value.code) || !Number.isFinite(value.at)) return null;
  if (now - value.at > PENDING_DAYS * 86_400_000) return null;
  return { code: value.code, at: value.at, visited: Boolean(value.visited), name: value.name ?? null, dismissed: Boolean(value.dismissed) };
}

function writePending(value: PendingReferral | null) {
  pendingThisVisit = value;
  try {
    if (value) store()?.setItem(PENDING_KEY, JSON.stringify(value));
    else store()?.removeItem(PENDING_KEY);
  } catch {
    // Remembered for this visit only.
  }
}

/**
 * Keeps the invitation a link brought. The first link wins: a second friend's
 * link does not take the newcomer from the first, until the first has waited
 * its thirty days.
 */
export function rememberReferral(code: string, now = Date.now()): PendingReferral | null {
  const clean = cleanCode(code);
  if (!clean) return readPending(now);
  const current = readPending(now);
  if (current) return current;
  const next: PendingReferral = { code: clean, at: now, visited: false, name: null, dismissed: false };
  writePending(next);
  return next;
}

export function updatePending(patch: Partial<Omit<PendingReferral, "code" | "at">>) {
  const current = readPending();
  if (current) writePending({ ...current, ...patch });
}

export function clearPending() {
  writePending(null);
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let browserThisVisit: string | null = null;

/**
 * A random id this browser keeps, so a visit to a link is counted once. It
 * says nothing about the person and is sent only with a visit to a link; the
 * server keeps a salted hash of it, not the id.
 */
export function browserId() {
  try {
    const stored = store()?.getItem(BROWSER_KEY);
    if (stored && /^[a-f0-9]{24}$/.test(stored)) return stored;
    const next = randomId();
    store()?.setItem(BROWSER_KEY, next);
    return next;
  } catch {
    browserThisVisit ??= randomId();
    return browserThisVisit;
  }
}

/* ------------------------------------------------------------ the server */

/**
 * The rules are for everybody, and read on every visit: a plain request with
 * the site's public key, so a visitor who is not signed in never waits on the
 * client library for them.
 */
export async function fetchRules(): Promise<CreditRules> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/credit_settings?select=*&limit=1`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
  });
  if (!response.ok) throw new Error(`credit_settings: HTTP ${response.status}`);
  const rows = (await response.json()) as unknown;
  return normalizeRules(Array.isArray(rows) ? (rows[0] ?? null) : null);
}

export async function fetchStatus(): Promise<CreditStatus | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("credit_status");
  if (error) throw error;
  return normalizeStatus(data);
}

export type VisitReply = { ok: boolean; self: boolean; name: string | null; counted: boolean; rewarded: boolean };

export async function recordVisit(code: string, visitor: string): Promise<VisitReply> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("credit_visit", { p_code: code, p_visitor: visitor });
  if (error) throw error;
  const row = (data ?? {}) as Row;
  return {
    ok: row.ok === true,
    self: row.self === true,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
    counted: row.counted === true,
    rewarded: row.rewarded === true,
  };
}

export type ClaimReason = "signed_out" | "unknown" | "self" | "already" | "too_late" | "loop";
export type ClaimReply = { ok: boolean; reason: ClaimReason | null; welcome: number; name: string | null };

export async function claimReferral(code: string): Promise<ClaimReply> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("credit_claim", { p_code: code });
  if (error) throw error;
  const row = (data ?? {}) as Row;
  return {
    ok: row.ok === true,
    reason: typeof row.reason === "string" ? (row.reason as ClaimReason) : null,
    welcome: whole(row.welcome, 0),
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
  };
}

/** Why a code was not accepted, for the box where a person types one. */
export function describeClaim(reply: ClaimReply) {
  switch (reply.reason) {
    case "self":
      return "זה הקוד שלך — אפשר לשלוח אותו לחברים, לא להשתמש בו בעצמך.";
    case "already":
      return "החשבון הזה כבר רשום כמי שהגיע דרך חבר.";
    case "too_late":
      return "אפשר לציין חבר רק בימים הראשונים אחרי פתיחת החשבון.";
    case "loop":
      return "שני חשבונות לא יכולים להזמין זה את זה.";
    case "signed_out":
      return "צריך להתחבר כדי לציין מי הזמין אותך.";
    default:
      return "לא מצאנו את הקוד הזה. כדאי לבדוק שהוא הועתק במלואו.";
  }
}

/* ---------------------------------------------------------- words */

/**
 * "+30", kept left-to-right inside a Hebrew sentence. Without the isolate the
 * sign drifts to the number's right and reads as "30 and up".
 */
export function signed(value: number) {
  return `\u2066${value > 0 ? "+" : ""}${value}\u2069`;
}

/** "12 קרדיטים", "קרדיט אחד". */
export function creditsLabel(count: number) {
  const value = Math.round(count);
  return value === 1 ? "קרדיט אחד" : `${value.toLocaleString("he-IL")} קרדיטים`;
}

/** "‏10 ₪": a price, in whole units when it is whole. */
export function formatMoney(amount: number, currency: string) {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${whole ? amount : amount.toFixed(2)} ${currency}`;
  }
}

export const PASS_PLANS: Record<PassPlan, { title: string; days: number; length: string }> = {
  week: { title: "חופשי שבועי", days: 7, length: "7 ימים" },
  month: { title: "חופשי חודשי", days: 30, length: "30 יום" },
};

/** How much cheaper the month is than weeks for the same 30 days, in percent (0 when it is not). */
export function monthSaving(pay: Pick<PayRules, "week" | "month">) {
  if (pay.week <= 0 || pay.month <= 0) return 0;
  const weeks = (pay.week * PASS_PLANS.month.days) / PASS_PLANS.week.days;
  const saving = Math.round((1 - pay.month / weeks) * 100);
  return saving >= 5 ? saving : 0;
}

/** "5 שעות ו־12 דקות" until the allowance renews. */
export function untilReset(resetsAt: string | null, now = Date.now()) {
  if (!resetsAt) return null;
  const at = new Date(resetsAt).getTime();
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.round((at - now) / 60_000));
  if (minutes < 1) return "פחות מדקה";
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = hours === 1 ? "שעה" : `${hours} שעות`;
  return rest ? `${hoursText} ו־${rest} דקות` : hoursText;
}

/** What the price list calls each price, and what one of it buys. */
export const PRICE_LABELS: Record<PriceKey, { title: string; unit: string; tools: string[] }> = {
  assistant: { title: "הודעה לעוזר", unit: "לכל הודעה (וכל סבב אוטומטי במצב סוכן)", tools: [] },
  minute: { title: "תמלול לטקסט ומילים מסונכרנות", unit: "לכל דקת הקלטה", tools: ["transcript", "lyrics"] },
  text: { title: "עיבוד טקסט ב־AI", unit: "לכל 10,000 תווים — פיסוק, סיכום, תרגום, דוברים, הסבר שיר", tools: ["transcript"] },
  tts: { title: "הקראה לקובץ MP3", unit: "לכל 1,000 תווים", tools: ["tts"] },
  separate: { title: "הפרדת שירה ב־AI", unit: "לכל שיר", tools: ["vocals"] },
  identify: { title: "זיהוי שיר", unit: "לכל זיהוי", tools: ["identify"] },
};

const ACTION_LABELS: Record<string, string> = {
  assistant: "הודעה לעוזר",
  transcript: "תמלול לטקסט",
  lyrics: "מילים מסונכרנות",
  tts: "הקראה לקובץ MP3",
  separate: "הפרדת שירה ב־AI",
  identify: "זיהוי שיר",
  text: "עיבוד טקסט ב־AI",
};

const TEXT_JOBS: Record<string, string> = {
  polish: "פיסוק ופסקאות",
  summarize: "סיכום",
  translate: "תרגום",
  speakers: "זיהוי דוברים",
  explain: "הסבר השיר",
  lyrics: "תרגום מילים",
};

/** A line of the history, in words. */
export function entryLabel(entry: Pick<CreditEntry, "kind" | "action" | "detail">) {
  const action = entry.action ? ACTION_LABELS[entry.action] ?? entry.action : "פעולה בשרת";
  const job = entry.action === "text" && typeof entry.detail.job === "string" ? TEXT_JOBS[entry.detail.job] : null;
  const what = job ? `${action} · ${job}` : action;
  switch (entry.kind) {
    case "spend":
      return what;
    case "refund":
      return `החזר: ${what}`;
    case "visit":
      return "מישהו חדש נכנס לקישור שלך";
    case "signup":
      return "חבר הצטרף דרך הקישור שלך";
    case "welcome":
      return typeof entry.detail.from === "string" && entry.detail.from ? `מתנת הצטרפות · הזמנה מ${entry.detail.from}` : "מתנת הצטרפות";
    case "grant":
      return "מתנה מהאתר";
    case "purchase": {
      const title = isPlan(entry.action) ? PASS_PLANS[entry.action].title : "חופשי";
      return entry.detail.refunded ? `התשלום על ${title} הוחזר` : `קנית ${title}`;
    }
  }
}
