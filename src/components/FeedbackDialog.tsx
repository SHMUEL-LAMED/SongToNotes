import { Check, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FEEDBACK_KINDS, FEEDBACK_MAX, sendFeedback, type FeedbackKind } from "../lib/feedback";

const PROMPTS: Record<FeedbackKind, string> = {
  problem: "מה קרה, ובאיזה כלי?",
  idea: "מה היה עוזר לך באתר?",
  other: "מה תרצו לספר?",
};

/** "משוב והצעות": a problem, an idea or anything else, straight to whoever builds the site. */
export function FeedbackDialog({ open, page, onClose }: { open: boolean; page: string; onClose: () => void }) {
  if (!open) return null;
  // Mounted afresh for every opening, so "sent" never greets the next one.
  return <FeedbackSheet page={page} onClose={onClose} />;
}

function FeedbackSheet({ page, onClose }: { page: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [kind, setKind] = useState<FeedbackKind>("problem");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || state === "sending") return;
    setState("sending");
    void sendFeedback({ kind, message, contact, page }).then(
      () => setState("sent"),
      () => setState("failed"),
    );
  };

  return (
    <div className="dialog-overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={(event) => event.stopPropagation()}>
        <button ref={closeRef} type="button" className="icon-button dialog-close" onClick={onClose} aria-label="סגירה">
          <X size={17} />
        </button>
        <h2 id="feedback-title">משוב והצעות</h2>
        {state === "sent" ? (
          <div className="feedback-sent" role="status">
            <span className="feedback-sent-mark">
              <Check size={22} />
            </span>
            <p>תודה! ההודעה הגיעה.</p>
            <button type="button" className="secondary-button compact" onClick={onClose}>
              סגירה
            </button>
          </div>
        ) : (
          <form className="feedback-form" onSubmit={send}>
            <p>משהו לא עובד? יש רעיון לשיפור? ההודעה מגיעה ישר למי שבונה את האתר.</p>
            <div className="segmented-control" role="group" aria-label="סוג ההודעה">
              {FEEDBACK_KINDS.map((item) => (
                <button key={item.id} type="button" className={kind === item.id ? "active" : ""} aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <textarea
              className="field feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={FEEDBACK_MAX}
              rows={5}
              required
              aria-label="ההודעה"
              placeholder={PROMPTS[kind]}
              dir="auto"
            />
            <input
              className="field"
              type="text"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              maxLength={200}
              autoComplete="email"
              inputMode="email"
              aria-label="מייל לתשובה, לא חובה"
              placeholder="מייל לתשובה (לא חובה)"
              dir="auto"
            />
            <p className="feedback-note">עם ההודעה נשלחים רק הדף שממנו היא נשלחה, שפת האתר וסוג המכשיר והדפדפן.</p>
            {state === "failed" && (
              <p className="error-message" role="alert">
                ההודעה לא נשלחה. בדוק את החיבור ונסה שוב.
              </p>
            )}
            <button type="submit" className="primary-button" disabled={!message.trim() || state === "sending"}>
              <Send size={18} /> {state === "sending" ? "שולח…" : "שליחה"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
