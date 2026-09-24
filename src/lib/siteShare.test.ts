import { describe, expect, it } from "vitest";
import { PROMPT_EVERY_MS, REST_AFTER_SHARE_MS, advanceClock, promptDue, shareTargets } from "./siteShare";

describe("advanceClock", () => {
  it("counts the time the page is on screen", () => {
    const clock = advanceClock({ spent: 0, at: 1_000 }, 16_000, true);
    expect(clock).toEqual({ spent: 15_000, at: 16_000 });
  });

  it("does not count a hidden page", () => {
    expect(advanceClock({ spent: 40_000, at: 1_000 }, 16_000, false)).toEqual({ spent: 40_000, at: 16_000 });
  });

  it("takes a long gap for a sleep, not for time on the site", () => {
    const clock = advanceClock({ spent: 0, at: 0 }, 2 * 60 * 60_000, true);
    expect(clock.spent).toBeGreaterThan(0);
    expect(clock.spent).toBeLessThanOrEqual(60_000);
  });

  it("ignores a clock that went backwards", () => {
    expect(advanceClock({ spent: 5_000, at: 10_000 }, 4_000, true)).toEqual({ spent: 5_000, at: 4_000 });
  });
});

describe("promptDue", () => {
  const now = 1_700_000_000_000;

  it("asks once ten minutes have gone by on screen", () => {
    expect(promptDue(PROMPT_EVERY_MS - 1, null, now)).toBe(false);
    expect(promptDue(PROMPT_EVERY_MS, null, now)).toBe(true);
  });

  it("leaves a visitor who shared alone for a week", () => {
    expect(promptDue(PROMPT_EVERY_MS * 3, now - 60_000, now)).toBe(false);
    expect(promptDue(PROMPT_EVERY_MS * 3, now - REST_AFTER_SHARE_MS + 1, now)).toBe(false);
    expect(promptDue(PROMPT_EVERY_MS * 3, now - REST_AFTER_SHARE_MS, now)).toBe(true);
  });
});

describe("shareTargets", () => {
  const url = "https://shmuel-lamed.github.io/SongToNotes/";
  const targets = shareTargets(url, "כלי מוזיקה חינמיים & עוד", "כלי מוזיקה");
  const href = (id: string) => targets.find((target) => target.id === id)!.href;

  it("offers each app once", () => {
    expect(targets.map((target) => target.id)).toEqual(["whatsapp", "telegram", "facebook", "x", "email"]);
  });

  it("fills in the message and the address, encoded", () => {
    const whatsapp = new URL(href("whatsapp"));
    expect(whatsapp.origin).toBe("https://wa.me");
    expect(whatsapp.searchParams.get("text")).toBe(`כלי מוזיקה חינמיים & עוד\n${url}`);

    const telegram = new URL(href("telegram"));
    expect(telegram.searchParams.get("url")).toBe(url);
    expect(telegram.searchParams.get("text")).toBe("כלי מוזיקה חינמיים & עוד");

    expect(new URL(href("facebook")).searchParams.get("u")).toBe(url);
    expect(new URL(href("x")).searchParams.get("url")).toBe(url);
  });

  it("writes an email with a subject and the link in the body", () => {
    const mail = href("email");
    expect(mail.startsWith("mailto:?")).toBe(true);
    const params = new URLSearchParams(mail.slice("mailto:?".length));
    expect(params.get("subject")).toBe("כלי מוזיקה");
    expect(params.get("body")).toContain(url);
  });
});
