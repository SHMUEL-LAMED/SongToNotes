import { Bot, LogIn, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AiError, chat, type ChatMessage } from "../lib/aiApi";
import { useAuth } from "../lib/auth";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** Where the visitor is, so the assistant can be asked "how do I use this?". */
  toolTitle: string | null;
};

const STORAGE_KEY = "musictools.assistant.v1";

const SUGGESTIONS = [
  "איך מוציאים תווים משיר?",
  "מה ההבדל בין הפרדה מהירה להפרדת AI?",
  "איך שומרים עבודה באזור האישי?",
  "תסביר לי מה זה סולם מז'ור",
];

function loadHistory(): ChatMessage[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    return Array.isArray(parsed) ? (parsed as ChatMessage[]).slice(-30) : [];
  } catch {
    return [];
  }
}

/**
 * A helper that answers questions about the tools and about music, from a
 * button at the corner of every page. The model runs on the site's server,
 * so the panel is only a conversation: nothing is installed. It needs an
 * account, like every use of the server.
 */
export function AiAssistant({ open, onClose, onOpen, toolTitle }: Props) {
  const { user, signInWithGoogle } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Private browsing; the conversation lasts as long as the page.
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open]);

  const send = async (content: string) => {
    const clean = content.trim();
    if (!clean || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: clean }];
    setMessages(next);
    setDraft("");
    setError(null);
    setBusy(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // The page the visitor is on travels with the question, quietly.
      const context = toolTitle ? `(הגולש נמצא כרגע בכלי "${toolTitle}".) ` : "";
      const history = next.slice(0, -1).concat({ role: "user", content: `${context}${clean}` });
      const reply = await chat(history, controller.signal);
      if (controller.signal.aborted) return;
      setMessages([...next, { role: "assistant", content: reply.text }]);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof AiError || caught instanceof Error ? caught.message : "לא הצלחנו לענות.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          className="assistant-launcher"
          onClick={onOpen}
          aria-label="פתח את העוזר"
          title="שאל את העוזר"
        >
          <Sparkles size={20} />
          <span>עוזר</span>
        </button>
      )}
      {open && (
        <aside className="assistant-panel" role="dialog" aria-label="העוזר של כלי מוזיקה" aria-modal="false">
          <header className="assistant-head">
            <span className="tool-intro-icon">
              <Bot size={20} />
            </span>
            <div>
              <strong>העוזר</strong>
              <small>שאלות על הכלים ועל מוזיקה · עונה מהשרת</small>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  abortRef.current?.abort();
                  setMessages([]);
                  setError(null);
                  setBusy(false);
                }}
                aria-label="נקה את השיחה"
                title="נקה את השיחה"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label="סגור את העוזר">
              <X size={18} />
            </button>
          </header>

          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="assistant-empty">
                <p>שלום! אפשר לשאול אותי איך להשתמש בכל כלי באתר, או כל שאלה על מוזיקה.</p>
                <div className="assistant-suggestions">
                  {SUGGESTIONS.map((item) => (
                    <button key={item} type="button" className="chip-toggle" onClick={() => void send(item)} disabled={busy || !user}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={`assistant-bubble is-${message.role}`} dir="auto">
                {message.content}
              </div>
            ))}
            {busy && (
              <div className="assistant-bubble is-assistant is-thinking" aria-label="העוזר חושב">
                <span />
                <span />
                <span />
              </div>
            )}
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
          </div>

          {user ? (
            <form className="assistant-compose" onSubmit={submit}>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                rows={1}
                placeholder="כתוב שאלה…"
                aria-label="השאלה שלך"
                disabled={busy}
                dir="auto"
              />
              <button type="submit" className="primary-button compact" disabled={busy || !draft.trim()} aria-label="שלח">
                <SendHorizontal size={18} />
              </button>
            </form>
          ) : (
            <div className="assistant-signin">
              <p>
                <LogIn size={15} /> כדי לשוחח עם העוזר צריך להתחבר — בחינם, ברגע.
              </p>
              <button
                type="button"
                className="primary-button compact"
                onClick={() =>
                  signInWithGoogle().catch(() => setError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."))
                }
              >
                <LogIn size={17} /> התחברות עם Google
              </button>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
