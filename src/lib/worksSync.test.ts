import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKS_KEY, listLocalWorks, syncLocalWorks, type SavedWork } from "./works";

// The server, as far as uploading works goes: it refuses any batch holding a
// kind its check does not know yet, the way Postgres fails a whole insert.
const server = vi.hoisted(() => ({ calls: [] as { kind: string; client_id: string }[][], unknown: new Set<string>() }));
vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      upsert: async (rows: { kind: string; client_id: string }[]) => {
        server.calls.push(rows);
        return { error: rows.some((row) => server.unknown.has(row.kind)) ? { message: "violates check constraint works_kind_check" } : null };
      },
    }),
  },
}));

function work(id: string, kind: SavedWork["kind"], localOnly: boolean): SavedWork {
  return {
    id,
    kind,
    title: id,
    sourceName: null,
    summary: {},
    payload: {},
    fileName: null,
    deviceId: null,
    filePath: null,
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
    origin: "works",
    rowId: null,
    localOnly,
  };
}

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) });
  vi.stubGlobal("console", { ...console, warn: vi.fn() });
  server.calls = [];
  server.unknown = new Set();
});
afterEach(() => vi.unstubAllGlobals());

describe("syncLocalWorks", () => {
  it("sends what waits on this device in one batch", async () => {
    localStorage.setItem(WORKS_KEY, JSON.stringify([work("a", "chords", true), work("b", "song", true), work("c", "vocals", false)]));
    const synced = await syncLocalWorks("user-1");
    expect(server.calls).toHaveLength(1);
    expect(synced.map((item) => item.id)).toEqual(["a", "b"]);
    expect(listLocalWorks().every((item) => !item.localOnly)).toBe(true);
  });

  it("does not let one refused work hold back the others", async () => {
    server.unknown.add("identify");
    localStorage.setItem(WORKS_KEY, JSON.stringify([work("a", "chords", true), work("b", "identify", true), work("c", "song", true)]));
    const synced = await syncLocalWorks("user-1");
    // The batch, then each work on its own.
    expect(server.calls.map((rows) => rows.length)).toEqual([3, 1, 1, 1]);
    expect(synced.map((item) => item.id)).toEqual(["a", "c"]);
    const local = new Map(listLocalWorks().map((item) => [item.id, item.localOnly]));
    expect(local).toEqual(new Map([["a", false], ["b", true], ["c", false]]));
  });
});
