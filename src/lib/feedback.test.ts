import { afterEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_MAX, feedbackRow, sendFeedback } from "./feedback";

const PHONE = { width: 390, touch: true, agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", language: "he" };

describe("feedbackRow", () => {
  it("keeps the message, where it came from and on what", () => {
    const row = feedbackRow({ kind: "problem", message: "  הטיונר לא שומע את המיקרופון  ", contact: " me@example.com ", page: "tuner" }, PHONE);
    expect(row).toMatchObject({ kind: "problem", message: "הטיונר לא שומע את המיקרופון", contact: "me@example.com", page: "tuner", language: "he", device: "phone" });
    expect(row?.browser).toBeTruthy();
    expect(row?.os).toBeTruthy();
  });

  it("sends no address unless one was written", () => {
    expect(feedbackRow({ kind: "idea", message: "מצב לילה לשירון", contact: "   ", page: "songbook" }, PHONE)?.contact).toBeNull();
    expect(feedbackRow({ kind: "idea", message: "מצב לילה לשירון", page: "songbook" }, PHONE)?.contact).toBeNull();
  });

  it("stays inside the table's limits", () => {
    const row = feedbackRow({ kind: "other", message: "א".repeat(FEEDBACK_MAX + 50), contact: "x".repeat(300), page: "p".repeat(80) }, PHONE);
    expect(row?.message).toHaveLength(FEEDBACK_MAX);
    expect(row?.contact).toHaveLength(200);
    expect(row?.page).toHaveLength(40);
  });

  it("has nothing to send without a message or with an unknown kind", () => {
    expect(feedbackRow({ kind: "problem", message: "   ", page: "home" }, PHONE)).toBeNull();
    expect(feedbackRow({ kind: "praise" as never, message: "יופי", page: "home" }, PHONE)).toBeNull();
  });
});

describe("sendFeedback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds a row to site_feedback with the public key", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { innerWidth: 1280 });
    vi.stubGlobal("navigator", { maxTouchPoints: 0, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36" });
    await sendFeedback({ kind: "idea", message: "עוד סולמות במאמן השמיעה", page: "ear" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/rest\/v1\/site_feedback$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "idea", message: "עוד סולמות במאמן השמיעה", page: "ear", device: "desktop" });
  });

  it("throws when the row did not arrive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    vi.stubGlobal("window", { innerWidth: 1280 });
    vi.stubGlobal("navigator", { maxTouchPoints: 0, userAgent: "" });
    await expect(sendFeedback({ kind: "idea", message: "משהו", page: "home" })).rejects.toThrow();
  });
});
