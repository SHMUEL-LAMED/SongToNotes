/**
 * The identified song's video, as the server sends it — a watch address on
 * www.youtube.com — and what the page builds from it: the player to embed in
 * the result, and the still that stands in for the player until asked for.
 */

/** The video id of a watch address, or null for anything else. */
export function youtubeVideoId(watch: string | null | undefined): string | null {
  if (!watch) return null;
  let url: URL;
  try {
    url = new URL(watch);
  } catch {
    return null;
  }
  const id = url.protocol === "https:" && url.hostname === "www.youtube.com" && url.pathname === "/watch" ? url.searchParams.get("v") : null;
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/**
 * YouTube's own player, starting as it opens. From www.youtube.com itself, not
 * the youtube-nocookie.com mirror: filtered connections (NetFree and the like)
 * know YouTube's address and pass its videos through their own review, but
 * treat the mirror as a new, unapproved site and block the player outright.
 * Nothing loads from YouTube until the visitor asks to play.
 */
export function youtubeEmbedUrl(id: string) {
  return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
}

/** The video's still. */
export function youtubeStillUrl(id: string) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
