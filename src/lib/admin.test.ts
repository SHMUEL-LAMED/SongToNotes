import { describe, expect, it } from "vitest";
import {
  accountSummary,
  normalizeAccounts,
  busiestHour,
  changeOverRange,
  compactNumber,
  dayKey,
  dayRange,
  formatBytes,
  formatDuration,
  funnel,
  hourLabel,
  isAdminEmail,
  normalizeControlState,
  normalizeFeedback,
  normalizeHours,
  normalizeSnapshot,
  series,
  shortDay,
  successRate,
  sumSeries,
  timeAgo,
  toCsv,
  toolHue,
  toolLabel,
  weekdayLabel,
} from "./admin";

describe("who may open the admin area", () => {
  it("accepts the owner in both spellings of the address", () => {
    expect(isAdminEmail("0534169095@xn--4dbjbascrao3i.com")).toBe(true);
    expect(isAdminEmail("0534169095@שמואלליווי.com")).toBe(true);
    expect(isAdminEmail("  0534169095@XN--4DBJBASCRAO3I.COM ")).toBe(true);
  });

  it("turns everybody else away", () => {
    expect(isAdminEmail("someone@example.com")).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });
});

describe("reading the server's reply", () => {
  it("fills in every field a missing reply left out", () => {
    const snapshot = normalizeSnapshot({});
    expect(snapshot.stats.daily).toEqual([]);
    expect(snapshot.stats.tools).toEqual([]);
    expect(snapshot.stats.hours).toHaveLength(7);
    expect(snapshot.stats.hours[0]).toHaveLength(24);
    expect(snapshot.totals.accounts).toBe(0);
    expect(snapshot.control.maintenance).toBe(false);
    expect(snapshot.days).toBe(30);
  });

  it("keeps the numbers it was given", () => {
    const snapshot = normalizeSnapshot({
      generatedAt: "2026-03-01T10:00:00.000Z",
      days: 7,
      truncated: true,
      stats: {
        daily: [{ day: "2026-02-28", views: 4, results: 2, errors: 1, visitors: 3 }],
        tools: [{ tool: "notes", views: 10, inputs: 6, results: 4, errors: 1, visitors: 7, dwellSeconds: 42, workSeconds: 8 }],
        devices: [{ key: "phone", value: 9 }, { key: "", value: 3 }],
        visitors: { total: 12, returning: 5, fresh: 7 },
        live: 2,
        views: 10,
        signedInShare: 40,
        events: 33,
        failures: [{ tool: "notes", code: "timeout", count: 2, last: "2026-02-28T09:00:00.000Z" }],
      },
      totals: { accounts: 5, works: 9, files: 4, bytes: 2048, shares: 3, shareViews: 12, liveShares: 2 },
      quotas: [{ kind: "stt", today: 60, range: 600 }],
      alerts: [{ kind: "bad", text: "יותר מדי שגיאות" }, { kind: "nonsense", text: "?" }],
      control: { maintenance: true, banner_kind: "warn", banner: " שימו לב ", disabled_tools: ["tts"] },
    });

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.stats.daily[0].visitors).toBe(3);
    expect(snapshot.stats.tools[0].dwellSeconds).toBe(42);
    // A tally without a name is noise, not a category.
    expect(snapshot.stats.devices).toEqual([{ key: "phone", value: 9 }]);
    expect(snapshot.stats.visitors).toEqual({ total: 12, returning: 5, fresh: 7 });
    expect(snapshot.totals.bytes).toBe(2048);
    expect(snapshot.quotas[0]).toEqual({ kind: "stt", today: 60, range: 600 });
    expect(snapshot.alerts.map((alert) => alert.kind)).toEqual(["bad", "info"]);
    expect(snapshot.control).toEqual({
      maintenance: true,
      maintenanceMessage: null,
      banner: "שימו לב",
      bannerKind: "warn",
      disabledTools: ["tts"],
    });
  });

  it("carries no field that could name a person", () => {
    const snapshot = normalizeSnapshot({ stats: {}, totals: {} }) as unknown as Record<string, unknown>;
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain("user");
    expect(text).not.toContain("email");
    expect(Object.keys(snapshot.stats as object)).not.toContain("users");
  });
});

describe("normalizing the odd corners", () => {
  it("repairs a half-sent heatmap", () => {
    const hours = normalizeHours([[1, 2], "not a row"]);
    expect(hours).toHaveLength(7);
    expect(hours[0][1]).toBe(2);
    expect(hours[0][5]).toBe(0);
    expect(hours[1].every((cell) => cell === 0)).toBe(true);
  });

  it("reads the control row in either spelling", () => {
    expect(normalizeControlState({ maintenanceMessage: "חוזרים בקרוב" }).maintenanceMessage).toBe("חוזרים בקרוב");
    expect(normalizeControlState({ maintenance_message: "חוזרים בקרוב" }).maintenanceMessage).toBe("חוזרים בקרוב");
    expect(normalizeControlState(null).bannerKind).toBe("info");
  });
});

describe("days", () => {
  it("names the day a moment belongs to", () => {
    expect(dayKey(new Date(2026, 2, 14, 23, 30))).toBe("2026-03-14");
    expect(dayKey("not a date")).toBe("");
  });

  it("lists a range oldest first", () => {
    const range = dayRange(3, new Date(2026, 2, 14, 12));
    expect(range).toEqual(["2026-03-12", "2026-03-13", "2026-03-14"]);
  });

  it("shortens a day for an axis", () => {
    expect(shortDay("2026-03-04")).toBe("4.3");
    expect(shortDay("nope")).toBe("nope");
  });
});

describe("the figures a tile shows", () => {
  const daily = [
    { day: "2026-03-01", views: 2, results: 1, errors: 0, visitors: 2 },
    { day: "2026-03-02", views: 2, results: 1, errors: 0, visitors: 2 },
    { day: "2026-03-03", views: 4, results: 2, errors: 1, visitors: 3 },
    { day: "2026-03-04", views: 4, results: 2, errors: 0, visitors: 3 },
  ];

  it("pulls one measure out of the daily rows", () => {
    expect(series(daily, "views")).toEqual([
      { day: "2026-03-01", value: 2 },
      { day: "2026-03-02", value: 2 },
      { day: "2026-03-03", value: 4 },
      { day: "2026-03-04", value: 4 },
    ]);
    expect(sumSeries(series(daily, "errors"))).toBe(1);
  });

  it("compares the second half of a range with the first", () => {
    expect(changeOverRange(series(daily, "views"))).toBe(100);
    expect(changeOverRange(series(daily.slice(0, 2), "views"))).toBeNull();
  });

  it("refuses to invent growth out of nothing", () => {
    const empty = [
      { day: "a", value: 0 },
      { day: "b", value: 0 },
      { day: "c", value: 3 },
      { day: "d", value: 3 },
    ];
    expect(changeOverRange(empty)).toBeNull();
    expect(changeOverRange(empty.map((point) => ({ ...point, value: 0 })))).toBe(0);
  });
});

describe("how a tool did", () => {
  it("gives a success rate only where somebody came", () => {
    expect(successRate({ views: 10, results: 4 })).toBe(40);
    expect(successRate({ views: 0, results: 0 })).toBeNull();
    // More results than views (a visit spanning midnight) still reads as full.
    expect(successRate({ views: 2, results: 5 })).toBe(100);
  });

  it("describes the three steps as shares of the widest one", () => {
    expect(funnel({ views: 10, inputs: 5, results: 2 })).toEqual([
      { label: "נכנסו", value: 10, share: 100 },
      { label: "התחילו", value: 5, share: 50 },
      { label: "קיבלו תוצאה", value: 2, share: 20 },
    ]);
  });

  it("finds the busiest cell of the week", () => {
    const hours = normalizeHours([]);
    expect(busiestHour(hours)).toBeNull();
    hours[3][14] = 9;
    expect(busiestHour(hours)).toEqual({ weekday: 3, hour: 14, value: 9 });
    expect(weekdayLabel(3)).toBe("רביעי");
    expect(hourLabel(9)).toBe("09:00");
  });
});

describe("naming a tool", () => {
  it("uses the tool's own Hebrew name and colour", () => {
    expect(toolLabel("notes")).toBe("שיר לתווים");
    expect(toolHue("notes")).toBe(292);
  });

  it("still names the pages that are not tools", () => {
    expect(toolLabel("home")).toBe("דף הבית");
    expect(toolLabel("whatever")).toBe("whatever");
    const hue = toolHue("whatever");
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
    expect(toolHue("whatever")).toBe(hue);
  });
});

describe("writing numbers for people", () => {
  it("keeps a tile short", () => {
    expect(compactNumber(842)).toBe("842");
    expect(compactNumber(12_900)).toBe("12.9K");
    expect(compactNumber(3_100_000)).toBe("3.1M");
  });

  it("says how big and how long", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(45)).toBe("45 שנ׳");
    expect(formatDuration(600)).toBe("10 דק׳");
  });

  it("says how long ago", () => {
    const now = new Date("2026-03-14T12:00:00.000Z");
    expect(timeAgo("2026-03-14T11:59:50.000Z", now)).toBe("עכשיו");
    expect(timeAgo("2026-03-14T09:00:00.000Z", now)).toBe("לפני 3 שע׳");
    expect(timeAgo(null, now)).toBe("—");
    expect(timeAgo("nonsense", now)).toBe("—");
  });

  it("writes a table a spreadsheet can open", () => {
    expect(toCsv([])).toBe("");
    expect(toCsv([{ tool: "notes", views: 3 }, { tool: 'a,"b', views: 1 }])).toBe(
      'tool,views\nnotes,3\n"a,""b",1',
    );
  });
});

describe("the visitors' feedback", () => {
  it("reads the rows as the page shows them", () => {
    const [entry] = normalizeFeedback([
      { id: 7, created_at: "2026-09-25T10:00:00Z", kind: "idea", message: "עוד סולמות", contact: "", page: "ear", language: "he", device: "phone", browser: "Safari", os: "iOS", handled: false },
    ]);
    expect(entry).toEqual({ id: 7, createdAt: "2026-09-25T10:00:00Z", kind: "idea", message: "עוד סולמות", contact: null, page: "ear", language: "he", device: "phone", browser: "Safari", os: "iOS", handled: false });
  });

  it("leaves out what is malformed and treats an unknown kind as a problem", () => {
    const rows = normalizeFeedback([null, { id: "x", created_at: "2026-09-25T10:00:00Z", message: "a" }, { id: 3, created_at: "2026-09-25T10:00:00Z", message: "b", kind: "praise", handled: true }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 3, kind: "problem", handled: true });
    expect(normalizeFeedback({})).toEqual([]);
  });
});

describe("accounts", () => {
  it("keeps well-formed rows and fills in the gaps", () => {
    const rows = normalizeAccounts([
      { id: "a", email: "x@y.com", providers: ["google"], createdAt: "2026-09-01T00:00:00Z", works: "3", bonus: null },
      { email: "no-id@y.com" },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "a", email: "x@y.com", name: null, works: 3, bonus: null, providers: ["google"] });
  });

  it("counts who signed in lately", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const rows = normalizeAccounts([
      { id: "a", createdAt: "2026-09-24T00:00:00Z", lastSignInAt: "2026-09-25T10:00:00Z" },
      { id: "b", createdAt: "2026-01-01T00:00:00Z", lastSignInAt: "2026-09-20T10:00:00Z" },
      { id: "c", createdAt: "2026-01-01T00:00:00Z", lastSignInAt: null },
    ]);
    expect(accountSummary(rows, now)).toEqual({ total: 3, today: 1, week: 2, month: 2, joinedWeek: 1 });
  });
});
