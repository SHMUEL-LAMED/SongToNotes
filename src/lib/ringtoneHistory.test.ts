import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSupabase = vi.fn();
vi.mock("./supabase", () => ({ getSupabase: () => getSupabase() }));

const { RINGTONE_HISTORY_KEY, listLocalRingtones, saveRingtone } = await import("./ringtoneHistory");

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const item = { title: "שיר", sourceName: "song.mp3", startSeconds: 30, durationSeconds: 29 };

describe("saveRingtone", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getSupabase.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps a ringtone on the device without an account", async () => {
    const entry = await saveRingtone(item, null);
    expect(listLocalRingtones().map((saved) => saved.id)).toEqual([entry.id]);
    expect(getSupabase).not.toHaveBeenCalled();
    expect(localStorage.getItem(RINGTONE_HISTORY_KEY)).toContain("song.mp3");
  });

  it("still resolves when the profile cannot be reached at all", async () => {
    getSupabase.mockRejectedValue(new TypeError("Failed to fetch dynamically imported module"));
    const entry = await saveRingtone(item, "user-1");
    expect(entry.title).toBe("שיר");
    expect(listLocalRingtones()[0]?.id).toBe(entry.id);
  });

  it("still resolves when the upsert throws", async () => {
    getSupabase.mockResolvedValue({
      from: () => ({
        upsert: () => Promise.reject(new TypeError("Failed to fetch")),
      }),
    });
    await expect(saveRingtone(item, "user-1")).resolves.toMatchObject({ sourceName: "song.mp3" });
  });
});
