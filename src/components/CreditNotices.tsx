import { BatteryLow, CircleAlert, Gift, Hourglass, Infinity as InfinityIcon, LoaderCircle, PartyPopper, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { isAdmin } from "../lib/admin";
import { useAuth } from "../lib/auth";
import { PASS_PLANS, creditsLabel, formatMoney, passesOnSale, untilReset } from "../lib/credits";
import { useCredits, type PaymentNotice } from "../lib/creditsContext";

/**
 * What the credits have to say at the bottom of the screen, stacked with the
 * site's other notices: an invitation for a visitor a friend's link brought,
 * the gift that greets them once they join, when the server refused a piece
 * of work how many credits it needed and how to get more, and how a payment
 * for a pass went.
 */
export function CreditNotices({ onOpenCredits, onSignInError }: { onOpenCredits: () => void; onSignInError: (message: string) => void }) {
  const { user, signInWithGoogle } = useAuth();
  const { invite, dismissInvite, welcome, dismissWelcome, empty, dismissEmpty, rules, payment, dismissPayment, retryPayment } = useCredits();
  const onSale = passesOnSale(rules, isAdmin(user));
  const signIn = () =>
    void signInWithGoogle().catch(() => onSignInError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."));
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
  // With a pass running, the day's fair use is what ran out.
  const fairUse = empty && "passUntil" in empty && empty.passUntil ? `הגעת לתקרת השימוש ההוגן של החופשי להיום (${rules.pay.passDaily}).` : null;
  // Each sentence is a text of its own, so each is translated on its own.
  const sentences = [
    fairUse,
    shortfall,
    renews ? `${fairUse ? "התקרה והקצבה היומית מתחדשות" : "הקצבה היומית מתחדשת"} בעוד ${renews}.` : null,
    fairUse ? null : "או הזמינו חברים וקבלו עוד כבר עכשיו.",
    !fairUse && onSale ? `ואפשר גם חופשי שבועי ב־${formatMoney(rules.pay.week, rules.pay.currency)} — בלי לספור קרדיטים.` : null,
  ].filter((sentence): sentence is string => Boolean(sentence));

  return (
    <>
      {payment && (
        <PaymentNoticeView
          payment={payment}
          signedIn={Boolean(user)}
          onSignIn={signIn}
          onRetry={retryPayment}
          onDismiss={dismissPayment}
        />
      )}

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
            onClick={signIn}
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

const shortDate = (value: string | null) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" }) : "";
};

/** How a payment for a pass went, in a sentence or two, and what can be done next. */
function describe(payment: PaymentNotice, signedIn: boolean): { tone: string; icon: ReactNode; title: string; lines: string[]; retry?: boolean; signIn?: boolean } {
  if (payment.phase === "working") {
    return signedIn
      ? { tone: "working", icon: <LoaderCircle size={17} className="is-spinning" />, title: "משלימים את התשלום…", lines: ["זה לוקח כמה שניות."] }
      : {
          tone: "working",
          icon: <CircleAlert size={17} />,
          title: "כדי להשלים את התשלום צריך להתחבר",
          lines: ["לאותו חשבון שבו התחלת לקנות."],
          signIn: true,
        };
  }
  if (payment.phase === "error") {
    return { tone: "error", icon: <CircleAlert size={17} />, title: "משהו בתשלום לא עבד", lines: [payment.message], retry: payment.retry };
  }
  const { result } = payment;
  const title = result.plan ? PASS_PLANS[result.plan].title : "החופשי";
  switch (result.status) {
    case "completed":
      return {
        tone: "done",
        icon: <PartyPopper size={17} />,
        title: `${title} שלך פעיל!`,
        lines: [result.until ? `עד ${shortDate(result.until)} — כל פעולות השרת בלי קרדיטים.` : "כל פעולות השרת בלי קרדיטים."],
      };
    case "pending":
      return {
        tone: "pending",
        icon: <Hourglass size={17} />,
        title: "התשלום בבדיקה אצל PayPal",
        lines: ["החופשי ייפתח לבד ברגע שהתשלום יאושר — בדרך כלל תוך דקות."],
      };
    case "not_approved":
      return { tone: "info", icon: <CircleAlert size={17} />, title: "התשלום לא הושלם", lines: ["התשלום לא אושר ב־PayPal, ולכן לא חויבת."] };
    case "canceled":
      return { tone: "info", icon: <InfinityIcon size={17} />, title: "התשלום בוטל", lines: ["לא חויבת. אפשר לקנות חופשי מתי שרוצים."] };
    case "refunded":
      return { tone: "info", icon: <CircleAlert size={17} />, title: "התשלום הזה הוחזר", lines: ["הכסף חזר, והימים שנקנו בו בוטלו."] };
    default:
      return {
        tone: "error",
        icon: <CircleAlert size={17} />,
        title: "התשלום לא עבר",
        lines: [
          result.reason === "declined"
            ? "PayPal לא אישר את אמצעי התשלום. לא חויבת — אפשר לנסות שוב, גם עם אמצעי תשלום אחר."
            : result.reason === "expired"
              ? "הזמן לתשלום עבר. לא חויבת — אפשר להתחיל שוב."
              : result.reason === "mismatch"
                ? "התשלום התקבל בסכום שלא תואם למחיר ועבר לבדיקה. הכסף יוחזר דרך PayPal."
                : "התשלום לא הושלם. לא חויבת — אפשר לנסות שוב.",
        ],
      };
  }
}

function PaymentNoticeView({
  payment,
  signedIn,
  onSignIn,
  onRetry,
  onDismiss,
}: {
  payment: PaymentNotice;
  signedIn: boolean;
  onSignIn: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const view = describe(payment, signedIn);
  return (
    <div className={`app-notice credits-notice is-payment is-${view.tone}`} role={view.tone === "error" ? "alert" : "status"}>
      <span className="app-notice-icon">{view.icon}</span>
      <p>
        <strong>{view.title}</strong>
        {view.lines.map((line) => (
          <span key={line}> {line}</span>
        ))}
      </p>
      {view.signIn && (
        <button type="button" className="app-notice-action" onClick={onSignIn}>
          להתחברות
        </button>
      )}
      {view.retry && (
        <button type="button" className="app-notice-action" onClick={onRetry}>
          לנסות שוב
        </button>
      )}
      {payment.phase !== "working" && (
        <button type="button" className="app-notice-close" onClick={onDismiss} aria-label="סגירת ההודעה">
          <X size={15} />
        </button>
      )}
    </div>
  );
}
