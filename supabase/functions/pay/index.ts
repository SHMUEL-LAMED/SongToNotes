/**
 * Buying a pass ("חופשי") with PayPal: a week or a month in which the server
 * work costs no credits (the rules, and the purchases, are in
 * supabase/credits.sql).
 *
 * The page asks for an order and sends the payer to PayPal; PayPal sends
 * them back to the site, and the page asks here to take the money. The pass
 * is given once, when the capture is COMPLETED and its sum is the price that
 * was asked — by whichever reports it first: the page coming back, or
 * PayPal's own notice (the webhook). The webhook also covers a payer who
 * closed the tab on the way back, a payment PayPal held for review, and a
 * refund, which takes the pass's time back.
 *
 * The price comes from credit_settings, never from the page. In PayPal's test
 * mode (credit_settings.pay_mode = sandbox) only the site's owner may buy.
 *
 * POST {action: "create", plan, returnTo}   signed in → {url, purchase}
 * POST {action: "capture", purchase}        signed in → {status, plan?, until?}
 * POST {action: "cancel", purchase}         signed in → {ok}
 * POST …/pay/webhook?mode=live|sandbox      PayPal's notices, checked with PayPal
 *
 * Settings (function secrets, or private.stt_settings from the admin area):
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID
 *       the app's live keys and live webhook (developer.paypal.com)
 *   PAYPAL_SANDBOX_CLIENT_ID, PAYPAL_SANDBOX_CLIENT_SECRET, PAYPAL_SANDBOX_WEBHOOK_ID
 *       the same for the sandbox
 *   SITE_URL   where PayPal sends the payer back (default: the GitHub Pages address)
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { CORS, adminClient, isOwner, json, settings, visitor } from "../_shared/common.ts";
import {
  PAYPAL_KEYS,
  PayPalError,
  isPayPalMode,
  paypal,
  readCapture,
  refundedCapture,
  type CaptureInfo,
  type PayPalClient,
  type PayPalMode,
} from "../_shared/paypal.ts";

const SITE = "https://shmuel-lamed.github.io/SongToNotes/";
const BRAND = "כלי מוזיקה";
const DESCRIPTIONS: Record<string, string> = {
  week: "חופשי שבועי — כל הכלים בלי הגבלה ל־7 ימים",
  month: "חופשי חודשי — כל הכלים בלי הגבלה ל־30 יום",
};

type Row = Record<string, unknown>;

type Purchase = {
  id: string;
  user_id: string | null;
  mode: PayPalMode;
  plan: string;
  status: string;
  order_id: string | null;
  capture_id: string | null;
  pass_until: string | null;
};

type Get = Awaited<ReturnType<typeof settings>>;

/** A PayPal client for the mode, or null when its keys are not set. */
function clientFor(get: Get, mode: PayPalMode): PayPalClient | null {
  const keys = PAYPAL_KEYS[mode];
  const clientId = get(keys.id);
  const secret = get(keys.secret);
  return clientId && secret ? paypal({ clientId, secret, mode }) : null;
}

/**
 * Where PayPal sends the payer back: the page's own address when it is the
 * site (or a copy running on this computer), the site otherwise — an order
 * never sends anybody to an address somebody else chose.
 */
function returnBase(get: Get, requested: unknown) {
  const site = get("SITE_URL") || SITE;
  if (typeof requested !== "string" || !requested) return site;
  try {
    const url = new URL(requested);
    const known = new URL(site);
    const local = (url.hostname === "localhost" || url.hostname === "127.0.0.1") && /^https?:$/.test(url.protocol);
    if (url.origin !== known.origin && !local) return site;
    return `${url.origin}${url.pathname}`;
  } catch {
    return site;
  }
}

function withQuery(base: string, query: Record<string, string>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

async function purchaseById(admin: SupabaseClient, id: string) {
  const { data } = await admin.from("credit_purchases").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as Purchase | null;
}

async function purchaseByOrder(admin: SupabaseClient, orderId: string) {
  const { data } = await admin.from("credit_purchases").select("*").eq("order_id", orderId).maybeSingle();
  return (data ?? null) as Purchase | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The purchase a PayPal resource is about: by our id (custom_id), else by its order. */
async function purchaseFor(admin: SupabaseClient, info: CaptureInfo) {
  if (info.customId && UUID.test(info.customId)) {
    const found = await purchaseById(admin, info.customId);
    if (found) return found;
  }
  return info.orderId ? await purchaseByOrder(admin, info.orderId) : null;
}

/** What a capture means for the purchase: the pass, a wait, or a no. */
async function settle(admin: SupabaseClient, purchase: Purchase, capture: CaptureInfo) {
  const status = (capture.captureStatus ?? "").toUpperCase();
  if (status === "COMPLETED") {
    const { data, error } = await admin.rpc("credit_purchase_complete", {
      p_purchase: purchase.id,
      p_capture: capture.captureId,
      p_amount: capture.amount,
      p_currency: capture.currency,
      p_detail: { order: capture.orderId ?? purchase.order_id },
    });
    if (error) throw error;
    const row = (data ?? {}) as Row;
    if (row.ok !== true) {
      console.error("purchase not completed", purchase.id, row);
      return { status: typeof row.status === "string" ? row.status : "failed", reason: row.reason ?? null };
    }
    return { status: "completed", plan: row.plan ?? purchase.plan, until: row.until ?? null };
  }
  if (status === "PENDING") {
    await admin.rpc("credit_purchase_mark", { p_purchase: purchase.id, p_status: "pending", p_detail: { capture: capture.captureId } });
    return { status: "pending" };
  }
  if (status === "DECLINED" || status === "FAILED") {
    await admin.rpc("credit_purchase_mark", { p_purchase: purchase.id, p_status: "failed", p_detail: { capture: capture.captureId, paypal: status } });
    return { status: "failed", reason: "declined" };
  }
  return { status: status ? status.toLowerCase() : "unknown" };
}

/* ------------------------------------------------------------ the page */

async function create(admin: SupabaseClient, get: Get, req: Request, body: Row) {
  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  const { data: config } = await admin.from("credit_settings").select("pay_enabled, pay_mode").maybeSingle();
  if (!config?.pay_enabled) return json(409, { error: "off" });
  const mode: PayPalMode = isPayPalMode(config.pay_mode) ? config.pay_mode : "sandbox";
  const client = clientFor(get, mode);
  if (!client) return json(503, { error: "not_configured" });

  const { data: started, error } = await admin.rpc("credit_purchase_start", {
    p_user: user.id,
    p_plan: typeof body.plan === "string" ? body.plan : "",
    p_owner: isOwner(user),
  });
  if (error) throw error;
  const purchase = (started ?? {}) as Row;
  if (purchase.ok !== true) return json(409, { error: String(purchase.reason ?? "off") });

  const id = String(purchase.id);
  const base = returnBase(get, body.returnTo);
  try {
    const order = await client.createOrder({
      purchaseId: id,
      amount: Number(purchase.amount),
      currency: String(purchase.currency),
      description: DESCRIPTIONS[String(purchase.plan)] ?? BRAND,
      returnUrl: withQuery(base, { pay: "return", purchase: id }),
      cancelUrl: withQuery(base, { pay: "cancel", purchase: id }),
      brand: BRAND,
      locale: "he-IL",
    });
    // Without the order on record the payment could not be matched later:
    // better not to send the payer at all.
    const { error: unsaved } = await admin.rpc("credit_purchase_order", { p_purchase: id, p_order: order.id });
    if (unsaved) throw unsaved;
    return json(200, { url: order.url, purchase: id });
  } catch (failure) {
    const issue = failure instanceof PayPalError ? failure.issue : null;
    console.error("paypal order failed", id, failure);
    await admin.rpc("credit_purchase_mark", { p_purchase: id, p_status: "failed", p_detail: { order_error: issue ?? "network" } });
    // Keys PayPal refuses are the owner's to fix; anything else is worth a retry.
    return json(502, { error: failure instanceof PayPalError && failure.status === 401 ? "keys" : "paypal" });
  }
}

async function capture(admin: SupabaseClient, get: Get, req: Request, body: Row) {
  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });
  const id = typeof body.purchase === "string" && UUID.test(body.purchase) ? body.purchase : "";
  const purchase = id ? await purchaseById(admin, id) : null;
  if (!purchase || purchase.user_id !== user.id) return json(404, { error: "unknown" });

  if (purchase.status === "completed") {
    return json(200, { status: "completed", plan: purchase.plan, until: purchase.pass_until });
  }
  if (["refunded", "failed", "canceled"].includes(purchase.status)) return json(200, { status: purchase.status });
  if (!purchase.order_id) return json(409, { error: "no_order" });

  const client = clientFor(get, purchase.mode);
  if (!client) return json(503, { error: "not_configured" });
  try {
    const result = await settle(admin, purchase, await client.captureOrder(purchase.order_id));
    return json(200, result);
  } catch (failure) {
    if (failure instanceof PayPalError) {
      if (failure.issue === "ORDER_NOT_APPROVED" || failure.issue === "PAYER_ACTION_REQUIRED") {
        return json(200, { status: "not_approved" });
      }
      if (failure.issue === "INSTRUMENT_DECLINED" || failure.issue === "TRANSACTION_REFUSED") {
        await admin.rpc("credit_purchase_mark", { p_purchase: purchase.id, p_status: "failed", p_detail: { paypal: failure.issue } });
        return json(200, { status: "failed", reason: "declined" });
      }
      if (failure.status === 404) {
        await admin.rpc("credit_purchase_mark", { p_purchase: purchase.id, p_status: "failed", p_detail: { paypal: "order_gone" } });
        return json(200, { status: "failed", reason: "expired" });
      }
    }
    console.error("paypal capture failed", purchase.id, failure);
    return json(502, { error: "paypal" });
  }
}

async function cancel(admin: SupabaseClient, req: Request, body: Row) {
  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });
  const id = typeof body.purchase === "string" && UUID.test(body.purchase) ? body.purchase : "";
  const purchase = id ? await purchaseById(admin, id) : null;
  if (!purchase || purchase.user_id !== user.id) return json(404, { error: "unknown" });
  // Only a checkout that was never paid; anything further stays as it is.
  if (purchase.status === "created" || purchase.status === "approved") {
    await admin.rpc("credit_purchase_mark", { p_purchase: purchase.id, p_status: "canceled", p_detail: {} });
  }
  return json(200, { ok: true });
}

/* ------------------------------------------------------------ PayPal */

async function webhook(admin: SupabaseClient, get: Get, req: Request, url: URL) {
  const mode: PayPalMode = url.searchParams.get("mode") === "sandbox" ? "sandbox" : "live";
  const client = clientFor(get, mode);
  const webhookId = get(PAYPAL_KEYS[mode].webhook);
  // Without them nothing can be checked: PayPal will send the notice again later.
  if (!client || !webhookId) return json(503, { error: "not_configured" });

  let event: Row;
  try {
    event = (await req.json()) as Row;
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (!(await client.verifyWebhook(req.headers, event, webhookId))) {
    console.warn("paypal webhook not verified", event.id);
    return json(400, { error: "unverified" });
  }

  const type = String(event.event_type ?? "");
  const resource = (event.resource ?? {}) as Row;
  try {
    if (type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") {
      const captureId = refundedCapture(resource) ?? readCapture(resource).captureId;
      if (captureId) {
        const { data } = await admin.rpc("credit_purchase_refund", {
          p_purchase: null,
          p_capture: captureId,
          p_detail: { refund: resource.id ?? null, event: type },
        });
        console.log("paypal refund", captureId, data);
      }
      return json(200, { ok: true });
    }

    const info = readCapture(resource);
    const purchase = await purchaseFor(admin, info);
    // Not ours (another site on the same PayPal account), or not this mode's.
    if (!purchase || purchase.mode !== mode) return json(200, { ok: true, ignored: true });

    if (type === "CHECKOUT.ORDER.APPROVED") {
      if (purchase.status === "completed" || !purchase.order_id) return json(200, { ok: true });
      await admin.rpc("credit_purchase_mark", { p_purchase: purchase.id, p_status: "approved", p_detail: {} });
      // The payer said yes: take the money even if they never come back to the page.
      const result = await settle(admin, purchase, await client.captureOrder(purchase.order_id));
      return json(200, { ok: true, ...result });
    }
    if (type === "PAYMENT.CAPTURE.COMPLETED" || type === "PAYMENT.CAPTURE.PENDING" || type === "PAYMENT.CAPTURE.DENIED" || type === "PAYMENT.CAPTURE.DECLINED") {
      const result = await settle(admin, purchase, {
        ...info,
        captureStatus: type === "PAYMENT.CAPTURE.DENIED" ? "DECLINED" : info.captureStatus,
      });
      return json(200, { ok: true, ...result });
    }
    return json(200, { ok: true, ignored: true });
  } catch (failure) {
    // An error answer makes PayPal try again later, which is what is wanted.
    console.error("paypal webhook failed", type, failure);
    return json(500, { error: "retry" });
  }
}

/* ------------------------------------------------------------ the door */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const admin = adminClient();
  const get = await settings(admin);
  const url = new URL(req.url);

  if (url.pathname.replace(/\/+$/, "").endsWith("/webhook")) return await webhook(admin, get, req, url);

  let body: Row;
  try {
    body = (await req.json()) as Row;
  } catch {
    return json(400, { error: "bad_request" });
  }
  try {
    switch (body.action) {
      case "create":
        return await create(admin, get, req, body);
      case "capture":
        return await capture(admin, get, req, body);
      case "cancel":
        return await cancel(admin, req, body);
      default:
        return json(400, { error: "bad_request" });
    }
  } catch (failure) {
    console.error("pay failed", body.action, failure);
    return json(502, { error: "storage" });
  }
});
