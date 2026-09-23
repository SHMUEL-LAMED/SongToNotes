import {
  Bot,
  Check,
  CircleHelp,
  Copy,
  History,
  ListChecks,
  LoaderCircle,
  LogIn,
  MapPin,
  MessageSquarePlus,
  Mic,
  MicOff,
  Pencil,
  Play,
  RefreshCw,
  Settings2,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
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
import {
  deleteChat as removeChat,
  emptyChat,
  listChats,
  readLocal,
  renameChat,
  saveChat,
  titleFrom,
  type Chat,
  type StoredMessage,
} from "../lib/assistantChats";
import { parseAssistantReply, type PlanStep } from "../lib/assistantProtocol";
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

/**
 * One turn of the conversation. The thread itself is kept and synced by
 * {@link ../lib/assistantChats}, so this is that module's shape.
 */
type Message = StoredMessage;

const MODE_KEY = "musictools.assistant.mode.v1";
const PREFS_KEY = "musictools.assistant.prefs.v1";
/**
 * A message is capped only where a text box has to stop somewhere; the
 * conversation itself is not trimmed here. What fits in the model's context
 * is decided on the server, which fills its budget from the newest turn
 * backwards and says so when something was left out.
 */
const MAX_MESSAGE = 32_000;
/** How long after the last change the thread is written down. */
const SAVE_AFTER = 700;
/** How many times the agent may act, look, and act again for one request. */
const MAX_ROUNDS = 12;
/** Actions run from one reply; anything past this is ignored. */
const MAX_ACTIONS = 8;
/** Between two actions, so the page has rendered the first before the second reads it. */
const ACTION_GAP = 80;
/** The panel's width, in pixels: what it opens at and how far it can be dragged. */
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 340;
const MAX_WIDTH = 760;

const MODES: { id: AssistantMode; label: string; hint: string; icon: typeof Zap }[] = [
  { id: "question", label: "שאלה", hint: "תשובות והסברים, בלי לגעת בכלום", icon: CircleHelp },
  { id: "plan", label: "תכנון", hint: "תוכנית צעד אחר צעד, ומבצעים בלחיצה", icon: ListChecks },
  { id: "execute", label: "סוכן", hint: "מתכנן ומבצע באתר עד הסוף, בלי לעצור לאישור", icon: Zap },
];

const SUGGESTIONS = [
  "איך מוציאים תווים משיר?",
  "מה ההבדל בין הפרדה מהירה להפרדת AI?",
  "איך שומרים עבודה באזור האישי?",
  "תסביר לי מה זה סולם מז'ור",
];

/** Things to ask the agent to do. */
const DO_SUGGESTIONS = [
  "כתוב שיר קצר על החורף עם אקורדים ושים אותו בשירון",
  "הפעל מטרונום ב־100 BPM במשקל 3/4",
  "פתח את הפסנתר ונגן אקורד דו מז'ור",
  "מה שמרתי באזור האישי?",
];

/** Bigger jobs, for the plan mode. */
const PLAN_SUGGESTIONS = [
  "תכנן לי אימון גיטרה של 20 דקות עם מטרונום ואקורדים",
  "תכנן שיר יום הולדת: מילים, אקורדים, והקראה",
  "תכנן ביט היפ־הופ ב־90 BPM ושמירה שלו",
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
  beats: ["מה זה סווינג בתופים?"],
  theory: ["איך עובד מעגל הקווינטות?", "מה ההבדל בין דוריאני למינור?"],
};

/** Something to ask the agent to do on the page the visitor is on. */
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
  beats: ["בנה ביט טראפ ב־140 BPM והפעל", "הוסף היי־האט על כל שמינית"],
  theory: ["הראה את סולם לה מינור על הגיטרה", "נגן את האקורד של הדרגה החמישית"],
};

function loadMode(): AssistantMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "question" || stored === "plan" ? stored : "execute";
  } catch {
    return "execute";
  }
}

type Prefs = { detailed: boolean; confirm: boolean; width: number };

function clampWidth(value: number) {
  const room = typeof window === "undefined" ? MAX_WIDTH : Math.max(MIN_WIDTH, window.innerWidth - 420);
  return Math.round(Math.min(MAX_WIDTH, room, Math.max(MIN_WIDTH, value)));
}

function loadPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    return {
      detailed: stored?.detailed === true,
      confirm: stored?.confirm === true,
      width: typeof stored?.width === "number" && Number.isFinite(stored.width) ? stored.width : DEFAULT_WIDTH,
    };
  } catch {
    return { detailed: false, confirm: false, width: DEFAULT_WIDTH };
  }
}

/** The turns as the model receives them: role and text only, all of them. */
function toHistory(messages: Message[]): ChatMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

const timeFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });
function whenLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

/** The newest plan in the thread, from the assistant's own turns. */
function latestPlan(messages: Message[]): PlanStep[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const { plan } = parseAssistantReply(message.content);
    if (plan) return plan;
  }
  return null;
}

/** The browser's speech recognition, where there is one. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** A task list: what is done, what is under way, what is next. */
function PlanCard({ steps, compact = false }: { steps: PlanStep[]; compact?: boolean }) {
  const done = steps.filter((step) => step.status === "done").length;
  return (
    <div className={`assistant-plan ${compact ? "is-compact" : ""}`}>
      <div className="assistant-plan-head">
        <ListChecks size={15} />
        <strong>תוכנית</strong>
        <span>
          {done}/{steps.length}
        </span>
      </div>
      <div className="assistant-plan-bar" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      {!compact && (
        <ol className="assistant-plan-steps">
          {steps.map((step, index) => (
            <li key={index} className={`is-${step.status}`}>
              <span className="assistant-plan-mark" aria-hidden="true">
                {step.status === "done" ? <Check size={12} /> : step.status === "active" ? <LoaderCircle size={12} className="spin" /> : index + 1}
              </span>
              <span dir="auto">{step.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The assistant, docked at the side of every page. It answers questions
 * about the tools and about music, writes a plan for a bigger job, and — as
 * an agent — carries the job out on the site: the reply can carry a plan and
 * actions ({@link ../lib/assistantProtocol}), the panel runs the actions one
 * by one, and whatever they brought back goes to the model for the next
 * round until the plan is done. The model runs on the site's server and its
 * reply streams in as it is written.
 *
 * Conversations are kept: the one on screen is written down as it grows, and
 * the rest are a click away in the history, on this device and — with an
 * account — on every device. It needs an account, like every use of the
 * server, and each account sees only its own threads.
 */
export function AiAssistant(props: Props) {
  const { user } = useAuth();
  // Remount on account changes: never show another account's conversation.
  return <AssistantConversation key={user?.id ?? "guest"} {...props} />;
}

type Confirmation = { call: ActionCall; spec: ActionSpec; resolve: (approved: boolean) => void };

function AssistantConversation({ open, onClose, onOpen, toolId = null, toolTitle }: Props) {
  const { user, signInWithGoogle } = useAuth();
  const userId = user?.id ?? null;
  // The thread on screen, and the rest of them. This device's copy is read
  // synchronously, so a refresh comes back to the conversation rather than
  // to an empty panel; the profile's threads arrive a moment later.
  const [restored] = useState<Chat>(() => readLocal(userId).find((item) => item.messages.length) ?? emptyChat());
  const [chat, setChat] = useState<Chat>(restored);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>(restored.messages);
  const [draft, setDraft] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [mode, setMode] = useState<AssistantMode>(loadMode);
  const [busy, setBusy] = useState(false);
  // The reply being written, shown as it grows.
  const [partial, setPartial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  // The action under way, and an action waiting for the visitor's yes.
  const [acting, setActing] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  // Set by the stop button: no further action of this request runs.
  const haltRef = useRef(false);
  // The text of the reply under way, for keeping it when the visitor stops.
  const writtenRef = useRef("");
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  const width = clampWidth(prefs.width);

  // The thread is written down a moment after it stops changing, so a reply
  // streaming in token by token is one save rather than hundreds.
  const chatRef = useRef(chat);
  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);
  useEffect(() => {
    if (!messages.length) return;
    // Opening a thread is not a change to it.
    if (chatRef.current.messages === messages) return;
    const timer = window.setTimeout(() => {
      const current = chatRef.current;
      const next: Chat = {
        ...current,
        messages,
        title: current.title === "שיחה חדשה" ? titleFrom(messages) : current.title,
      };
      void saveChat(next, userId)
        .then((saved) => {
          setChat((live) => (live.id === saved.id ? { ...live, title: saved.title, updatedAt: saved.updatedAt, localOnly: saved.localOnly } : live));
          setChats((list) => (list ? [saved, ...list.filter((item) => item.id !== saved.id)] : list));
        })
        .catch(() => undefined);
    }, SAVE_AFTER);
    return () => window.clearTimeout(timer);
  }, [messages, userId]);

  // With an account the threads made on other devices come down once, and
  // the newest one opens when this device had nothing of its own.
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void listChats(userId)
      .then((list) => {
        if (!live) return;
        setChats(list);
        const newest = list.find((item) => item.messages.length);
        if (!newest) return;
        setChat((current) => (current.messages.length ? current : newest));
        setMessages((current) => (current.length ? current : newest.messages));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId]);

  // The list is refreshed whenever the history is opened.
  useEffect(() => {
    if (!showHistory) return;
    let live = true;
    void listChats(userId)
      .then((list) => {
        if (live) setChats(list);
      })
      .catch(() => {
        if (live) setChats([]);
      });
    return () => {
      live = false;
    };
  }, [showHistory, userId]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Fine.
    }
  }, [mode]);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Fine.
    }
  }, [prefs]);

  // Docked, the panel takes its width from the page rather than covering
  // it: the shell reads these two from the root and makes room.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.assistant = open ? "open" : "closed";
    root.style.setProperty("--assistant-w", `${width}px`);
    return () => {
      delete root.dataset.assistant;
    };
  }, [open, width]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: partial ? "auto" : "smooth" });
  }, [messages, busy, partial, acting, confirmation]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      haltRef.current = true;
      recognitionRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    const onKey = (event: KeyboardEvent) => {
      // Escape closes the panel only from inside it: on the page it belongs
      // to whatever dialog or menu is open there.
      if (event.key === "Escape" && panelRef.current?.contains(event.target as Node)) {
        if (showSettings) setShowSettings(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, open, showSettings]);

  // The box grows with the question, up to a few lines.
  const resize = useCallback(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(180, box.scrollHeight)}px`;
  }, []);
  useEffect(resize, [draft, resize]);

  /** Dragging the panel's inner edge makes it wider or narrower. */
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    const rtl = getComputedStyle(panel).direction === "rtl";
    const rect = panel.getBoundingClientRect();
    const move = (moved: PointerEvent) => {
      const next = rtl ? moved.clientX - rect.left : rect.right - moved.clientX;
      setPrefs((current) => ({ ...current, width: clampWidth(next) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.documentElement.classList.remove("is-resizing-assistant");
    };
    document.documentElement.classList.add("is-resizing-assistant");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
      if (text) setMessages((previous) => [...previous, { role: "assistant" as const, content: kept }]);
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
      if (spec?.confirm && prefs.confirm) {
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
   * run, and — when it has something to learn from them or steps of its
   * plan are still open — the outcome goes back as the next turn and the
   * round repeats.
   */
  const converse = async (next: Message[], round: number, runMode: AssistantMode): Promise<void> => {
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
    let answeredBy: string | null = null;
    const asked = next[next.length - 1]?.content ?? "";
    try {
      const context = {
        state: describeState().slice(0, 4000) || undefined,
        catalog: runMode === "question" ? undefined : describeCatalog(toolId),
      };
      const reply = await chatStream(
        toHistory(next),
        {
          tool: toolId,
          detailed: prefs.detailed,
          mode: runMode,
          context,
          signal: controller.signal,
          onModel: (name) => {
            answeredBy = name;
            setModel(name);
          },
        },
        (piece) => {
          if (controller.signal.aborted) return;
          writtenRef.current += piece;
          setPartial(writtenRef.current);
        },
      );
      window.clearTimeout(timer);
      if (controller.signal.aborted) return;
      const parsed = parseAssistantReply(reply);
      const actions = runMode === "execute" ? parsed.actions : [];
      if (!parsed.text && !parsed.plan && !actions.length) throw new Error("התקבלה תשובה ריקה. אפשר לנסות שוב.");
      writtenRef.current = "";
      setPartial(null);
      let entry: Message = {
        role: "assistant",
        content: reply.trim(),
        ...(actions.length ? { actions: [] } : {}),
        ...(answeredBy ? { model: answeredBy } : {}),
      };
      let history = [...next, entry];
      setMessages(history);
      if (!actions.length) return;

      const records = await runActions(actions, (list) => {
        entry = { ...entry, actions: list.map(trimRecord) };
        history = [...next, entry];
        setMessages(history);
      });
      if (haltRef.current) return;
      // A read brought data the model asked for, a failure is worth a second
      // try, and a plan with open steps is not finished: each of these is
      // another round. A plain success with nothing left needs no more words.
      const openSteps = (parsed.plan ?? (round > 0 ? latestPlan(next) : null) ?? []).some((step) => step.status !== "done");
      const worthAnotherRound = openSteps || records.some((record) => (record.ok && record.data !== undefined) || (!record.ok && !record.cancelled));
      if (worthAnotherRound && round < MAX_ROUNDS) {
        abortRef.current = null;
        const report: Message = { role: "user", content: formatActionResults(records), hidden: true };
        await converse([...history, report], round + 1, runMode);
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

  const send = (content: string, base?: Message[], runMode: AssistantMode = mode) => {
    const clean = content.trim();
    if (!clean || abortRef.current || !user) return;
    if (clean.length > MAX_MESSAGE) {
      setError(`אפשר לשלוח עד ${MAX_MESSAGE} תווים בכל הודעה.`);
      return;
    }
    recognitionRef.current?.stop();
    setDraft("");
    setShowSettings(false);
    void converse([...(base ?? messages), { role: "user" as const, content: clean }], 0, runMode);
  };

  /** The plan on screen becomes the agent's task. */
  const executePlan = () => {
    setMode("execute");
    send("בצע את התוכנית.", undefined, "execute");
  };

  /** Speaking instead of typing, where the browser can listen. */
  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Speech = speechRecognition();
    if (!Speech) {
      setError("הדפדפן הזה לא תומך בהכתבה. אפשר לנסות ב־Chrome או ב־Edge.");
      return;
    }
    const recognition = new Speech();
    recognition.lang = "he-IL";
    recognition.interimResults = true;
    recognition.continuous = false;
    const before = draft ? `${draft.trimEnd()} ` : "";
    recognition.onresult = (event) => {
      let heard = "";
      for (let index = 0; index < event.results.length; index += 1) heard += event.results[index][0].transcript;
      setDraft(before + heard);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  /** Puts the current thread away and starts an empty one. */
  const startNewChat = () => {
    stop();
    setChat(emptyChat());
    setMessages([]);
    setError(null);
    setRetry(null);
    setPartial(null);
    setShowHistory(false);
    window.setTimeout(() => inputRef.current?.focus(), 60);
  };

  const openChat = (item: Chat) => {
    stop();
    setChat(item);
    setMessages(item.messages);
    setError(null);
    setRetry(null);
    setPartial(null);
    setShowHistory(false);
  };

  const dropChat = (id: string) => {
    void removeChat(id, userId).catch(() => undefined);
    setChats((list) => (list ? list.filter((item) => item.id !== id) : list));
    // Throwing away the thread on screen leaves an empty one in its place.
    if (id === chat.id) {
      stop();
      setChat(emptyChat());
      setMessages([]);
    }
  };

  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    const { id } = renaming;
    setRenaming(null);
    if (!title) return;
    void renameChat(id, title, userId).catch(() => undefined);
    setChats((list) => (list ? list.map((item) => (item.id === id ? { ...item, title } : item)) : list));
    setChat((live) => (live.id === id ? { ...live, title } : live));
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

  const current = MODES.find((item) => item.id === mode) ?? MODES[2];
  const starters =
    mode === "execute"
      ? [...(toolId && DO_BY_TOOL[toolId] ? DO_BY_TOOL[toolId] : []), ...DO_SUGGESTIONS.slice(0, toolId ? 2 : 4)]
      : mode === "plan"
        ? PLAN_SUGGESTIONS
        : toolId && BY_TOOL[toolId]
          ? [...BY_TOOL[toolId], ...SUGGESTIONS.slice(0, 2)]
          : toolTitle
            ? [`איך משתמשים בכלי ${toolTitle}?`, ...SUGGESTIONS.slice(0, 3)]
            : SUGGESTIONS;
  const shown = messages.filter((message) => !message.hidden);
  const lastAssistant = shown.length > 0 && shown[shown.length - 1].role === "assistant";
  const lastShownIndex = messages.lastIndexOf(shown[shown.length - 1]);
  // Only the newest plan is shown in full; the ones it replaced shrink to their bar.
  const lastPlanIndex = messages.reduce((found, message, index) => (message.role === "assistant" && parseAssistantReply(message.content).plan ? index : found), -1);
  const livePlan = busy ? (partial ? parseAssistantReply(partial).plan : null) ?? latestPlan(messages) : null;
  const status = confirmation
    ? "ממתין לאישור שלך"
    : acting
      ? `מבצע: ${acting}`
      : busy
        ? partial
          ? "כותב…"
          : "חושב…"
        : model
          ? `מוכן · ${model}`
          : "מוכן";

  const bubble = (message: Message, index: number, live = false) => {
    if (message.role === "user") {
      return (
        <div key={`u${index}`} className="assistant-turn is-user">
          <div className="assistant-bubble is-user" dir="auto">
            {message.content}
          </div>
        </div>
      );
    }
    // Always parsed, not only while streaming: a reply kept from before the
    // action protocol, or saved when the visitor pressed stop mid-block, can
    // still carry markup, and none of it belongs on screen.
    const parsed = parseAssistantReply(message.content);
    const text = parsed.text || (parsed.plan || parsed.actions.length || parsed.pending ? "" : message.content);
    const canExecute = !live && !busy && index === lastShownIndex && parsed.plan && parsed.plan.some((step) => step.status !== "done") && mode !== "execute" && !message.actions;
    return (
      <div key={`a${index}`} className="assistant-turn is-assistant">
        <span className="assistant-avatar" aria-hidden="true">
          <Sparkles size={14} />
        </span>
        <div className={`assistant-bubble is-assistant ${live ? "is-live" : ""}`} dir="auto">
          {text && <div className="assistant-markdown">{renderMarkdown(text)}</div>}
          {parsed.plan && <PlanCard steps={parsed.plan} compact={!live && (busy || index !== lastPlanIndex)} />}
          {!live && message.actions && message.actions.length > 0 && (
            <ol className="assistant-actions" aria-label="פעולות שבוצעו">
              {message.actions.map((record, at) => {
                const spec = findAction(record.id);
                return (
                  <li key={at} className={`assistant-action ${record.cancelled ? "is-cancelled" : record.ok ? "is-ok" : "is-failed"}`}>
                    <span className="assistant-action-mark">{record.ok && !record.cancelled ? <Check size={12} /> : <X size={12} />}</span>
                    <div>
                      <b>{spec?.label ?? record.id}</b>
                      {record.message && <span>{record.message}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {canExecute && (
            <div className="assistant-tools">
              <button type="button" className="assistant-open" onClick={executePlan}>
                <Play size={14} /> בצע את התוכנית
              </button>
            </div>
          )}
          {!live && (
            <div className="assistant-bubble-tools">
              <button type="button" className="link-button" onClick={() => void copy(index, text || message.content)} aria-label="העתק את התשובה">
                {copied === index ? <Check size={13} /> : <Copy size={13} />} {copied === index ? "הועתק" : "העתק"}
              </button>
              {index === lastShownIndex && !busy && (
                <button type="button" className="link-button" onClick={regenerate} aria-label="נסח מחדש">
                  <RefreshCw size={13} /> תשובה אחרת
                </button>
              )}
              {message.model && <small className="assistant-model">{message.model}</small>}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {!open && (
        <button type="button" className="assistant-launcher" onClick={onOpen} aria-label="פתח את העוזר" title="העוזר (Ctrl+J)">
          <span className="assistant-launcher-orb" aria-hidden="true">
            <Sparkles size={17} />
          </span>
          <span>עוזר AI</span>
        </button>
      )}
      {open && (
        <aside ref={panelRef} className={`assistant-panel ${busy ? "is-busy" : ""}`} aria-label="העוזר של כלי מוזיקה">
          <div className="assistant-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="שינוי רוחב העוזר" title="גרור כדי לשנות רוחב" />
          <header className="assistant-head">
            <span className="assistant-orb" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div>
              <strong>העוזר</strong>
              <small className="assistant-status" role="status">
                <span className={`assistant-status-dot ${busy ? "is-busy" : ""}`} aria-hidden="true" />
                {status}
              </small>
            </div>
            <button
              type="button"
              className={`icon-button ${showHistory ? "is-on" : ""}`}
              onClick={() => {
                setShowHistory((value) => !value);
                setShowSettings(false);
              }}
              aria-label="שיחות קודמות"
              aria-pressed={showHistory}
              title="שיחות קודמות"
            >
              <History size={16} />
            </button>
            <button type="button" className="icon-button" onClick={startNewChat} aria-label="שיחה חדשה" title="שיחה חדשה" disabled={!messages.length && !busy}>
              <MessageSquarePlus size={16} />
            </button>
            <button
              type="button"
              className={`icon-button ${showSettings ? "is-on" : ""}`}
              onClick={() => {
                setShowSettings((value) => !value);
                setShowHistory(false);
              }}
              aria-label="הגדרות העוזר"
              aria-expanded={showSettings}
              title="הגדרות"
            >
              <Settings2 size={16} />
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="סגור את העוזר" title="סגור (Esc)">
              <X size={18} />
            </button>
          </header>

          <div className="assistant-modes" role="group" aria-label="מצב העוזר">
            {MODES.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={mode === item.id ? "is-active" : ""}
                  aria-pressed={mode === item.id}
                  disabled={busy}
                  onClick={() => setMode(item.id)}
                  title={item.hint}
                >
                  <Icon size={14} /> {item.label}
                </button>
              );
            })}
          </div>

          {showSettings && (
            <div className="assistant-settings">
              <label>
                <input type="checkbox" checked={prefs.detailed} onChange={(event) => setPrefs((value) => ({ ...value, detailed: event.target.checked }))} />
                <span>
                  <b>תשובות מפורטות</b>
                  <small>צעדים, דוגמה, ומה לעשות אם משהו לא עובד</small>
                </span>
              </label>
              <label>
                <input type="checkbox" checked={prefs.confirm} onChange={(event) => setPrefs((value) => ({ ...value, confirm: event.target.checked }))} />
                <span>
                  <b>לבקש אישור לפני פעולות רגישות</b>
                  <small>כבוי: הסוכן מבצע הכול בעצמו, גם מחיקה ושמירה</small>
                </span>
              </label>
              <button type="button" className="link-button" onClick={() => setPrefs((value) => ({ ...value, width: DEFAULT_WIDTH }))}>
                איפוס רוחב הלוח
              </button>
            </div>
          )}

          {showHistory && (
            <div className="assistant-history">
              <div className="assistant-history-head">
                <strong>שיחות קודמות</strong>
                <button type="button" className="link-button" onClick={startNewChat}>
                  <MessageSquarePlus size={14} /> שיחה חדשה
                </button>
              </div>
              {chats === null ? (
                <p className="table-footnote">טוען…</p>
              ) : chats.filter((item) => item.messages.length).length === 0 ? (
                <p className="table-footnote">
                  עדיין אין שיחות שמורות. כל שיחה נשמרת מעצמה{user ? " ומסונכרנת לחשבון" : " במכשיר הזה; התחברות תסנכרן אותה לכל המכשירים"}.
                </p>
              ) : (
                <ul className="assistant-history-list">
                  {chats
                    .filter((item) => item.messages.length)
                    .map((item) => (
                      <li key={item.id} className={item.id === chat.id ? "is-current" : ""}>
                        {renaming?.id === item.id ? (
                          <form
                            className="assistant-history-rename"
                            onSubmit={(event) => {
                              event.preventDefault();
                              commitRename();
                            }}
                          >
                            <input
                              autoFocus
                              value={renaming.title}
                              maxLength={80}
                              aria-label="שם השיחה"
                              onChange={(event) => setRenaming({ id: item.id, title: event.target.value })}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") setRenaming(null);
                              }}
                            />
                            <button type="submit" className="icon-button" aria-label="שמור שם">
                              <Check size={15} />
                            </button>
                          </form>
                        ) : (
                          <>
                            <button type="button" className="assistant-history-open" onClick={() => openChat(item)}>
                              <span>{item.title}</span>
                              <small>
                                {whenLabel(item.updatedAt)} · {item.messages.filter((message) => !message.hidden).length} הודעות
                              </small>
                            </button>
                            <button type="button" className="icon-button" onClick={() => setRenaming({ id: item.id, title: item.title })} aria-label={`שנה שם ל${item.title}`}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" className="icon-button is-danger" onClick={() => dropChat(item.id)} aria-label={`מחק את ${item.title}`}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {livePlan && (
            <div className="assistant-progress">
              <PlanCard steps={livePlan} compact />
              <span dir="auto">{livePlan.find((step) => step.status !== "done")?.text ?? "מסיים…"}</span>
            </div>
          )}

          <div className="assistant-messages" ref={listRef} aria-live="polite">
            {shown.length === 0 && !busy && (
              <div className="assistant-empty">
                <span className="assistant-hero-orb" aria-hidden="true">
                  <Sparkles size={26} />
                </span>
                <h2>במה אפשר לעזור?</h2>
                <p>
                  {mode === "execute"
                    ? "אני סוכן שעובד באתר בעצמו: מתכנן, פותח כלים, כותב, מנגן, שומר — ומדווח מה עשיתי. בלי לעצור לאישור."
                    : mode === "plan"
                      ? "תאר משימה, ואכין תוכנית צעד אחר צעד. כשהיא נראית לך — לחיצה אחת ואני מבצע אותה."
                      : "שאל כל שאלה על הכלים באתר ועל מוזיקה — תיאוריה, אקורדים, טכניקה ותרגול."}
                </p>
                <div className="assistant-capabilities" aria-hidden="true">
                  <span>
                    <CircleHelp size={13} /> שואל
                  </span>
                  <span>
                    <ListChecks size={13} /> מתכנן
                  </span>
                  <span>
                    <Zap size={13} /> מבצע
                  </span>
                </div>
                <div className="assistant-suggestions">
                  {starters.map((item) => (
                    <button key={item} type="button" className="assistant-suggestion" onClick={() => send(item)} disabled={busy || !user}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (message.hidden ? null : bubble(message, index)))}
            {busy && partial !== null && partial.length > 0 && bubble({ role: "assistant", content: partial }, messages.length, true)}
            {busy && !partial && !acting && !confirmation && (
              <div className="assistant-turn is-assistant">
                <span className="assistant-avatar is-thinking" aria-hidden="true">
                  <Sparkles size={14} />
                </span>
                <div className="assistant-bubble is-assistant is-thinking" aria-label="העוזר חושב">
                  <span />
                  <span />
                  <span />
                </div>
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
              <button type="button" className="assistant-suggestion" onClick={() => send(retry, messages.slice(0, -1))}>
                <RefreshCw size={14} /> נסה שוב
              </button>
            )}
            {!busy && !retry && lastAssistant && (
              <div className="assistant-suggestions is-followups">
                {(mode === "execute" ? ["המשך", "בטל את זה", "מה עשית?"] : mode === "plan" ? ["פרט יותר", "קצר את התוכנית"] : ["תסביר בשלבים", "תן דוגמה", "בקצרה יותר"]).map((item) => (
                  <button key={item} type="button" className="assistant-suggestion" onClick={() => send(item)}>
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          {user ? (
            <form className="assistant-compose" onSubmit={submit}>
              <div className="assistant-context">
                <span className={`assistant-chip is-mode-${mode}`} title={current.hint}>
                  <current.icon size={12} /> {current.label}
                </span>
                <span className="assistant-chip" title="העוזר רואה את העמוד הזה">
                  <MapPin size={12} /> {toolTitle ?? "דף הבית"}
                </span>
              </div>
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
                placeholder={mode === "execute" ? "מה לעשות? אני אתכנן ואבצע…" : mode === "plan" ? "תאר משימה ואכין תוכנית…" : "שאל כל שאלה…"}
                aria-label="ההודעה שלך"
                dir="auto"
              />
              <div className="assistant-compose-row">
                <button
                  type="button"
                  className={`icon-button assistant-mic ${listening ? "is-on" : ""}`}
                  onClick={toggleListening}
                  aria-label={listening ? "הפסק הכתבה" : "הכתבה בקול"}
                  aria-pressed={listening}
                  title={listening ? "הפסק הכתבה" : "הכתבה בקול"}
                >
                  {listening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
                <small className="assistant-hint">Enter לשליחה · Shift+Enter לשורה חדשה</small>
                {busy ? (
                  <button type="button" className="assistant-send is-stop" onClick={stop} aria-label="עצור" title="עצור">
                    <Square size={15} />
                  </button>
                ) : (
                  <button type="submit" className="assistant-send" disabled={!draft.trim()} aria-label="שלח">
                    <SendHorizontal size={16} />
                  </button>
                )}
              </div>
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
