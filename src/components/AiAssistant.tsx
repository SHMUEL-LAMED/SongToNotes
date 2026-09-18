import { Bot, CircleHelp, LogIn, MousePointerClick, SendHorizontal, Sparkles, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AiError, chat, type AssistantMode, type ChatMessage } from "../lib/aiApi";
import { findTool } from "../lib/tools";
import { useAuth } from "../lib/auth";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** Where the visitor is, so the assistant can be asked "how do I use this?". */
  toolTitle: string | null;
};

const STORAGE_KEY = "musictools.assistant.v2";
const MAX_MESSAGE = 3000;
const EXECUTION_SUGGESTIONS = ["פתח לי את הכלי להסרת שירה", "קח אותי ליצירת צלצול", "פתח את המטרונום"];

const SUGGESTIONS = [
  "איך מוציאים תווים משיר?",
  "מה ההבדל בין הפרדה מהירה להפרדת AI?",
  "איך שומרים עבודה באזור האישי?",
  "תסביר לי מה זה סולם מז'ור",
];

function loadHistory(storageKey: string): ChatMessage[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    return Array.isArray(parsed) ? parsed.filter((item): item is ChatMessage =>
      item !== null && typeof item === "object" &&
      (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
    ).slice(-30).map((item) => ({ role: item.role, content: item.content.slice(0, 8000) })) : [];
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
export function AiAssistant(props: Props) {
  const { user } = useAuth();
  // Remount on account changes: never expose another account's conversation.
  return <AssistantConversation key={user?.id ?? "guest"} {...props} storageKey={`${STORAGE_KEY}.${user?.id ?? "guest"}`} />;
}

function AssistantConversation({ open, onClose, onOpen, toolTitle, storageKey }: Props & { storageKey: string }) {
  const { user, signInWithGoogle } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(storageKey));
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<AssistantMode>("question");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ content: string; mode: AssistantMode; detailed: boolean } | null>(null);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const [detailed, setDetailed] = useState(false);
  const destination = pendingRoute ? findTool(pendingRoute) : null;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-30)));
    } catch {
      // Private browsing; the conversation lasts as long as the page.
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, storageKey]);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

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

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const send = async (content: string, retrying = false) => {
    const clean = content.trim();
    if (!clean || abortRef.current || !user) return;
    if (clean.length > MAX_MESSAGE) {
      setError(`אפשר לשלוח עד ${MAX_MESSAGE} תווים בכל הודעה.`);
      return;
    }
    const requestMode = retrying && retry ? retry.mode : mode;
    const requestDetailed = retrying && retry ? retry.detailed : detailed;
    const next: ChatMessage[] = retrying ? messages : [...messages, { role: "user", content: clean }].slice(-30) as ChatMessage[];
    setMessages(next);
    setDraft("");
    setError(null);
    setPendingRoute(null);
    setRetry({ content: clean, mode: requestMode, detailed: requestDetailed });
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      if (abortRef.current !== controller) return;
      controller.abort();
      abortRef.current = null;
      setBusy(false);
      setError("התשובה מתעכבת. אפשר לנסות שוב או לקצר את השאלה.");
    }, 60000);
    try {
      // The page the visitor is on travels with the question, quietly.
      const context = [
        toolTitle ? `הכלי הנוכחי: ${toolTitle}.` : "הגולש בדף הבית.",
        requestDetailed ? "העדפה: הסבר מפורט עם צעדים ודוגמה שימושית." : "העדפה: תשובה קצרה וברורה, עם צעדים כשצריך.",
        "אם חסר פרט חיוני, שאל שאלה ממוקדת. אין לך גישה לקובץ האודיו או לתוצאות שלו מתוך השיחה.",
        requestMode === "execute" ? "פתיחת כלי דורשת אישור נוסף בכפתור. הצע את הפעולה ואל תטען שכבר בוצעה. אין לך יכולת להעלות קבצים או להתחיל עיבוד בעצמך." : "במצב שאלה מסבירים בלבד, ללא ביצוע פעולות.",
      ].join(" ");
      const history = next.slice(-16, -1).concat({ role: "user", content: `(${context})\n${clean}` });
      const reply = await chat(history, { mode: requestMode, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!reply || typeof reply.text !== "string" || !reply.text.trim()) {
        throw new Error("התקבלה תשובה ריקה. אפשר לנסות שוב.");
      }
      setMessages([...next, { role: "assistant", content: reply.text }].slice(-30) as ChatMessage[]);
      setRetry(null);
      if (requestMode === "execute" && reply.action?.type === "navigate" && findTool(reply.action.route)) {
        setPendingRoute(reply.action.route);
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof AiError || caught instanceof Error ? caught.message : "לא הצלחנו לענות.");
    } finally {
      window.clearTimeout(timer);
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
                  stop();
                  setMessages([]);
                  setError(null);
                  setRetry(null);
                  setPendingRoute(null);
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

          <div className="segmented-control assistant-mode" role="group" aria-label="מצב העוזר">
            <button
              type="button"
              className={mode === "question" ? "active" : ""}
              aria-pressed={mode === "question"}
              onClick={() => { setMode("question"); setPendingRoute(null); }}
              disabled={busy}
            >
              <CircleHelp size={15} /> מצב שאלה
            </button>
            <button
              type="button"
              className={mode === "execute" ? "active" : ""}
              aria-pressed={mode === "execute"}
              onClick={() => setMode("execute")}
              disabled={busy}
            >
              <MousePointerClick size={15} /> מצב ביצוע
            </button>
          </div>

          <div className="assistant-signin">
            <small>{mode === "execute" ? "מציע כלי מתאים ופותח אותו רק באישור שלך. עיבוד קבצים מתבצע בתוך הכלי." : "מסביר ועונה, בלי לשנות דבר באתר."}</small>
            <label><input type="checkbox" checked={detailed} onChange={(event) => setDetailed(event.target.checked)} disabled={busy} /> הסבר מפורט</label>
          </div>

          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="assistant-empty">
                <p>שלום! אפשר לשאול אותי איך להשתמש בכל כלי באתר, או כל שאלה על מוזיקה.</p>
                <div className="assistant-suggestions">
                  {(mode === "execute" ? EXECUTION_SUGGESTIONS : toolTitle ? [`איך משתמשים בכלי ${toolTitle}?`, ...SUGGESTIONS.slice(0, 3)] : SUGGESTIONS).map((item) => (
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
            {!busy && retry && (
              <button type="button" className="chip-toggle" onClick={() => void send(retry.content, true)}>נסה שוב את הבקשה האחרונה</button>
            )}
            {!busy && destination && mode === "execute" && (
              <div className="assistant-bubble is-assistant">
                <strong>לאישור: פתיחת {destination.title}</strong>
                <p>הפעולה תעביר אותך לכלי. כדאי לשמור עבודה פתוחה לפני המעבר. היא לא מעלה קובץ ולא מתחילה עיבוד.</p>
                <button type="button" className="primary-button compact" onClick={() => {
                  window.location.assign(`#/${destination.id}`);
                  setPendingRoute(null);
                  setMessages((previous) => [...previous, { role: "assistant", content: `בוצע מעבר לכלי ${destination.title}.` }].slice(-30) as ChatMessage[]);
                }}>אישור ופתיחת הכלי</button>
                <button type="button" className="chip-toggle" onClick={() => setPendingRoute(null)}>ביטול</button>
              </div>
            )}
            {!busy && !retry && !destination && messages.at(-1)?.role === "assistant" && (
              <div className="assistant-suggestions">
                {["תסביר בשלבים", "תן דוגמה", "תקצר את התשובה"].map((item) => <button key={item} type="button" className="chip-toggle" onClick={() => void send(item)}>{item}</button>)}
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
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                rows={1}
                maxLength={MAX_MESSAGE}
                placeholder={mode === "execute" ? "כתוב מה לבצע…" : "כתוב שאלה…"}
                aria-label="השאלה שלך"
                disabled={busy}
                dir="auto"
              />
              {busy ? <button type="button" className="primary-button compact" onClick={stop} aria-label="עצור תשובה" title="עצור תשובה"><Square size={18} /></button> : <button type="submit" className="primary-button compact" disabled={!draft.trim()} aria-label="שלח">
                <SendHorizontal size={18} />
              </button>}
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
