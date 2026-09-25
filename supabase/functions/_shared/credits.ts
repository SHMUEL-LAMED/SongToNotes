/**
 * Paying for server work in credits (the tables and the rules are in
 * supabase/credits.sql).
 *
 * A function about to call a paid service asks `charge()` first. It takes the
 * price from the account in one step — the day's allowance, then the earned
 * bonus — or says no, and the function answers 402 with what was missing.
 * When the service then fails, `refund()` gives the credits back, so nobody
 * pays for an error. The site's owner is never refused. An account with a
 * bought pass pays nothing, up to the pass's fair use for the day.
 *
 * If the credits ledger cannot be reached at all (a project that has not run
 * credits.sql yet), the work goes on uncharged: each function's own daily
 * safety cap still holds, and a broken ledger never takes the tools down.
 */
import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { isOwner, json } from "./common.ts";

/** The keys of public.credit_settings.prices. */
export type PriceKey = "assistant" | "text" | "minute" | "tts" | "separate" | "identify";

export type Charge = {
  /** False only when the account had too little. */
  ok: boolean;
  /** Credits are switched on (and the ledger was reachable). */
  enabled: boolean;
  /** The ledger entry to refund, when something was taken. */
  entry: number | null;
  charged: number;
  dailyLeft: number;
  bonus: number;
  allowance: number;
  needed: number;
  resetsAt: string | null;
  /** An active pass: until when, and what it still covers today. */
  passUntil: string | null;
  passLeft: number | null;
  /** What the pass covered of this action. */
  passUsed: number;
};

const UNCHARGED: Charge = {
  ok: true,
  enabled: false,
  entry: null,
  charged: 0,
  dailyLeft: 0,
  bonus: 0,
  allowance: 0,
  needed: 0,
  resetsAt: null,
  passUntil: null,
  passLeft: null,
  passUsed: 0,
};

function toCharge(raw: Record<string, unknown>): Charge {
  const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return {
    ok: raw.ok !== false,
    enabled: raw.enabled !== false,
    entry: raw.entry === null || raw.entry === undefined ? null : number(raw.entry),
    charged: number(raw.charged),
    dailyLeft: number(raw.daily_left),
    bonus: number(raw.bonus),
    allowance: number(raw.allowance),
    needed: number(raw.needed),
    resetsAt: typeof raw.resets_at === "string" ? raw.resets_at : null,
    passUntil: typeof raw.pass_until === "string" ? raw.pass_until : null,
    passLeft: raw.pass_left === null || raw.pass_left === undefined ? null : number(raw.pass_left),
    passUsed: number(raw.pass_used),
  };
}

/**
 * Takes `units` × the price of `price` from the account. `action` is what the
 * history on the credits page will call it (assistant, transcript, lyrics…).
 */
export async function charge(
  admin: SupabaseClient,
  user: User,
  action: string,
  price: PriceKey,
  units: number,
  detail: Record<string, unknown> = {},
): Promise<Charge> {
  const { data, error } = await admin.rpc("credit_spend", {
    p_user: user.id,
    p_action: action,
    p_price: price,
    p_units: Math.max(0, Math.ceil(units)),
    p_detail: detail,
    p_force: isOwner(user),
  });
  if (error || !data || typeof data !== "object") {
    console.error("credits unavailable, not charging", error?.message);
    return UNCHARGED;
  }
  return toCharge(data as Record<string, unknown>);
}

/** Gives back what `paid` took, once. Returns the balance after it. */
export async function refund(admin: SupabaseClient, user: User, paid: Charge | null) {
  if (!paid?.entry) return paid;
  const { data, error } = await admin.rpc("credit_refund", { p_user: user.id, p_entry: paid.entry });
  if (error || !data || typeof data !== "object") {
    console.error("credits refund failed", paid.entry, error?.message);
    return paid;
  }
  const back = toCharge(data as Record<string, unknown>);
  return { ...back, ok: true, entry: null, charged: 0, passUsed: 0 };
}

/** The refund for a job that failed after it was started — a separation, found by its id. */
export async function refundJob(admin: SupabaseClient, user: User, job: string) {
  const { error } = await admin.rpc("credit_refund_job", { p_user: user.id, p_job: job });
  if (error) console.error("credits job refund failed", job, error.message);
}

/** Adds to what the ledger entry remembers, such as the job it paid for. */
export async function noteCharge(admin: SupabaseClient, paid: Charge, detail: Record<string, unknown>) {
  if (!paid.entry) return;
  const { error } = await admin.rpc("credit_note", { p_entry: paid.entry, p_detail: detail });
  if (error) console.error("credits note failed", paid.entry, error.message);
}

/** What the page is told about the account after the work, for the balance it shows. */
export function creditSummary(paid: Charge | null) {
  if (!paid?.enabled) return null;
  return {
    left: paid.dailyLeft + paid.bonus,
    daily: paid.dailyLeft,
    bonus: paid.bonus,
    allowance: paid.allowance,
    charged: paid.charged,
    ...(paid.ok ? {} : { needed: paid.needed }),
    resetsAt: paid.resetsAt,
    ...(paid.passUntil ? { passUntil: paid.passUntil, passLeft: paid.passLeft ?? 0, passUsed: paid.passUsed } : {}),
  };
}

/** The same, as a header — for replies that are a stream or a file rather than JSON. */
export function creditHeaders(paid: Charge | null): Record<string, string> {
  const summary = creditSummary(paid);
  return summary ? { "X-Credits": JSON.stringify(summary) } : {};
}

/** The answer when the account has too little: what was needed and when the day renews. */
export function refused(paid: Charge) {
  return json(402, { error: "credits", credits: creditSummary(paid) });
}
