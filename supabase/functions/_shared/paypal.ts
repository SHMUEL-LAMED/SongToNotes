/**
 * PayPal's REST API — the little of it a pass needs: an order for the price,
 * its capture once the payer has approved it, a look at an order, and the
 * check that a webhook notice really came from PayPal.
 *
 * https://developer.paypal.com/docs/api/orders/v2/
 * https://developer.paypal.com/api/rest/webhooks/rest/
 *
 * Nothing here imports anything, so the site's tests run it as it is
 * (src/lib/paypal.test.ts), with a fetch that plays PayPal.
 */

export type PayPalMode = "sandbox" | "live";

export const PAYPAL_API: Record<PayPalMode, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

/**
 * The settings each mode takes its keys from. A PayPal app has one pair of
 * keys for its sandbox and another for real payments, and a webhook of each
 * kind has its own id, so both can be set and the mode switched in one click.
 */
export const PAYPAL_KEYS: Record<PayPalMode, { id: string; secret: string; webhook: string }> = {
  sandbox: { id: "PAYPAL_SANDBOX_CLIENT_ID", secret: "PAYPAL_SANDBOX_CLIENT_SECRET", webhook: "PAYPAL_SANDBOX_WEBHOOK_ID" },
  live: { id: "PAYPAL_CLIENT_ID", secret: "PAYPAL_CLIENT_SECRET", webhook: "PAYPAL_WEBHOOK_ID" },
};

export function isPayPalMode(value: unknown): value is PayPalMode {
  return value === "sandbox" || value === "live";
}

export type PayPalConfig = {
  clientId: string;
  secret: string;
  mode: PayPalMode;
  /** For the tests; the real fetch otherwise. */
  fetch?: typeof fetch;
};

type Json = Record<string, unknown>;

/** A reply PayPal did not like, with the issue it named (INSTRUMENT_DECLINED…). */
export class PayPalError extends Error {
  status: number;
  issue: string | null;
  constructor(status: number, issue: string | null, message?: string) {
    super(message ?? `PayPal ${status}${issue ? ` ${issue}` : ""}`);
    this.name = "PayPalError";
    this.status = status;
    this.issue = issue;
  }
}

/** The first issue a PayPal error names, or its name. */
export function issueOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Json;
  const details = Array.isArray(row.details) ? (row.details as Json[]) : [];
  const issue = details.find((item) => typeof item?.issue === "string")?.issue;
  if (typeof issue === "string") return issue;
  if (typeof row.name === "string") return row.name;
  if (typeof row.error === "string") return row.error;
  return null;
}

/** Currencies PayPal counts in whole units. */
const WHOLE_UNITS = new Set(["HUF", "JPY", "TWD"]);

/** The sum as PayPal wants it written: "10.00". */
export function formatAmount(amount: number, currency: string) {
  return WHOLE_UNITS.has(currency.toUpperCase()) ? String(Math.round(amount)) : amount.toFixed(2);
}

/** Where the payer approves the order. */
export function approveLink(order: unknown): string | null {
  const links = order && typeof order === "object" && Array.isArray((order as Json).links) ? ((order as Json).links as Json[]) : [];
  const link = links.find((item) => item?.rel === "payer-action") ?? links.find((item) => item?.rel === "approve");
  return typeof link?.href === "string" ? link.href : null;
}

export type CaptureInfo = {
  orderId: string | null;
  orderStatus: string | null;
  captureId: string | null;
  /** COMPLETED, PENDING, DECLINED… */
  captureStatus: string | null;
  amount: number | null;
  currency: string | null;
  /** Our purchase id, which the order carried as custom_id. */
  customId: string | null;
};

/** What an order (or a capture, as a webhook sends it) says about the money. */
export function readCapture(resource: unknown): CaptureInfo {
  const row = (resource && typeof resource === "object" ? resource : {}) as Json;
  const units = Array.isArray(row.purchase_units) ? (row.purchase_units as Json[]) : [];
  const unit = units[0] ?? {};
  const payments = (unit.payments && typeof unit.payments === "object" ? unit.payments : {}) as Json;
  const captures = Array.isArray(payments.captures) ? (payments.captures as Json[]) : [];
  // An order holds its captures; a capture is its own resource.
  const isCapture = !units.length && typeof row.id === "string" && row.amount !== undefined;
  const capture = isCapture ? row : captures[0] ?? null;
  const money = (capture?.amount ?? unit.amount ?? null) as Json | null;
  const value = Number(money?.value);
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  // A capture names its order among its related ids.
  const related = ((row.supplementary_data as Json | undefined)?.related_ids ?? {}) as Json;
  return {
    orderId: isCapture ? text(related.order_id) : text(row.id),
    orderStatus: isCapture ? null : text(row.status),
    captureId: capture ? text(capture.id) : null,
    captureStatus: capture ? text(capture.status) : null,
    amount: Number.isFinite(value) ? value : null,
    currency: text(money?.currency_code),
    customId: text(capture?.custom_id) ?? text(unit.custom_id),
  };
}

/** The capture a refund (as a webhook sends it) gave money back from. */
export function refundedCapture(resource: unknown): string | null {
  const links = resource && typeof resource === "object" && Array.isArray((resource as Json).links) ? ((resource as Json).links as Json[]) : [];
  for (const link of links) {
    const href = typeof link?.href === "string" ? link.href : "";
    const match = link?.rel === "up" ? href.match(/\/captures\/([^/?#]+)/) : null;
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

export type OrderInput = {
  /** Our purchase id: PayPal's idempotency key, and the order's custom_id and invoice_id. */
  purchaseId: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  brand?: string;
  locale?: string;
};

/** Access tokens by account, reused until shortly before they expire. */
const tokens = new Map<string, { value: string; expires: number }>();

export function paypal(config: PayPalConfig) {
  const base = PAYPAL_API[config.mode];
  const send = config.fetch ?? fetch;
  const account = `${config.mode}:${config.clientId}`;

  async function token(): Promise<string> {
    const cached = tokens.get(account);
    if (cached && cached.expires > Date.now() + 60_000) return cached.value;
    const response = await send(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${config.clientId}:${config.secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok || typeof data.access_token !== "string") {
      throw new PayPalError(response.status, issueOf(data) ?? "auth", "PayPal refused the keys");
    }
    const seconds = Number(data.expires_in);
    tokens.set(account, { value: data.access_token, expires: Date.now() + (Number.isFinite(seconds) ? seconds : 300) * 1000 });
    return data.access_token;
  }

  async function call(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await send(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => ({}))) as Json;
    // A token PayPal no longer takes is not reused.
    if (response.status === 401) tokens.delete(account);
    return { status: response.status, ok: response.ok, data };
  }

  async function getOrder(orderId: string): Promise<CaptureInfo> {
    const reply = await call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    if (!reply.ok) throw new PayPalError(reply.status, issueOf(reply.data));
    return readCapture(reply.data);
  }

  return {
    getOrder,

    /** The keys work: PayPal hands out a token for them. */
    async check() {
      tokens.delete(account);
      await token();
      return true;
    },

    /** An order for the pass. Returns its id and where the payer approves it. */
    async createOrder(input: OrderInput) {
      const reply = await call(
        "POST",
        "/v2/checkout/orders",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: input.purchaseId,
              custom_id: input.purchaseId,
              invoice_id: input.purchaseId,
              description: input.description.slice(0, 127),
              amount: { currency_code: input.currency, value: formatAmount(input.amount, input.currency) },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: (input.brand ?? "").slice(0, 127) || undefined,
                locale: input.locale,
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                landing_page: "NO_PREFERENCE",
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
              },
            },
          },
        },
        { "PayPal-Request-Id": `order-${input.purchaseId}`, Prefer: "return=representation" },
      );
      if (!reply.ok) throw new PayPalError(reply.status, issueOf(reply.data));
      const id = typeof reply.data.id === "string" ? reply.data.id : null;
      const url = approveLink(reply.data);
      if (!id || !url) throw new PayPalError(reply.status, "no_approval_link");
      return { id, url };
    },

    /**
     * Takes the money of an approved order. An order captured before (the
     * page and the webhook racing) is read back instead, so the caller sees
     * the same completed capture either way.
     */
    async captureOrder(orderId: string): Promise<CaptureInfo> {
      const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
      const reply = await call("POST", `${path}/capture`, {}, {
        "PayPal-Request-Id": `capture-${orderId}`,
        Prefer: "return=representation",
      });
      if (reply.ok) return readCapture(reply.data);
      const issue = issueOf(reply.data);
      if (issue === "ORDER_ALREADY_CAPTURED") return getOrder(orderId);
      throw new PayPalError(reply.status, issue);
    },

    /** PayPal's own answer to "did this notice come from you?". */
    async verifyWebhook(headers: Headers, event: unknown, webhookId: string) {
      const header = (name: string) => headers.get(name) ?? "";
      if (!header("paypal-transmission-id") || !header("paypal-transmission-sig")) return false;
      const reply = await call("POST", "/v1/notifications/verify-webhook-signature", {
        auth_algo: header("paypal-auth-algo"),
        cert_url: header("paypal-cert-url"),
        transmission_id: header("paypal-transmission-id"),
        transmission_sig: header("paypal-transmission-sig"),
        transmission_time: header("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      });
      return reply.ok && reply.data.verification_status === "SUCCESS";
    },
  };
}

export type PayPalClient = ReturnType<typeof paypal>;
