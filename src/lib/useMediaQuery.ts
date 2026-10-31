import { useCallback, useSyncExternalStore } from "react";

/**
 * The shell's three widths. Anything that lives in two places at different
 * widths (the sidebar's search and the top bar's, the floating assistant
 * launcher and the tab bar's) is rendered by these, not hidden with CSS, so
 * exactly one of each is in the page. The CSS uses the same numbers.
 */
export const PHONE_QUERY = "(max-width: 719.98px)";
export const DESKTOP_QUERY = "(min-width: 1120px)";

function matchFor(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/**
 * Whether a media query matches, following it as the window changes. Safe to
 * render on a server or in a test without `matchMedia`: it answers
 * `fallback` there (and on the server's first paint).
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchFor(query);
      if (!list) return () => undefined;
      // Old Safari has only the deprecated pair.
      if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      }
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    },
    [query],
  );
  const snapshot = () => matchFor(query)?.matches ?? fallback;
  return useSyncExternalStore(subscribe, snapshot, () => fallback);
}
