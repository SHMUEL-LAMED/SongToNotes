import { X } from "lucide-react";
import { useEffect, useRef } from "react";

const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "חיפוש כלי, עבודה או פעולה", keys: ["Ctrl", "K"] },
  { label: "פתיחה וסגירה של העוזר", keys: ["Ctrl", "J"] },
  { label: "רשימת הקיצורים הזאת", keys: ["?"] },
  { label: "סגירת חלון או תפריט", keys: ["Esc"] },
  { label: "ניגון ועצירה במטרונום, בפסנתר ובתווים", keys: ["רווח"] },
  { label: "נגינה בפסנתר מהמקלדת", keys: ["A", "…", "'"] },
  { label: "מכונת התופים: ניגון ועצירה", keys: ["רווח"] },
  { label: "מאמן הקצב: הקשה", keys: ["רווח"] },
];

/** The keyboard shortcuts, one sheet. Opens with ? from anywhere. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} type="button" className="icon-button dialog-close" onClick={onClose} aria-label="סגירה">
          <X size={17} />
        </button>
        <h2 id="shortcuts-title">קיצורי מקלדת</h2>
        <p>למי שמעדיף לא לעזוב את המקלדת.</p>
        <ul className="shortcut-list">
          {SHORTCUTS.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <span>
                {item.keys.map((key, index) =>
                  key === "…" ? <span key={index}>…</span> : <kbd key={index}>{key}</kbd>,
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
