import { CloudUpload, Share2, Sparkles, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { creditsLabel } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";

/**
 * Google's own mark, in its four colours (Google brand guidelines), drawn
 * rather than fetched so the button needs nothing from another server.
 */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285f4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34a853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#fbbc05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#ea4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

/**
 * The window that greets a visitor without an account, once a visit: what an
 * account adds, one button to open one with Google, and one to carry on
 * without it. Nothing here is a gate — every tool runs in the browser either
 * way — so "להמשיך בלי חשבון" closes it, as do Escape and the page behind it.
 */
export function SignInPrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  // Mounted afresh for every opening, so a failed attempt never greets the next one.
  return <SignInSheet onClose={onClose} />;
}

function SignInSheet({ onClose }: { onClose: () => void }) {
  const { signInWithGoogle } = useAuth();
  const { rules } = useCredits();
  const signInRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"idle" | "opening" | "failed">("idle");

  // The window covers the page, so it behaves like a window: Escape closes
  // it, the sign-in button holds the focus, and whatever had it gets it back.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    signInRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const signIn = () => {
    if (state === "opening") return;
    setState("opening");
    // Google takes the page from here; "opening" stays up until it does.
    void signInWithGoogle().catch(() => setState("failed"));
  };

  const perks: { icon: ReactNode; text: string }[] = [
    { icon: <CloudUpload size={16} />, text: "כל מה שתיצור נשמר באזור האישי ומחכה לך בכל מכשיר" },
    ...(rules.enabled
      ? [
          {
            icon: <Zap size={16} />,
            text:
              rules.welcomeBonus > 0
                ? `${creditsLabel(rules.welcomeBonus)} מתנה על ההצטרפות, ועוד ${rules.daily} בכל יום`
                : `${rules.daily} קרדיטים חינם בכל יום`,
          },
        ]
      : []),
    { icon: <Share2 size={16} />, text: "קישור לכל עבודה, לשלוח למורה או לחבר בלי שיתקינו כלום" },
    { icon: <Sparkles size={16} />, text: "המועדפים, ההיסטוריה והשיחות עם עוזר ה־AI נשמרים איתך" },
  ];

  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="dialog sign-in-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="icon-button dialog-close" onClick={onClose} aria-label="סגירה">
          <X size={17} />
        </button>
        <span className="sign-in-badge" aria-hidden="true">
          <GoogleMark size={26} />
        </span>
        <h2 id="sign-in-title">מתחברים עם Google?</h2>
        <p>ההתחברות חינמית ולוקחת שתי שניות — בלי סיסמה ובלי הרשמה למלא.</p>

        <ul className="sign-in-perks">
          {perks.map((perk) => (
            <li key={perk.text}>
              <span className="sign-in-perk-icon" aria-hidden="true">
                {perk.icon}
              </span>
              {perk.text}
            </li>
          ))}
        </ul>

        {state === "failed" && (
          <p className="error-message" role="alert">
            לא הצלחנו לפתוח את ההתחברות ל־Google. בדוק את החיבור ונסה שוב.
          </p>
        )}

        <button ref={signInRef} type="button" className="primary-button" onClick={signIn} disabled={state === "opening"}>
          <GoogleMark /> {state === "opening" ? "פותח את ההתחברות…" : "התחברות עם Google"}
        </button>
        <button type="button" className="secondary-button sign-in-skip" onClick={onClose}>
          להמשיך בלי חשבון
        </button>
        <p className="sign-in-note">
          כל הכלים עובדים גם בלי חשבון, והקבצים נשארים במכשיר שלך. מ־Google אנחנו מקבלים רק את השם, המייל ותמונת הפרופיל.
        </p>
      </div>
    </div>
  );
}
