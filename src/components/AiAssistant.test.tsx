import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiAssistant } from "./AiAssistant";

const auth = vi.hoisted(() => ({ user: { id: "account-a" } as { id: string } | null, signInWithGoogle: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../lib/aiApi", () => ({ chatStream: vi.fn(), AiError: class extends Error {} }));

const props = { open: true, onOpen: vi.fn(), onClose: vi.fn(), toolTitle: null };
const OWN = "musictools.assistant.v3.account-a";
const values = new Map<string, string>();
const render = () => renderToStaticMarkup(<AiAssistant {...props} />);

beforeEach(() => {
  auth.user = { id: "account-a" };
  values.clear();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: () => undefined };
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("sessionStorage", store);
});
afterEach(() => vi.unstubAllGlobals());

describe("assistant initial state", () => {
  it("offers detailed answers and separate do/ask modes, doing by default", () => {
    const html = render();
    expect(html).toContain("מפורט");
    expect(html).toContain("מצב שאלה");
    expect(html).toContain("מצב ביצוע");
    expect(html).toContain('maxLength="3000"');
    expect(html).toContain("כתוב שיר קצר על החורף");
    expect(html).toContain("מבצע פעולות באתר");
  });
  it("remembers a preference for answers only", () => {
    values.set("musictools.assistant.mode.v1", "question");
    const html = render();
    expect(html).toContain("איך מוציאים תווים משיר?");
    expect(html).not.toContain("כתוב שיר קצר על החורף");
  });
  it("requires sign-in before composing", () => {
    auth.user = null;
    expect(render()).toContain("התחברות עם Google");
    expect(render()).not.toContain("<textarea");
  });
  it("does not load another account's history or legacy shared history", () => {
    const history = JSON.stringify([{ role: "user", content: "private-message" }]);
    values.set("musictools.assistant.v3.account-b", history);
    values.set("musictools.assistant.v2", history);
    expect(render()).not.toContain("private-message");
  });
  it("loads valid own history while rejecting malformed entries", () => {
    values.set(
      OWN,
      JSON.stringify([null, 42, {}, { role: "system", content: "bad-role" }, { role: "user", content: {} }, { role: "assistant", content: "valid-answer" }]),
    );
    expect(render()).toContain("valid-answer");
    expect(render()).not.toContain("bad-role");
  });
  it("renders markdown and never shows raw action markup", () => {
    values.set(
      OWN,
      JSON.stringify([{ role: "assistant", content: "**חשוב**: תעלה קובץ\n- צעד אחד\n- צעד שני\n\n[[open:transcript]]\n```action\n{\"action\":\"metronome.start\"}\n```" }]),
    );
    const html = render();
    expect(html).toContain("<strong>חשוב</strong>");
    expect(html).toContain("<li>צעד אחד</li>");
    expect(html).not.toContain("[[open:");
    expect(html).not.toContain("metronome.start");
  });
  it("shows what the assistant did under its reply and hides the site's own reports", () => {
    values.set(
      OWN,
      JSON.stringify([
        { role: "user", content: "הפעל מטרונום" },
        {
          role: "assistant",
          content: "מפעיל.",
          actions: [
            { id: "metronome.set", params: { bpm: 100 }, ok: true, message: "100 BPM" },
            { id: "works.delete", params: { id: "x" }, ok: false, cancelled: true, message: "בוטל" },
            { id: "nope", params: {}, ok: false, message: "אין פעולה כזאת" },
            { id: "broken" },
          ],
        },
        { role: "user", content: "[תוצאות פעולות]\n1. metronome.set — הצליח", hidden: true },
      ]),
    );
    const html = render();
    expect(html).toContain("הגדרות מטרונום");
    expect(html).toContain("100 BPM");
    expect(html).toContain("is-cancelled");
    expect(html).toContain("is-failed");
    expect(html).toContain("אין פעולה כזאת");
    expect(html).not.toContain("broken");
    expect(html).not.toContain("[תוצאות פעולות]");
  });
  it("recovers from corrupt storage", () => {
    values.set(OWN, "not-json");
    expect(render()).toContain("כתוב שיר קצר על החורף");
  });
  it("offers things to do and to ask on the current tool", () => {
    const html = renderToStaticMarkup(<AiAssistant {...props} toolId="metronome" toolTitle="מטרונום" />);
    expect(html).toContain("הגדר 120 BPM ב־4/4 והפעל");
    expect(html).toContain("איך מתרגלים עם מטרונום?");
  });
  it("renders only the launcher when closed", () => {
    const html = renderToStaticMarkup(<AiAssistant {...props} open={false} />);
    expect(html).toContain("assistant-launcher");
    expect(html).not.toContain('role="dialog"');
  });
});
