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
  it("offers the ask, plan and agent modes, the agent by default", () => {
    const html = render();
    expect(html).toContain("שאלה");
    expect(html).toContain("תכנון");
    expect(html).toContain("סוכן");
    expect(html).toContain("כתוב שיר קצר על החורף");
    expect(html).toContain("בלי לעצור לאישור");
  });
  it("keeps detailed answers and approvals in its settings", () => {
    expect(render()).toContain('aria-label="הגדרות העוזר"');
  });
  it("remembers the plan mode", () => {
    values.set("musictools.assistant.mode.v1", "plan");
    const html = render();
    expect(html).toContain("תכנן לי אימון גיטרה");
    expect(html).not.toContain("כתוב שיר קצר על החורף");
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
  it("shows a plan as a task list, and offers to carry it out in plan mode", () => {
    values.set("musictools.assistant.mode.v1", "plan");
    seed([
      { role: "user", content: "תכנן אימון" },
      { role: "assistant", content: "הנה התוכנית:\n```plan\n- [x] לפתוח מטרונום\n- [ ] לנגן סולם\n```" },
    ]);
    const html = render();
    expect(html).toContain("assistant-plan");
    expect(html).toContain("לנגן סולם");
    expect(html).toContain("1/2");
    expect(html).toContain("בצע את התוכנית");
    expect(html).not.toContain("```plan");
  });
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
    expect(html).not.toContain("assistant-panel");
  });
});
