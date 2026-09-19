import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiAssistant } from "./AiAssistant";

const auth = vi.hoisted(() => ({ user: { id: "account-a" } as { id: string } | null, signInWithGoogle: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../lib/aiApi", () => ({ chatStream: vi.fn(), AiError: class extends Error {} }));

const props = { open: true, onOpen: vi.fn(), onClose: vi.fn(), toolTitle: null };
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
  it("offers detailed answers and separate question/execute modes", () => {
    const html = render();
    expect(html).toContain("מפורט");
    expect(html).toContain("מצב שאלה");
    expect(html).toContain("מצב ביצוע");
    expect(html).toContain('maxLength="3000"');
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
      "musictools.assistant.v3.account-a",
      JSON.stringify([null, 42, {}, { role: "system", content: "bad-role" }, { role: "user", content: {} }, { role: "assistant", content: "valid-answer" }]),
    );
    expect(render()).toContain("valid-answer");
    expect(render()).not.toContain("bad-role");
  });
  it("renders markdown but hides actions in question mode", () => {
    values.set(
      "musictools.assistant.v3.account-a",
      JSON.stringify([{ role: "assistant", content: "**חשוב**: תעלה קובץ\n- צעד אחד\n- צעד שני\n\n[[open:transcript]]" }]),
    );
    const html = render();
    expect(html).toContain("<strong>חשוב</strong>");
    expect(html).toContain("<li>צעד אחד</li>");
    expect(html).not.toContain("הצע פתיחת תמלול לטקסט");
    expect(html).not.toContain("[[open:");
  });
  it("recovers from corrupt storage", () => {
    values.set("musictools.assistant.v3.account-a", "not-json");
    expect(render()).toContain("איך מוציאים תווים משיר?");
  });
  it("offers help for the current tool", () => {
    expect(renderToStaticMarkup(<AiAssistant {...props} toolId="metronome" toolTitle="מטרונום" />)).toContain("איך מתרגלים עם מטרונום?");
  });
  it("renders only the launcher when closed", () => {
    const html = renderToStaticMarkup(<AiAssistant {...props} open={false} />);
    expect(html).toContain("assistant-launcher");
    expect(html).not.toContain('role="dialog"');
  });
});
