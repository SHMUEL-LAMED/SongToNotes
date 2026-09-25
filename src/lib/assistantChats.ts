/**
 * The assistant's conversations: a thread the visitor can leave, come back
 * to, rename or throw away, the way any chat app keeps them.
 *
 * A conversation is written to this device first, so it survives a refresh
 * and works without an account, and mirrored to the profile when there is
 * one — the same local-first shape the personal area already uses
 * ({@link ./works}). Signing in uploads whatever this browser made while
 * signed out; opening the panel on another device brings the threads down.
 *
 * Nothing here trims a conversation for length. What the model can hold is
 * the server's business ({@link ../../supabase/functions/ai/index.ts}),
 * which fills its budget from the newest turn backwards and says so when
 * something did not fit.
 */
import { getSupabase } from "./supabase";

export type StoredAction = {
  id: string;
  params: Record<string, unknown>;
  ok: boolean;
  message: string;
  cancelled?: boolean;
};

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  /** The site's own report of what its actions did: sent to the model, never shown. */
  hidden?: boolean;
  actions?: StoredAction[];
  /** The model that wrote an assistant turn. */
  model?: string;
};

export type Chat = {
  id: string;
  title: string;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
  /** True while this device is the only place the thread exists. */
  localOnly: boolean;
};

const KEY = "musictools.assistant.chats.v1";
/** Threads kept on this device. Older ones fall off the end. */
const MAX_CHATS = 60;
const MAX_TITLE = 80;

export function chatsKey(userId: string | null) {
  return `${KEY}.${userId ?? "guest"}`;
}

export function newChatId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A conversation's name, from the first thing the visitor asked. */
export function titleFrom(messages: StoredMessage[]) {
  const first = messages.find((item) => item.role === "user" && !item.hidden);
  const clean = (first?.content ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "שיחה חדשה";
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE).trimEnd()}…` : clean;
}

export function emptyChat(): Chat {
  const now = new Date().toISOString();
  return { id: newChatId(), title: "שיחה חדשה", messages: [], createdAt: now, updatedAt: now, localOnly: true };
}

// ---------------------------------------------------------------------------
// Reading and writing what a stored thread is
// ---------------------------------------------------------------------------

function asAction(value: unknown): StoredAction | null {
  if (!value || typeof value !== "object") return null;
  const item = value as StoredAction;
  if (typeof item.id !== "string" || typeof item.ok !== "boolean" || typeof item.message !== "string") return null;
  return {
    id: item.id,
    params: item.params && typeof item.params === "object" && !Array.isArray(item.params) ? item.params : {},
    ok: item.ok,
    message: item.message,
    ...(item.cancelled === true ? { cancelled: true } : {}),
  };
}

export function normalizeMessages(value: unknown): StoredMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): StoredMessage | null => {
      if (!item || typeof item !== "object") return null;
      const message = item as StoredMessage;
      if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return null;
      const actions = Array.isArray(message.actions)
        ? message.actions.map(asAction).filter((action): action is StoredAction => action !== null)
        : [];
      return {
        role: message.role,
        content: message.content,
        ...(message.hidden === true ? { hidden: true } : {}),
        ...(actions.length ? { actions } : {}),
        ...(typeof message.model === "string" && message.model ? { model: message.model.slice(0, 80) } : {}),
      };
    })
    .filter((item): item is StoredMessage => item !== null);
}

function normalizeChat(value: unknown): Chat | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Chat;
  if (typeof item.id !== "string" || !item.id) return null;
  const messages = normalizeMessages(item.messages);
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
  return {
    id: item.id,
    title: typeof item.title === "string" && item.title.trim() ? item.title.slice(0, MAX_TITLE) : titleFrom(messages),
    messages,
    createdAt,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt,
    localOnly: item.localOnly !== false,
  };
}

export function sortNewestFirst(chats: Chat[]) {
  return [...chats].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// ---------------------------------------------------------------------------
// This device
// ---------------------------------------------------------------------------

export function readLocal(userId: string | null): Chat[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(chatsKey(userId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return sortNewestFirst(parsed.map(normalizeChat).filter((item): item is Chat => item !== null));
  } catch {
    return [];
  }
}

/**
 * Writes the threads to this device. A browser that refuses — private mode,
 * or a store already full of long conversations — drops the oldest and tries
 * again rather than losing the thread in front of the visitor.
 */
export function writeLocal(userId: string | null, chats: Chat[]) {
  const ordered = sortNewestFirst(chats).slice(0, MAX_CHATS);
  for (let keep = ordered.length; keep > 0; keep -= Math.max(1, Math.ceil(keep / 4))) {
    try {
      localStorage.setItem(chatsKey(userId), JSON.stringify(ordered.slice(0, keep)));
      return;
    } catch {
      // Too big for the store; try again with fewer.
    }
  }
  try {
    localStorage.removeItem(chatsKey(userId));
  } catch {
    // Private browsing: the thread lives as long as the page does.
  }
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

type Row = { client_id: string; title: string; messages: unknown; created_at: string; updated_at: string };

function fromRow(row: Row): Chat {
  const messages = normalizeMessages(row.messages);
  return {
    id: row.client_id,
    title: row.title || titleFrom(messages),
    messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    localOnly: false,
  };
}

function toRow(chat: Chat, userId: string) {
  return {
    user_id: userId,
    client_id: chat.id,
    title: chat.title,
    messages: chat.messages,
    created_at: chat.createdAt,
    updated_at: chat.updatedAt,
  };
}

/**
 * Every thread, newest first: what the profile holds, plus anything this
 * device made that has not gone up yet — which it uploads on the way.
 * Without an account, or when the server cannot be reached, this device's
 * threads are the whole answer.
 */
export async function listChats(userId: string | null): Promise<Chat[]> {
  const local = readLocal(userId);
  if (!userId) return local;
  const supabase = await getSupabase();

  const pending = local.filter((chat) => chat.localOnly && chat.messages.length);
  if (pending.length) {
    const { error } = await supabase
      .from("assistant_chats")
      .upsert(pending.map((chat) => toRow(chat, userId)), { onConflict: "user_id,client_id" });
    if (!error) {
      const uploaded = new Set(pending.map((chat) => chat.id));
      writeLocal(userId, local.map((chat) => (uploaded.has(chat.id) ? { ...chat, localOnly: false } : chat)));
    }
  }

  const { data, error } = await supabase
    .from("assistant_chats")
    .select("client_id, title, messages, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_CHATS);
  if (error) return sortNewestFirst(readLocal(userId));

  // The newer of the two sides wins for each thread, so a conversation
  // continued on another device is not overwritten by a stale local copy.
  const byId = new Map<string, Chat>();
  for (const chat of readLocal(userId)) byId.set(chat.id, chat);
  for (const row of (data ?? []) as Row[]) {
    const remote = fromRow(row);
    const mine = byId.get(remote.id);
    byId.set(remote.id, !mine || remote.updatedAt >= mine.updatedAt ? remote : mine);
  }
  const merged = sortNewestFirst([...byId.values()]);
  writeLocal(userId, merged);
  return merged;
}

/** Records the thread on this device, and in the profile when there is one. */
export async function saveChat(chat: Chat, userId: string | null): Promise<Chat> {
  const updated: Chat = {
    ...chat,
    title: chat.title.trim() || titleFrom(chat.messages),
    updatedAt: new Date().toISOString(),
    localOnly: !userId,
  };
  const rest = readLocal(userId).filter((item) => item.id !== updated.id);
  if (!userId) {
    writeLocal(userId, [updated, ...rest]);
    return updated;
  }
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("assistant_chats")
    .upsert([toRow(updated, userId)], { onConflict: "user_id,client_id" });
  // A failed upload is not a lost thread: it stays here and goes up next time.
  const kept = { ...updated, localOnly: Boolean(error) };
  writeLocal(userId, [kept, ...rest]);
  return kept;
}

export async function deleteChat(id: string, userId: string | null): Promise<void> {
  writeLocal(userId, readLocal(userId).filter((item) => item.id !== id));
  if (!userId) return;
  await (await getSupabase()).from("assistant_chats").delete().eq("user_id", userId).eq("client_id", id);
}

export async function renameChat(id: string, title: string, userId: string | null): Promise<void> {
  const clean = title.trim().slice(0, MAX_TITLE);
  if (!clean) return;
  writeLocal(userId, readLocal(userId).map((item) => (item.id === id ? { ...item, title: clean } : item)));
  if (!userId) return;
  await (await getSupabase()).from("assistant_chats").update({ title: clean }).eq("user_id", userId).eq("client_id", id);
}
