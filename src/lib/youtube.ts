/**
 * Where to watch a song that was identified: a YouTube search for its artist
 * and title. It is the address of the ordinary results page, so there is no
 * API key and nothing to call; the search runs when the link is opened.
 */

const SEARCH = "https://www.youtube.com/results?search_query=";

/**
 * The search for "artist title", or null when either one is missing — half a
 * name finds anything but the song.
 */
export function youtubeSearchUrl(artist: string | null | undefined, title: string | null | undefined): string | null {
  const who = artist?.trim();
  const what = title?.trim();
  if (!who || !what) return null;
  const query = `${who} ${what}`.replace(/\s+/g, " ");
  // encodeURIComponent keeps a "&", "#", "/" or "+" in a name from cutting the
  // query short; the spaces become "+", as in YouTube's own search addresses.
  return SEARCH + encodeURIComponent(query).replace(/%20/g, "+");
}
