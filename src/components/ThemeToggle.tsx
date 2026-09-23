import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../lib/theme";

type Props = {
  preference: ThemePreference;
  onCycle: () => void;
};

const LABELS: Record<ThemePreference, string> = {
  system: "לפי המערכת",
  light: "מצב בהיר",
  dark: "מצב כהה",
};

export function ThemeToggle({ preference, onCycle }: Props) {
  const Icon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor;
  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      onClick={onCycle}
      aria-label={`ערכת נושא: ${LABELS[preference]}. לחצו להחלפה`}
      title={LABELS[preference]}
    >
      <Icon size={17} />
    </button>
  );
}
