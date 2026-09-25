/**
 * The audio a tool produced, kept in the visitor's own corner of the cloud.
 *
 * A saved work used to keep its file on the device that made it only; the
 * record crossed devices, the audio did not. Now the file goes up with the
 * work — into a private bucket, under the visitor's own user id, where the
 * bucket's policies let nobody else read it — so a karaoke track made on the
 * laptop plays on the phone. The device copy in {@link ./fileStore} stays as
 * the fast, offline path.
 *
 * The song the visitor started from is still never uploaded; only what the
 * tool made from it.
 */
import { getSupabase } from "./supabase";

export const WORK_FILES_BUCKET = "works";

/**
 * The largest file a save will send. A four-minute stereo WAV is about
 * 40MB; anything past this is a whole album side, and would take the
 * bucket's quota down one song at a time.
 */
export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/** Where a work's file lives: its owner's folder, its own id, the file's type. */
export function workFilePath(userId: string, workId: string, file: File | Blob) {
  const extension = file.type === "audio/wav" || file.type === "audio/x-wav" ? "wav" : file.type.split("/")[1] || "bin";
  return `${userId}/${workId}.${extension}`;
}

export class UploadTooLargeError extends Error {
  constructor(bytes: number) {
    super(`File is ${bytes} bytes; the limit is ${MAX_UPLOAD_BYTES}`);
    this.name = "UploadTooLargeError";
  }
}

/** Sends a work's file up. Resolves to the path the row should remember. */
export async function uploadWorkFile(userId: string, workId: string, file: File | Blob) {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadTooLargeError(file.size);
  const path = workFilePath(userId, workId, file);
  const supabase = await getSupabase();
  const { error } = await supabase.storage.from(WORK_FILES_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || "application/octet-stream",
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}

/** Fetches a work's file back, as a File named after the work. */
export async function downloadWorkFile(path: string, name: string): Promise<File> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(WORK_FILES_BUCKET).download(path);
  if (error || !data) throw error ?? new Error("empty download");
  return new File([data], name, { type: data.type || "audio/wav" });
}

/** A short-lived URL the audio element can play from directly. */
export async function workFileUrl(path: string, seconds = 60 * 60) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage
    .from(WORK_FILES_BUCKET)
    .createSignedUrl(path, seconds);
  if (error || !data) throw error ?? new Error("no url");
  return data.signedUrl;
}

export async function deleteWorkFile(path: string) {
  const supabase = await getSupabase();
  const { error } = await supabase.storage.from(WORK_FILES_BUCKET).remove([path]);
  if (error) throw error;
}
