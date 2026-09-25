import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RULES,
  entryLabel,
  formatMoney,
  monthSaving,
  normalizeRules,
  normalizeStatus,
  parsePulse,
  passActive,
  passDaysLeft,
  passesOnSale,
} from "./credits";
import { clearPaymentReturn, isPayPalCheckout, readPaymentReturn, takePaymentReturn } from "./payments";

const PURCHASE = "3f2a9c1e-0000-4000-8000-000000000001";

describe("the pass rules", () => {
  it("starts closed, with the prices the database starts with", () => {
    expect(DEFAULT_RULES.pay).toEqual({ enabled: false, mode: "sandbox", currency: "ILS", week: 10, month: 30, passDaily: 200 });
    expect(normalizeRules({}).pay).toEqual(DEFAULT_RULES.pay);
  });

  it("reads the settings row", () => {
    const rules = normalizeRules({
      pay_enabled: true,
      pay_mode: "live",
      pay_currency: "usd",
      pass_week_price: "9.90",
      pass_month_price: 29.5,
      pass_daily: 300,
    });
    expect(rules.pay).toEqual({ enabled: true, mode: "live", currency: "USD", week: 9.9, month: 29.5, passDaily: 300 });
  });

  it("keeps nonsense out", () => {
    const rules = normalizeRules({ pay_mode: "free", pay_currency: "shekel", pass_week_price: -4, pass_daily: 0 });
    expect(rules.pay.mode).toBe("sandbox");
    expect(rules.pay.currency).toBe("ILS");
    expect(rules.pay.week).toBe(10);
    expect(rules.pay.passDaily).toBe(1);
  });

  it("sells to everybody only for real money; in test mode to the owner alone", () => {
    const live = normalizeRules({ pay_enabled: true, pay_mode: "live" });
    const test = normalizeRules({ pay_enabled: true, pay_mode: "sandbox" });
    expect(passesOnSale(live, false)).toBe(true);
    expect(passesOnSale(test, false)).toBe(false);
    expect(passesOnSale(test, true)).toBe(true);
    expect(passesOnSale(normalizeRules({ pay_enabled: false, pay_mode: "live" }), true)).toBe(false);
    expect(passesOnSale(normalizeRules({ enabled: false, pay_enabled: true, pay_mode: "live" }), true)).toBe(false);
  });

  it("says how much the month saves over weeks", () => {
    expect(monthSaving({ week: 10, month: 30 })).toBe(30);
    expect(monthSaving({ week: 10, month: 43 })).toBe(0);
    expect(monthSaving({ week: 0, month: 30 })).toBe(0);
  });

  it("writes prices in shekels, whole when whole", () => {
    // Hebrew puts direction marks around the parts; what is read is "10 ₪".
    expect(formatMoney(10, "ILS").replace(/[\u200e\u200f]/g, "")).toMatch(/^10\s₪$/);
    expect(formatMoney(9.9, "ILS")).toMatch(/9\.90/);
    expect(formatMoney(5, "XYZ1")).toBe("5 XYZ1");
  });
});

describe("the pass on the account", () => {
  const status = (extra: Record<string, unknown>) =>
    normalizeStatus({ code: "abcd2345", allowance: 20, daily_left: 20, bonus: 0, history: [], ...extra });

  it("reads a running pass, its fair use and the purchases", () => {
    const read = status({
      pass_until: "2026-10-02T10:00:00Z",
      pass_plan: "week",
      pass_daily: 200,
      pass_left: 150,
      pass_used_today: 50,
      purchases: [
        { id: "p1", at: "2026-09-25T10:00:00Z", plan: "week", days: 7, amount: "10.00", currency: "ILS", status: "completed", mode: "live", until: "2026-10-02T10:00:00Z" },
        { id: "p2", at: "2026-09-25T09:00:00Z", plan: "month", days: 30, amount: 30, currency: "ILS", status: "created", mode: "live" },
      ],
    });
    expect(read?.pass).toEqual({ until: "2026-10-02T10:00:00Z", plan: "week", daily: 200, left: 150, usedToday: 50 });
    // A checkout that never got paid is not a purchase.
    expect(read?.purchases).toHaveLength(1);
    expect(read?.purchases[0]).toMatchObject({ plan: "week", amount: 10, status: "completed", mode: "live" });
  });

  it("has no pass when the account never bought one", () => {
    expect(status({})?.pass).toBeNull();
    expect(status({})?.purchases).toEqual([]);
  });

  it("knows when a pass is running and how many days it has left", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(passActive({ until: "2026-10-02T12:00:00Z" }, now)).toBe(true);
    expect(passActive({ until: "2026-09-25T11:59:59Z" }, now)).toBe(false);
    expect(passActive(null, now)).toBe(false);
    expect(passDaysLeft({ until: "2026-10-02T12:00:00Z" }, now)).toBe(7);
    expect(passDaysLeft({ until: "2026-09-26T01:00:00Z" }, now)).toBe(1);
  });

  it("hears the pass in a server reply", () => {
    expect(parsePulse({ left: 20, daily: 20, bonus: 0, allowance: 20, charged: 0, passUntil: "2026-10-02T10:00:00Z", passLeft: 140 })).toMatchObject({
      passUntil: "2026-10-02T10:00:00Z",
      passLeft: 140,
    });
    expect(parsePulse({ left: 20, daily: 20, bonus: 0, allowance: 20, charged: 1 })).not.toHaveProperty("passUntil");
  });

  it("names a purchase in the history", () => {
    expect(entryLabel({ kind: "purchase", action: "month", detail: {} })).toBe("קנית חופשי חודשי");
    expect(entryLabel({ kind: "purchase", action: "week", detail: { refunded: true } })).toBe("התשלום על חופשי שבועי הוחזר");
  });

  it("reads what a pass covered of an action", () => {
    const read = status({ history: [{ id: 1, at: "2026-09-25T10:00:00Z", kind: "spend", action: "transcript", delta: 0, from_pass: 6, detail: {} }] });
    expect(read?.history[0]).toMatchObject({ delta: 0, fromPass: 6 });
  });
});

describe("back from PayPal", () => {
  const values = new Map<string, string>();
  let address = "";
  const replaced: string[] = [];

  beforeEach(() => {
    values.clear();
    replaced.length = 0;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
    vi.stubGlobal("window", {
      localStorage: globalThis.localStorage,
      get location() {
        return { href: address };
      },
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: string) => void replaced.push(url),
      },
    });
    clearPaymentReturn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the purchase out of the address and opens the credits page", () => {
    address = `https://shmuel-lamed.github.io/SongToNotes/?pay=return&purchase=${PURCHASE}&token=5O190127TN364715T&PayerID=QYR5Z8XDVJNXQ`;
    expect(takePaymentReturn()).toMatchObject({ purchase: PURCHASE, kind: "return" });
    expect(replaced).toEqual(["/SongToNotes/#/credits"]);
    expect(readPaymentReturn()).toMatchObject({ purchase: PURCHASE, kind: "return" });
  });

  it("keeps the rest of the address", () => {
    address = `https://shmuel-lamed.github.io/SongToNotes/?lang=en&pay=cancel&purchase=${PURCHASE}&token=5O190127TN364715T`;
    expect(takePaymentReturn()).toMatchObject({ kind: "cancel" });
    expect(replaced).toEqual(["/SongToNotes/?lang=en#/credits"]);
  });

  it("leaves an ordinary address alone", () => {
    address = "https://shmuel-lamed.github.io/SongToNotes/#/tuner";
    expect(takePaymentReturn()).toBeNull();
    expect(replaced).toEqual([]);
  });

  it("ignores a purchase id that is not one", () => {
    address = "https://shmuel-lamed.github.io/SongToNotes/?pay=return&purchase=../../admin";
    expect(takePaymentReturn()).toBeNull();
    expect(readPaymentReturn()).toBeNull();
  });

  it("forgets a way back after a week", () => {
    address = `https://shmuel-lamed.github.io/SongToNotes/?pay=return&purchase=${PURCHASE}`;
    const taken = takePaymentReturn();
    expect(readPaymentReturn((taken?.at ?? 0) + 8 * 86_400_000)).toBeNull();
  });

  it("sends a payer to PayPal and nowhere else", () => {
    expect(isPayPalCheckout("https://www.paypal.com/checkoutnow?token=5O190127TN364715T")).toBe(true);
    expect(isPayPalCheckout("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T")).toBe(true);
    expect(isPayPalCheckout("http://www.paypal.com/checkoutnow")).toBe(false);
    expect(isPayPalCheckout("https://paypal.com.example.net/checkoutnow")).toBe(false);
    expect(isPayPalCheckout("https://evil.example/?paypal.com")).toBe(false);
    expect(isPayPalCheckout("not a url")).toBe(false);
  });
});
