export const RINGTONE_HISTORY_KEY = "music-tools.ringtone-history.v1";

export type SavedRingtone = {
  id: string;
  title: string;
  sourceName: string;
  startSeconds: number;
  durationSeconds: number;
  createdAt: string;
};

export function listRingtones(): SavedRingtone[] {
  try {
    const value = JSON.parse(localStorage.getItem(RINGTONE_HISTORY_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedRingtone =>
      Boolean(item && typeof item.id === "string" && typeof item.title === "string"),
    ).slice(0, 50);
  } catch {
    return [];
  }
}

export function deleteRingtone(id: string) {
  const items = listRingtones().filter((item) => item.id !== id);
  localStorage.setItem(RINGTONE_HISTORY_KEY, JSON.stringify(items));
}
