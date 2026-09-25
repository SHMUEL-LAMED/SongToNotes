import { BatteryLow, Gift, PartyPopper, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { creditsLabel, untilReset } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";

/**
 * What the credits have to say at the bottom of the screen, stacked with the
 * site's other notices: an invitation for a visitor a friend's link brought,
 * the gift that greets them once they join, and — when the server refused a
 * piece of work — how many credits it needed and how to get more.
 */
export function CreditNotices({ onOpenCredits, onSignInError }: { onOpenCredits: () => void; onSignInError: (message: string) => void }) {
  const { signInWithGoogle } = useAuth();
  const { invite, dismissInvite, welcome, dismissWelcome, empty, dismissEmpty, rules } = useCredits();
  const [now, setNow] = useState(() => Date.now());

  // The countdown in the notice stays true while it is up.
  useEffect(() => {
    if (!empty) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [empty]);

  // The gift is news, not a fixture: it steps aside on its own.
  useEffect(() => {
    if (!welcome) return;
    const timer = window.setTimeout(dismissWelcome, 14_000);
    return () => window.clearTimeout(timer);
  }, [dismissWelcome, welcome]);

  const renews = empty && "resetsAt" in empty ? untilReset(empty.resetsAt ?? null, now) : null;
  const shortfall =
    empty && "needed" in empty && typeof empty.needed === "number" && "left" in empty
      ? `הפעולה עולה ${creditsLabel(empty.needed)}, ונשארו לך ${creditsLabel(empty.left)}.`
      : null;
  // Each sentence is a text of its own, so each is translated on its own.
  const sentences = [shortfall, renews ? `הקצבה היומית מתחדשת בעוד ${renews}.` : null, "או הזמינו חברים וקבלו עוד כבר עכשיו."].filter(
    (sentence): sentence is string => Boolean(sentence),
  );

  return (
    <>
      {empty && (
        <div className="app-notice credits-notice is-empty" role="alert">
          <span className="app-notice-icon">
            <BatteryLow size={17} />
          </span>
          <p>
            <strong>נגמרו הקרדיטים לפעולה הזאת.</strong>
            {sentences.map((sentence) => (
              <span key={sentence}> {sentence}</span>
            ))}
          </p>
          <button
            type="button"
            className="app-notice-action"
            onClick={() => {
              dismissEmpty();
              onOpenCredits();
            }}
          >
            לקבלת קרדיטים
          </button>
          <button type="button" className="app-notice-close" onClick={dismissEmpty} aria-label="סגירת ההודעה">
            <X size={15} />
          </button>
        </div>
      )}

      {welcome && (
        <div className="app-notice credits-notice is-welcome" role="status">
          <span className="app-notice-icon">
            <PartyPopper size={17} />
          </span>
          <p>
            <strong>ברוכים הבאים!</strong>{" "}
            {welcome.name
              ? `קיבלת ${creditsLabel(welcome.credits)} מתנה, בזכות ההזמנה של ${welcome.name}.`
              : `קיבלת ${creditsLabel(welcome.credits)} מתנה על ההצטרפות.`}
          </p>
          <button
            type="button"
            className="app-notice-action"
            onClick={() => {
              dismissWelcome();
              onOpenCredits();
            }}
          >
            הקרדיטים שלי
          </button>
          <button type="button" className="app-notice-close" onClick={dismissWelcome} aria-label="סגירת ההודעה">
            <X size={15} />
          </button>
        </div>
      )}

      {invite && rules.enabled && (
        <div className="app-notice credits-notice is-invite" role="status">
          <span className="app-notice-icon">
            <Gift size={17} />
          </span>
          <p>
            <strong>{invite.name ? `קיבלת הזמנה מ${invite.name}!` : "קיבלת הזמנה מחבר!"}</strong>{" "}
            {rules.welcomeBonus > 0
              ? `פותחים חשבון חינם עם Google ומקבלים ${creditsLabel(rules.welcomeBonus)} מתנה — ועוד ${rules.daily} בכל יום.`
              : `פותחים חשבון חינם עם Google ומקבלים ${rules.daily} קרדיטים בכל יום.`}
          </p>
          <button
            type="button"
            className="app-notice-action"
            onClick={() =>
              void signInWithGoogle().catch(() => onSignInError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."))
            }
          >
            להצטרפות
          </button>
          <button type="button" className="app-notice-close" onClick={dismissInvite} aria-label="סגירת ההודעה">
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
