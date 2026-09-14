import { useCallback, useEffect, useState } from "react";

/**
 * Hash routing keeps every tool linkable and the browser's back button
 * working, without pulling in a router or needing server-side rewrites —
 * which GitHub Pages would not give us anyway.
 */
export function currentRoute(): string {
  const hash = window.location.hash.replace(/^#\/?/, "").trim();
  return hash || "home";
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: string) => {
    const target = next === "home" ? "#/" : `#/${next}`;
    if (window.location.hash === target) {
      setRoute(currentRoute());
      return;
    }
    window.location.hash = target;
  }, []);

  return { route, navigate };
}
