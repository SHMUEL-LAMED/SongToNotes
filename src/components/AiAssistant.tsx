import {
  Bot,
  Check,
  CircleHelp,
  Copy,
  LoaderCircle,
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
import {
  describeCatalog,
  describeState,
  findAction,
  formatActionResults,
  runAssistantAction,
  trimRecord,
  type ActionCall,
  type ActionRecord,
  type ActionSpec,
} from "../lib/assistantActions";
import { parseAssistantReply } from "../lib/assistantProtocol";
import { useAuth } from "../lib/auth";
import { renderMarkdown } from "../lib/markdown";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** The tool the visitor is on, so the assistant can be asked "how do I use this?". */
  toolId?: string | null;
  toolTitle: string | null;
};

/** One turn of the conversation, as the panel keeps it. */
type Message = ChatMessage & {
  /** The site's own report of what its actions did; sent to the model, never shown. */
  hidden?: boolean;
  /** What the assistant did after this reply, as chips under it. */
  actions?: ActionRecord[];
};

const STORAGE_KEY = "musictools.assistant.v3";
const MODE_KEY = "musictools.assistant.mode.v1";
const MAX_MESSAGE = 3000;
const HISTORY = 40;
/** Turns sent to the model with each question. */
const WINDOW = 16;
/** How many times the model may act, look, and act again for one request. */
const MAX_ROUNDS = 4;
/** Actions run from one reply; anything past this is ignored. */
const MAX_ACTIONS = 8;
/** Between two actions, so the page has rendered the first before the second reads it. */
const ACTION_GAP = 80;

const SUGGESTIONS = [
  "איך מוציאים תווים משיר?",
  "מה ההבדל בין הפרדה מהירה להפרדת AI?",
  "איך שומרים עבודה באזור האישי?",
  "תסביר לי מה זה סולם מז'ור",
];

/** Things to ask the assistant to do, when it is allowed to do them. */
const DO_SUGGESTIONS = [
  "כתוב שיר קצר על החורף עם אקורדים ושים אותו בשירון",
  "הפעל מטרונום ב־100 BPM במשקל 3/4",
  "פתח את הפסנתר ונגן אקורד דו מז'ור",
  "מה שמרתי באזור האישי?",
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

/** Something to ask the assistant to do on the page the visitor is on. */
const DO_BY_TOOL: Record<string, string[]> = {
  notes: ["טען את מנגינת הדוגמה והפוך אותה לתווים", "הורד את התוצאה כ־MIDI"],
  ringtone: ["קח את הפזמון ותעשה צלצול של 20 שניות"],
  vocals: ["הפק קריוקי עם AI"],
  speed: ["האט ל־75% והוסף חצי טון"],
  metronome: ["הגדר 120 BPM ב־4/4 והפעל", "עצור את המטרונום"],
  tuner: ["כוון לגיטרה והשמע את המיתר E הנמוך"],
  piano: ["נגן את סולם דו מז'ור", "נגן אקורד לה מינור"],
  ear: ["התחל תרגול מרווחים ברמה בינונית"],
  transcript: ["סכם לי את התמלול", "תרגם את התמלול לאנגלית"],
  chords: ["העלה בטון אחד ושלח לשירון"],
  songbook: ["העלה את השיר בטון", "הוסף בית נוסף לשיר"],
  tts: ["כתוב ברכה קצרה ליום הולדת והקרא אותה"],
  lyrics: ["הורד את המילים כ־LRC"],
  mixer: ["השתק את הערוץ הראשון והפעל"],
  rhythm: ["קבע 90 BPM ברמה קלה והתחל סיבוב"],
  analyze: ["מה הסולם והקצב של השיר?"],
  convert: ["המר ל־MP3 באיכות 320"],
  video: ["חלץ את השמע כ־MP3 ושלח לתמלול"],
  identify: ["האזן וזהה את השיר"],
};

function validRecord(item: unknown): item is ActionRecord {
  if (!item || typeof item !== "object") return false;
  const record = item as ActionRecord;
  return typeof record.id === "string" && typeof record.ok === "boolean" && typeof record.message === "string";
}

function loadHistory(storageKey: string): Message[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey) ?? "null");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is Message =>
              item !== null &&
              typeof item === "object" &&
              ((item as Message).role === "user" || (item as Message).role === "assistant") &&
              typeof (item as Message).content === "string",
          )
          .slice(-HISTORY)
          .map((item) => ({
            role: item.role,
            // A reply kept before the action protocol may still carry markers.
            content: item.role === "assistant" ? parseAssistantReply(item.content.slice(0, 8000)).text || item.content.slice(0, 8000) : item.content.slice(0, 8000),
            ...(item.hidden === true ? { hidden: true } : {}),
            ...(Array.isArray(item.actions)
              ? { actions: item.actions.filter(validRecord).slice(0, MAX_ACTIONS).map((record) => ({ id: record.id, params: record.params && typeof record.params === "object" ? record.params : {}, ok: record.ok, message: record.message, ...(record.cancelled ? { cancelled: true } : {}) })) }
              : {}),
          }))
      : [];
  } catch {
    return [];
  }
}

function loadMode(): AssistantMode {
  try {
    return localStorage.getItem(MODE_KEY) === "question" ? "question" : "execute";
  } catch {
    return "execute";
  }
}

/** The turns as the model receives them: role and text only. */
function toHistory(messages: Message[]): ChatMessage[] {
  return messages.slice(-WINDOW).map(({ role, content }) => ({ role, content }));
}

/**
 * A helper that answers questions about the tools and about music, and does
 * things on the site when asked to, from a button at the corner of every
 * page. The model runs on the site's server and its reply streams in as it
 * is written. In "do" mode the reply can carry actions ({@link ../lib/assistantProtocol});
 * the panel runs them one by one, asks the visitor before anything that
 * cannot be undone, and — when an action brought data back or failed —
 * reports the outcome to the model so it can carry on. It needs an account,
 * like every use of the server, and each account sees only its own
 * conversation.
 */
export function AiAssistant(props: Props) {
  const { user } = useAuth();
  // Remount on account changes: never show another account's conversation.
  return <AssistantConversation key={user?.id ?? "guest"} {...props} storageKey={`${STORAGE_KEY}.${user?.id ?? "guest"}`} />;
}

type Confirmation = { call: ActionCall; spec: ActionSpec; resolve: (approved: boolean) => void };

function AssistantConversation({ open, onClose, onOpen, toolId = null, toolTitle, storageKey }: Props & { storageKey: string }) {
  const { user, signInWithGoogle } = useAuth();
  const [messages, setMessages] = useState<Message[]>(() => loadHistory(storageKey));
  const [draft, setDraft] = useState("");
  const [detailed, setDetailed] = useState(false);
  const [mode, setMode] = useState<AssistantMode>(loadMode);
  const [busy, setBusy] = useState(false);
  // The reply being written, shown as it grows.
  const [partial, setPartial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  // The action under way, and an action waiting for the visitor's yes.
  const [acting, setActing] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set by the stop button: no further action of this request runs.
  const haltRef = useRef(false);
  // The text of the reply under way, for keeping it when the visitor stops.
  const writtenRef = useRef("");
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-HISTORY)));
    } catch {
      // Private browsing; the conversation lasts as long as the page.
    }
  }, [messages, storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Fine.
    }
  }, [mode]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: partial ? "auto" : "smooth" });
  }, [messages, busy, partial, acting, confirmation]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      haltRef.current = true;
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
    haltRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    confirmation?.resolve(false);
    setConfirmation(null);
    setActing(null);
    setBusy(false);
    // Whatever arrived before the stop is kept as the answer.
    const kept = writtenRef.current.trim();
    writtenRef.current = "";
    setPartial(null);
    if (kept) {
      const { text } = parseAssistantReply(kept);
      if (text) setMessages((previous) => [...previous, { role: "assistant" as const, content: text }].slice(-HISTORY));
    }
  };

  /** Puts the question to the visitor and waits for the button. */
  const askConfirmation = (call: ActionCall, spec: ActionSpec) =>
    new Promise<boolean>((resolve) => {
      onOpenRef.current();
      setConfirmation({
        call,
        spec,
        resolve: (approved) => {
          setConfirmation(null);
          resolve(approved);
        },
      });
    });

  /** Runs the reply's actions in order, telling the panel about each. */
  const runActions = async (calls: ActionCall[], report: (records: ActionRecord[]) => void) => {
    const records: ActionRecord[] = [];
    for (const call of calls.slice(0, MAX_ACTIONS)) {
      if (haltRef.current) break;
      const spec = findAction(call.id);
      if (spec?.confirm) {
        const approved = await askConfirmation(call, spec);
        if (haltRef.current) break;
        if (!approved) {
          records.push({ ...call, ok: false, cancelled: true, message: "בוטל" });
          report([...records]);
          continue;
        }
      }
      setActing(spec?.label ?? call.id);
      const record = await runAssistantAction(call);
      records.push(record);
      report([...records]);
      await new Promise((resolve) => window.setTimeout(resolve, ACTION_GAP));
    }
    setActing(null);
    return records;
  };

  /**
   * One round: the model answers the conversation as it stands, its actions
   * run, and — when it has something to learn from them — the outcome goes
   * back as the next turn and the round repeats.
   */
  const converse = async (next: Message[], round: number): Promise<void> => {
    setMessages(next);
    setError(null);
    setRetry(null);
    setBusy(true);
    setPartial("");
    haltRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      if (abortRef.current !== controller) return;
      controller.abort();
    }, 90_000);
    writtenRef.current = "";
    const asked = next[next.length - 1]?.content ?? "";
    try {
      const context = {
        state: describeState().slice(0, 4000) || undefined,
        catalog: mode === "execute" ? describeCatalog(toolId) : undefined,
      };
      const reply = await chatStream(
        toHistory(next),
        { tool: toolId, detailed, mode, context, signal: controller.signal },
        (piece) => {
          if (controller.signal.aborted) return;
          writtenRef.current += piece;
          setPartial(writtenRef.current);
        },
      );
      window.clearTimeout(timer);
      if (controller.signal.aborted) return;
      const parsed = parseAssistantReply(reply);
      const actions = mode === "execute" ? parsed.actions : [];
      const text = parsed.text || (actions.length ? "מבצע." : "");
      if (!text) throw new Error("התקבלה תשובה ריקה. אפשר לנסות שוב.");
      writtenRef.current = "";
      setPartial(null);
      let entry: Message = { role: "assistant", content: text, ...(actions.length ? { actions: [] } : {}) };
      let history = [...next, entry].slice(-HISTORY);
      setMessages(history);
      if (!actions.length) return;

      const records = await runActions(actions, (list) => {
        entry = { ...entry, actions: list.map(trimRecord) };
        history = [...next, entry].slice(-HISTORY);
        setMessages(history);
      });
      if (haltRef.current) return;
      // A read brought data the model asked for; a failure is worth a
      // second try. A plain success needs no more words from the model.
      const worthAnotherRound = records.some((record) => (record.ok && record.data !== undefined) || (!record.ok && !record.cancelled));
      if (worthAnotherRound && round < MAX_ROUNDS) {
        abortRef.current = null;
        const report: Message = { role: "user", content: formatActionResults(records), hidden: true };
        await converse([...history, report].slice(-HISTORY), round + 1);
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPartial(null);
      if (round === 0) setRetry(asked);
      setError(caught instanceof AiError || caught instanceof Error ? caught.message : "לא הצלחנו לענות.");
    } finally {
      window.clearTimeout(timer);
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const send = (content: string, base?: Message[]) => {
    const clean = content.trim();
    if (!clean || abortRef.current || !user) return;
    if (clean.length > MAX_MESSAGE) {
      setError(`אפשר לשלוח עד ${MAX_MESSAGE} תווים בכל הודעה.`);
      return;
    }
    setDraft("");
    void converse([...(base ?? messages), { role: "user" as const, content: clean }].slice(-HISTORY), 0);
  };

  const regenerate = () => {
    // The last exchange is asked again, from the same question.
    const lastUser = [...messages].reverse().find((item) => item.role === "user" && !item.hidden);
    if (!lastUser) return;
    const cut = messages.lastIndexOf(lastUser);
    send(lastUser.content, messages.slice(0, cut));
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
    send(draft);
  };

  const starters =
    mode === "execute"
      ? [...(toolId && DO_BY_TOOL[toolId] ? DO_BY_TOOL[toolId] : []), ...(toolId && BY_TOOL[toolId] ? BY_TOOL[toolId].slice(0, 1) : []), ...DO_SUGGESTIONS.slice(0, toolId ? 2 : 4)]
      : toolId && BY_TOOL[toolId]
        ? [...BY_TOOL[toolId], ...SUGGESTIONS.slice(0, 2)]
        : toolTitle
          ? [`איך משתמשים בכלי ${toolTitle}?`, ...SUGGESTIONS.slice(0, 3)]
          : SUGGESTIONS;
  const shown = messages.filter((message) => !message.hidden);
  const lastAssistant = shown.length > 0 && shown[shown.length - 1].role === "assistant";
  const lastShownIndex = messages.lastIndexOf(shown[shown.length - 1]);

  const bubble = (message: Message, index: number, live = false) => {
    if (message.role === "user") {
      return (
        <div key={`u${index}`} className="assistant-bubble is-user" dir="auto">
          {message.content}
        </div>
      );
    }
    const text = live ? parseAssistantReply(message.content).text : message.content;
    return (
      <div key={`a${index}`} className={`assistant-bubble is-assistant ${live ? "is-live" : ""}`} dir="auto">
        <div className="assistant-markdown">{renderMarkdown(text)}</div>
        {!live && message.actions && message.actions.length > 0 && (
          <ul className="assistant-actions" aria-label="פעולות שבוצעו">
            {message.actions.map((record, at) => {
              const spec = findAction(record.id);
              return (
                <li key={at} className={`assistant-action ${record.cancelled ? "is-cancelled" : record.ok ? "is-ok" : "is-failed"}`}>
                  {record.cancelled ? <X size={14} /> : record.ok ? <Check size={14} /> : <X size={14} />}
                  <div>
                    <b>{spec?.label ?? record.id}</b>
                    {record.message && <span> · {record.message}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!live && (
          <div className="assistant-bubble-tools">
            <button type="button" className="link-button" onClick={() => void copy(index, text)} aria-label="העתק את התשובה">
              {copied === index ? <Check size={13} /> : <Copy size={13} />} {copied === index ? "הועתק" : "העתק"}
            </button>
            {index === lastShownIndex && !busy && (
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
              <small>
                {mode === "execute"
                  ? toolTitle
                    ? `מבצע פעולות בכלי ${toolTitle} ובכל האתר, ועונה על שאלות`
                    : "מבצע פעולות באתר ועונה על שאלות במוזיקה"
                  : toolTitle
                    ? `עוזר בכלי ${toolTitle} ובכל שאלה במוזיקה`
                    : "שאלות על הכלים ועל מוזיקה"}
              </small>
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
            <button type="button" className={mode === "execute" ? "active" : ""} aria-pressed={mode === "execute"} disabled={busy} onClick={() => setMode("execute")}>
              <MousePointerClick size={15} /> מצב ביצוע
            </button>
            <button type="button" className={mode === "question" ? "active" : ""} aria-pressed={mode === "question"} disabled={busy} onClick={() => setMode("question")}>
              <CircleHelp size={15} /> מצב שאלה
            </button>
          </div>

          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {shown.length === 0 && !busy && (
              <div className="assistant-empty">
                <p>
                  {mode === "execute"
                    ? "שלום! אפשר לבקש ממני לעשות דברים באתר — לכתוב שיר לשירון, להפעיל מטרונום, לנגן, לתמלל, לשמור — וגם לשאול כל שאלה על הכלים ועל מוזיקה."
                    : "שלום! אני כאן לכל שאלה על הכלים באתר ועל מוזיקה. במצב ביצוע אני גם עושה דברים באתר."}
                </p>
                <div className="assistant-suggestions">
                  {starters.map((item) => (
                    <button key={item} type="button" className="chip-toggle" onClick={() => send(item)} disabled={busy || !user}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (message.hidden ? null : bubble(message, index)))}
            {busy && partial !== null && partial.length > 0 && bubble({ role: "assistant", content: partial }, messages.length, true)}
            {busy && !partial && !acting && !confirmation && (
              <div className="assistant-bubble is-assistant is-thinking" aria-label="העוזר חושב">
                <span />
                <span />
                <span />
              </div>
            )}
            {acting && (
              <div className="assistant-acting" role="status">
                <LoaderCircle size={15} className="spin" /> מבצע: {acting}…
              </div>
            )}
            {confirmation && (
              <div className="assistant-bubble is-assistant assistant-confirm">
                <strong>לאישור: {confirmation.spec.label}</strong>
                <p>
                  {confirmation.spec.description}
                  {Object.keys(confirmation.call.params).length > 0 && (
                    <>
                      {" "}
                      <code dir="ltr">{JSON.stringify(confirmation.call.params)}</code>
                    </>
                  )}
                </p>
                <div className="assistant-tools">
                  <button type="button" className="assistant-open" onClick={() => confirmation.resolve(true)}>
                    <Check size={15} /> אישור
                  </button>
                  <button type="button" className="link-button" onClick={() => confirmation.resolve(false)}>
                    ביטול
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
            {!busy && retry && (
              <button type="button" className="chip-toggle" onClick={() => send(retry, messages.slice(0, -1))}>
                <RefreshCw size={14} /> נסה שוב
              </button>
            )}
            {!busy && !retry && lastAssistant && (
              <div className="assistant-suggestions is-followups">
                {(mode === "execute" ? ["בטל את זה", "תסביר בשלבים", "תן דוגמה"] : ["תסביר בשלבים", "תן דוגמה", "בקצרה יותר"]).map((item) => (
                  <button key={item} type="button" className="chip-toggle" onClick={() => send(item)}>
                    {item}
                  </button>
                ))}
              </div>
            )}
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
                    send(draft);
                  }
                }}
                rows={1}
                maxLength={MAX_MESSAGE}
                placeholder={mode === "execute" ? "כתוב מה לעשות, או מה לשאול…" : "כתוב שאלה…"}
                aria-label="השאלה שלך"
                dir="auto"
              />
              {busy ? (
                <button type="button" className="primary-button compact" onClick={stop} aria-label="עצור" title="עצור">
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
