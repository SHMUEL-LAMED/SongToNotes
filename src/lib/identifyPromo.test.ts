import { describe, expect, it } from "vitest";
import { PROMO_AFTER_MS, REST_AFTER_DISMISS_MS, REST_AFTER_USE_MS, promoDue, restUntil } from "./identifyPromo";

describe("the invitation to the song identifier", () => {
  const now = 1_800_000_000_000;

  it("rises after a little while on screen", () => {
    expect(promoDue({ spent: PROMO_AFTER_MS - 1, restingUntil: null, shownThisVisit: false, now })).toBe(false);
    expect(promoDue({ spent: PROMO_AFTER_MS, restingUntil: null, shownThisVisit: false, now })).toBe(true);
  });

  it("comes once a visit, however long the visit", () => {
    expect(promoDue({ spent: PROMO_AFTER_MS * 20, restingUntil: null, shownThisVisit: true, now })).toBe(false);
  });

  it("rests a few days after 'not now'", () => {
    const until = restUntil("dismissed", now);
    expect(until - now).toBe(REST_AFTER_DISMISS_MS);
    expect(promoDue({ spent: PROMO_AFTER_MS, restingUntil: until, shownThisVisit: false, now: until - 1 })).toBe(false);
    expect(promoDue({ spent: PROMO_AFTER_MS, restingUntil: until, shownThisVisit: false, now: until })).toBe(true);
  });

  it("rests much longer once the identifier was opened", () => {
    expect(restUntil("used", now) - now).toBe(REST_AFTER_USE_MS);
    expect(restUntil("used", now)).toBeGreaterThan(restUntil("dismissed", now));
  });
});
