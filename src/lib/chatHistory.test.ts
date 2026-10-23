import { describe, expect, it } from "vitest";
import type { Chat, StoredMessage } from "./assistantChats";
import { chatDidActions, chatPreview, dateGroup, historySections, matchChat, plainText, visibleCount } from "./chatHistory";

function chat(id: string, messages: StoredMessage[], updatedAt = "2026-10-23T09:00:00.000Z", title = `שיחה ${id}`): Chat {
  return { id, title, messages, createdAt: updatedAt, updatedAt, localOnly: false };
}

const now = new Date(2026, 9, 23, 15, 0, 0);

describe("plainText", () => {
  it("drops plan and action blocks from a reply, and the Markdown marks", () => {
    const reply = "**מגדיר** את `המטרונום`.\n\n```plan\n- [x] שלב\n```\n```action\n{\"action\":\"metronome.set\"}\n```\n- נקודה";
    expect(plainText({ role: "assistant", content: reply })).toBe("מגדיר את המטרונום. נקודה");
  });
  it("leaves a question as it was asked", () => {
    expect(plainText({ role: "user", content: "מה זה *סולם*?" })).toBe("מה זה סולם?");
  });
});

describe("chatPreview", () => {
  it("is the last visible turn with words, skipping the site's hidden reports", () => {
    const thread = chat("a", [
      { role: "user", content: "שאלה" },
      { role: "assistant", content: "התשובה המלאה" },
      { role: "user", content: "[תוצאות פעולות]\n1. ok", hidden: true },
    ]);
    expect(chatPreview(thread)).toBe("התשובה המלאה");
  });
  it("is cut with an ellipsis when long", () => {
    const thread = chat("a", [{ role: "user", content: "א".repeat(300) }]);
    expect(chatPreview(thread).endsWith("…")).toBe(true);
    expect(chatPreview(thread).length).toBeLessThan(120);
  });
});

describe("counts and marks", () => {
  it("counts what the visitor sees and notices actions", () => {
    const thread = chat("a", [
      { role: "user", content: "הפעל" },
      { role: "assistant", content: "מפעיל", actions: [{ id: "metronome.start", params: {}, ok: true, message: "מנגן" }] },
      { role: "user", content: "[תוצאות פעולות]", hidden: true },
    ]);
    expect(visibleCount(thread)).toBe(2);
    expect(chatDidActions(thread)).toBe(true);
    expect(chatDidActions(chat("b", [{ role: "user", content: "שאלה" }]))).toBe(false);
  });
});

describe("dateGroup", () => {
  it("sorts by calendar day, not by hours ago", () => {
    expect(dateGroup(new Date(2026, 9, 23, 0, 5).toISOString(), now)).toBe("today");
    expect(dateGroup(new Date(2026, 9, 22, 23, 55).toISOString(), now)).toBe("yesterday");
    expect(dateGroup(new Date(2026, 9, 18, 12).toISOString(), now)).toBe("week");
    expect(dateGroup(new Date(2026, 9, 1, 12).toISOString(), now)).toBe("month");
    expect(dateGroup(new Date(2026, 6, 1, 12).toISOString(), now)).toBe("older");
    expect(dateGroup("not a date", now)).toBe("older");
  });
});

describe("matchChat", () => {
  const thread = chat("a", [
    { role: "user", content: "איך מכוונים גיטרה?" },
    { role: "assistant", content: "פותחים את **הטיונר** ומכוונים מיתר אחרי מיתר, מהעבה לדקה." },
  ], undefined, "כיוון גיטרה");
  it("finds every word, in any case and order, in the title or what was said", () => {
    expect(matchChat(thread, "טיונר גיטרה")).toContain("הטיונר");
    expect(matchChat(thread, "פסנתר")).toBeNull();
  });
  it("shows the words around the hit", () => {
    expect(matchChat(thread, "מיתר")).toContain("מיתר");
  });
  it("is the usual preview with no query", () => {
    expect(matchChat(thread, "  ")).toBe(chatPreview(thread));
  });
  it("does not search the site's hidden reports", () => {
    const hidden = chat("b", [{ role: "user", content: "שאלה" }, { role: "user", content: "metronome.set הצליח", hidden: true }]);
    expect(matchChat(hidden, "metronome")).toBeNull();
  });
});

describe("historySections", () => {
  const today = new Date(2026, 9, 23, 10).toISOString();
  const yesterday = new Date(2026, 9, 22, 10).toISOString();
  const old = new Date(2026, 5, 1, 10).toISOString();
  const list = [
    chat("old", [{ role: "user", content: "ישנה" }], old),
    chat("today", [{ role: "user", content: "מהיום" }], today),
    chat("yesterday", [{ role: "user", content: "מאתמול" }], yesterday),
    chat("empty", [], today),
  ];

  it("puts pins first, then dates newest first, and drops empty threads", () => {
    const sections = historySections(list, { pinned: new Set(["old"]), now });
    expect(sections.map((section) => section.group)).toEqual(["pinned", "today", "yesterday"]);
    expect(sections[0].entries[0].chat.id).toBe("old");
    expect(sections[0].entries[0].pinned).toBe(true);
    expect(sections.flatMap((section) => section.entries).some((entry) => entry.chat.id === "empty")).toBe(false);
  });

  it("keeps only what the search reaches", () => {
    const sections = historySections(list, { query: "אתמול", now });
    expect(sections.map((section) => section.group)).toEqual(["yesterday"]);
  });
});
