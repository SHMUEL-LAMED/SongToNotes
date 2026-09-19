import {
  Captions,
  Check,
  Copy,
  Download,
  FileText,
  Languages,
  ListChecks,
  Search,
  Users,
  LogIn,
  Play,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { Transport } from "../components/Transport";
import { ShareButton } from "../components/ShareButton";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { downloadFile, safeFilename } from "../lib/export";
import { AiError, transformText, type AiAction } from "../lib/aiApi";
import { useAuth } from "../lib/auth";
import {
  CANCELLED,
  SpeechError,
  describeAllowance,
  transcribeWindow,
} from "../lib/speechApi";
import {
  LANGUAGES,
  countWords,
  languageLabel,
  normalizeSegments,
  segmentsToSrt,
  segmentsToText,
  segmentsToVtt,
  splitIntoWindows,
  textToSegments,
  type SampleWindow,
  type TranscriptSegment,
} from "../lib/transcript";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";

const SETTINGS_KEY = "musictools.transcript.v1";
const SPEECH_RATE = 16_000;
/**
 * Decoded straight to mono at 16 kHz, a recording costs 3.8MB a minute in
 * memory, so two hours fit where twenty minutes of full-rate stereo did.
 * The file itself is allowed up to this size — about ten hours of MP3.
 */
const MAX_FILE_BYTES = 600 * 1024 * 1024;
/**
 * The server hears this much at a time — four minutes of mono 16 kHz WAV is
 * under 8MB to send — and the text lands window by window.
 */
const WINDOW_SECONDS = 240;
/** From this length there is more than one window, and the page says so. */
const LONG_SECONDS = WINDOW_SECONDS * 1.5;

type Saved = { language: string | null };

/** Where a translation can go; the label is what the model is told. */
const TRANSLATE_TO = [
  { id: "en", label: "אנגלית" },
  { id: "he", label: "עברית" },
  { id: "ar", label: "ערבית" },
  { id: "ru", label: "רוסית" },
  { id: "fr", label: "צרפתית" },
  { id: "es", label: "ספרדית" },
];

type AiJob = Exclude<AiAction, "chat" | "speakers">;
const AI_LABELS: Record<AiJob, string> = {
  polish: "נוסח ערוך",
  summarize: "סיכום",
  translate: "תרגום",
};

function loadSaved(): Saved {
  const fallback: Saved = { language: "he" };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null;
    if (!parsed) return fallback;
    return {
      language: LANGUAGES.some((item) => item.id === parsed.language) ? (parsed.language as string | null) : fallback.language,
    };
  } catch {
    return fallback;
  }
}

/**
 * The samples the recogniser reads. The picker already decoded the file to
 * mono at 16 kHz, so this is a view of the buffer; the offline render is only
 * for a buffer that arrived some other way.
 */
async function prepareForSpeech(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate === SPEECH_RATE && buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const Offline =
    window.OfflineAudioContext ||
    (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Offline) throw new Error("הדפדפן הזה אינו תומך בהמרת קצב הדגימה של ההקלטה.");
  const frames = Math.max(1, Math.ceil(buffer.duration * SPEECH_RATE));
  const offline = new Offline(1, frames, SPEECH_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** "כ־3 דקות" / "פחות מדקה" — a remaining time, loosely. */
function roughMinutes(seconds: number) {
  if (seconds < 45) return "פחות מדקה";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `כ־${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `כ־${hours} שעות ו־${rest} דקות` : `כ־${hours} שעות`;
}

/** Where a run stands: which window of how many, and how fast it is going. */
type Stage = {
  index: number;
  count: number;
  /** Seconds of audio already transcribed in this run. */
  doneSeconds: number;
  /** Seconds of audio the run covers in all. */
  totalSeconds: number;
  /** Seconds of audio per second of work, once a window has finished. */
  speed: number | null;
  /** Going up, or being listened to on the server. */
  phase: "uploading" | "listening";
  /** 0–100 while uploading. */
  upload: number;
};

type Props = {
  /** A saved transcript to show again; the recording itself was never stored. */
  initial?: SavedWork | null;
};

type Result = {
  segments: TranscriptSegment[];
  language: string | null;
  model: string;
  duration: number;
  sourceName: string | null;
};

function readInitial(work: SavedWork | null | undefined): Result | null {
  if (!work || work.kind !== "transcript") return null;
  const segments = normalizeSegments(work.payload.segments);
  if (!segments.length) return null;
  return {
    segments,
    language: typeof work.payload.language === "string" ? work.payload.language : null,
    model: typeof work.payload.model === "string" ? work.payload.model : "server",
    duration: typeof work.summary.duration === "number" ? work.summary.duration : 0,
    sourceName: work.sourceName,
  };
}

/**
 * Speech to text. The listening happens on the server ({@link ../lib/speechApi}),
 * one window of the recording at a time; this is the choice of language, the
 * progress as the windows go up and come back, and the text afterwards —
 * editable in place so a misheard word is fixed without losing its timestamp.
 */
export function TranscriptTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, progress, load, clear, maxBytes } = useAudioFile({
    maxBytes: MAX_FILE_BYTES,
    monoAt: SPEECH_RATE,
  });
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const [saved] = useState(loadSaved);
  const [language, setLanguage] = useState<string | null>(saved.language);
  const [result, setResult] = useState<Result | null>(() => readInitial(initial));
  const [text, setText] = useState(() => (result ? segmentsToText(result.segments) : ""));
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    initial ? "פתחת תמלול שמור. ההקלטה עצמה לא נשמרה." : null,
  );
  const [trim, setTrim] = useState<TrimRange>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  // Where to pick up after a stop or a failure: the window that did not finish.
  const [resume, setResume] = useState<{ windows: SampleWindow[]; index: number } | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  // The language model's take on the text: one result at a time, kept apart
  // from the transcript so the timestamps underneath stay true.
  const [ai, setAi] = useState<{ job: AiJob; text: string; language?: string } | null>(null);
  const [aiBusy, setAiBusy] = useState<AiJob | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCopied, setAiCopied] = useState(false);
  const [translateTo, setTranslateTo] = useState("en");
  // Finding a phrase, and jumping the player to where it was said.
  const [query, setQuery] = useState("");
  const [seek, setSeek] = useState<{ time: number; key: number; play?: boolean } | null>(null);
  const [playTime, setPlayTime] = useState(0);
  const [speakersBusy, setSpeakersBusy] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [finished, setFinished] = useState<{ seconds: number; model: string } | null>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;
  const resultsRef = useRef<HTMLDivElement>(null);
  const runTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language } satisfies Saved));
    } catch {
      // Private browsing; the choice simply does not persist.
    }
  }, [language]);

  // Editing the text is a new transcript to save.
  useEffect(() => resetSave(), [resetSave, text]);

  const busy = stage !== null;

  /**
   * Transcribes window by window. Each finished window's text is added to
   * the result at once, so a long recording reads as it goes; a stop or a
   * failure keeps what is done and remembers where to pick up.
   */
  const run = useCallback(
    async (plan?: { windows: SampleWindow[]; index: number }) => {
      if (!audio || stage) return;
      runTokenRef.current += 1;
      const token = runTokenRef.current;
      setError(null);
      setNotice(null);
      setResume(null);
      setFinished(null);
      const controller = new AbortController();
      abortRef.current = controller;
      const runStartedAt = Date.now();
      let samples: Float32Array;
      try {
        samples = await prepareForSpeech(audio.buffer);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "התמלול נכשל.");
        return;
      }
      if (runTokenRef.current !== token) return;

      const from = trim ? Math.floor(trim.start * SPEECH_RATE) : 0;
      const to = trim ? Math.ceil(trim.end * SPEECH_RATE) : samples.length;
      const windows = plan?.windows ?? splitIntoWindows(samples, SPEECH_RATE, WINDOW_SECONDS, 8, from, to);
      const startIndex = plan?.index ?? 0;
      const totalSeconds = windows.reduce((sum, item) => sum + (item.end - item.start), 0) / SPEECH_RATE;
      let doneSeconds = windows.slice(0, startIndex).reduce((sum, item) => sum + (item.end - item.start), 0) / SPEECH_RATE;
      let collected: TranscriptSegment[] = plan ? (result?.segments ?? []) : [];
      let modelId = result?.model ?? "server";
      let heardLanguage = language;
      let speed: number | null = null;

      const publish = (segments: TranscriptSegment[]) => {
        setResult({
          segments,
          language: heardLanguage,
          model: modelId,
          duration: audio.buffer.duration,
          sourceName: audio.file.name,
        });
        setText(segmentsToText(segments));
      };

      for (let index = startIndex; index < windows.length; index += 1) {
        const window_ = windows[index];
        const base = { index, count: windows.length, doneSeconds, totalSeconds, speed };
        setStage({ ...base, phase: "uploading", upload: 0 });
        const startedAt = Date.now();
        try {
          const slice = samples.subarray(window_.start, window_.end);
          const found = await transcribeWindow(slice, SPEECH_RATE, {
            language,
            signal: controller.signal,
            onUpload: (percent) => {
              if (runTokenRef.current !== token) return;
              setStage(
                percent >= 100
                  ? { ...base, phase: "listening", upload: 100 }
                  : { ...base, phase: "uploading", upload: percent },
              );
            },
          });
          if (runTokenRef.current !== token) return;
          modelId = found.model;
          if (found.language) heardLanguage = found.language;
          setUsage({ used: found.used, limit: found.limit });
          const offset = window_.start / SPEECH_RATE;
          collected = [
            ...collected,
            ...found.segments.map((segment) => ({
              start: segment.start + offset,
              end: segment.end === null ? null : segment.end + offset,
              text: segment.text,
            })),
          ];
          const windowSeconds = (window_.end - window_.start) / SPEECH_RATE;
          doneSeconds += windowSeconds;
          const took = Math.max(0.001, (Date.now() - startedAt) / 1000);
          speed = windowSeconds / took;
          publish(collected);
          if (index === startIndex) {
            window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 120);
          }
        } catch (caught) {
          if (runTokenRef.current !== token) return;
          const message = caught instanceof Error ? caught.message : "התמלול נכשל.";
          setStage(null);
          if (collected.length) publish(collected);
          if (message !== CANCELLED) setError(message);
          if (caught instanceof SpeechError && caught.code === "quota") {
            setUsage((current) => (current ? { ...current, used: current.limit } : current));
          }
          // Whatever stopped it, the next attempt starts at this window.
          setResume({ windows, index });
          return;
        }
      }
      setStage(null);
      abortRef.current = null;
      if (!collected.length) {
        setError("לא זוהה דיבור בהקלטה. נסה לבחור את השפה הנכונה, או קטע אחר.");
      } else {
        setFinished({ seconds: (Date.now() - runStartedAt) / 1000, model: modelId });
      }
    },
    [audio, language, result, setError, stage, trim],
  );

  const stop = () => {
    runTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStage(null);
    if (stage) {
      // The window under way is the one to come back to.
      const windows = resume?.windows ?? null;
      if (windows) setResume({ windows, index: stage.index });
    }
  };

  // Within a window, the upload is about half the wait; the listening the rest.
  const withinWindow = stage ? (stage.phase === "uploading" ? stage.upload / 200 : 0.5) : 0;
  const remaining =
    stage && stage.speed
      ? roughMinutes(
          Math.max(
            0,
            (stage.totalSeconds - stage.doneSeconds - withinWindow * (stage.totalSeconds / stage.count)) /
              stage.speed,
          ),
        )
      : null;
  const overall = stage
    ? Math.min(
        99,
        Math.round(
          ((stage.doneSeconds + withinWindow * (stage.totalSeconds / Math.max(1, stage.count))) /
            Math.max(1, stage.totalSeconds)) *
            100,
        ),
      )
    : 0;
  const isLong = Boolean(audio && audio.buffer.duration > LONG_SECONDS);

  // The text box is the source of truth once the visitor has typed in it;
  // the segments underneath keep their timestamps.
  const segments = useMemo(
    () => (result ? textToSegments(text, result.segments) : []),
    [result, text],
  );
  const words = useMemo(() => countWords(text), [text]);
  const speakers = useMemo(() => {
    const names = new Set<string>();
    for (const segment of segments) {
      const match = segment.text.match(/^([^:：]{1,30}):\s/);
      if (match) names.add(match[1].trim());
    }
    return names.size;
  }, [segments]);
  const wordsPerMinute = result && result.duration > 30 ? Math.round(words / (result.duration / 60)) : null;
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return segments.map((segment, index) => (segment.text.toLowerCase().includes(needle) ? index : -1)).filter((index) => index >= 0);
  }, [query, segments]);
  const currentSegment = segments.findIndex((segment, index) => playTime >= segment.start && (index === segments.length - 1 || playTime < segments[index + 1].start));

  /** Asks the model who said what; the lines come back prefixed and go into the text. */
  const labelSpeakers = async () => {
    if (!segments.length || speakersBusy) return false;
    setSpeakersBusy(true);
    setAiError(null);
    try {
      // Labels from an earlier run come off first, so a second run does not
      // stack "דובר 1: דובר 1:" and the model sees the words alone.
      const bare = segments.map((segment) => segment.text.replace(/^([^:：]{1,30}):\s/, ""));
      const reply = await transformText("speakers", bare.join("\n"));
      const lines = reply.text.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length !== segments.length) {
        // The model changed the line count; keep what lines up, in order.
        setNotice("זיהוי הדוברים החזיר מספר שורות שונה; הוחלו רק השורות שהתאימו.");
      }
      setText(bare.map((line, index) => (lines[index] && lines[index].includes(line.slice(0, 12)) ? lines[index] : segments[index].text)).join("\n"));
      return true;
    } catch (caught) {
      setAiError(caught instanceof AiError || caught instanceof Error ? caught.message : "זיהוי הדוברים נכשל.");
      return false;
    } finally {
      setSpeakersBusy(false);
    }
  };
  const title = result?.sourceName
    ? result.sourceName.replace(/\.[^/.]+$/, "")
    : audio
      ? audio.file.name.replace(/\.[^/.]+$/, "")
      : "תמלול";

  const buildFile = (format: "txt" | "srt" | "vtt") => {
    if (!segments.length) return null;
    const body =
      format === "srt" ? segmentsToSrt(segments) : format === "vtt" ? segmentsToVtt(segments) : text;
    const type = format === "vtt" ? "text/vtt" : "text/plain";
    // A byte-order mark, so Windows editors read the Hebrew as UTF-8.
    return new File([`\uFEFF${body}`], `${safeFilename(title)}.${format}`, {
      type: `${type};charset=utf-8`,
    });
  };

  const exportAs = (format: "txt" | "srt" | "vtt") => {
    const file = buildFile(format);
    if (file) downloadFile(file, file.name, file.type);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("לא הצלחנו להעתיק. אפשר לסמן את הטקסט ולהעתיק ידנית.");
    }
  };

  /** Resolves with the model's text, or null when it failed (the reason is on screen). */
  const runAi = async (job: AiJob, targetLabel?: string): Promise<string | null> => {
    if (!text.trim() || aiBusy) return null;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiBusy(job);
    setAiError(null);
    try {
      const target = TRANSLATE_TO.find((item) => item.id === translateTo);
      const language = job === "translate" ? (targetLabel ?? target?.label) : undefined;
      const reply = await transformText(job, text, { language, signal: controller.signal });
      if (controller.signal.aborted) return null;
      setAi({ job, text: reply.text, language });
      return reply.text;
    } catch (caught) {
      if (controller.signal.aborted) return null;
      setAiError(caught instanceof AiError || caught instanceof Error ? caught.message : "הפעולה נכשלה.");
      return null;
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setAiBusy(null);
      }
    }
  };

  const copyAi = async () => {
    if (!ai) return;
    try {
      await navigator.clipboard.writeText(ai.text);
      setAiCopied(true);
      window.setTimeout(() => setAiCopied(false), 2000);
    } catch {
      setAiError("לא הצלחנו להעתיק. אפשר לסמן את הטקסט ולהעתיק ידנית.");
    }
  };

  const downloadAi = () => {
    if (!ai) return;
    const suffix = ai.job === "polish" ? "ערוך" : ai.job === "summarize" ? "סיכום" : `תרגום-${ai.language ?? ""}`;
    downloadFile(
      new File([`\uFEFF${ai.text}`], `${safeFilename(`${title}-${suffix}`)}.txt`, { type: "text/plain;charset=utf-8" }),
      `${safeFilename(`${title}-${suffix}`)}.txt`,
      "text/plain;charset=utf-8",
    );
  };

  const saveTranscript = () => {
    if (!result || !segments.length) return Promise.resolve(null);
    return saving.save({
      kind: "transcript",
      title,
      sourceName: result.sourceName,
      summary: {
        words,
        duration: result.duration,
        language: result.language,
        languageLabel: languageLabel(result.language),
        segments: segments.length,
      },
      payload: {
        segments,
        language: result.language,
        model: result.model,
        ...(ai ? { ai: { job: ai.job, text: ai.text, language: ai.language ?? null } } : {}),
      },
    });
  };

  useAssistantTool("transcript", {
    state: () =>
      `${[
        `תמלול לטקסט: ${audio ? `הקלטה „${audio.file.name}” (${formatTime(audio.buffer.duration)})${trim ? `, קטע מסומן ${formatTime(trim.start)}–${formatTime(trim.end)}` : ""}` : "לא נבחרה הקלטה (רק הגולש יכול לבחור קובץ או להקליט)"}`,
        `שפת הדיבור: ${languageLabel(language)}`,
        busy
          ? `מתמלל עכשיו (${overall}%)`
          : result
            ? `יש תמלול: ${words} מילים, ${segments.length} משפטים${result.duration ? `, ${formatTime(result.duration)}` : ""}; תחילתו: „${text.slice(0, 240).replace(/\n/g, " / ")}${text.length > 240 ? "…" : ""}”`
            : "אין תמלול עדיין",
        ai ? `יש תוצאת AI מסוג ${AI_LABELS[ai.job]}${ai.language ? ` (${ai.language})` : ""}` : "",
        resume ? "יש תמלול שנעצר באמצע ואפשר להמשיך אותו" : "",
        !user ? "הגולש לא מחובר — תמלול ועיבוד AI דורשים חשבון" : "",
      ]
        .filter(Boolean)
        .join("; ")}.`,
    handlers: {
      "transcript.read": ({ from, chars }) => {
        if (!text.trim()) return { ok: false, message: "אין תמלול" };
        const start = Math.max(0, Math.min(text.length, typeof from === "number" ? Math.round(from) : 0));
        const count = Math.max(200, Math.min(12_000, typeof chars === "number" ? Math.round(chars) : 6000));
        return {
          ok: true,
          message: `${words} מילים, ${segments.length} משפטים`,
          data: { text: text.slice(start, start + count), from: start, total: text.length, words, sentences: segments.length, language: result?.language ?? language },
        };
      },
      "transcript.language": ({ language: next }) => {
        const id = next === "auto" ? null : String(next);
        if (id !== null && !LANGUAGES.some((item) => item.id === id)) return { ok: false, message: `שפה לא מוכרת; יש: ${LANGUAGES.map((item) => item.id ?? "auto").join(", ")}` };
        setLanguage(id);
        setResume(null);
        return { ok: true, message: `שפת הדיבור: ${languageLabel(id)}` };
      },
      "transcript.run": () => {
        if (!audio) return { ok: false, message: "אין הקלטה; הגולש צריך לבחור קובץ או להקליט" };
        if (!user) return { ok: false, message: "התמלול דורש חשבון מחובר" };
        if (busy) return { ok: false, message: "כבר מתמלל" };
        void run(resume ?? undefined);
        return { ok: true, message: resume ? "ממשיך את התמלול מאיפה שנעצר; זה רץ ברקע" : "התמלול התחיל ורץ ברקע; הטקסט מצטבר על המסך" };
      },
      "transcript.stop": () => {
        if (!busy) return { ok: false, message: "לא מתמלל כרגע" };
        stop();
        return { ok: true, message: "התמלול נעצר; מה שתומלל נשאר" };
      },
      "transcript.write": ({ text: next }) => {
        if (!result) return { ok: false, message: "אין תמלול להחליף" };
        const clean = String(next);
        setText(clean);
        return { ok: true, message: `הטקסט הוחלף (${countWords(clean)} מילים)` };
      },
      "transcript.replace": ({ find, replaceWith, all }) => {
        const needle = String(find);
        const replacement = typeof replaceWith === "string" ? replaceWith : "";
        if (!needle) return { ok: false, message: "לא צוין מה לחפש" };
        const count = text.split(needle).length - 1;
        if (!count) return { ok: false, message: `„${needle}” לא נמצא בתמלול` };
        setText(all ? text.split(needle).join(replacement) : text.replace(needle, replacement));
        return { ok: true, message: `הוחלפו ${all ? count : 1} מופעים של „${needle}”` };
      },
      "transcript.ai": async ({ job, language: target }) => {
        if (!text.trim()) return { ok: false, message: "אין תמלול" };
        if (!user) return { ok: false, message: "עיבוד AI דורש חשבון מחובר" };
        if (aiBusy) return { ok: false, message: "ה־AI כבר עובד על התמלול" };
        const kind = job as AiJob;
        const wanted = typeof target === "string" ? target.trim() : "";
        const label = wanted ? (TRANSLATE_TO.find((item) => item.id === wanted.toLowerCase() || item.label === wanted)?.label ?? wanted) : undefined;
        const reply = await runAi(kind, label);
        if (reply === null) return { ok: false, message: "הפעולה נכשלה; הודעת השגיאה מוצגת על המסך" };
        return { ok: true, message: `${AI_LABELS[kind]} מוכן ומוצג בכרטיס ה־AI`, data: { job: kind, text: reply.slice(0, 5000) } };
      },
      "transcript.applyPolish": () => {
        if (!ai || ai.job !== "polish") return { ok: false, message: "אין נוסח ערוך; קודם transcript.ai עם polish" };
        setText(ai.text);
        setNotice("הנוסח הערוך הוחלף בטקסט. השורות והזמנים של הכתוביות עודכנו בהתאם.");
        return { ok: true, message: "הנוסח הערוך הוחל על הטקסט" };
      },
      "transcript.speakers": async () => {
        if (!segments.length) return { ok: false, message: "אין תמלול" };
        if (!user) return { ok: false, message: "זיהוי דוברים דורש חשבון מחובר" };
        const done = await labelSpeakers();
        return done ? { ok: true, message: "הדוברים סומנו בתחילת השורות" } : { ok: false, message: "זיהוי הדוברים נכשל" };
      },
      "transcript.search": ({ query: next }) => {
        const needle = typeof next === "string" ? next : "";
        setQuery(needle);
        return { ok: true, message: needle ? `המשפטים מסוננים לפי „${needle}”` : "הסינון בוטל" };
      },
      "transcript.download": ({ format }) => {
        if (!segments.length) return { ok: false, message: "אין תמלול" };
        exportAs(format as "txt" | "srt" | "vtt");
        return { ok: true, message: `קובץ ${String(format).toUpperCase()} ירד` };
      },
      "transcript.save": async () => {
        if (!result || !segments.length) return { ok: false, message: "אין תמלול לשמור" };
        const saved = await saveTranscript();
        return saved ? { ok: true, message: "התמלול נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
    },
  });

  return (
    <section className="tool-body transcript-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Captions size={26} />
        </span>
        <div>
          <h1>תמלול לטקסט</h1>
          <p>בחר הקלטה או הקלט, וקבל את הדיבור כטקסט עם חותמות זמן.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          progress={progress}
          maxBytes={maxBytes}
          onPick={(file) => {
            setError(null);
            setNotice(null);
            setTrim(null);
            setResume(null);
            void load(file);
          }}
          onClear={() => {
            runTokenRef.current += 1;
            abortRef.current?.abort();
            abortRef.current = null;
            setStage(null);
            setFinished(null);
            setResume(null);
            setTrim(null);
            clear();
          }}
          allowRecording
          hint="הקלטה, הרצאה, שיעור או שיר · גם של שעות · עברית, אנגלית ועוד"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="notice-message" role="status">
            {notice}
          </div>
        )}

        <div className="settings-panel">
          <div className="settings-grid">
            <label className="setting-field">
              <span>
                <Languages size={15} /> שפת הדיבור
              </span>
              <select
                value={language ?? ""}
                onChange={(event) => setLanguage(event.target.value || null)}
                aria-label="שפת הדיבור"
              >
                {LANGUAGES.map((item) => (
                  <option key={item.id ?? "auto"} value={item.id ?? ""}>
                    {item.label}
                  </option>
                ))}
              </select>
              <small>לבחור את השפה נותן תוצאה טובה יותר מזיהוי אוטומטי.</small>
            </label>
            <div className="setting-field">
              <span>
                <Wand2 size={15} /> איך זה עובד
              </span>
              <small>
                הזיהוי נעשה בשרת של האתר — אין מה להתקין או להוריד, וזה עובד גם בטלפון. ההקלטה
                נשלחת בחלקים קצרים, מתומללת ולא נשמרת בשרת.
                {usage
                  ? ` נוצלו היום ${describeAllowance(usage.used)} מתוך ${describeAllowance(usage.limit)}.`
                  : ""}
              </small>
            </div>
          </div>
        </div>

        {audio && peaks && (
          <Waveform
            peaks={peaks}
            duration={audio.buffer.duration}
            trim={trim}
            onTrimChange={(next) => {
              setTrim(next);
              setResume(null);
            }}
            selectLabel="קטע לתמלול"
            clearLabel="תמלל את כל ההקלטה"
            emptyLabel="אפשר לסמן קטע בגל הקול כדי לתמלל רק אותו"
          />
        )}

        {audio && isLong && !busy && (
          <p className="engine-note">
            הקלטה ארוכה ({formatTime(audio.buffer.duration)}). התמלול נעשה בחלקים של
            כ־{Math.round(WINDOW_SECONDS / 60)} דקות, הטקסט מצטבר תוך כדי, ואפשר לעצור באמצע
            ולהמשיך אחר כך מאותה נקודה.
          </p>
        )}

        {audio && !busy && !authLoading && !user && (
          <div className="transcript-signin" role="status">
            <p>
              <LogIn size={16} /> כדי לתמלל צריך להתחבר לחשבון — בחינם, ברגע. כך ההקלטות שלך
              נשלחות רק מטעמך והמכסה היומית נשמרת לך.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                signInWithGoogle().catch(() =>
                  setError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."),
                )
              }
            >
              <LogIn size={20} /> התחברות עם Google
            </button>
          </div>
        )}
        {audio && !busy && !resume && (user || authLoading) && (
          <button className="primary-button" type="button" onClick={() => void run()} disabled={authLoading}>
            <Wand2 size={20} /> {trim ? "תמלל את הקטע המסומן" : "תמלל את ההקלטה"}
            <small>{formatTime(trim ? trim.end - trim.start : audio.buffer.duration)}</small>
          </button>
        )}
        {audio && !busy && resume && user && (
          <div className="transcript-resume">
            <button className="primary-button" type="button" onClick={() => void run(resume)}>
              <Play size={20} /> המשך מאיפה שנעצר
              <small>
                חלק {resume.index + 1} מתוך {resume.windows.length}
              </small>
            </button>
            <button type="button" className="link-button" onClick={() => setResume(null)}>
              התחל מהתחלה
            </button>
          </div>
        )}

        {busy && stage && (
          <div className="processing-box" aria-live="polite">
            <div className="processing-top">
              <span>
                <Wand2 size={18} />{" "}
                {stage.phase === "uploading" ? "שולח את ההקלטה לשרת…" : "השרת מאזין ומתמלל…"}
              </span>
              <strong>{stage.phase === "uploading" ? `${stage.upload}%` : ""}</strong>
            </div>
            {stage.count > 1 && (
              <p className="transcript-stage">
                חלק {stage.index + 1} מתוך {stage.count} · {overall}% מההקלטה
                {remaining ? ` · נותרו ${remaining}` : ""}
              </p>
            )}
            {stage.phase === "uploading" ? (
              <div
                className="progress-track"
                role="progressbar"
                aria-label="שליחת ההקלטה"
                aria-valuenow={stage.upload}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${Math.max(2, stage.upload)}%` }} />
              </div>
            ) : (
              <div className="progress-track indeterminate">
                <div />
              </div>
            )}
            <button type="button" className="link-button" onClick={stop}>
              <X size={14} /> {stage.count > 1 ? "עצור — מה שתומלל יישמר" : "בטל"}
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className="workspace-card transcript-result" ref={resultsRef}>
          <div className="results-header">
            <div>
              <span className="eyebrow-small">
                <FileText size={14} /> התמלול
              </span>
              <h2>{title}</h2>
            </div>
            <div className="transcript-stats">
              <span>{words} מילים</span>
              <span>{segments.length} משפטים</span>
              {speakers > 1 && <span>{speakers} דוברים</span>}
              {result.duration > 0 && <span>{formatTime(result.duration)}</span>}
              {wordsPerMinute !== null && <span>{wordsPerMinute} מילים לדקה</span>}
              <span>{languageLabel(result.language)}</span>
            </div>
            <SaveButton
              state={saving.state}
              onSave={() => void saveTranscript()}
              disabled={!segments.length}
              label="שמור את התמלול"
              message={saving.message}
              compact
            />
          </div>

          {audio && <Transport buffer={audio.buffer} label="נגן עם התמלול" onTime={setPlayTime} seek={seek} />}

          <div className="transcript-tools">
            <label className="transcript-search">
              <Search size={15} />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש בתמלול…" aria-label="חיפוש בתמלול" dir="auto" />
              {matching && <small>{matching.length ? `${matching.length} משפטים` : "לא נמצא"}</small>}
            </label>
            <button type="button" className="chip-toggle" onClick={() => void labelSpeakers()} disabled={busy || speakersBusy || !segments.length || !user}>
              <Users size={14} /> {speakersBusy ? "מזהה דוברים…" : speakers > 1 ? "זהה דוברים מחדש" : "זהה דוברים"}
            </button>
          </div>

          <textarea
            className="transcript-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(24, Math.max(6, segments.length + 2))}
            aria-label="הטקסט המתומלל, ניתן לעריכה"
            dir="auto"
            spellCheck
            readOnly={busy}
          />
          {busy && (
            <p className="table-footnote">הטקסט ממשיך להצטבר; אפשר לערוך כשהתמלול יסתיים.</p>
          )}
          <p className="table-footnote">
            אפשר לתקן כאן ישירות. כל שורה היא משפט עם חותמת הזמן שלו — השורות נשמרות
            לכתוביות.
          </p>

          <ol className="transcript-segments" aria-label="משפטים עם חותמות זמן">
            {segments.map((segment, index) => {
              if (matching && !matching.includes(index)) return null;
              const needle = query.trim();
              const at = needle ? segment.text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
              return (
                <li key={`${segment.start}-${index}`} className={index === currentSegment && audio ? "is-current" : ""}>
                  <button type="button" className="transcript-jump" onClick={() => setSeek({ time: segment.start, key: Date.now(), play: true })} aria-label={`נגן מ־${formatTime(segment.start)}`}>
                    <time>{formatTime(segment.start)}</time>
                  </button>
                  <span dir="auto">
                    {at >= 0 ? (
                      <>
                        {segment.text.slice(0, at)}
                        <mark>{segment.text.slice(at, at + needle.length)}</mark>
                        {segment.text.slice(at + needle.length)}
                      </>
                    ) : (
                      segment.text
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="ai-separator transcript-ai">
            <div className="ai-separator-head">
              <span className="tool-intro-icon">
                <Sparkles size={20} />
              </span>
              <div>
                <h3>
                  <Sparkles size={16} /> עיבוד עם AI
                </h3>
                <p>
                  פיסוק ופסקאות, סיכום או תרגום — נעשה בשרת, בלי להתקין דבר. הכתוביות שומרות על
                  הזמנים המקוריים.
                </p>
              </div>
            </div>
            <div className="transcript-ai-actions">
              <button
                type="button"
                className="chip-toggle"
                onClick={() => void runAi("polish")}
                disabled={!text.trim() || aiBusy !== null || busy}
              >
                <Wand2 size={15} /> {aiBusy === "polish" ? "מנסח…" : "פיסוק ופסקאות"}
              </button>
              <button
                type="button"
                className="chip-toggle"
                onClick={() => void runAi("summarize")}
                disabled={!text.trim() || aiBusy !== null || busy}
              >
                <ListChecks size={15} /> {aiBusy === "summarize" ? "מסכם…" : "סיכום"}
              </button>
              <span className="transcript-ai-translate">
                <button
                  type="button"
                  className="chip-toggle"
                  onClick={() => void runAi("translate")}
                  disabled={!text.trim() || aiBusy !== null || busy}
                >
                  <Languages size={15} /> {aiBusy === "translate" ? "מתרגם…" : "תרגום ל־"}
                </button>
                <select
                  value={translateTo}
                  onChange={(event) => setTranslateTo(event.target.value)}
                  aria-label="שפת היעד לתרגום"
                  disabled={aiBusy !== null}
                >
                  {TRANSLATE_TO.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {!user && !authLoading && (
              <small className="ai-status" role="status">
                כדי להשתמש ב־AI צריך להתחבר לחשבון.
              </small>
            )}
            {aiBusy && (
              <div className="progress-track indeterminate" aria-label="ה־AI עובד">
                <div />
              </div>
            )}
            {aiError && (
              <div className="error-message" role="alert">
                {aiError}
              </div>
            )}
            {ai && !aiBusy && (
              <div className="transcript-ai-result">
                <div className="results-header">
                  <span className="eyebrow-small">
                    <Sparkles size={14} /> {AI_LABELS[ai.job]}
                    {ai.language ? ` — ${ai.language}` : ""}
                  </span>
                  <div className="transcript-ai-tools">
                    <button type="button" className="link-button" onClick={() => void copyAi()}>
                      {aiCopied ? <Check size={14} /> : <Copy size={14} />} {aiCopied ? "הועתק" : "העתק"}
                    </button>
                    <button type="button" className="link-button" onClick={downloadAi}>
                      <Download size={14} /> הורד TXT
                    </button>
                    {ai.job === "polish" && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          setText(ai.text);
                          setNotice("הנוסח הערוך הוחלף בטקסט. השורות והזמנים של הכתוביות עודכנו בהתאם.");
                        }}
                      >
                        <Check size={14} /> החלף את הטקסט בנוסח הערוך
                      </button>
                    )}
                  </div>
                </div>
                <div className="transcript-ai-text" dir="auto">
                  {ai.text}
                </div>
              </div>
            )}
          </div>

          <div className="downloads-card transcript-downloads">
            <div>
              <span className="download-icon">
                <Download size={22} />
              </span>
              <div>
                <h3>הורדה</h3>
                <p>כטקסט למסמך, או ככתוביות לסרטון.</p>
              </div>
            </div>
            <div className="download-buttons">
              <button type="button" onClick={() => exportAs("txt")} disabled={!segments.length}>
                <FileText size={17} />
                <span>
                  TXT<small>טקסט בלבד</small>
                </span>
              </button>
              <button type="button" onClick={() => exportAs("srt")} disabled={!segments.length}>
                <Captions size={17} />
                <span>
                  SRT<small>כתוביות עם זמנים</small>
                </span>
              </button>
              <button type="button" onClick={() => exportAs("vtt")} disabled={!segments.length}>
                <Captions size={17} />
                <span>
                  VTT<small>כתוביות לאינטרנט</small>
                </span>
              </button>
              <button type="button" onClick={() => void copy()} disabled={!text.trim()}>
                {copied ? <Check size={17} /> : <Copy size={17} />}
                <span>
                  {copied ? "הועתק" : "העתק"}
                  <small>ללוח</small>
                </span>
              </button>
              <ShareButton build={() => buildFile("txt")} title={`תמלול — ${title}`} />
            </div>
          </div>

          {finished && (
            <p className="engine-note">
              התמלול הסתיים ב־{finished.seconds.toFixed(0)} שניות בשרת · ההקלטה לא נשמרה שם.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
