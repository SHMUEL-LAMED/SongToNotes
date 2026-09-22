import { describe, expect, it } from "vitest";
import {
  activityByDay,
  expiryLabel,
  exportName,
  filterWorks,
  monthCount,
  personalHeatmap,
  storageByKind,
  streak,
  topKind,
} from "./me";
import type { SavedWork } from "./works";

function work(over: Partial<SavedWork> & { createdAt: string }): SavedWork {
  return {
    id: over.id ?? over.createdAt,
    kind: "notes",
    title: "שיר",
    sourceName: null,
    summary: {},
    payload: {},
    fileName: null,
    deviceId: null,
    filePath: null,
    updatedAt: over.createdAt,
    origin: "works",
    rowId: null,
    localOnly: false,
    ...over,
  };
}

const at = (day: number, hour = 12) => new Date(2026, 2, day, hour).toISOString();

describe("a streak", () => {
  it("counts consecutive days up to today", () => {
    const works = [work({ createdAt: at(12) }), work({ createdAt: at(13) }), work({ createdAt: at(14) })];
    expect(streak(works, new Date(2026, 2, 14, 20))).toBe(3);
  });

  it("does not break because today is not over", () => {
    const works = [work({ createdAt: at(12) }), work({ createdAt: at(13) })];
    expect(streak(works, new Date(2026, 2, 14, 9))).toBe(2);
  });

  it("ends at the first empty day", () => {
    const works = [work({ createdAt: at(10) }), work({ createdAt: at(13) }), work({ createdAt: at(14) })];
    expect(streak(works, new Date(2026, 2, 14))).toBe(2);
    expect(streak([], new Date())).toBe(0);
  });
});

describe("the month and the top tool", () => {
  it("counts what this month holds", () => {
    const works = [work({ createdAt: at(1) }), work({ createdAt: at(20) }), work({ createdAt: new Date(2026, 1, 3).toISOString() })];
    expect(monthCount(works, new Date(2026, 2, 14))).toBe(2);
  });

  it("names the most used tool", () => {
    const works = [work({ createdAt: at(1), kind: "ear" }), work({ createdAt: at(2), kind: "ear" }), work({ createdAt: at(3) })];
    expect(topKind(works)).toEqual({ kind: "ear", count: 2 });
    expect(topKind([])).toBeNull();
  });

  it("draws one point per day", () => {
    const works = [work({ createdAt: at(13) }), work({ createdAt: at(13, 15) })];
    expect(activityByDay(works, ["2026-03-12", "2026-03-13"])).toEqual([
      { day: "2026-03-12", value: 0 },
      { day: "2026-03-13", value: 2 },
    ]);
  });

  it("places each work on the week", () => {
    const grid = personalHeatmap([work({ createdAt: at(14, 9) })]);
    const weekday = new Date(2026, 2, 14).getDay();
    expect(grid[weekday][9]).toBe(1);
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("storage by tool", () => {
  it("takes the larger of the cloud and device copies, and skips the empty", () => {
    const works = [
      work({ id: "a", createdAt: at(1), kind: "vocals", summary: { fileBytes: 500 } }),
      work({ id: "b", createdAt: at(2), kind: "vocals" }),
      work({ id: "c", createdAt: at(3), kind: "notes" }),
    ];
    const rows = storageByKind(works, [{ id: "a", size: 800 }, { id: "b", size: 100 }]);
    expect(rows).toEqual([{ kind: "vocals", label: "הסרת שירה", count: 2, bytes: 900 }]);
  });
});

describe("finding a work", () => {
  const works = [
    work({ id: "1", createdAt: at(1), title: "ירושלים של זהב", kind: "notes" }),
    work({ id: "2", createdAt: at(2), title: "צלצול לבוקר", kind: "ringtone" }),
    work({ id: "3", createdAt: at(3), title: "אימון", kind: "ear" }),
  ];
  const marks = { "2": { star: true, tags: ["בוקר"] } };

  it("searches titles, kinds and tags", () => {
    expect(filterWorks(works, { query: "זהב" }, marks).map((item) => item.id)).toEqual(["1"]);
    expect(filterWorks(works, { query: "צלצול" }, marks).map((item) => item.id)).toEqual(["2"]);
    expect(filterWorks(works, { query: "בוקר" }, marks).map((item) => item.id)).toEqual(["2"]);
  });

  it("narrows by star, tag and kind", () => {
    expect(filterWorks(works, { starred: true }, marks).map((item) => item.id)).toEqual(["2"]);
    expect(filterWorks(works, { tag: "בוקר" }, marks).map((item) => item.id)).toEqual(["2"]);
    expect(filterWorks(works, { kind: "ear" }, marks).map((item) => item.id)).toEqual(["3"]);
  });

  it("sorts as asked", () => {
    expect(filterWorks(works, {}, marks, undefined, "newest").map((item) => item.id)).toEqual(["3", "2", "1"]);
    expect(filterWorks(works, {}, marks, undefined, "oldest").map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(filterWorks(works, {}, marks, undefined, "title")[0].id).toBe("3");
  });
});

describe("naming things", () => {
  it("says how long a link has left", () => {
    const now = new Date("2026-03-14T12:00:00.000Z");
    expect(expiryLabel(null, now)).toBe("ללא תפוגה");
    expect(expiryLabel("2026-03-14T10:00:00.000Z", now)).toBe("פג תוקף");
    expect(expiryLabel("2026-03-14T15:00:00.000Z", now)).toBe("עוד 3 שע׳");
    expect(expiryLabel("2026-03-20T12:00:00.000Z", now)).toBe("עוד 6 ימים");
  });

  it("files a work under its tool with its extension", () => {
    expect(exportName(work({ createdAt: at(1), title: "שיר", kind: "vocals" }), "x.wav")).toBe("הסרת שירה/שיר.wav");
    expect(exportName(work({ createdAt: at(1), title: "שיר" }), null)).toBe("תווים/שיר");
  });
});
