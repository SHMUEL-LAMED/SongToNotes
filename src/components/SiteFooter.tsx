import { LockKeyhole } from "lucide-react";
import { LogoGlyph } from "./Logo";

/**
 * The foot of every page: the brand, a few ways in grouped in small columns,
 * and the line about where the files stay.
 */
export function SiteFooter({ onOpen, onFeedback }: { onOpen: (route: string) => void; onFeedback: () => void }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <button type="button" className="brand brand-button" onClick={() => onOpen("home")} aria-label="לדף הבית">
          <span className="brand-mark is-mono">
            <LogoGlyph />
          </span>
          <span className="brand-text">
            <strong>כלי מוזיקה</strong>
          </span>
        </button>
        <nav aria-label="קישורים" className="site-footer-links">
          <div className="site-footer-col">
            <p className="site-footer-heading">כלים</p>
            <button type="button" onClick={() => onOpen("notes")}>
              שיר לתווים
            </button>
            <button type="button" onClick={() => onOpen("vocals")}>
              קריוקי
            </button>
            <button type="button" onClick={() => onOpen("beats")}>
              מכונת תופים
            </button>
          </div>
          <div className="site-footer-col">
            <p className="site-footer-heading">האתר</p>
            <button type="button" onClick={() => onOpen("me")}>
              האזור האישי
            </button>
            <button type="button" onClick={() => onOpen("credits")}>
              קרדיטים והזמנת חברים
            </button>
            <button type="button" onClick={onFeedback}>
              משוב והצעות
            </button>
          </div>
        </nav>
      </div>
      <div className="site-footer-small">
        <p>
          <LockKeyhole size={13} aria-hidden="true" /> רוב העיבוד קורה בדפדפן שלך · חינם, בלי פרסומות ובלי הרשמה
        </p>
      </div>
    </footer>
  );
}
