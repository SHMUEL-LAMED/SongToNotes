import { Logo } from "./Logo";

/** The foot of every page: the brand, a line about the site, a few ways in, and a word back. */
export function SiteFooter({ onOpen, onFeedback }: { onOpen: (route: string) => void; onFeedback: () => void }) {
  return (
    <footer className="site-footer">
      <button type="button" className="brand brand-button" onClick={() => onOpen("home")} aria-label="לדף הבית">
        <Logo compact />
      </button>
      <p>רוב העיבוד קורה בדפדפן שלך · חינם, בלי פרסומות ובלי הרשמה</p>
      <nav aria-label="קישורים">
        <button type="button" onClick={() => onOpen("notes")}>שיר לתווים</button>
        <button type="button" onClick={() => onOpen("vocals")}>קריוקי</button>
        <button type="button" onClick={() => onOpen("beats")}>מכונת תופים</button>
        <button type="button" onClick={() => onOpen("me")}>האזור האישי</button>
        <button type="button" onClick={onFeedback}>משוב והצעות</button>
      </nav>
    </footer>
  );
}
