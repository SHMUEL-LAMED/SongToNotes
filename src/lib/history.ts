import type { DetectedNote } from "./types";
import { supabase } from "./supabase";

export type SavedTranscription = {
  id: string;
  user_id: string;
  title: string;
  source_name: string | null;
  note_count: number;
  duration_seconds: number;
  bpm: number;
  key_name: string | null;
  analysis_offset: number;
  raw_notes: DetectedNote[];
  settings: Record<string, unknown>;
  created_at: string;
};

export async function listTranscriptions(userId: string) {
  const { data, error } = await supabase
    .from("transcriptions")
    .select(
      "id, user_id, title, source_name, note_count, duration_seconds, bpm, key_name, analysis_offset, raw_notes, settings, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []) as SavedTranscription[];
}

export async function saveTranscription(
  item: Omit<SavedTranscription, "id" | "created_at">,
) {
  const { data, error } = await supabase
    .from("transcriptions")
    .insert(item)
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function deleteTranscription(id: string, userId: string) {
  const { error } = await supabase
    .from("transcriptions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}
