import {
  ArrowLeft,
  Bot,
  Check,
  CircleHelp,
  Copy,
  LogIn,
  Maximize2,
  MousePointerClick,
  Minimize2,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AiError, chatStream, type AssistantMode, type ChatMessage } from "../lib/aiApi";
import { useAuth } from "../lib/auth";
import { renderMarkdown, splitOpenMarkers } from "../lib/markdown";
import { findTool } from "../lib/tools";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** The tool the visitor is on, so the assistant can be asked "how do I use this?". */
  toolId?: string | null;
  toolTitle: string | null;
};

const STORAGE_KEY = "musictools.assistant.v3";
const MAX_MESSAGE = 3000;
const HISTORY = 40;

const SUGGESTIONS = [
  "איך מוציאים תווים משיר?",
  "מה ההבדל בין הפרדה מהירה להפרדת AI?",
  "איך שומרים עבודה באזור האישי?",
  "תסביר לי מה זה סולם מז'ור",
];

/** Something to ask about the page the visitor is on. */
const BY_TOOL: Record<string, string[]> = {
  notes: ["איך משפרים את דיוק זיהוי התווים?", "מה ההבדל בין MIDI ל־MusicXML?"],
  ringtone: ["איך מתקינים את הצלצול באייפון?", "מה האורך המומלץ לצלצול?"],
  vocals: ["למה השירה עדיין נשמעת בקריוקי?", "מתי לבחור הפרדת AI?"],
  speed: ["איך מאטים סולו בלי לשנות את הגובה?"],
  metronome: ["איך מתרגלים עם מטרונום?", "מה זה חלוקות משנה?"],
  tuner: ["איך מכוונים גיטרה לפי הטיונר?", "מה זה סנטים?"],
  piano: ["איזה סולם כדאי להתחיל ללמוד?"],
  ear: ["איך מזהים מרווחים בשמיעה?"],
  transcript: ["איך משפרים את איכות התמלול?", "איך מוציאים כתוביות לסרטון?"],
  analyze: ["מה זה Camelot ואיך משתמשים בו?"],
  chords: ["איך מנגנים אקורד באר?", "מה זה קאפו ולמה הוא עוזר?"],
  songbook: ["איך כותבים אקורדים מעל המילים?"],
};

function loadHistory(storageKey: string): ChatMessage[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey) ?? "null");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is ChatMessage =>
              item !== null &&
              typeof item === "object" &&
              ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "assistant") &&
              typeof (item as ChatMessage).content === "string",
          )
          .slice(-HISTORY)
          .map((item) => ({ role: item.role, content: item.content.slice(0, 8000) }))
      : [];
  } catch {
    return [];
  }
}

/**
 * A helper that answers questions about the tools and about music, from a
 * button at the corner of every page. The model runs on the site's server
 * and its reply streams in as it is written; a reply can end with buttons
 * that open the tool it talked about. It needs an account, like every use
 * of the server, and each account sees only its own conversation.
 */
export function AiAssistant(props: Props) {
  const { user } = useAuth();
  // Remount on account changes: never show another account's conversation.
  return <AssistantConversation key={user?.id ?? "guest"} {...props} storageKey={`${STORAGE_KEY}.${user?.id ?? "guest"}`} />;
}

function AssistantConversation({ open, onClose, onOpen, toolId = null, toolTitle, storageKey }: Props & { storageKey: string }) {
  const { user, signInWithGoogle } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(storageKey));
  const [draft, setDraft] = useState("");
  const [detailed, setDetailed] = useState(false);
  const [mode, setMode] = useState<AssistantMode>("question");
  const [busy, setBusy] = useState(false);
  // The reply being written, shown as it grows.
  const [partial, setPartial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [pendingTool, setPendingTool] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The text of the reply under way, for keeping it when the visitor stops.
  const writtenRef = useRef("");

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-HISTORY)));
    } catch {
      // Private browsing; the conversation lasts as long as the page.
    }
  }, [messages, storageKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: partial ? "auto" : "smooth" });
  }, [messages, busy, partial]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

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

  // The box grows with the question, up to a few lines.
  const resize = useCallback(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(140, box.scrollHeight)}px`;
  }, []);
  useEffect(resize, [draft, resize]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    // Whatever arrived before the stop is kept as the answer.
    const kept = writtenRef.current.trim();
    writtenRef.current = "";
    setPartial(null);
    if (kept) setMessages((previous) => [...previous, { role: "assistant" as const, content: kept }].slice(-HISTORY));
  };

  const send = async (content: string, base?: ChatMessage[]) => {
    const clean = content.trim();
    if (!clean || abortRef.current || !user) return;
    if (clean.length > MAX_MESSAGE) {
      setError(`אפשר לשלוח עד ${MAX_MESSAGE} תווים בכל הודעה.`);
      return;
    }
    const next: ChatMessage[] = [...(base ?? messages), { role: "user" as const, content: clean }].slice(-HISTORY);
    setMessages(next);
    setDraft("");
    setError(null);
    setRetry(null);
    setPendingTool(null);
    setBusy(true);
    setPartial("");
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      if (abortRef.current !== controller) return;
      controller.abort();
    }, 90_000);
    writtenRef.current = "";
    try {
      const reply = await chatStream(
        next.slice(-16),
        { tool: toolId, detailed, mode, signal: controller.signal },
        (piece) => {
          if (controller.signal.aborted) return;
          writtenRef.current += piece;
          setPartial(writtenRef.current);
        },
      );
      if (controller.signal.aborted) return;
      const text = reply.trim();
      if (!text) throw new Error("התקבלה תשובה ריקה. אפשר לנסות שוב.");
      writtenRef.current = "";
      setMessages([...next, { role: "assistant" as const, content: text }].slice(-HISTORY));
      const suggested = mode === "execute" ? splitOpenMarkers(text).tools.find((id) => findTool(id)) : undefined;
      if (suggested) setPendingTool(suggested);
      setPartial(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPartial(null);
      setRetry(clean);
      setError(caught instanceof AiError || caught instanceof Error ? caught.message : "לא הצלחנו לענות.");
    } finally {
      window.clearTimeout(timer);
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const regenerate = () => {
    // The last exchange is asked again, from the same question.
    const lastUser = [...messages].reverse().find((item) => item.role === "user");
    if (!lastUser) return;
    const cut = messages.lastIndexOf(lastUser);
    void send(lastUser.content, messages.slice(0, cut));
  };

  const copy = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied((current) => (current === index ? null : current)), 1800);
    } catch {
      setError("לא הצלחנו להעתיק.");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const openTool = (id: string) => {
    window.location.assign(`#/${id}`);
    if (window.innerWidth < 700) onClose();
  };

  const starters = toolId && BY_TOOL[toolId] ? [...BY_TOOL[toolId], ...SUGGESTIONS.slice(0, 2)] : toolTitle ? [`איך משתמשים בכלי ${toolTitle}?`, ...SUGGESTIONS.slice(0, 3)] : SUGGESTIONS;
  const lastAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";

  const bubble = (message: ChatMessage, index: number, live = false) => {
    if (message.role === "user") {
      return (
        <div key={`u${index}`} className="assistant-bubble is-user" dir="auto">
          {message.content}
        </div>
      );
    }
    const { text, tools } = splitOpenMarkers(message.content);
    return (
      <div key={`a${index}`} className={`assistant-bubble is-assistant ${live ? "is-live" : ""}`} dir="auto">
        <div className="assistant-markdown">{renderMarkdown(text)}</div>
        {!live && mode === "execute" && tools.length > 0 && (
          <div className="assistant-tools">
            {tools.map((id) => {
              const tool = findTool(id);
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <button key={id} type="button" className="assistant-open" onClick={() => setPendingTool(id)}>
                  <Icon size={16} /> הצע פתיחת {tool.title} <ArrowLeft size={14} />
                </button>
              );
            })}
          </div>
        )}
        {!live && (
          <div className="assistant-bubble-tools">
            <button type="button" className="link-button" onClick={() => void copy(index, text)} aria-label="העתק את התשובה">
              {copied === index ? <Check size={13} /> : <Copy size={13} />} {copied === index ? "הועתק" : "העתק"}
            </button>
            {index === messages.length - 1 && !busy && (
              <button type="button" className="link-button" onClick={regenerate} aria-label="נסח מחדש">
                <RefreshCw size={13} /> תשובה אחרת
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {!open && (
        <button type="button" className="assistant-launcher" onClick={onOpen} aria-label="פתח את העוזר" title="שאל את העוזר">
          <Sparkles size={20} />
          <span>עוזר</span>
        </button>
      )}
      {open && (
        <aside className={`assistant-panel ${wide ? "is-wide" : ""}`} role="dialog" aria-label="העוזר של כלי מוזיקה" aria-modal="false">
          <header className="assistant-head">
            <span className="tool-intro-icon">
              <Bot size={20} />
            </span>
            <div>
              <strong>העוזר</strong>
              <small>{toolTitle ? `עוזר בכלי ${toolTitle} ובכל שאלה במוזיקה` : "שאלות על הכלים ועל מוזיקה"}</small>
            </div>
            <button type="button" className="icon-button" onClick={() => setWide((value) => !value)} aria-label={wide ? "הקטן" : "הגדל"} title={wide ? "הקטן" : "הגדל"}>
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  stop();
                  setMessages([]);
                  setError(null);
                  setRetry(null);
                  setPartial(null);
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
            <button type="button" className={mode === "question" ? "active" : ""} aria-pressed={mode === "question"} disabled={busy} onClick={() => { setMode("question"); setPendingTool(null); }}>
              <CircleHelp size={15} /> מצב שאלה
            </button>
            <button type="button" className={mode === "execute" ? "active" : ""} aria-pressed={mode === "execute"} disabled={busy} onClick={() => setMode("execute")}>
              <MousePointerClick size={15} /> מצב ביצוע
            </button>
          </div>

          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && !busy && (
              <div className="assistant-empty">
                <p>שלום! אני כאן לכל שאלה על הכלים באתר ועל מוזיקה — ואפשר לבקש ממני לפתוח כלי.</p>
                <div className="assistant-suggestions">
                  {starters.map((item) => (
                    <button key={item} type="button" className="chip-toggle" onClick={() => void send(item)} disabled={busy || !user}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => bubble(message, index))}
            {busy && partial !== null && partial.length > 0 && bubble({ role: "assistant", content: partial }, messages.length, true)}
            {busy && !partial && (
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
              <button type="button" className="chip-toggle" onClick={() => void send(retry, messages.slice(0, -1))}>
                <RefreshCw size={14} /> נסה שוב
              </button>
            )}
            {!busy && !retry && lastAssistant && (
              <div className="assistant-suggestions is-followups">
                {["תסביר בשלבים", "תן דוגמה", "בקצרה יותר"].map((item) => (
                  <button key={item} type="button" className="chip-toggle" onClick={() => void send(item)}>
                    {item}
                  </button>
                ))}
              </div>
            )}
            {!busy && pendingTool && mode === "execute" && (() => {
              const tool = findTool(pendingTool);
              if (!tool) return null;
              return (
                <div className="assistant-bubble is-assistant assistant-confirm">
                  <strong>לאישור: פתיחת {tool.title}</strong>
                  <p>המעבר יפתח את הכלי בלבד. הוא לא יעלה קובץ ולא יתחיל עיבוד.</p>
                  <div className="assistant-tools">
                    <button type="button" className="assistant-open" onClick={() => { openTool(tool.id); setPendingTool(null); }}>
                      <Check size={15} /> אישור ופתיחת הכלי
                    </button>
                    <button type="button" className="link-button" onClick={() => setPendingTool(null)}>ביטול</button>
                  </div>
                </div>
              );
            })()}
          </div>

          {user ? (
            <form className="assistant-compose" onSubmit={submit}>
              <label className="assistant-detailed">
                <input type="checkbox" checked={detailed} onChange={(event) => setDetailed(event.target.checked)} /> מפורט
              </label>
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
                placeholder={mode === "execute" ? "כתוב מה תרצה לבצע…" : "כתוב שאלה…"}
                aria-label="השאלה שלך"
                dir="auto"
              />
              {busy ? (
                <button type="button" className="primary-button compact" onClick={stop} aria-label="עצור תשובה" title="עצור תשובה">
                  <Square size={18} />
                </button>
              ) : (
                <button type="submit" className="primary-button compact" disabled={!draft.trim()} aria-label="שלח">
                  <SendHorizontal size={18} />
                </button>
              )}
            </form>
          ) : (
            <div className="assistant-signin">
              <p>
                <LogIn size={15} /> כדי לשוחח עם העוזר צריך להתחבר — בחינם, ברגע.
              </p>
              <button type="button" className="primary-button compact" onClick={() => signInWithGoogle().catch(() => setError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."))}>
                <LogIn size={17} /> התחברות עם Google
              </button>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
