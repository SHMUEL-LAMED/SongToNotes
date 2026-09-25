/**
 * The song's own video on YouTube, for the identifier's ▶ YouTube button: a
 * watch address, never a search, and no YouTube key. Two places carry one,
 * both from AudD — the media list of its lyrics block, and the YouTube button
 * on its page for the song (lis.tn). Whatever is found is cut down to its
 * video id and written out afresh, so nothing else from a page reaches the site.
 */

/** A YouTube video id, from a watch, YouTube Music or youtu.be address. */
export function youtubeId(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.replaceAll("&amp;", "&"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const id = host === "youtu.be" ? url.pathname.slice(1) : host === "youtube.com" && url.pathname === "/watch" ? url.searchParams.get("v") : null;
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** From the lyrics block, whose `media` is a JSON string of { provider, type, url }. */
export function videoFromLyricsMedia(media: unknown): string | null {
  if (typeof media !== "string") return null;
  let list: unknown;
  try {
    list = JSON.parse(media);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const { provider, url } = (item ?? {}) as { provider?: unknown; url?: unknown };
    const id = provider === "youtube" && typeof url === "string" ? youtubeId(url) : null;
    if (id) return watch(id);
  }
  return null;
}

/**
 * From AudD's page for the song: the link its YouTube button opens, or else
 * its YouTube Music one — the same video id plays on YouTube.
 */
export function videoFromSongPage(html: string): string | null {
  const tags = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag);
  for (const player of ["youtube", "youtubemusic"]) {
    for (const tag of tags) {
      if (!tag.includes(`data-player="${player}"`)) continue;
      const href = /\bhref="([^"]+)"/i.exec(tag)?.[1];
      const id = href ? youtubeId(href) : null;
      if (id) return watch(id);
    }
  }
  return null;
}

/** Fetches AudD's page for the song (only ever lis.tn) and reads its YouTube button. */
export async function videoFromSongLink(link: string | null | undefined): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(link ?? "");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "lis.tn") return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return response.ok ? videoFromSongPage(await response.text()) : null;
  } catch (caught) {
    console.error("song page unreachable", caught);
    return null;
  }
}
