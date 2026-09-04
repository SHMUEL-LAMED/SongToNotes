import { LockKeyhole, Music2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../lib/auth";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.19-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.86A6 6 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.48l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
    </svg>
  );
}

export function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState("");

  return (
    <main className="auth-screen">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />
      <section className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark"><Music2 size={22} /></span>
          <span>SongToNotes</span>
        </div>
        <span className="auth-icon"><Sparkles size={27} /></span>
        <h1>התווים שלך,<br />שמורים במקום אחד</h1>
        <p>
          התחבר כדי להפוך מנגינות לתווים, לשמור כל תוצאה בפרופיל האישי ולחזור
          אליה מכל מכשיר.
        </p>
        <button
          className="google-button"
          type="button"
          onClick={() => {
            setError("");
            void signInWithGoogle().catch(() =>
              setError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."),
            );
          }}
        >
          <GoogleMark /> המשך באמצעות Google
        </button>
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="auth-privacy">
          <LockKeyhole size={15} /> קובצי השמע נשארים במכשיר שלך ולא נשמרים בשרת
        </div>
      </section>
    </main>
  );
}
