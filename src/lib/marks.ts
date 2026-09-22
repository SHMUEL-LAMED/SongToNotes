/**
 * The visitor's own marks on their work: a star and a few tags.
 *
 * These are private and local by nature — nobody else has an opinion about
 * which of your recordings matters — so they live in this browser beside the
 * works themselves and never go to the server.
 */

export type Mark = { star?: boolean; tags?: string[] };
export type Marks = Record<string, Mark>;

export const MARKS_KEY = "music-tools.marks.v1";

/** Tags stay short and few, so a card never turns into a paragraph. */
const MAX_TAGS = 6;
const MAX_TAG = 20;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseMarks(raw: string | null): Marks {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return {};
    const out: Marks = {};
    for (const [id, mark] of Object.entries(value as Record<string, unknown>)) {
      if (!mark || typeof mark !== "object") continue;
      const { star, tags } = mark as Mark;
      const clean: Mark = {};
      if (star) clean.star = true;
      if (Array.isArray(tags)) clean.tags = cleanTags(tags);
      if (clean.star || clean.tags?.length) out[id] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

export function cleanTags(tags: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const text = typeof tag === "string" ? tag.trim().slice(0, MAX_TAG) : "";
    if (text) seen.add(text);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

export function loadMarks(): Marks {
  return parseMarks(store()?.getItem(MARKS_KEY) ?? null);
}

export function saveMarks(marks: Marks) {
  store()?.setItem(MARKS_KEY, JSON.stringify(marks));
}

export function isStarred(marks: Marks, id: string) {
  return Boolean(marks[id]?.star);
}

export function tagsOf(marks: Marks, id: string) {
  return marks[id]?.tags ?? [];
}

/** Returns the marks as they should be after the star is flipped. */
export function withStar(marks: Marks, id: string, star: boolean): Marks {
  const next = { ...marks, [id]: { ...marks[id], star: star || undefined } };
  if (!next[id].star && !next[id].tags?.length) delete next[id];
  return next;
}

export function withTags(marks: Marks, id: string, tags: readonly string[]): Marks {
  const clean = cleanTags(tags);
  const next = { ...marks, [id]: { ...marks[id], tags: clean.length ? clean : undefined } };
  if (!next[id].star && !next[id].tags?.length) delete next[id];
  return next;
}

/** Every tag in use, most used first — the list the filter row shows. */
export function allTags(marks: Marks): { tag: string; count: number }[] {
  const table = new Map<string, number>();
  for (const mark of Object.values(marks)) {
    for (const tag of mark.tags ?? []) table.set(tag, (table.get(tag) ?? 0) + 1);
  }
  return [...table.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
