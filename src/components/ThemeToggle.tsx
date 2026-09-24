import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../lib/theme";

type Props = {
  preference: ThemePreference;
  onOpen: () => void;
};

const LABELS: Record<ThemePreference, string> = {
  system: "לפי המערכת",
  light: "מצב בהיר",
  dark: "מצב כהה",
};

/** Opens the appearance sheet: light or dark, and the site's colour. */
export function ThemeToggle({ preference, onOpen }: Props) {
  const Icon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor;
  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      onClick={onOpen}
      aria-label={`מראה וצבעים (ערכת נושא: ${LABELS[preference]})`}
      title="מראה וצבעים"
    >
      <Icon size={17} />
    </button>
  );
}
