import { Check, Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { ACCENT_CHOICES, type AccentPreference, type ThemePreference } from "../lib/theme";

type Props = {
  open: boolean;
  onClose: () => void;
  preference: ThemePreference;
  onPreference: (value: ThemePreference) => void;
  accent: AccentPreference;
  onAccent: (value: AccentPreference) => void;
};

const MODES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "לפי המערכת", icon: Monitor },
  { id: "light", label: "בהיר", icon: Sun },
  { id: "dark", label: "כהה", icon: Moon },
];

/** Light or dark, and the site's colour. Everything is kept on this device. */
export function AppearanceDialog({ open, onClose, preference, onPreference, accent, onAccent }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-title" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} type="button" className="icon-button dialog-close" onClick={onClose} aria-label="סגירה">
          <X size={17} />
        </button>
        <h2 id="appearance-title">מראה</h2>
        <p>נשמר בדפדפן הזה.</p>

        <div className="appearance-section">
          <span className="appearance-label">ערכת נושא</span>
          <div className="segmented-control" role="group" aria-label="ערכת נושא">
            {MODES.map((mode) => {
              const Icon = mode.icon;
              return (
                <button key={mode.id} type="button" className={preference === mode.id ? "active" : ""} aria-pressed={preference === mode.id} onClick={() => onPreference(mode.id)}>
                  <Icon size={15} /> {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="appearance-section">
          <span className="appearance-label">צבע</span>
          <div className="appearance-swatches" role="group" aria-label="צבע האתר">
            <button type="button" className={`appearance-swatch is-default ${accent.hue === null ? "is-on" : ""}`} aria-pressed={accent.hue === null} onClick={() => onAccent({ hue: null, everywhere: false })} title="ברירת המחדל">
              {accent.hue === null && <Check size={16} />}
              <span>רגיל</span>
            </button>
            {ACCENT_CHOICES.map((choice) => {
              const on = accent.hue === choice.hue;
              return (
                <button
                  key={choice.hue}
                  type="button"
                  className={`appearance-swatch ${on ? "is-on" : ""}`}
                  style={{ "--swatch-hue": choice.hue } as CSSProperties}
                  aria-pressed={on}
                  aria-label={choice.label}
                  title={choice.label}
                  onClick={() => onAccent({ hue: choice.hue, everywhere: accent.everywhere })}
                >
                  {on && <Check size={16} />}
                </button>
              );
            })}
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={accent.everywhere}
              disabled={accent.hue === null}
              onChange={(event) => onAccent({ ...accent, everywhere: event.target.checked })}
            />
            <span>גם בכל הכלים (במקום הצבע של כל כלי)</span>
          </label>
        </div>
      </div>
    </div>
  );
}
