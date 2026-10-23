/**
 * How the assistant's history page reads the stored conversations: a line of
 * preview for each, the date group it falls in, a search through titles and
 * everything said, and the threads the visitor pinned to the top.
 *
 * Nothing here changes a conversation; {@link ./assistantChats} keeps them.
 * Pins are a preference of this device, like the panel's width, so they live
 * in its storage rather than in the profile.
 */
import type { Chat, StoredMessage } from "./assistantChats";
import { parseAssistantReply } from "./assistantProtocol";

const PIN_KEY = "musictools.assistant.pinned.v1";
const PREVIEW = 110;

/** A message as plain words: no plan or action blocks, no Markdown marks. */
export function plainText(message: StoredMessage) {
  const source = message.role === "assistant" ? parseAssistantReply(message.content).text : message.content;
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cut(text: string, length = PREVIEW) {
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

/** The last thing said in the thread that has words in it, for the line under its title. */
export function chatPreview(chat: Chat) {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.hidden) continue;
    const text = plainText(message);
    if (text) return cut(text);
  }
  return "";
}

/** Whether the agent carried anything out in this thread. */
export function chatDidActions(chat: Chat) {
  return chat.messages.some((message) => (message.actions?.length ?? 0) > 0);
}

/** How many turns the visitor sees. */
export function visibleCount(chat: Chat) {
  return chat.messages.filter((message) => !message.hidden).length;
}

export type HistoryGroup = "pinned" | "today" | "yesterday" | "week" | "month" | "older";

export const GROUP_LABELS: Record<HistoryGroup, string> = {
  pinned: "מוצמדות",
  today: "היום",
  yesterday: "אתמול",
  week: "השבוע האחרון",
  month: "החודש האחרון",
  older: "קודם",
};

const ORDER: HistoryGroup[] = ["pinned", "today", "yesterday", "week", "month", "older"];

/** The group a thread's last change falls in, by the visitor's own calendar days. */
export function dateGroup(updatedAt: string, now = new Date()): Exclude<HistoryGroup, "pinned"> {
  const when = new Date(updatedAt);
  if (Number.isNaN(when.getTime())) return "older";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const time = when.getTime();
  if (time >= startOfToday) return "today";
  if (time >= startOfToday - day) return "yesterday";
  if (time >= startOfToday - 6 * day) return "week";
  if (time >= startOfToday - 29 * day) return "month";
  return "older";
}

export type HistoryEntry = {
  chat: Chat;
  /** The words under the title: the match when searching, the last reply otherwise. */
  preview: string;
  pinned: boolean;
};

export type HistorySection = { group: HistoryGroup; label: string; entries: HistoryEntry[] };

/** A few words either side of where the search hit, so the visitor sees why it matched. */
function snippet(text: string, at: number, length: number) {
  const before = 36;
  const start = Math.max(0, at - before);
  const end = Math.min(text.length, at + length + PREVIEW - before);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Where a thread matches the search, as the line to show; null when it does
 * not. Every word of the query has to appear, in the title or in what was
 * said, in any order and any case.
 */
export function matchChat(chat: Chat, query: string): string | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return chatPreview(chat);
  const texts = chat.messages.filter((message) => !message.hidden).map(plainText).filter(Boolean);
  const haystack = `${chat.title}\n${texts.join("\n")}`.toLowerCase();
  if (!words.every((word) => haystack.includes(word))) return null;
  // The line to show is the first message holding the first word; a match
  // only in the title shows the usual preview.
  for (const text of texts) {
    const at = text.toLowerCase().indexOf(words[0]);
    if (at >= 0) return snippet(text, at, words[0].length);
  }
  return chatPreview(chat);
}

/**
 * The page's sections, in order: the pinned threads first, then by date,
 * newest first within each. Empty threads are left out, and so is every
 * thread the search does not reach.
 */
export function historySections(chats: Chat[], options: { query?: string; pinned?: ReadonlySet<string>; now?: Date } = {}): HistorySection[] {
  const pinned = options.pinned ?? new Set<string>();
  const query = (options.query ?? "").trim();
  const buckets = new Map<HistoryGroup, HistoryEntry[]>();
  const sorted = [...chats]
    .filter((chat) => chat.messages.some((message) => !message.hidden))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const chat of sorted) {
    const preview = matchChat(chat, query);
    if (preview === null) continue;
    const isPinned = pinned.has(chat.id);
    const group: HistoryGroup = isPinned ? "pinned" : dateGroup(chat.updatedAt, options.now);
    const list = buckets.get(group) ?? [];
    list.push({ chat, preview, pinned: isPinned });
    buckets.set(group, list);
  }
  return ORDER.filter((group) => buckets.has(group)).map((group) => ({ group, label: GROUP_LABELS[group], entries: buckets.get(group)! }));
}

// ---------------------------------------------------------------------------
// Pins, on this device
// ---------------------------------------------------------------------------

function pinKey(userId: string | null) {
  return `${PIN_KEY}.${userId ?? "guest"}`;
}

export function readPins(userId: string | null): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(pinKey(userId)) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writePins(userId: string | null, pins: ReadonlySet<string>) {
  try {
    localStorage.setItem(pinKey(userId), JSON.stringify([...pins]));
  } catch {
    // A private window keeps the pins for the visit only.
  }
}
