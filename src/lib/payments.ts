/**
 * Buying a pass ("חופשי") — the page's half. supabase/functions/pay talks to
 * PayPal; this starts a purchase, sends the payer to PayPal, and takes the
 * purchase up again when PayPal sends them back to the site:
 *
 *   ?pay=return&purchase=<id>&token=<order>&PayerID=…   approved: take the money
 *   ?pay=cancel&purchase=<id>&token=<order>             left without paying
 *
 * The address is cleaned before anything else reads it, and the purchase is
 * remembered until the server has answered, so a reload in between loses
 * nothing. The price is never sent from here: the server has it.
 */
import { siteBase, type PassPlan } from "./credits";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getSupabase } from "./supabase";

const PAY_URL = `${SUPABASE_URL}/functions/v1/pay`;
const RETURN_KEY = "musictools.payment.v1";
/** What PayPal adds to the way back, besides ours. */
const RETURN_PARAMS = ["pay", "purchase", "token", "PayerID", "ba_token"];
/** A way back older than this is not taken up any more. */
const RETURN_DAYS = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

export type PaymentReturn = { purchase: string; kind: "return" | "cancel"; at: number };

export type PaymentStatus = "completed" | "pending" | "failed" | "not_approved" | "canceled" | "refunded";

export type PaymentResult = {
  status: PaymentStatus;
  plan: PassPlan | null;
  until: string | null;
  /** Why it failed: declined, expired, mismatch. */
  reason: string | null;
};

const MESSAGES: Record<string, string> = {
  signed_out: "צריך להתחבר לחשבון כדי לקנות חופשי.",
  off: "המכירה של החופשי סגורה כרגע.",
  test_mode: "התשלומים עדיין במצב ניסיון — אפשר יהיה לקנות בקרוב.",
  plan: "החבילה הזאת לא קיימת.",
  busy: "היו יותר מדי ניסיונות תשלום בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.",
  not_configured: "התשלומים עוד לא הוגדרו באתר.",
  keys: "החיבור ל־PayPal לא הוגדר נכון. אפשר לנסות שוב מאוחר יותר.",
  paypal: "PayPal לא ענה. אפשר לנסות שוב בעוד רגע.",
  network: "החיבור לשרת נכשל. כדאי לבדוק את האינטרנט ולנסות שוב.",
  not_deployed: "שירות התשלומים עוד לא עלה לשרת.",
  unknown: "לא מצאנו את התשלום הזה.",
  no_order: "התשלום לא הגיע ל־PayPal. אפשר לנסות שוב.",
  storage: "השרת לא הצליח לבצע את הפעולה. אפשר לנסות שוב.",
};

export class PayError extends Error {
  code: string;
  constructor(code: string) {
    super(MESSAGES[code] ?? "הבקשה נכשלה. אפשר לנסות שוב בעוד רגע.");
    this.name = "PayError";
    this.code = code;
  }
}

async function call(body: Row): Promise<Row> {
  const { data } = await (await getSupabase()).auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new PayError("signed_out");
  let response: Response;
  try {
    response = await fetch(PAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PayError("network");
  }
  const reply = (await response.json().catch(() => null)) as Row | null;
  if (!response.ok || !reply || typeof reply.error === "string") {
    throw new PayError(typeof reply?.error === "string" ? reply.error : response.status === 404 ? "not_deployed" : "storage");
  }
  return reply;
}

/** PayPal's own pages, and only them, are where a payer is sent. */
export function isPayPalCheckout(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /(^|\.)paypal\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Starts the purchase and goes to PayPal. Throws a PayError the page can show. */
export async function startPass(plan: PassPlan) {
  const reply = await call({ action: "create", plan, returnTo: siteBase() });
  const url = typeof reply.url === "string" ? reply.url : "";
  if (!isPayPalCheckout(url)) throw new PayError("paypal");
  window.location.assign(url);
}

function normalizeResult(reply: Row): PaymentResult {
  const known: PaymentStatus[] = ["completed", "pending", "failed", "not_approved", "canceled", "refunded"];
  const status = known.includes(reply.status as PaymentStatus) ? (reply.status as PaymentStatus) : "failed";
  return {
    status,
    plan: reply.plan === "week" || reply.plan === "month" ? reply.plan : null,
    until: typeof reply.until === "string" ? reply.until : null,
    reason: typeof reply.reason === "string" ? reply.reason : null,
  };
}

/** Back from PayPal with the payer's yes: the server takes the money and gives the pass. */
export async function finishPayment(purchase: string) {
  return normalizeResult(await call({ action: "capture", purchase }));
}

/** Back from PayPal without paying. */
export async function cancelPayment(purchase: string) {
  await call({ action: "cancel", purchase });
}

/* ---------------------------------------------------------- the way back */

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let returnThisVisit: PaymentReturn | null = null;

export function readPaymentReturn(now = Date.now()): PaymentReturn | null {
  let value = returnThisVisit;
  try {
    const raw = store()?.getItem(RETURN_KEY);
    if (raw) value = JSON.parse(raw) as PaymentReturn;
  } catch {
    // This visit's memory, then.
  }
  if (!value || !UUID.test(String(value.purchase)) || (value.kind !== "return" && value.kind !== "cancel")) return null;
  if (!Number.isFinite(value.at) || now - value.at > RETURN_DAYS * 86_400_000) return null;
  return { purchase: value.purchase, kind: value.kind, at: value.at };
}

function writePaymentReturn(value: PaymentReturn | null) {
  returnThisVisit = value;
  try {
    if (value) store()?.setItem(RETURN_KEY, JSON.stringify(value));
    else store()?.removeItem(RETURN_KEY);
  } catch {
    // Remembered for this visit only.
  }
}

export function clearPaymentReturn() {
  writePaymentReturn(null);
}

/**
 * Run once before the first render: PayPal's way back is taken out of the
 * address (the credits page is where the answer shows) and remembered until
 * the server has settled it.
 */
export function takePaymentReturn(): PaymentReturn | null {
  if (typeof window === "undefined") return null;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return null;
  }
  const kind = url.searchParams.get("pay");
  if (kind !== "return" && kind !== "cancel") return null;
  const purchase = url.searchParams.get("purchase") ?? "";
  for (const key of RETURN_PARAMS) url.searchParams.delete(key);
  try {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}#/credits`);
  } catch {
    // The address keeps PayPal's words; the page still goes on.
  }
  if (!UUID.test(purchase)) return null;
  const value: PaymentReturn = { purchase, kind, at: Date.now() };
  writePaymentReturn(value);
  return value;
}
