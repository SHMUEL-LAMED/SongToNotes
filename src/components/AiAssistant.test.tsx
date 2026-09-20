import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiAssistant } from "./AiAssistant";
import { chatsKey, type Chat, type StoredMessage } from "../lib/assistantChats";

const auth = vi.hoisted(() => ({ user: { id: "account-a" } as { id: string } | null, signInWithGoogle: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: () => auth }));
vi.mock("../lib/aiApi", () => ({ chatStream: vi.fn(), AiError: class extends Error {} }));

const props = { open: true, onOpen: vi.fn(), onClose: vi.fn(), toolTitle: null };
const values = new Map<string, string>();
const render = () => renderToStaticMarkup(<AiAssistant {...props} />);

/** One stored thread for the account under test. */
function seed(messages: StoredMessage[], overrides: Partial<Chat> = {}) {
  const chat: Chat = {
    id: "chat-1",
    title: "שיחה",
    messages,
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
    localOnly: true,
    ...overrides,
  };
  values.set(chatsKey("account-a"), JSON.stringify([chat]));
}

beforeEach(() => {
  auth.user = { id: "account-a" };
  values.clear();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: () => undefined, removeItem: () => undefined };
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
    expect(html).toContain("כתוב שיר קצר על החורף");
    expect(html).toContain("מבצע פעולות באתר");
  });
  it("lets a message be far longer than a sentence", () => {
    expect(render()).toContain('maxLength="32000"');
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
  it("offers the history and a new conversation", () => {
    const html = render();
    expect(html).toContain('aria-label="שיחות קודמות"');
    expect(html).toContain('aria-label="שיחה חדשה"');
  });
});

describe("the conversation it comes back to", () => {
  it("reopens the thread this device was last on", () => {
    seed([
      { role: "user", content: "מה הסולם?" },
      { role: "assistant", content: "דו מז'ור." },
    ]);
    const html = render();
    expect(html).toContain("מה הסולם?");
    expect(html).toContain("דו מז&#x27;ור.");
  });
  it("does not open another account's threads", () => {
    values.set(chatsKey("account-b"), JSON.stringify([{ id: "x", title: "t", messages: [{ role: "user", content: "private-message" }], createdAt: "", updatedAt: "", localOnly: true }]));
    expect(render()).not.toContain("private-message");
  });
  it("starts empty when storage holds nothing usable", () => {
    values.set(chatsKey("account-a"), "not-json");
    expect(render()).toContain("כתוב שיר קצר על החורף");
  });
  it("renders markdown and never shows raw action markup", () => {
    seed([{ role: "assistant", content: "**חשוב**: תעלה קובץ\n- צעד אחד\n- צעד שני\n\n[[open:transcript]]\n```action\n{\"action\":\"metronome.start\"}\n```" }]);
    const html = render();
    expect(html).toContain("<strong>חשוב</strong>");
    expect(html).toContain("<li>צעד אחד</li>");
    expect(html).not.toContain("[[open:");
    expect(html).not.toContain("metronome.start");
  });
  it("shows what the assistant did under its reply and hides the site's own reports", () => {
    seed([
      { role: "user", content: "הפעל מטרונום" },
      {
        role: "assistant",
        content: "מפעיל.",
        actions: [
          { id: "metronome.set", params: { bpm: 100 }, ok: true, message: "100 BPM" },
          { id: "works.delete", params: { id: "x" }, ok: false, cancelled: true, message: "בוטל" },
          { id: "nope", params: {}, ok: false, message: "אין פעולה כזאת" },
        ],
      },
      { role: "user", content: "[תוצאות פעולות]\n1. metronome.set — הצליח", hidden: true },
    ]);
    const html = render();
    expect(html).toContain("הגדרות מטרונום");
    expect(html).toContain("100 BPM");
    expect(html).toContain("is-cancelled");
    expect(html).toContain("is-failed");
    expect(html).toContain("אין פעולה כזאת");
    expect(html).not.toContain("[תוצאות פעולות]");
  });
  it("renders only the launcher when closed", () => {
    const html = renderToStaticMarkup(<AiAssistant {...props} open={false} />);
    expect(html).toContain("assistant-launcher");
    expect(html).not.toContain('role="dialog"');
  });
});
