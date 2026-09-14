import { ArrowRight, History, LockKeyhole, Music2, UserRound } from "lucide-react";
import { useEffect, type PropsWithChildren } from "react";
import { useAuth } from "../lib/auth";
import type { ThemePreference } from "../lib/theme";
import type { ToolDefinition } from "../lib/tools";
import { ThemeToggle } from "./ThemeToggle";

type Props = PropsWithChildren<{
  tool: ToolDefinition | null;
  themePreference: ThemePreference;
  onCycleTheme: () => void;
  onHome: () => void;
  onOpenAccount: () => void;
  onSignInError: (message: string) => void;
}>;

/**
 * The frame every page shares: brand, back link, privacy note, theme switch
 * and the account button. Tool pages get their own accent hue through a
 * custom property so the same components take on each tool's colour.
 */
export function ToolShell({
  tool,
  themePreference,
  onCycleTheme,
  onHome,
  onOpenAccount,
  onSignInError,
  children,
}: Props) {
  const { user, profile, signInWithGoogle } = useAuth();

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
            <button
              className="account-button"
              type="button"
              onClick={() =>
                void signInWithGoogle().catch(() =>
                  onSignInError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."),
                )
              }
            >
              <span className="account-avatar">
                <UserRound size={18} />
              </span>
              <span className="account-button-copy">
                <strong>התחברות</strong>
                <small>
                  <History size={12} /> לשמירת היסטוריה
                </small>
              </span>
            </button>
          ) : (
            <button className="account-button" type="button" onClick={onOpenAccount}>
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
                  <History size={12} /> היסטוריה
                </small>
              </span>
            </button>
          )}
        </div>
      </nav>
      {children}
    </main>
  );
}
