import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatsKey,
  emptyChat,
  normalizeMessages,
  readLocal,
  sortNewestFirst,
  titleFrom,
  writeLocal,
  type Chat,
} from "./assistantChats";

/** The bare minimum of `localStorage`, with a size limit we can trip. */
function fakeStorage(limitBytes = Infinity) {
  const map = new Map<string, string>();
  return {
    store: map,
    api: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.length > limitBytes) throw new Error("QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    } as unknown as Storage,
  };
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "a",
    title: "שיחה",
    messages: [{ role: "user", content: "שלום" }],
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
    localOnly: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage().api);
});

describe("titleFrom", () => {
  it("names a thread after the first thing the visitor asked", () => {
    expect(titleFrom([{ role: "assistant", content: "שלום!" }, { role: "user", content: "הפעל  מטרונום\nב־100" }])).toBe("הפעל מטרונום ב־100");
  });
  it("skips the site's own reports and falls back when there is nothing", () => {
    expect(titleFrom([{ role: "user", content: "[תוצאות פעולות]", hidden: true }])).toBe("שיחה חדשה");
    expect(titleFrom([])).toBe("שיחה חדשה");
  });
  it("cuts a very long question rather than carrying it whole", () => {
    const title = titleFrom([{ role: "user", content: "א".repeat(200) }]);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("normalizeMessages", () => {
  it("keeps sound turns and drops everything else", () => {
    expect(
      normalizeMessages([
        null,
        42,
        { role: "system", content: "no" },
        { role: "user", content: 7 },
        { role: "user", content: "כן", hidden: true },
        { role: "assistant", content: "בסדר" },
      ]),
    ).toEqual([
      { role: "user", content: "כן", hidden: true },
      { role: "assistant", content: "בסדר" },
    ]);
  });
  it("keeps only well-formed action records", () => {
    const [message] = normalizeMessages([
      {
        role: "assistant",
        content: "מפעיל",
        actions: [
          { id: "metronome.set", params: { bpm: 100 }, ok: true, message: "100 BPM" },
          { id: "broken" },
          { id: "works.delete", params: "nope", ok: false, message: "בוטל", cancelled: true },
        ],
      },
    ]);
    expect(message.actions).toEqual([
      { id: "metronome.set", params: { bpm: 100 }, ok: true, message: "100 BPM" },
      { id: "works.delete", params: {}, ok: false, message: "בוטל", cancelled: true },
    ]);
  });
  it("reads nothing out of nothing", () => {
    expect(normalizeMessages(undefined)).toEqual([]);
    expect(normalizeMessages("[]")).toEqual([]);
  });
});

describe("this device's copy", () => {
  it("writes threads and reads them back newest first", () => {
    writeLocal("me", [chat({ id: "old", updatedAt: "2026-09-18T10:00:00.000Z" }), chat({ id: "new", updatedAt: "2026-09-20T10:00:00.000Z" })]);
    expect(readLocal("me").map((item) => item.id)).toEqual(["new", "old"]);
  });
  it("keeps each account's threads apart", () => {
    writeLocal("me", [chat({ id: "mine" })]);
    expect(readLocal("you")).toEqual([]);
    expect(readLocal(null)).toEqual([]);
  });
  it("survives storage that holds nothing readable", () => {
    const { api, store } = fakeStorage();
    vi.stubGlobal("localStorage", api);
    store.set(chatsKey("me"), "not-json");
    expect(readLocal("me")).toEqual([]);
  });
  it("fills in what a stored thread is missing", () => {
    const { api, store } = fakeStorage();
    vi.stubGlobal("localStorage", api);
    store.set(chatsKey("me"), JSON.stringify([{ id: "a", messages: [{ role: "user", content: "מה השעה" }], createdAt: "2026-09-19T10:00:00.000Z" }]));
    const [item] = readLocal("me");
    expect(item.title).toBe("מה השעה");
    expect(item.updatedAt).toBe("2026-09-19T10:00:00.000Z");
    expect(item.localOnly).toBe(true);
  });
  it("drops the oldest threads rather than losing the newest when the store is full", () => {
    const { api } = fakeStorage(400);
    vi.stubGlobal("localStorage", api);
    const many = Array.from({ length: 12 }, (_, index) =>
      chat({ id: `c${index}`, updatedAt: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z` }),
    );
    writeLocal("me", many);
    const kept = readLocal("me");
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(many.length);
    expect(kept[0].id).toBe("c11");
  });
  it("gives up quietly when nothing can be written at all", () => {
    vi.stubGlobal("localStorage", fakeStorage(0).api);
    expect(() => writeLocal("me", [chat()])).not.toThrow();
    expect(readLocal("me")).toEqual([]);
  });
});

describe("emptyChat and sorting", () => {
  it("starts a thread with its own id and no messages", () => {
    const one = emptyChat();
    const two = emptyChat();
    expect(one.id).not.toBe(two.id);
    expect(one.messages).toEqual([]);
    expect(one.localOnly).toBe(true);
  });
  it("orders by when each thread was last touched", () => {
    const ordered = sortNewestFirst([
      chat({ id: "b", updatedAt: "2026-09-19T10:00:00.000Z" }),
      chat({ id: "c", updatedAt: "2026-09-21T10:00:00.000Z" }),
      chat({ id: "a", updatedAt: "2026-09-20T10:00:00.000Z" }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });
});
