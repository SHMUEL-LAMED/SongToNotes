import { describe, expect, it } from "vitest";
import {
  DEFAULT_SONG_SECONDS,
  SETLIST_STORAGE_KEY,
  clockAt,
  duplicateSetlist,
  entryFromSong,
  formatDuration,
  guessSongKey,
  loadStore,
  makeBreak,
  makeSetlist,
  makeSong,
  moveEntry,
  parseDuration,
  parseStore,
  refreshLinkedSongs,
  runningStarts,
  saveStore,
  serializeStore,
  setTotals,
  setlistToText,
  songNumbers,
  targetStatus,
  type SetlistStore,
} from "./setlist";

function sample() {
  const setlist = makeSetlist("חתונה", "s1", "2026-01-01T00:00:00.000Z");
  setlist.entries = [
    makeSong({ title: "פתיחה", key: "Am", bpm: 120, duration: 225, notes: "capo 2" }, "a"),
    makeSong({ title: "בלדה", key: "C", duration: 300 }, "b"),
    makeBreak(900, "br"),
    makeSong({ title: "סיום", bpm: 140, duration: 180 }, "c"),
  ];
  return setlist;
}

describe("durations", () => {
  it("parses mm:ss, h:mm:ss and bare minutes", () => {
    expect(parseDuration("3:45")).toBe(225);
    expect(parseDuration(" 0:30 ")).toBe(30);
    expect(parseDuration("1:02:30")).toBe(3750);
    expect(parseDuration("4")).toBe(240);
    expect(parseDuration("3.5")).toBe(210);
  });

  it("rejects typos instead of guessing", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("3:75")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("-3:00")).toBeNull();
    expect(parseDuration("1:2:3:4")).toBeNull();
  });

  it("formats with padded seconds and hours when needed", () => {
    expect(formatDuration(225)).toBe("3:45");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(3750)).toBe("1:02:30");
    expect(formatDuration(-90)).toBe("1:30");
    expect(formatDuration(parseDuration("12:07") ?? 0)).toBe("12:07");
  });
});

describe("totals and running times", () => {
  it("adds songs and breaks separately and together", () => {
    expect(setTotals(sample().entries)).toEqual({ songs: 705, breaks: 900, total: 1605, songCount: 3, breakCount: 1 });
    expect(setTotals([])).toEqual({ songs: 0, breaks: 0, total: 0, songCount: 0, breakCount: 0 });
  });

  it("gives each entry its start offset", () => {
    expect(runningStarts(sample().entries)).toEqual([0, 225, 525, 1425]);
  });

  it("numbers songs only, skipping breaks", () => {
    expect(songNumbers(sample().entries)).toEqual([1, 2, null, 3]);
  });

  it("turns offsets into clock times, across midnight", () => {
    expect(clockAt("20:30", 0)).toBe("20:30");
    expect(clockAt("20:30", 45 * 60)).toBe("21:15");
    expect(clockAt("23:50", 20 * 60)).toBe("00:10");
    expect(clockAt("25:00", 0)).toBe("");
  });

  it("compares the total with the target", () => {
    expect(targetStatus(1605, null)).toBeNull();
    expect(targetStatus(1605, 20)).toEqual({ state: "over", diff: 405 });
    expect(targetStatus(1605, 30)).toEqual({ state: "under", diff: -195 });
    expect(targetStatus(1605, 27)?.state).toBe("on");
  });
});

describe("reordering", () => {
  it("moves an item and leaves the original untouched", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveEntry(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveEntry(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores out-of-range moves", () => {
    expect(moveEntry(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveEntry(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });

  it("running times follow the new order", () => {
    const moved = moveEntry(sample().entries, 2, 0);
    expect(runningStarts(moved)).toEqual([0, 900, 1125, 1425]);
    expect(songNumbers(moved)).toEqual([null, 1, 2, 3]);
  });
});

describe("songbook import", () => {
  it("guesses the key from the first chord, with the saved transposition", () => {
    expect(guessSongKey("[פזמון]\n[Am7]היה [G]פעם")).toBe("Am");
    expect(guessSongKey("[Cmaj7]שלום", 2)).toBe("D");
    expect(guessSongKey("בלי אקורדים")).toBe("");
  });

  it("maps a saved song to a linked entry", () => {
    const entry = entryFromSong({ id: "w1", title: "ירושלים", payload: { body: "[Em]עיר", transpose: 0 } }, "e1");
    expect(entry).toMatchObject({ id: "e1", type: "song", title: "ירושלים", key: "Em", bpm: null, duration: DEFAULT_SONG_SECONDS, workId: "w1", songBody: "[Em]עיר" });
  });

  it("refreshes linked song text but keeps the band's own fields", () => {
    const entries = [makeSong({ title: "שלי", key: "D", workId: "w1", songBody: "old" }, "e1"), makeSong({ title: "ידני" }, "e2")];
    const refreshed = refreshLinkedSongs(entries, [{ id: "w1", title: "אחר", payload: { body: "new", transpose: 3 } }]);
    expect(refreshed[0]).toMatchObject({ title: "שלי", key: "D", songBody: "new", songTranspose: 3 });
    expect(refreshed[1]).toBe(entries[1]);
    expect(refreshLinkedSongs(refreshed, [{ id: "w1", title: "אחר", payload: { body: "new", transpose: 3 } }])).toBe(refreshed);
  });
});

describe("storage", () => {
  it("round-trips a store", () => {
    const store: SetlistStore = { version: 1, activeId: "s1", setlists: [sample()] };
    expect(parseStore(serializeStore(store))).toEqual(store);
  });

  it("rejects malformed data", () => {
    expect(parseStore(null)).toBeNull();
    expect(parseStore("not json")).toBeNull();
    expect(parseStore("[]")).toBeNull();
    expect(parseStore(JSON.stringify({ version: 2, activeId: "x", setlists: [] }))).toBeNull();
    expect(parseStore(JSON.stringify({ version: 1, activeId: "x", setlists: "nope" }))).toBeNull();
    expect(parseStore(JSON.stringify({ version: 1, activeId: "x", setlists: [{ id: 5, name: "x", entries: [] }] }))).toBeNull();
  });

  it("drops bad entries, duplicates and fixes a dangling active id", () => {
    const raw = JSON.stringify({
      version: 1,
      activeId: "missing",
      setlists: [
        {
          id: "s1",
          name: "ערב",
          targetMinutes: -5,
          startTime: "99:99",
          entries: [
            { id: "a", type: "song", title: "טוב", key: "G", bpm: 9999, duration: 200, notes: "" },
            { id: "a", type: "song", title: "כפול", duration: 100 },
            { id: "b", type: "song", title: "בלי משך" },
            { id: "c", type: "mystery", title: "?", duration: 10 },
            { id: "d", type: "break", duration: 600 },
            "garbage",
          ],
        },
        { id: "s1", name: "כפול", entries: [] },
      ],
    });
    const store = parseStore(raw);
    expect(store?.activeId).toBe("s1");
    expect(store?.setlists).toHaveLength(1);
    const setlist = store!.setlists[0];
    expect(setlist.entries.map((entry) => entry.id)).toEqual(["a", "d"]);
    expect(setlist.entries[0].bpm).toBe(400);
    expect(setlist.targetMinutes).toBeNull();
    expect(setlist.startTime).toBeNull();
  });

  it("loads and saves through a storage, starting fresh when it is broken", () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => void memory.set(key, value) };
    const fresh = loadStore(storage);
    expect(fresh.setlists).toHaveLength(1);
    fresh.setlists[0].entries.push(makeSong({ title: "א" }, "x"));
    expect(saveStore(fresh, storage)).toBe(true);
    expect(loadStore(storage)).toEqual(fresh);
    memory.set(SETLIST_STORAGE_KEY, "{broken");
    expect(loadStore(storage).setlists[0].entries).toEqual([]);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadStore(throwing).setlists).toHaveLength(1);
    expect(saveStore(fresh, throwing)).toBe(false);
  });

  it("duplicates with fresh ids", () => {
    let n = 0;
    const copy = duplicateSetlist(sample(), "עותק", () => `id${++n}`);
    expect(copy.id).toBe("id1");
    expect(copy.entries.map((entry) => entry.id)).toEqual(["id2", "id3", "id4", "id5"]);
    expect(copy.entries[0].title).toBe("פתיחה");
  });
});

describe("text export", () => {
  it("writes a numbered list with keys, breaks and the total", () => {
    expect(setlistToText(sample())).toBe(
      ["חתונה", "", "1. פתיחה (Am, 120 BPM) 3:45 · capo 2", "2. בלדה (C) 5:00", "— הפסקה (15:00) —", "3. סיום (140 BPM) 3:00", "", "סה״כ 26:45 · 3 שירים · הפסקה אחת"].join("\n"),
    );
  });

  it("adds clock times when the start time is set", () => {
    const setlist = { ...sample(), startTime: "21:00" };
    const lines = setlistToText(setlist).split("\n");
    expect(lines[1]).toBe("התחלה: 21:00");
    expect(lines[3].startsWith("21:00 1. פתיחה")).toBe(true);
    expect(lines[5].startsWith("21:08 — הפסקה")).toBe(true);
  });
});
