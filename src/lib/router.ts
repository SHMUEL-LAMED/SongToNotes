import { useCallback, useEffect, useState } from "react";

/**
 * Hash routing keeps every tool linkable and the browser's back button
 * working, without pulling in a router or needing server-side rewrites —
 * which GitHub Pages would not give us anyway.
 *
 * Each tool also has a real page of its own (`/SongToNotes/<tool>/`, written
 * at build time by the `tool-pages` plugin in vite.config.ts) so search
 * engines can list it on its own. Those pages carry the same app; with no
 * hash in the address the tool is read from the path instead.
 */
const BASE = import.meta.env.BASE_URL ?? "/";

/** The tool named by the path of a tool page, or null anywhere else. */
export function pathRoute(pathname: string, base = BASE): string | null {
  if (!pathname.startsWith(base)) return null;
  const rest = pathname.slice(base.length).replace(/\/+$/, "");
  return /^[a-z][a-z0-9-]*$/.test(rest) ? rest : null;
}

export function routeFrom(hash: string, pathname: string, base = BASE): string {
  // A hash always wins, "#/" included: that is how a tool page goes home.
  if (hash) return hash.replace(/^#\/?/, "").trim() || "home";
  return pathRoute(pathname, base) ?? "home";
}

export function currentRoute(): string {
  return routeFrom(window.location.hash, window.location.pathname);
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  const navigate = useCallback((next: string) => {
    const target = next === "home" ? "#/" : `#/${next}`;
    // Leaving a tool page for another page returns to the site's main
    // address, so the path and the hash never name two different tools.
    if (window.location.pathname !== BASE && pathRoute(window.location.pathname)) {
      window.history.pushState(null, "", `${BASE}${target}`);
      setRoute(currentRoute());
      return;
    }
    if (window.location.hash === target) {
      setRoute(currentRoute());
      return;
    }
    window.location.hash = target;
  }, []);

  return { route, navigate };
}
