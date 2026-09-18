import {
  Captions,
  Check,
  Copy,
  Cpu,
  Download,
  FileText,
  Languages,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { formatTime } from "../lib/audio";
import { downloadFile, safeFilename } from "../lib/export";
import {
  LANGUAGES,
  MODELS,
  countWords,
  languageLabel,
  normalizeSegments,
  segmentsToSrt,
  segmentsToText,
  segmentsToVtt,
  textToSegments,
  type ModelChoice,
  type TranscriptSegment,
} from "../lib/transcript";
import { useSaveWork } from "../lib/useSaveWork";
import { useSpeech } from "../lib/useSpeech";
import type { SavedWork } from "../lib/works";

const SETTINGS_KEY = "musictools.transcript.v1";
const SPEECH_RATE = 16_000;

type Saved = { language: string | null; model: ModelChoice };

function loadSaved(): Saved {
  const fallback: Saved = { language: "he", model: "fast" };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null;
    if (!parsed) return fallback;
    return {
      language: LANGUAGES.some((item) => item.id === parsed.language) ? (parsed.language as string | null) : fallback.language,
      model: parsed.model === "accurate" ? "accurate" : "fast",
    };
  } catch {
    return fallback;
  }
}

/** Mono at the model's rate, rendered offline so it is not tied to playback. */
async function prepareForSpeech(buffer: AudioBuffer): Promise<Float32Array> {
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
  return rendered.getChannelData(0).slice();
}

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
    model: typeof work.payload.model === "string" ? work.payload.model : MODELS.fast.id,
    duration: typeof work.summary.duration === "number" ? work.summary.duration : 0,
    sourceName: work.sourceName,
  };
}

/**
 * Speech to text. The heavy part runs in {@link ../workers/speech.worker};
 * this is the choice of language and model, the progress while the model
 * comes down and listens, and the text afterwards — editable in place so a
 * misheard word is fixed without losing its timestamp.
 */
export function TranscriptTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [saved] = useState(loadSaved);
  const [language, setLanguage] = useState<string | null>(saved.language);
  const [model, setModel] = useState<ModelChoice>(saved.model);
  const [result, setResult] = useState<Result | null>(() => readInitial(initial));
  const [text, setText] = useState(() => (result ? segmentsToText(result.segments) : ""));
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    initial ? "פתחת תמלול שמור. ההקלטה עצמה לא נשמרה." : null,
  );
  const speech = useSpeech();
  const saving = useSaveWork();
  const resetSave = saving.reset;
  const resultsRef = useRef<HTMLDivElement>(null);
  const runTokenRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language, model } satisfies Saved));
    } catch {
      // Private browsing; the choice simply does not persist.
    }
  }, [language, model]);

  // Editing the text is a new transcript to save.
  useEffect(() => resetSave(), [resetSave, text]);

  const busy = speech.phase === "loading" || speech.phase === "transcribing";

  const run = useCallback(async () => {
    if (!audio || busy) return;
    runTokenRef.current += 1;
    const token = runTokenRef.current;
    setError(null);
    setNotice(null);
    try {
      const samples = await prepareForSpeech(audio.buffer);
      if (runTokenRef.current !== token) return;
      const segments = await speech.transcribe(samples, {
        model: MODELS[model].id,
        language,
      });
      if (runTokenRef.current !== token) return;
      if (!segments.length) {
        setError("לא זוהה דיבור בהקלטה. נסה שפה אחרת, או את המודל המדויק.");
        return;
      }
      const next: Result = {
        segments,
        language,
        model: MODELS[model].id,
        duration: audio.buffer.duration,
        sourceName: audio.file.name,
      };
      setResult(next);
      setText(segmentsToText(segments));
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 120);
    } catch (caught) {
      if (runTokenRef.current !== token) return;
      const message = caught instanceof Error ? caught.message : "התמלול נכשל.";
      if (message !== "התמלול בוטל.") setError(message);
    }
  }, [audio, busy, language, model, setError, speech]);

  // The text box is the source of truth once the visitor has typed in it;
  // the segments underneath keep their timestamps.
  const segments = useMemo(
    () => (result ? textToSegments(text, result.segments) : []),
    [result, text],
  );
  const words = useMemo(() => countWords(text), [text]);
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

  const saveTranscript = () => {
    if (!result || !segments.length) return;
    void saving.save({
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
      payload: { segments, language: result.language, model: result.model },
    });
  };

  const modelInfo = MODELS[model];

  return (
    <section className="tool-body transcript-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Captions size={26} />
        </span>
        <div>
          <h1>תמלול לטקסט</h1>
          <p>בחר הקלטה או הקלט, והדפדפן יהפוך את הדיבור לטקסט.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            setNotice(null);
            void load(file);
          }}
          onClear={() => {
            runTokenRef.current += 1;
            speech.cancel();
            clear();
          }}
          allowRecording
          hint="הקלטה, הרצאה, שיעור או שיר · עברית, אנגלית ועוד"
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
              <span id="transcript-model">
                <Cpu size={15} /> מנוע הזיהוי
              </span>
              <div className="segmented-control" role="group" aria-labelledby="transcript-model">
                {(Object.keys(MODELS) as ModelChoice[]).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className={model === choice ? "active" : ""}
                    aria-pressed={model === choice}
                    onClick={() => setModel(choice)}
                  >
                    {MODELS[choice].label}
                  </button>
                ))}
              </div>
              <small>
                {modelInfo.note}. הורדה חד־פעמית של {modelInfo.size}; אחר כך הכול רץ במכשיר.
              </small>
            </div>
          </div>
        </div>

        {audio && !busy && (
          <button className="primary-button" type="button" onClick={run}>
            <Wand2 size={20} /> תמלל את ההקלטה
            <small>{formatTime(audio.buffer.duration)}</small>
          </button>
        )}

        {busy && (
          <div className="processing-box" aria-live="polite">
            <div className="processing-top">
              <span>
                <Wand2 size={18} />{" "}
                {speech.phase === "loading"
                  ? speech.loadingFile
                    ? `מוריד את ${speech.loadingFile}…`
                    : (speech.status ?? "מכין את מנוע הזיהוי…")
                  : (speech.status ?? "מתמלל…")}
              </span>
              <strong>
                {speech.phase === "loading" && speech.loadingFile
                  ? `${speech.loadProgress}%`
                  : speech.phase === "transcribing"
                    ? `${speech.progress}%`
                    : ""}
              </strong>
            </div>
            {speech.phase === "loading" && speech.loadingFile ? (
              <div
                className="progress-track"
                role="progressbar"
                aria-label="הורדת המודל"
                aria-valuenow={speech.loadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${Math.max(2, speech.loadProgress)}%` }} />
              </div>
            ) : speech.phase === "transcribing" ? (
              <div
                className="progress-track"
                role="progressbar"
                aria-label="התקדמות התמלול"
                aria-valuenow={speech.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${Math.max(2, speech.progress)}%` }} />
              </div>
            ) : (
              <div className="progress-track indeterminate">
                <div />
              </div>
            )}
            {speech.partial && <p className="transcript-partial">{speech.partial}</p>}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                runTokenRef.current += 1;
                speech.cancel();
              }}
            >
              <X size={14} /> בטל
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
              {result.duration > 0 && <span>{formatTime(result.duration)}</span>}
              <span>{languageLabel(result.language)}</span>
            </div>
          </div>

          <textarea
            className="transcript-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(24, Math.max(6, segments.length + 2))}
            aria-label="הטקסט המתומלל, ניתן לעריכה"
            dir="auto"
            spellCheck
          />
          <p className="table-footnote">
            אפשר לתקן כאן ישירות. כל שורה היא משפט עם חותמת הזמן שלו — השורות נשמרות
            לכתוביות.
          </p>

          <ol className="transcript-segments" aria-label="משפטים עם חותמות זמן">
            {segments.map((segment, index) => (
              <li key={`${segment.start}-${index}`}>
                <time>{formatTime(segment.start)}</time>
                <span dir="auto">{segment.text}</span>
              </li>
            ))}
          </ol>

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
            <SaveButton
              state={saving.state}
              onSave={saveTranscript}
              disabled={!segments.length}
              label="שמור את התמלול"
              message={saving.message}
            />
          </div>

          {speech.elapsed !== null && (
            <p className="engine-note">
              התמלול הסתיים ב־{(speech.elapsed / 1000).toFixed(0)} שניות
              {speech.device === "webgpu" ? " על כרטיס המסך" : " על המעבד"} · ההקלטה לא יצאה
              מהמכשיר.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
