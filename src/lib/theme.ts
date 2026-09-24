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

/* ---- accent colour ---- */

export type AccentPreference = {
  /** OKLCH hue of the site's own colour; null keeps the brand's. */
  hue: number | null;
  /** Paint every tool in it too, instead of each tool's own colour. */
  everywhere: boolean;
};

const ACCENT_KEY = "musictools.accent.v1";

/** Colours to pick from, spread round the wheel at equal brightness. */
export const ACCENT_CHOICES: { hue: number; label: string }[] = [
  { hue: 292, label: "סגול" },
  { hue: 330, label: "ורוד" },
  { hue: 18, label: "אדום" },
  { hue: 50, label: "כתום" },
  { hue: 85, label: "זהב" },
  { hue: 140, label: "ירוק" },
  { hue: 180, label: "טורקיז" },
  { hue: 230, label: "כחול" },
  { hue: 262, label: "אינדיגו" },
];

export function normalizeAccent(raw: unknown): AccentPreference {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as Partial<AccentPreference>;
  const hue = typeof parsed.hue === "number" && Number.isFinite(parsed.hue) ? ((Math.round(parsed.hue) % 360) + 360) % 360 : null;
  return { hue, everywhere: hue !== null && parsed.everywhere === true };
}

function readAccent(): AccentPreference {
  try {
    return normalizeAccent(JSON.parse(localStorage.getItem(ACCENT_KEY) ?? "null"));
  } catch {
    return { hue: null, everywhere: false };
  }
}

/** One write to the root element; the stylesheet does the rest. */
function applyAccent(accent: AccentPreference) {
  const root = document.documentElement;
  if (accent.hue === null) {
    root.style.removeProperty("--accent-hue");
    root.style.removeProperty("--user-hue");
  } else {
    root.style.setProperty("--accent-hue", String(accent.hue));
    root.style.setProperty("--user-hue", String(accent.hue));
  }
  if (accent.everywhere) root.dataset.accentLock = "";
  else delete root.dataset.accentLock;
}

export function useAccent() {
  const [accent, setAccentState] = useState<AccentPreference>(() => {
    const initial = readAccent();
    // Applied before the first paint, so the page never flashes the old colour.
    if (typeof document !== "undefined") applyAccent(initial);
    return initial;
  });

  const setAccent = useCallback((next: AccentPreference) => {
    const clean = normalizeAccent(next);
    setAccentState(clean);
    applyAccent(clean);
    try {
      localStorage.setItem(ACCENT_KEY, JSON.stringify(clean));
    } catch {
      // For this visit only.
    }
  }, []);

  return { accent, setAccent };
}
