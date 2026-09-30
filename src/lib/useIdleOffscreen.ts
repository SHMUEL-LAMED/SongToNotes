import { useCallback } from "react";

/**
 * A ref that marks its element `data-idle` while it is out of sight, so the
 * endless animations inside it pause (see home.css) instead of repainting
 * for no one. The margin wakes it a little before it scrolls in. A callback
 * ref, so an element that only appears later (once the credits rules load,
 * say) is watched too.
 */
export function useIdleOffscreen<T extends Element>() {
  return useCallback((element: T | null) => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => element.toggleAttribute("data-idle", !entry.isIntersecting), {
      rootMargin: "240px 0px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
}
