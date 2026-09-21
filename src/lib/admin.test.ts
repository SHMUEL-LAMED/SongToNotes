import { describe, expect, it } from "vitest";
import {
  activeUsers,
  changeOverRange,
  compactNumber,
  dayKey,
  dayRange,
  digestUsers,
  formatBytes,
  isAdminEmail,
  normalizeSnapshot,
  seriesByDay,
  tally,
  timeAgo,
  toCsv,
  weekHeatmap,
  type AdminSnapshot,
  type AdminWork,
} from "./admin";

function work(overrides: Partial<AdminWork> = {}): AdminWork {
  return {
    id: "w1",
    origin: "works",
    userId: "u1",
    kind: "vocals",
    title: "שיר",
    source: null,
    createdAt: "2026-03-10T09:00:00.000Z",
    hasFile: true,
    ...overrides,
  };
}

describe("the admin gate", () => {
  it("knows the owner in either spelling of the address", () => {
    expect(isAdminEmail("0534169095@xn--4dbjbascrao3i.com")).toBe(true);
    expect(isAdminEmail("0534169095@שמואלליווי.com")).toBe(true);
    expect(isAdminEmail(" 0534169095@XN--4DBJBASCRAO3I.COM ")).toBe(true);
  });

  it("lets nobody else through", () => {
    expect(isAdminEmail("someone@gmail.com")).toBe(false);
    expect(isAdminEmail("0534169095@gmail.com")).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    // A lookalike address that merely ends with the owner's is not the owner.
    expect(isAdminEmail("x0534169095@xn--4dbjbascrao3i.com")).toBe(false);
  });
});

describe("the server's reply", () => {
  it("becomes one shape, whichever column a tally came from", () => {
    const snapshot = normalizeSnapshot({
      generatedAt: "2026-03-10T10:00:00.000Z",
      days: 30,
      totals: { users: 4, works: 9, shares: 2 },
      users: [],
      works: [],
      ai: [{ user_id: "u1", day: "2026-03-10", kind: "ai", amount: 1200 }],
      stt: [{ user_id: "u1", day: "2026-03-10", seconds: 90 }],
      shares: [
        {
          token: "abc",
          user_id: "u1",
          origin: "works",
          work_id: "w1",
          kind: "vocals",
          title: "שיר",
          views: 7,
          created_at: "2026-03-01T00:00:00.000Z",
          revoked_at: null,
        },
      ],
      storage: [{ user_id: "u1", files: 3, bytes: 2048 }],
    });

    expect(snapshot.ai[0]).toEqual({ userId: "u1", day: "2026-03-10", kind: "ai", amount: 1200 });
    expect(snapshot.stt[0]).toEqual({ userId: "u1", day: "2026-03-10", kind: "stt", amount: 90 });
    expect(snapshot.shares[0].views).toBe(7);
    expect(snapshot.storage[0].bytes).toBe(2048);
    expect(snapshot.truncated).toEqual({ works: false, users: false });
  });

  it("survives a reply with nothing in it", () => {
    const snapshot = normalizeSnapshot({});
    expect(snapshot.users).toEqual([]);
    expect(snapshot.totals.works).toBe(0);
  });
});

describe("counting by day", () => {
  it("keeps a point for every day, including the quiet ones", () => {
    const days = dayRange(3, new Date("2026-03-10T12:00:00"));
    const points = seriesByDay(
      [
        work({ createdAt: "2026-03-10T09:00:00" }),
        work({ createdAt: "2026-03-10T11:00:00" }),
        work({ createdAt: "2026-03-08T11:00:00" }),
      ],
      (item) => dayKey(item.createdAt),
      days,
    );
    expect(points.map((point) => point.value)).toEqual([1, 0, 2]);
  });

  it("weighs a point when the rows carry an amount", () => {
    const days = dayRange(2, new Date("2026-03-10T12:00:00"));
    const points = seriesByDay(
      [
        { day: "2026-03-10", amount: 500 },
        { day: "2026-03-10", amount: 250 },
      ],
      (item) => item.day,
      days,
      (item) => item.amount,
    );
    expect(points[1].value).toBe(750);
  });

  it("ignores what falls outside the range", () => {
    const days = dayRange(2, new Date("2026-03-10T12:00:00"));
    const points = seriesByDay([work({ createdAt: "2025-01-01T00:00:00" })], (item) => dayKey(item.createdAt), days);
    expect(points.every((point) => point.value === 0)).toBe(true);
  });
});

describe("the change across a range", () => {
  it("compares the second half with the first", () => {
    expect(changeOverRange([{ day: "a", value: 10 }, { day: "b", value: 10 }, { day: "c", value: 15 }, { day: "d", value: 15 }])).toBe(50);
  });

  it("says nothing rather than „+100%” when there is no before", () => {
    expect(changeOverRange([{ day: "a", value: 0 }, { day: "b", value: 0 }, { day: "c", value: 4 }, { day: "d", value: 4 }])).toBeNull();
    expect(changeOverRange([{ day: "a", value: 1 }])).toBeNull();
  });

  it("is zero when nothing happened at all", () => {
    expect(changeOverRange([{ day: "a", value: 0 }, { day: "b", value: 0 }, { day: "c", value: 0 }, { day: "d", value: 0 }])).toBe(0);
  });
});

describe("tallies", () => {
  it("counts by key, biggest first", () => {
    const result = tally(
      [work({ kind: "vocals" }), work({ kind: "notes" }), work({ kind: "vocals" })],
      (item) => item.kind,
    );
    expect(result).toEqual([
      { key: "vocals", value: 2 },
      { key: "notes", value: 1 },
    ]);
  });
});

describe("who is active", () => {
  it("counts an account once, and only inside the window", () => {
    const now = new Date("2026-03-10T12:00:00");
    const seen = activeUsers(
      [
        work({ userId: "u1", createdAt: "2026-03-09T12:00:00" }),
        work({ userId: "u1", createdAt: "2026-03-08T12:00:00" }),
        work({ userId: "u2", createdAt: "2026-01-01T12:00:00" }),
      ],
      7,
      now,
    );
    expect([...seen]).toEqual(["u1"]);
  });
});

describe("the week heatmap", () => {
  it("is seven rows of twenty-four", () => {
    const grid = weekHeatmap([work({ createdAt: "2026-03-10T09:30:00" })]);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    const date = new Date("2026-03-10T09:30:00");
    expect(grid[date.getDay()][date.getHours()]).toBe(1);
  });
});

describe("the per-account digest", () => {
  const snapshot: AdminSnapshot = {
    generatedAt: "2026-03-10T10:00:00.000Z",
    days: 30,
    truncated: { works: false, users: false },
    totals: { users: 2, works: 3, shares: 1 },
    users: [
      {
        id: "u1",
        email: "a@example.com",
        name: "א",
        avatar: null,
        provider: "google",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSignInAt: "2026-03-10T08:00:00.000Z",
        bannedUntil: null,
      },
      {
        id: "u2",
        email: "b@example.com",
        name: null,
        avatar: null,
        provider: "google",
        createdAt: "2026-02-01T00:00:00.000Z",
        lastSignInAt: null,
        bannedUntil: "2030-01-01T00:00:00.000Z",
      },
    ],
    works: [
      work({ userId: "u1", createdAt: "2026-03-01T00:00:00.000Z" }),
      work({ userId: "u1", createdAt: "2026-03-09T00:00:00.000Z" }),
      work({ userId: "u2", createdAt: "2026-02-20T00:00:00.000Z" }),
    ],
    ai: [
      { userId: "u1", day: "2026-03-09", kind: "ai", amount: 1000 },
      { userId: "u1", day: "2026-03-10", kind: "separation", amount: 2 },
    ],
    stt: [{ userId: "u2", day: "2026-03-09", kind: "stt", amount: 120 }],
    shares: [
      {
        token: "t",
        userId: "u1",
        origin: "works",
        workId: "w1",
        kind: "vocals",
        title: "שיר",
        views: 5,
        createdAt: "2026-03-02T00:00:00.000Z",
        revokedAt: null,
      },
    ],
    storage: [{ userId: "u1", files: 2, bytes: 4096 }],
  };

  it("gathers every list onto its account", () => {
    const [first, second] = digestUsers(snapshot, new Date("2026-03-10T12:00:00.000Z"));
    expect(first.works).toBe(2);
    expect(first.lastWorkAt).toBe("2026-03-09T00:00:00.000Z");
    expect(first.bytes).toBe(4096);
    expect(first.aiAmount).toBe(1002);
    expect(first.shareViews).toBe(5);
    expect(first.banned).toBe(false);
    expect(second.sttSeconds).toBe(120);
    expect(second.banned).toBe(true);
  });

  it("leaves an account with nothing saved at zero, not undefined", () => {
    const empty = digestUsers({ ...snapshot, works: [], storage: [], ai: [], stt: [], shares: [] });
    expect(empty[0].works).toBe(0);
    expect(empty[0].bytes).toBe(0);
    expect(empty[0].lastWorkAt).toBeNull();
  });

  it("stops counting a block once it has run out", () => {
    const [, second] = digestUsers(snapshot, new Date("2031-01-01T00:00:00.000Z"));
    expect(second.banned).toBe(false);
  });
});

describe("writing numbers for people", () => {
  it("keeps small numbers whole and shortens big ones", () => {
    expect(compactNumber(842)).toBe("842");
    expect(compactNumber(12_900)).toBe("12.9K");
    expect(compactNumber(3_100_000)).toBe("3.1M");
  });

  it("scales bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("says how long ago something was", () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    expect(timeAgo("2026-03-10T11:30:00.000Z", now)).toBe("לפני 30 דק׳");
    expect(timeAgo(null, now)).toBe("—");
  });
});

describe("the CSV export", () => {
  it("quotes what would otherwise break a column", () => {
    const csv = toCsv([{ title: 'a,"b"', count: 2 }]);
    expect(csv.split("\n")[0]).toBe("title,count");
    expect(csv.split("\n")[1]).toBe('"a,""b""",2');
  });

  it("is empty for an empty list", () => {
    expect(toCsv([])).toBe("");
  });
});
