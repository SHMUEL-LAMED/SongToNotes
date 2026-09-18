import { beforeEach, describe, expect, it } from "vitest";
import {
  WORKS_KEY,
  describeWork,
  fromRingtone,
  fromTranscription,
  listLocalWorks,
  normalizeWork,
  sortNewestFirst,
  type SavedWork,
} from "./works";

/** The bare minimum of `localStorage` for the local index. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function work(overrides: Partial<SavedWork>): SavedWork {
  return {
    id: "a",
    kind: "vocals",
    title: "שיר — קריוקי",
    sourceName: "song.mp3",
    summary: {},
    payload: {},
    fileName: null,
    deviceId: null,
    filePath: null,
    createdAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-09-18T10:00:00.000Z",
    origin: "works",
    rowId: null,
    localOnly: true,
    ...overrides,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true });
});

describe("normalizeWork", () => {
  it("accepts a stored entry and fills what it lacks", () => {
    const item = normalizeWork({ id: "x", kind: "piano", createdAt: "2026-01-01T00:00:00Z" });
    expect(item).not.toBeNull();
    expect(item?.title).toBe("הקלטת פסנתר");
    expect(item?.updatedAt).toBe("2026-01-01T00:00:00Z");
    expect(item?.localOnly).toBe(true);
    expect(item?.origin).toBe("works");
  });

  it("drops anything that is not a work", () => {
    expect(normalizeWork(null)).toBeNull();
    expect(normalizeWork({ id: "x", kind: "video" })).toBeNull();
    expect(normalizeWork({ kind: "piano" })).toBeNull();
    expect(normalizeWork("piano")).toBeNull();
  });

  it("keeps a synced entry synced", () => {
    expect(normalizeWork({ id: "x", kind: "ear", localOnly: false })?.localOnly).toBe(false);
  });
});

describe("listLocalWorks", () => {
  it("returns nothing on a fresh device or a corrupt index", () => {
    expect(listLocalWorks()).toEqual([]);
    localStorage.setItem(WORKS_KEY, "{not json");
    expect(listLocalWorks()).toEqual([]);
    localStorage.setItem(WORKS_KEY, JSON.stringify({ id: "not-a-list" }));
    expect(listLocalWorks()).toEqual([]);
  });

  it("skips malformed entries and keeps the rest", () => {
    localStorage.setItem(
      WORKS_KEY,
      JSON.stringify([
        { id: "ok", kind: "metronome", title: "120", createdAt: "2026-02-02T00:00:00Z" },
        { id: "", kind: "metronome" },
        42,
        { id: "also", kind: "tuner" },
      ]),
    );
    expect(listLocalWorks().map((item) => item.id)).toEqual(["ok", "also"]);
  });
});

describe("sortNewestFirst", () => {
  it("orders by creation time and survives a missing one", () => {
    const sorted = sortNewestFirst([
      work({ id: "old", createdAt: "2026-01-01T00:00:00Z" }),
      work({ id: "none", createdAt: undefined as unknown as string }),
      work({ id: "new", createdAt: "2026-03-01T00:00:00Z" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["new", "old", "none"]);
  });
});

describe("the older tables", () => {
  it("reads a transcription into the shared shape", () => {
    const item = fromTranscription({
      id: "row",
      user_id: "u",
      title: "מנגינה",
      source_name: "tune.wav",
      note_count: 12,
      duration_seconds: 8.5,
      bpm: 96,
      key_name: "G major",
      analysis_offset: 0.25,
      raw_notes: [{ midi: 60, start: 0, duration: 0.5, confidence: 0.9 }],
      settings: { mode: "melody" },
      created_at: "2026-05-05T12:00:00Z",
    });
    expect(item.kind).toBe("notes");
    expect(item.origin).toBe("transcriptions");
    expect(item.rowId).toBe("row");
    expect(item.payload.notes).toHaveLength(1);
    expect(item.payload.analysisOffset).toBe(0.25);
    expect(describeWork(item)).toBe("12 תווים · 96 BPM · G major");
  });

  it("reads a ringtone into the shared shape", () => {
    const item = fromRingtone(
      {
        id: "client",
        title: "צלצול",
        sourceName: "song.mp3",
        startSeconds: 61,
        durationSeconds: 30,
        createdAt: "2026-05-05T12:00:00Z",
      },
      true,
    );
    expect(item.kind).toBe("ringtone");
    expect(item.origin).toBe("ringtones");
    expect(item.localOnly).toBe(true);
    expect(item.filePath).toBeNull();
    expect(describeWork(item)).toBe("30 שניות · מ־1:01");
  });
});

describe("describeWork", () => {
  it("says what each kind of work is", () => {
    expect(
      describeWork(work({ kind: "vocals", summary: { target: "vocals", usedAi: true, duration: 200 } })),
    ).toBe("שירה בלבד · הפרדת AI · 200 שניות");
    expect(
      describeWork(work({ kind: "speed", summary: { speed: 75, semitones: -2, duration: 180.4 } })),
    ).toBe("75% מהירות · -2 חצאי טונים · 180 שניות");
    expect(describeWork(work({ kind: "piano", summary: { noteCount: 9, duration: 4, timbre: "organ" } }))).toBe(
      "9 תווים · 4 שניות · אורגן",
    );
    expect(
      describeWork(work({ kind: "analysis", summary: { bpm: 127.6, keyName: "A מינור", camelot: "8A" } })),
    ).toBe("128 BPM · A מינור · Camelot 8A");
    expect(
      describeWork(
        work({
          kind: "ear",
          summary: { modeLabel: "מרווחים", levelLabel: "מתחיל", asked: 10, correct: 8, accuracy: 80 },
        }),
      ),
    ).toBe("מרווחים · מתחיל · 8/10 נכונות · 80% דיוק");
    expect(
      describeWork(work({ kind: "metronome", summary: { bpm: 120, meter: "3/4", subdivisionLabel: "שמיניות" } })),
    ).toBe("120 BPM · 3/4 · שמיניות");
    expect(describeWork(work({ kind: "tuner", summary: { presetLabel: "גיטרה", referenceA4: 442 } }))).toBe(
      "גיטרה · לה = 442 Hz",
    );
  });

  it("leaves out what a summary does not have", () => {
    expect(describeWork(work({ kind: "vocals", summary: {} }))).toBe("קריוקי");
    expect(describeWork(work({ kind: "notes", summary: {} }))).toBe("");
  });
});
