import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKS_KEY, listWorks, type SavedWork } from "./works";

// A server that cannot be reached: every read comes back with an error, the
// way supabase-js reports a failed fetch.
vi.mock("./supabase", () => {
  const failed = { data: null, error: { message: "TypeError: Failed to fetch" } };
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "limit", "upsert", "update", "delete"]) builder[name] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(failed).then(resolve);
  return { getSupabase: async () => ({ from: () => builder }) };
});
vi.mock("./fileStore", () => ({
  getFile: async () => null,
  putFile: async () => false,
  deleteFile: async () => undefined,
  listFiles: async () => [],
}));

function work(id: string): SavedWork {
  return {
    id,
    kind: "song",
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
    localOnly: false,
  };
}

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) });
  vi.stubGlobal("console", { ...console, warn: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("listWorks without the server", () => {
  it("shows what this device holds instead of nothing", async () => {
    localStorage.setItem(WORKS_KEY, JSON.stringify([work("a"), work("b")]));
    const list = await listWorks("user-1");
    expect(list.map((item) => item.id).sort()).toEqual(["a", "b"]);
    // And the local index is left as it was.
    expect(JSON.parse(localStorage.getItem(WORKS_KEY) ?? "[]")).toHaveLength(2);
  });
});
