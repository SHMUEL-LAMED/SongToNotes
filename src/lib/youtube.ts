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
 * Where the player is loaded from, in the order tried. YouTube's own address
 * first: filtered connections (NetFree and the like) know it and pass its
 * videos through their own review, where they treat the youtube-nocookie.com
 * mirror as a new, unapproved site. The mirror second, for a network that is
 * the other way round. Nothing loads from either until the visitor asks to play.
 */
export const PLAYER_HOSTS = ["www.youtube.com", "www.youtube-nocookie.com"] as const;
export type PlayerHost = (typeof PLAYER_HOSTS)[number];

/**
 * The player, starting as it opens. With the JavaScript API on, and our
 * address as its origin, it tells the page when it is ready and when a video
 * cannot play — so the page knows whether it worked.
 */
export function youtubeEmbedUrl(id: string, { host = PLAYER_HOSTS[0], origin }: { host?: PlayerHost; origin?: string } = {}) {
  const query = new URLSearchParams({ autoplay: "1", rel: "0", playsinline: "1", enablejsapi: "1" });
  if (origin) query.set("origin", origin);
  return `https://${host}/embed/${id}?${query}`;
}

/** What the page sends the player so that it starts reporting (the protocol of YouTube's IFrame API). */
export const LISTENING = JSON.stringify({ event: "listening", id: 1, channel: "widget" });

/** A report from the player — "onReady", "onError" and the like — or null for any other message. */
export function playerMessage(data: unknown): { event: string; info: unknown } | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const { event, info } = value as { event?: unknown; info?: unknown };
  return typeof event === "string" ? { event, info } : null;
}

/**
 * Errors about the video itself — not found (100), or its owner allows no
 * player outside YouTube (101, 150) — which no other address will change.
 */
export function isVideoError(code: unknown) {
  return code === 100 || code === 101 || code === 150;
}

/** The video's still. */
export function youtubeStillUrl(id: string) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
