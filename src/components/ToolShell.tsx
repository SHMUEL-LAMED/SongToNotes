import { ArrowRight, History, LockKeyhole, Music2, UserRound } from "lucide-react";
import { useEffect, useRef, type PropsWithChildren } from "react";
import { useAuth } from "../lib/auth";
import type { ThemePreference } from "../lib/theme";
import type { ToolDefinition } from "../lib/tools";
import { ThemeToggle } from "./ThemeToggle";

type Props = PropsWithChildren<{
  tool: ToolDefinition | null;
  /** True while the personal area is open over the page. */
  account?: boolean;
  themePreference: ThemePreference;
  onCycleTheme: () => void;
  onHome: () => void;
  onOpenAccount: () => void;
}>;

/**
 * The frame every page shares: brand, back link, privacy note, theme switch
 * and the account button. Tool pages get their own accent hue through a
 * custom property so the same components take on each tool's colour.
 */
export function ToolShell({
  tool,
  account = false,
  themePreference,
  onCycleTheme,
  onHome,
  onOpenAccount,
  children,
}: Props) {
  const { user, profile } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = tool
      ? `${tool.title} — כלי מוזיקה`
      : "כלי מוזיקה — שיר לתווים, צלצולים, מטרונום, טיונר ועוד";
  }, [tool]);

  return (
    <main
      className={tool ? "page tool-page" : "page hub-page"}
      style={tool ? ({ "--accent-hue": tool.hue } as React.CSSProperties) : undefined}
    >
      {/* A link would put its target in the hash and send the router to an
          unknown route, so the skip control moves focus itself. */}
      <button
        type="button"
        className="skip-link"
        onClick={() => contentRef.current?.focus()}
      >
        דלג לתוכן
      </button>
      <nav className="topbar">
        <div className="topbar-start">
          <button
            className="brand brand-button"
            onClick={onHome}
            aria-label="חזרה לכלי המוזיקה"
            type="button"
          >
            <span className="brand-mark">
              <Music2 size={22} />
            </span>
            <span>כלי מוזיקה</span>
          </button>
          {tool && (
            <button className="back-link" onClick={onHome} type="button">
              <ArrowRight size={16} /> כל הכלים
            </button>
          )}
        </div>
        <div className="topbar-actions">
          <div className="privacy-pill">
            <LockKeyhole size={15} />
            <span>הקובץ נשאר אצלך בדפדפן</span>
          </div>
          <ThemeToggle preference={themePreference} onCycle={onCycleTheme} />
          {!user ? (
            // Without an account the area still holds what this device saved,
            // and the sign-in button sits at the top of it.
            <button
              className={`account-button ${account ? "is-current" : ""}`}
              type="button"
              onClick={onOpenAccount}
              aria-expanded={account}
            >
              <span className="account-avatar">
                <UserRound size={18} />
              </span>
              <span className="account-button-copy">
                <strong>האזור האישי</strong>
                <small>
                  <History size={12} /> התחברות ושמירה
                </small>
              </span>
            </button>
          ) : (
            <button
              className={`account-button ${account ? "is-current" : ""}`}
              type="button"
              onClick={onOpenAccount}
              aria-expanded={account}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar">
                  <UserRound size={18} />
                </span>
              )}
              <span className="account-button-copy">
                <strong>{profile?.full_name?.split(" ")[0] || "הפרופיל שלי"}</strong>
                <small>
                  <History size={12} /> האזור האישי
                </small>
              </span>
            </button>
          )}
        </div>
      </nav>
      {/* Moving between tools changes the hash, not the document, so a screen
          reader is told nothing on its own. This says where we landed. */}
      <p className="sr-only" role="status" aria-live="polite">
        {tool ? `${tool.title} — ${tool.tagline}` : "כל הכלים"}
      </p>
      <div className="page-content" ref={contentRef} tabIndex={-1}>
        {children}
      </div>
    </main>
  );
}
