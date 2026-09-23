import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "musictools.theme.v1";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Storage blocked; the choice lasts for this visit only.
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * The whole palette is a set of custom properties keyed off `data-theme` on
 * the root element, so switching is one attribute write rather than a
 * re-render of anything that draws.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    readPreference() === "system" ? systemTheme() : (readPreference() as ResolvedTheme),
  );

  useEffect(() => {
    const apply = () => {
      const next = preference === "system" ? systemTheme() : preference;
      setResolved(next);
      document.documentElement.dataset.theme = next;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", next === "light" ? "#f5f4f0" : "#09090d");
    };
    apply();

    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Ignored, as above.
    }

    if (preference !== "system" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((current) =>
      current === "system" ? "light" : current === "light" ? "dark" : "system",
    );
  }, []);

  return { preference, resolved, setPreference, cycle };
}
