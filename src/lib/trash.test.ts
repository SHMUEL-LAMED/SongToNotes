import { describe, expect, it } from "vitest";
import { parseTrash, pruneTrash, type TrashEntry } from "./trash";
import type { SavedWork } from "./works";

function entry(id: string, deletedAt: string): TrashEntry {
  return {
    deletedAt,
    work: {
      id,
      kind: "vocals",
      title: id,
      sourceName: null,
      summary: {},
      payload: {},
      fileName: null,
      deviceId: null,
      filePath: null,
      createdAt: deletedAt,
      updatedAt: deletedAt,
      origin: "works",
      rowId: null,
      localOnly: false,
    } as SavedWork,
  };
}

describe("the recycle bin", () => {
  const now = new Date("2026-03-20T12:00:00.000Z");

  it("keeps what is still within its thirty days, newest first", () => {
    const kept = pruneTrash(
      [entry("old", "2026-03-01T12:00:00.000Z"), entry("new", "2026-03-19T12:00:00.000Z")],
      now,
    );
    expect(kept.map((item) => item.work.id)).toEqual(["new", "old"]);
  });

  it("forgets what has passed thirty days", () => {
    expect(pruneTrash([entry("ancient", "2026-01-01T12:00:00.000Z")], now)).toEqual([]);
  });

  it("survives nonsense in storage", () => {
    expect(parseTrash(null, now)).toEqual([]);
    expect(parseTrash("{}", now)).toEqual([]);
    expect(parseTrash('[{"deletedAt":"2026-03-19T12:00:00.000Z"}]', now)).toEqual([]);
  });

  it("reads a damaged entry as a whole work, so the bin can still render it", () => {
    const raw = JSON.stringify([
      { deletedAt: "2026-03-19T12:00:00.000Z", work: { id: "a", kind: "song", origin: "ringtones" } },
      { deletedAt: "2026-03-19T12:00:00.000Z", work: { id: "b", kind: "not-a-kind" } },
    ]);
    const [only, ...rest] = parseTrash(raw, now);
    expect(rest).toEqual([]);
    expect(only.work).toMatchObject({ id: "a", title: "שיר בשירון", summary: {}, payload: {}, origin: "ringtones" });
  });
});
