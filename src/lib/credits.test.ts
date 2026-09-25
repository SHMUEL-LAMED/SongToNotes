import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minutesCrossed, textUnits, ttsUnits } from "../../supabase/functions/_shared/pricing";
import {
  DEFAULT_RULES,
  PENDING_DAYS,
  allowanceFor,
  balanceOf,
  cleanCode,
  codeFromInput,
  creditsLabel,
  entryLabel,
  friendsToFullBoost,
  minutesCost,
  normalizeRules,
  normalizeStatus,
  parsePulse,
  readPending,
  rememberReferral,
  clearPending,
  textCost,
  ttsCost,
  untilReset,
  updatePending,
  withReferral,
} from "./credits";

describe("the rules", () => {
  it("reads the settings row, filling anything missing from the defaults", () => {
    const rules = normalizeRules({ daily: 30, signup_bonus: 50, prices: { minute: 2 }, enabled: false });
    expect(rules.daily).toBe(30);
    expect(rules.signupBonus).toBe(50);
    expect(rules.enabled).toBe(false);
    expect(rules.prices.minute).toBe(2);
    expect(rules.prices.separate).toBe(DEFAULT_RULES.prices.separate);
    expect(rules.welcomeBonus).toBe(DEFAULT_RULES.welcomeBonus);
  });

  it("never lets a broken value through", () => {
    const rules = normalizeRules({ daily: "lots", friend_daily: -3, prices: "nope" });
    expect(rules.daily).toBe(DEFAULT_RULES.daily);
    expect(rules.friendDaily).toBe(DEFAULT_RULES.friendDaily);
    expect(rules.prices).toEqual(DEFAULT_RULES.prices);
    expect(normalizeRules(null)).toEqual(DEFAULT_RULES);
  });

  it("grows the daily allowance with friends, up to the ceiling", () => {
    const rules = { ...DEFAULT_RULES, daily: 20, friendDaily: 2, friendDailyMax: 40 };
    expect(allowanceFor(0, rules)).toBe(20);
    expect(allowanceFor(3, rules)).toBe(26);
    expect(allowanceFor(20, rules)).toBe(60);
    expect(allowanceFor(500, rules)).toBe(60);
    expect(friendsToFullBoost(3, rules)).toBe(17);
    expect(friendsToFullBoost(25, rules)).toBe(0);
    expect(friendsToFullBoost(3, { ...rules, friendDaily: 0 })).toBe(0);
  });
});

describe("estimates", () => {
  it("match what the server charges", () => {
    const rules = { ...DEFAULT_RULES, prices: { ...DEFAULT_RULES.prices, minute: 1, text: 2, tts: 1 } };
    for (const seconds of [1, 59, 60, 61, 240, 3600, 5401]) {
      expect(minutesCost(seconds, rules)).toBe(minutesCrossed(0, seconds) * rules.prices.minute);
    }
    for (const characters of [0, 1, 9_999, 10_000, 10_001, 200_000]) {
      expect(textCost(characters, rules)).toBe(textUnits(characters) * rules.prices.text);
    }
    for (const characters of [1, 999, 1000, 1001, 4000]) {
      expect(ttsCost(characters, rules)).toBe(ttsUnits(characters) * rules.prices.tts);
    }
  });

  it("pays for each minute of the day once, however the windows fall", () => {
    // Four windows of 4 minutes and a bit: charged by the day's total, not window by window.
    let heard = 0;
    let paid = 0;
    for (const seconds of [250, 250, 250, 250]) {
      paid += minutesCrossed(heard, seconds);
      heard += seconds;
    }
    expect(paid).toBe(Math.ceil(1000 / 60));
    expect(minutesCrossed(30, 20)).toBe(0);
  });
});

describe("the account", () => {
  const raw = {
    enabled: true,
    code: "pt8j974k",
    allowance: 22,
    daily_left: 12,
    spent_today: 10,
    bonus: 32,
    friends: 1,
    visits: 3,
    visits_rewarded_today: 2,
    earned: 32,
    referred: false,
    can_claim: false,
    resets_at: "2026-09-25T21:00:00+00:00",
    history: [
      { id: 9, at: "2026-09-25T02:56:24Z", kind: "refund", action: "assistant", delta: 1, detail: { entry: 5 }, refunded: false },
      { id: 6, at: "2026-09-25T02:50:00Z", kind: "spend", action: "text", delta: -2, detail: { job: "summarize" }, refunded: false },
      { id: 1, at: "2026-09-25T02:40:00Z", kind: "bogus", action: null, delta: 99, detail: {}, refunded: false },
    ],
    config: { daily: 20 },
  };

  it("reads the status the database returns", () => {
    const status = normalizeStatus(raw)!;
    expect(status.code).toBe("pt8j974k");
    expect(balanceOf(status)).toBe(44);
    expect(status.rules.daily).toBe(20);
    // A kind the page does not know is left out rather than drawn wrong.
    expect(status.history.map((entry) => entry.id)).toEqual([9, 6]);
    expect(normalizeStatus(null)).toBeNull();
    expect(normalizeStatus({ ...raw, code: "" })).toBeNull();
  });

  it("names every line of the history", () => {
    const [refund, spend] = normalizeStatus(raw)!.history;
    expect(entryLabel(refund)).toBe("החזר: הודעה לעוזר");
    expect(entryLabel(spend)).toBe("עיבוד טקסט ב־AI · סיכום");
    expect(entryLabel({ kind: "signup", action: null, detail: {} })).toBe("חבר הצטרף דרך הקישור שלך");
    expect(entryLabel({ kind: "welcome", action: null, detail: { from: "דני" } })).toBe("מתנת הצטרפות · הזמנה מדני");
    expect(entryLabel({ kind: "spend", action: "transcript", detail: {} })).toBe("תמלול לטקסט");
  });

  it("reads the balance a server reply carries, as JSON or as a header", () => {
    const pulse = { left: 15, daily: 10, bonus: 5, allowance: 20, charged: 3, resetsAt: "t" };
    expect(parsePulse(pulse)).toEqual(pulse);
    expect(parsePulse(JSON.stringify({ ...pulse, needed: 5 }))?.needed).toBe(5);
    expect(parsePulse("not json")).toBeNull();
    expect(parsePulse({ daily: 1 })).toBeNull();
    expect(parsePulse(null)).toBeNull();
  });
});

describe("words", () => {
  it("counts credits in Hebrew", () => {
    expect(creditsLabel(1)).toBe("קרדיט אחד");
    expect(creditsLabel(12)).toBe("12 קרדיטים");
    expect(creditsLabel(1500)).toBe("1,500 קרדיטים");
  });

  it("says how long until the allowance renews", () => {
    const now = Date.parse("2026-09-25T15:48:00Z");
    expect(untilReset("2026-09-25T21:00:00Z", now)).toBe("5 שעות ו־12 דקות");
    expect(untilReset("2026-09-25T16:48:00Z", now)).toBe("שעה");
    expect(untilReset("2026-09-25T16:00:00Z", now)).toBe("12 דקות");
    expect(untilReset("2026-09-25T15:48:20Z", now)).toBe("פחות מדקה");
    expect(untilReset(null, now)).toBeNull();
    expect(untilReset("garbage", now)).toBeNull();
  });
});

describe("the link", () => {
  it("accepts a code, or a whole invite link, and nothing else", () => {
    expect(cleanCode(" PT8J974K ")).toBe("pt8j974k");
    expect(cleanCode("short")).toBeNull();
    expect(cleanCode("has space")).toBeNull();
    expect(codeFromInput("https://shmuel-lamed.github.io/SongToNotes/?ref=pt8j974k#/notes")).toBe("pt8j974k");
    expect(codeFromInput("pt8j974k")).toBe("pt8j974k");
    expect(codeFromInput("https://example.com/")).toBeNull();
  });

  it("puts the code in the query, before the hash", () => {
    expect(withReferral("https://x.io/SongToNotes/#/s/abc123", "pt8j974k")).toBe("https://x.io/SongToNotes/?ref=pt8j974k#/s/abc123");
    expect(withReferral("https://x.io/SongToNotes/?a=1", "pt8j974k")).toBe("https://x.io/SongToNotes/?a=1&ref=pt8j974k");
    expect(withReferral("https://x.io/SongToNotes/", null)).toBe("https://x.io/SongToNotes/");
    expect(withReferral("https://x.io/SongToNotes/", "bad code")).toBe("https://x.io/SongToNotes/");
  });
});

describe("the invitation, remembered", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
    vi.stubGlobal("window", { localStorage: globalThis.localStorage });
    clearPending();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the first friend's link, not a later one", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(rememberReferral("aaaa2222", now)?.code).toBe("aaaa2222");
    expect(rememberReferral("bbbb3333", now + 1000)?.code).toBe("aaaa2222");
    updatePending({ visited: true, name: "דני" });
    expect(readPending(now + 2000)).toMatchObject({ code: "aaaa2222", visited: true, name: "דני", dismissed: false });
  });

  it("lets an invitation go after its thirty days", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    rememberReferral("aaaa2222", now);
    const later = now + (PENDING_DAYS + 1) * 86_400_000;
    expect(readPending(later)).toBeNull();
    expect(rememberReferral("bbbb3333", later)?.code).toBe("bbbb3333");
  });

  it("ignores a code that is not one", () => {
    expect(rememberReferral("not a code")).toBeNull();
  });
});
