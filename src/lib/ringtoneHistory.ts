import { supabase } from "./supabase";

export const RINGTONE_HISTORY_KEY = "music-tools.ringtone-history.v1";

export type SavedRingtone = {
  /** Stable across devices: the id the creating device gave the ringtone. */
  id: string;
  title: string;
  sourceName: string;
  startSeconds: number;
  durationSeconds: number;
  createdAt: string;
};

type RingtoneRow = {
  client_id: string;
  title: string;
  source_name: string | null;
  start_seconds: number;
  duration_seconds: number;
  created_at: string;
};

function fromRow(row: RingtoneRow): SavedRingtone {
  return {
    id: row.client_id,
    title: row.title,
    sourceName: row.source_name ?? "",
    startSeconds: row.start_seconds,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
  };
}

function toRow(item: SavedRingtone, userId: string) {
  return {
    user_id: userId,
    client_id: item.id,
    title: item.title,
    source_name: item.sourceName || null,
    start_seconds: item.startSeconds,
    duration_seconds: item.durationSeconds,
    created_at: item.createdAt,
  };
}

/** The ringtones this device made, including the ones made without an account. */
export function listLocalRingtones(): SavedRingtone[] {
  try {
    const value = JSON.parse(localStorage.getItem(RINGTONE_HISTORY_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is SavedRingtone =>
        Boolean(item && typeof item.id === "string" && typeof item.title === "string"),
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

function writeLocalRingtones(items: SavedRingtone[]) {
  try {
    localStorage.setItem(RINGTONE_HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Storage blocked; the profile copy in Supabase is the one that matters.
  }
}

/**
 * The profile history: everything saved in Supabase, plus anything this device
 * made before signing in. Local-only ringtones are uploaded on the way, so the
 * next device sees them too. Without an account — or when Supabase is
 * unreachable — the local history alone is returned.
 */
export async function listRingtones(userId?: string | null): Promise<SavedRingtone[]> {
  const local = listLocalRingtones();
  if (!userId) return local;

  const { data, error } = await supabase
    .from("ringtones")
    .select("client_id, title, source_name, start_seconds, duration_seconds, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const saved = ((data ?? []) as RingtoneRow[]).map(fromRow);
  const savedIds = new Set(saved.map((item) => item.id));
  const missing = local.filter((item) => !savedIds.has(item.id));
  if (missing.length > 0) {
    const { error: uploadError } = await supabase
      .from("ringtones")
      .upsert(missing.map((item) => toRow(item, userId)), { onConflict: "user_id,client_id" });
    // A failed upload only means this device keeps them locally for now.
    if (uploadError) console.warn("Local ringtones could not be uploaded", uploadError);
  }

  return [...saved, ...missing].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Records a ringtone the visitor just downloaded. It is written to this
 * device first so it survives with or without an account, and mirrored to the
 * profile when there is one — the same shape `listRingtones` uploads later for
 * anything made before signing in.
 */
export async function saveRingtone(
  item: Omit<SavedRingtone, "id" | "createdAt">,
  userId?: string | null,
) {
  const entry: SavedRingtone = {
    ...item,
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  writeLocalRingtones([entry, ...listLocalRingtones()]);
  if (!userId) return entry;

  const { error } = await supabase
    .from("ringtones")
    .upsert([toRow(entry, userId)], { onConflict: "user_id,client_id" });
  // The local copy already holds it; the next profile read uploads it again.
  if (error) console.warn("Ringtone could not be saved to the profile", error);
  return entry;
}

export async function deleteRingtone(id: string, userId?: string | null) {
  writeLocalRingtones(listLocalRingtones().filter((item) => item.id !== id));
  if (!userId) return;
  const { error } = await supabase
    .from("ringtones")
    .delete()
    .eq("user_id", userId)
    .eq("client_id", id);
  if (error) throw error;
}
