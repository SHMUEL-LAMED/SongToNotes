/**
 * The server's PayPal client (supabase/functions/_shared/paypal.ts), run with
 * the site's tests against a fetch that plays PayPal.
 */
import { describe, expect, it } from "vitest";
import {
  PayPalError,
  approveLink,
  formatAmount,
  issueOf,
  paypal,
  readCapture,
  refundedCapture,
} from "../../supabase/functions/_shared/paypal";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A PayPal that answers from `routes` and remembers what it was asked. */
function fakePayPal(routes: Record<string, (call: Call) => { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    let body: unknown = init?.body;
    if (typeof body === "string" && headers["Content-Type"] === "application/json") body = JSON.parse(body);
    const call = { url, method, headers, body };
    calls.push(call);
    const path = new URL(url).pathname;
    const route = routes[`${method} ${path}`];
    const reply = route ? route(call) : { status: 404, body: { name: "RESOURCE_NOT_FOUND" } };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetcher };
}

const TOKEN = { "POST /v1/oauth2/token": () => ({ status: 200, body: { access_token: "token-1", expires_in: 32400 } }) };

const ORDER = {
  id: "ORDER-1",
  status: "COMPLETED",
  purchase_units: [
    {
      reference_id: "p-1",
      custom_id: "3f2a9c1e-0000-4000-8000-000000000001",
      amount: { currency_code: "ILS", value: "10.00" },
      payments: {
        captures: [
          {
            id: "CAPTURE-1",
            status: "COMPLETED",
            custom_id: "3f2a9c1e-0000-4000-8000-000000000001",
            amount: { currency_code: "ILS", value: "10.00" },
          },
        ],
      },
    },
  ],
};

describe("paypal helpers", () => {
  it("writes sums the way PayPal wants them", () => {
    expect(formatAmount(10, "ILS")).toBe("10.00");
    expect(formatAmount(29.9, "USD")).toBe("29.90");
    expect(formatAmount(1000.4, "JPY")).toBe("1000");
  });

  it("finds where the payer approves", () => {
    expect(approveLink({ links: [{ rel: "self", href: "a" }, { rel: "payer-action", href: "https://paypal/checkout" }] })).toBe(
      "https://paypal/checkout",
    );
    expect(approveLink({ links: [{ rel: "approve", href: "https://paypal/approve" }] })).toBe("https://paypal/approve");
    expect(approveLink({})).toBeNull();
  });

  it("reads the issue PayPal names", () => {
    expect(issueOf({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] })).toBe("INSTRUMENT_DECLINED");
    expect(issueOf({ name: "RESOURCE_NOT_FOUND" })).toBe("RESOURCE_NOT_FOUND");
    expect(issueOf({ error: "invalid_client" })).toBe("invalid_client");
    expect(issueOf(null)).toBeNull();
  });

  it("reads the money out of a captured order", () => {
    expect(readCapture(ORDER)).toEqual({
      orderId: "ORDER-1",
      orderStatus: "COMPLETED",
      captureId: "CAPTURE-1",
      captureStatus: "COMPLETED",
      amount: 10,
      currency: "ILS",
      customId: "3f2a9c1e-0000-4000-8000-000000000001",
    });
  });

  it("reads a capture as a webhook sends it, with its order", () => {
    const capture = {
      id: "CAPTURE-2",
      status: "PENDING",
      custom_id: "p-2",
      amount: { currency_code: "ILS", value: "30.00" },
      supplementary_data: { related_ids: { order_id: "ORDER-2" } },
    };
    expect(readCapture(capture)).toMatchObject({ orderId: "ORDER-2", captureId: "CAPTURE-2", captureStatus: "PENDING", amount: 30, customId: "p-2" });
  });

  it("reads an approved order that has no capture yet", () => {
    const order = { id: "ORDER-3", status: "APPROVED", purchase_units: [{ custom_id: "p-3", amount: { currency_code: "ILS", value: "30.00" } }] };
    expect(readCapture(order)).toMatchObject({ orderId: "ORDER-3", orderStatus: "APPROVED", captureId: null, amount: 30, customId: "p-3" });
  });

  it("finds the capture a refund returned money from", () => {
    const refund = {
      id: "REFUND-1",
      links: [
        { rel: "self", href: "https://api-m.paypal.com/v2/payments/refunds/REFUND-1" },
        { rel: "up", href: "https://api-m.paypal.com/v2/payments/captures/CAPTURE-9" },
      ],
    };
    expect(refundedCapture(refund)).toBe("CAPTURE-9");
    expect(refundedCapture({ links: [] })).toBeNull();
  });
});

describe("paypal client", () => {
  it("asks for an order with the price, our id and the way back", async () => {
    const { calls, fetcher } = fakePayPal({
      ...TOKEN,
      "POST /v2/checkout/orders": () => ({
        status: 200,
        body: { id: "ORDER-7", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-7" }] },
      }),
    });
    const client = paypal({ clientId: "order-test", secret: "s", mode: "sandbox", fetch: fetcher });
    const order = await client.createOrder({
      purchaseId: "p-7",
      amount: 10,
      currency: "ILS",
      description: "חופשי שבועי",
      returnUrl: "https://site/?pay=return&purchase=p-7",
      cancelUrl: "https://site/?pay=cancel&purchase=p-7",
      brand: "כלי מוזיקה",
      locale: "he-IL",
    });
    expect(order).toEqual({ id: "ORDER-7", url: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-7" });

    const [auth, create] = calls;
    expect(auth.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(auth.headers.Authorization).toBe(`Basic ${btoa("order-test:s")}`);
    expect(create.headers.Authorization).toBe("Bearer token-1");
    expect(create.headers["PayPal-Request-Id"]).toBe("order-p-7");
    expect(create.body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [{ custom_id: "p-7", invoice_id: "p-7", amount: { currency_code: "ILS", value: "10.00" } }],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: "https://site/?pay=return&purchase=p-7",
            cancel_url: "https://site/?pay=cancel&purchase=p-7",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            locale: "he-IL",
          },
        },
      },
    });
  });

  it("asks for a token once and keeps it", async () => {
    const { calls, fetcher } = fakePayPal({
      ...TOKEN,
      "GET /v2/checkout/orders/ORDER-1": () => ({ status: 200, body: ORDER }),
    });
    const client = paypal({ clientId: "token-reuse", secret: "s", mode: "live", fetch: fetcher });
    await client.getOrder("ORDER-1");
    await client.getOrder("ORDER-1");
    expect(calls.filter((call) => call.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    expect(calls[1].url).toBe("https://api-m.paypal.com/v2/checkout/orders/ORDER-1");
  });

  it("captures an approved order", async () => {
    const { calls, fetcher } = fakePayPal({
      ...TOKEN,
      "POST /v2/checkout/orders/ORDER-1/capture": () => ({ status: 201, body: ORDER }),
    });
    const client = paypal({ clientId: "capture", secret: "s", mode: "live", fetch: fetcher });
    await expect(client.captureOrder("ORDER-1")).resolves.toMatchObject({ captureId: "CAPTURE-1", captureStatus: "COMPLETED", amount: 10, currency: "ILS" });
    expect(calls[1].headers["PayPal-Request-Id"]).toBe("capture-ORDER-1");
  });

  it("reads back an order that was captured already", async () => {
    const { fetcher } = fakePayPal({
      ...TOKEN,
      "POST /v2/checkout/orders/ORDER-1/capture": () => ({
        status: 422,
        body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] },
      }),
      "GET /v2/checkout/orders/ORDER-1": () => ({ status: 200, body: ORDER }),
    });
    const client = paypal({ clientId: "captured", secret: "s", mode: "live", fetch: fetcher });
    await expect(client.captureOrder("ORDER-1")).resolves.toMatchObject({ captureId: "CAPTURE-1", captureStatus: "COMPLETED" });
  });

  it("says why a capture was refused", async () => {
    const { fetcher } = fakePayPal({
      ...TOKEN,
      "POST /v2/checkout/orders/ORDER-1/capture": () => ({
        status: 422,
        body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] },
      }),
    });
    const client = paypal({ clientId: "declined", secret: "s", mode: "live", fetch: fetcher });
    const failure = await client.captureOrder("ORDER-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PayPalError);
    expect(failure).toMatchObject({ status: 422, issue: "INSTRUMENT_DECLINED" });
  });

  it("refuses keys PayPal does not know", async () => {
    const { fetcher } = fakePayPal({
      "POST /v1/oauth2/token": () => ({ status: 401, body: { error: "invalid_client" } }),
    });
    const client = paypal({ clientId: "bad", secret: "s", mode: "live", fetch: fetcher });
    await expect(client.check()).rejects.toMatchObject({ status: 401, issue: "invalid_client" });
  });

  it("checks a webhook notice with PayPal", async () => {
    const { calls, fetcher } = fakePayPal({
      ...TOKEN,
      "POST /v1/notifications/verify-webhook-signature": (call) => ({
        status: 200,
        body: { verification_status: (call.body as { webhook_id: string }).webhook_id === "WH-1" ? "SUCCESS" : "FAILURE" },
      }),
    });
    const client = paypal({ clientId: "webhook", secret: "s", mode: "live", fetch: fetcher });
    const headers = new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/CERT",
      "paypal-transmission-id": "T-1",
      "paypal-transmission-sig": "SIG",
      "paypal-transmission-time": "2026-09-25T10:00:00Z",
    });
    const event = { id: "WH-EVENT", event_type: "PAYMENT.CAPTURE.COMPLETED" };
    await expect(client.verifyWebhook(headers, event, "WH-1")).resolves.toBe(true);
    await expect(client.verifyWebhook(headers, event, "WH-OTHER")).resolves.toBe(false);
    expect(calls.at(-1)?.body).toMatchObject({ transmission_id: "T-1", transmission_sig: "SIG", webhook_event: event });
    // A notice without PayPal's headers is not even sent to be checked.
    await expect(client.verifyWebhook(new Headers(), event, "WH-1")).resolves.toBe(false);
  });
});
