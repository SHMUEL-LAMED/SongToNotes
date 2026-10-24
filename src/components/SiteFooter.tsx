import { Logo } from "./Logo";

/** The foot of every page: the brand and a few ways in on one line, and under them a line about the site. */
export function SiteFooter({ onOpen, onFeedback }: { onOpen: (route: string) => void; onFeedback: () => void }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <button type="button" className="brand brand-button" onClick={() => onOpen("home")} aria-label="לדף הבית">
          <Logo compact />
        </button>
        <nav aria-label="קישורים">
          <button type="button" onClick={() => onOpen("notes")}>שיר לתווים</button>
          <button type="button" onClick={() => onOpen("vocals")}>קריוקי</button>
          <button type="button" onClick={() => onOpen("beats")}>מכונת תופים</button>
          <button type="button" onClick={() => onOpen("me")}>האזור האישי</button>
          <button type="button" onClick={() => onOpen("credits")}>קרדיטים והזמנת חברים</button>
          <button type="button" onClick={onFeedback}>משוב והצעות</button>
        </nav>
      </div>
      <div className="site-footer-small">
        <p>רוב העיבוד קורה בדפדפן שלך · חינם, בלי פרסומות ובלי הרשמה</p>
      </div>
    </footer>
  );
}
