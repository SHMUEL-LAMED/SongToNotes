import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LANGUAGES, OFFERED, currentLang, setLang } from "../lib/i18n";

/**
 * The language switch in the top bar. Each language is named in itself, and
 * the menu is kept out of the translation so it always reads that way.
 */
export function LanguageMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lang = currentLang();
  const offered = LANGUAGES.filter((item) => OFFERED.includes(item.id));
  const current = LANGUAGES.find((item) => item.id === lang)!;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (offered.length < 2) return null;

  return (
    <div className="language-menu" ref={rootRef} translate="no">
      <button
        type="button"
        className="icon-button language-button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Language / שפה / שפּראַך: ${current.label}`}
        title="Language / שפה / שפּראַך"
      >
        <Languages size={16} />
        <span>{current.short}</span>
      </button>
      {open && (
        <div className="language-list" role="menu">
          {offered.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === lang}
              lang={item.id}
              dir={item.dir}
              onClick={() => {
                setOpen(false);
                if (item.id !== lang) setLang(item.id);
              }}
            >
              <span>{item.label}</span>
              {item.id === lang && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
