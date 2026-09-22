/**
 * The personal area's arithmetic: what a visitor's own saved work adds up to.
 *
 * Everything here is pure and runs on the list the browser already holds, so
 * a streak, a month's count or a storage meter costs nothing and needs no
 * server. It is the visitor's own data about themselves — the one place on
 * the site where "what did I do" is exactly the right question.
 */
import { dayKey, type Point } from "./admin";
import { isStarred, tagsOf, type Marks } from "./marks";
import { KIND_LABELS, type SavedWork, type WorkKind } from "./works";

/** How many works were saved on each of `days`, oldest first. */
export function activityByDay(works: readonly SavedWork[], days: readonly string[]): Point[] {
  const table = new Map(days.map((day) => [day, 0]));
  for (const work of works) {
    const day = dayKey(work.createdAt);
    const current = table.get(day);
    if (current !== undefined) table.set(day, current + 1);
  }
  return days.map((day) => ({ day, value: table.get(day) ?? 0 }));
}

/**
 * Consecutive days with something saved, counted back from today. A day
 * without anything yet does not break a streak that ran up to yesterday —
 * the day is not over.
 */
export function streak(works: readonly SavedWork[], today: Date = new Date()) {
  const days = new Set(works.map((work) => dayKey(work.createdAt)).filter(Boolean));
  if (!days.size) return 0;
  let cursor = new Date(today.getTime());
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - 86_400_000);
  let count = 0;
  while (days.has(dayKey(cursor))) {
    count += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return count;
}

/** Works saved in the calendar month `now` falls in. */
export function monthCount(works: readonly SavedWork[], now: Date = new Date()) {
  const prefix = dayKey(now).slice(0, 7);
  return works.filter((work) => dayKey(work.createdAt).startsWith(prefix)).length;
}

/** The tool used most, with how many times. */
export function topKind(works: readonly SavedWork[]): { kind: WorkKind; count: number } | null {
  const table = new Map<WorkKind, number>();
  for (const work of works) table.set(work.kind, (table.get(work.kind) ?? 0) + 1);
  let best: { kind: WorkKind; count: number } | null = null;
  for (const [kind, count] of table) {
    if (!best || count > best.count) best = { kind, count };
  }
  return best;
}

/** Seven rows of twenty-four: when this person tends to make things. */
export function personalHeatmap(works: readonly SavedWork[]) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  for (const work of works) {
    const date = new Date(work.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    grid[date.getDay()][date.getHours()] += 1;
  }
  return grid;
}

export type StorageRow = { kind: WorkKind; label: string; count: number; bytes: number };

/**
 * What each tool's files weigh, in the cloud and on this device together.
 * A work's own `fileBytes` says what went up; the device list says what is
 * held here. Where both exist the larger is taken — it is one file.
 */
export function storageByKind(
  works: readonly SavedWork[],
  deviceFiles: readonly { id: string; size: number }[],
): StorageRow[] {
  const sizes = new Map(deviceFiles.map((file) => [file.id, file.size]));
  const table = new Map<WorkKind, StorageRow>();
  for (const work of works) {
    const cloud = Number(work.summary.fileBytes ?? 0) || 0;
    const local = sizes.get(work.id) ?? 0;
    const bytes = Math.max(cloud, local);
    const row = table.get(work.kind) ?? { kind: work.kind, label: KIND_LABELS[work.kind], count: 0, bytes: 0 };
    if (bytes > 0) {
      row.count += 1;
      row.bytes += bytes;
    }
    table.set(work.kind, row);
  }
  return [...table.values()].filter((row) => row.bytes > 0).sort((a, b) => b.bytes - a.bytes);
}

export type WorkFilter = {
  query?: string;
  kind?: WorkKind | "all";
  tag?: string | null;
  starred?: boolean;
};

export type WorkSort = "newest" | "oldest" | "title" | "kind";

/** The works that match, in the order asked for. Pure, so typing is instant. */
export function filterWorks(
  works: readonly SavedWork[],
  filter: WorkFilter,
  marks: Marks,
  describe: (work: SavedWork) => string = () => "",
  sort: WorkSort = "newest",
) {
  const needle = (filter.query ?? "").trim().toLowerCase();
  const list = works.filter((work) => {
    if (filter.kind && filter.kind !== "all" && work.kind !== filter.kind) return false;
    if (filter.starred && !isStarred(marks, work.id)) return false;
    if (filter.tag && !tagsOf(marks, work.id).includes(filter.tag)) return false;
    if (!needle) return true;
    return [work.title, work.sourceName ?? "", KIND_LABELS[work.kind], describe(work), ...tagsOf(marks, work.id)]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  switch (sort) {
    case "title":
      return list.sort((a, b) => a.title.localeCompare(b.title, "he"));
    case "oldest":
      return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "kind":
      return list.sort(
        (a, b) => KIND_LABELS[a.kind].localeCompare(KIND_LABELS[b.kind], "he") || b.createdAt.localeCompare(a.createdAt),
      );
    default:
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** "פג תוקף", "עוד 3 ימים", "ללא תפוגה" — how long a link still has. */
export function expiryLabel(expiresAt: string | null, now: Date = new Date()) {
  if (!expiresAt) return "ללא תפוגה";
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return "ללא תפוגה";
  const left = at - now.getTime();
  if (left <= 0) return "פג תוקף";
  const hours = Math.ceil(left / 3_600_000);
  if (hours < 24) return `עוד ${hours} שע׳`;
  return `עוד ${Math.ceil(hours / 24)} ימים`;
}

/** A file name a folder in the ZIP can carry: the title, then the kind. */
export function exportName(work: SavedWork, fileName: string | null) {
  const extension = fileName?.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${KIND_LABELS[work.kind]}/${work.title}${extension}`;
}
