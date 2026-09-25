/**
 * Songs the identifier recognised, kept in the personal area like any other
 * work (kind "identify"), so "recently identified" outlives a reload and
 * follows the account to every device. The work holds the identification
 * itself — title, artist, links, the video — without the day's allowance,
 * which is stale by the time the work is opened again.
 */
import type { Identification } from "./aiApi";
import type { NewWork, SavedWork } from "./works";

export type FoundSong = Extract<Identification, { found: true }>;

/** How many songs "recently identified" lists. */
export const HISTORY_SIZE = 8;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** The same song: the same title by the same artist. */
export function sameSong(a: Pick<FoundSong, "title" | "artist">, b: Pick<FoundSong, "title" | "artist">) {
  return a.title === b.title && a.artist === b.artist;
}

/** The work that records an identification. */
export function workForSong(song: FoundSong, sourceName: string | null): NewWork {
  const kept: Partial<FoundSong> = { ...song };
  delete kept.used;
  delete kept.limit;
  return {
    kind: "identify",
    title: [song.title, song.artist].filter(Boolean).join(" — ") || "שיר שזוהה",
    sourceName,
    summary: { artist: song.artist, album: song.album, year: song.releaseDate?.slice(0, 4) ?? null },
    payload: { identification: kept },
  };
}

/**
 * The identification a saved work holds, or null when it is not one. The
 * allowance comes back as zero, which the page reads as "not known".
 */
export function songOfWork(work: Pick<SavedWork, "kind" | "payload">): FoundSong | null {
  if (work.kind !== "identify") return null;
  const saved = work.payload.identification as Record<string, unknown> | null | undefined;
  if (!saved || typeof saved !== "object" || saved.found !== true) return null;
  const links = (saved.links && typeof saved.links === "object" ? saved.links : {}) as Record<string, unknown>;
  return {
    found: true,
    artist: text(saved.artist),
    title: text(saved.title),
    album: text(saved.album),
    releaseDate: text(saved.releaseDate),
    label: text(saved.label),
    timecode: text(saved.timecode),
    links: {
      song: text(links.song),
      appleMusic: text(links.appleMusic),
      spotify: text(links.spotify),
      deezer: text(links.deezer),
      youtube: text(links.youtube),
    },
    artwork: text(saved.artwork),
    used: 0,
    limit: 0,
  };
}

/** Newest first, each song once, at most HISTORY_SIZE. */
export function historyFromWorks(works: SavedWork[]): FoundSong[] {
  const songs: FoundSong[] = [];
  const newest = [...works].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const work of newest) {
    const song = songOfWork(work);
    if (song && !songs.some((item) => sameSong(item, song))) songs.push(song);
    if (songs.length === HISTORY_SIZE) break;
  }
  return songs;
}

/** A new identification goes on top, and an older one of the same song leaves. */
export function pushSong(history: FoundSong[], song: FoundSong): FoundSong[] {
  return [song, ...history.filter((item) => !sameSong(item, song))].slice(0, HISTORY_SIZE);
}
