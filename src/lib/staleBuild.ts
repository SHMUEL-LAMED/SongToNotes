/**
 * Each tool is its own piece of the build, fetched the first time it opens.
 * A deploy replaces every piece, so a tab opened before it still runs the old
 * build and asks for pieces the server no longer has: opening a tool there
 * fails. Rather than leave an empty page, the site loads itself afresh — the
 * new build, on the page the visitor asked for. At most once a minute, so a
 * connection that is really down ends in a message, never in a loop.
 */

/** When this tab last reloaded itself for a missing piece. */
const RELOAD_KEY = "musictools.stale-build-reload.v1";
/** Never two automatic reloads within this long. */
export const RELOAD_GAP_MS = 60_000;

/** How each browser words a piece that did not arrive. */
const MISSING_PIECE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|not a valid JavaScript MIME type/i;

let reloading = false;

/** Whether an error is a piece of the site that did not arrive. */
export function isMissingPiece(error: unknown): boolean {
  if (error instanceof Error) return MISSING_PIECE.test(`${error.name}: ${error.message}`);
  return typeof error === "string" && MISSING_PIECE.test(error);
}

/** Whether a tab that last reloaded itself at `last` may do so again at `now`. */
export function mayReload(last: number, now: number): boolean {
  return !(last > 0 && now >= last && now - last < RELOAD_GAP_MS);
}

/** Loads the page afresh, unless it just did. Returns whether it is on its way. */
export function reloadForNewBuild(): boolean {
  if (reloading) return true;
  const now = Date.now();
  try {
    if (!mayReload(Number(sessionStorage.getItem(RELOAD_KEY)) || 0, now)) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // With nothing stored, a loop cannot be told from a first try: no automatic reload.
    return false;
  }
  reloading = true;
  window.location.reload();
  return true;
}

/** Whether the page is already on its way to the new build. */
export function reloadingForNewBuild() {
  return reloading;
}

/** Vite reports a missing piece the moment it happens, before anything renders it. */
export function watchForNewBuild() {
  window.addEventListener("vite:preloadError", () => {
    reloadForNewBuild();
  });
}
