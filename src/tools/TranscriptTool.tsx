import {
  Captions,
  Check,
  Copy,
  Cpu,
  Download,
  FileText,
  Languages,
  Play,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
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
  splitIntoWindows,
  textToSegments,
  type ModelChoice,
  type SampleWindow,
  type TranscriptSegment,
} from "../lib/transcript";
import { useSaveWork } from "../lib/useSaveWork";
import { useSpeech } from "../lib/useSpeech";
import type { SavedWork } from "../lib/works";

const SETTINGS_KEY = "musictools.transcript.v1";
const SPEECH_RATE = 16_000;
/**
 * Decoded straight to mono at 16 kHz, a recording costs 3.8MB a minute in
 * memory, so two hours fit where twenty minutes of full-rate stereo did.
 * The file itself is allowed up to this size — about ten hours of MP3.
 */
const MAX_FILE_BYTES = 600 * 1024 * 1024;
/** The recogniser hears this much at a time; the text lands window by window. */
const WINDOW_SECONDS = 300;
/** From this length there is more than one window, and the page says so. */
const LONG_SECONDS = WINDOW_SECONDS * 1.5;

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
  const { audio, error, setError, isLoading, progress, load, clear, maxBytes } = useAudioFile({
    maxBytes: MAX_FILE_BYTES,
    monoAt: SPEECH_RATE,
  });
  const [saved] = useState(loadSaved);
  const [language, setLanguage] = useState<string | null>(saved.language);
  const [model, setModel] = useState<ModelChoice>(saved.model);
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
  const speech = useSpeech();
  const saving = useSaveWork();
  const resetSave = saving.reset;
  const resultsRef = useRef<HTMLDivElement>(null);
  const runTokenRef = useRef(0);
  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language, model } satisfies Saved));
    } catch {
      // Private browsing; the choice simply does not persist.
    }
  }, [language, model]);

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
      const modelId = MODELS[model].id;
      let speed: number | null = null;

      const publish = (segments: TranscriptSegment[]) => {
        setResult({
          segments,
          language,
          model: modelId,
          duration: audio.buffer.duration,
          sourceName: audio.file.name,
        });
        setText(segmentsToText(segments));
      };

      for (let index = startIndex; index < windows.length; index += 1) {
        const window_ = windows[index];
        setStage({ index, count: windows.length, doneSeconds, totalSeconds, speed });
        const startedAt = Date.now();
        try {
          // The worker takes the buffer over, so it gets a copy of the window.
          const slice = samples.slice(window_.start, window_.end);
          const found = await speech.transcribe(slice, { model: modelId, language });
          if (runTokenRef.current !== token) return;
          const offset = window_.start / SPEECH_RATE;
          collected = [
            ...collected,
            ...found.map((segment) => ({
              start: segment.start + offset,
              end: segment.end === null ? null : segment.end + offset,
              text: segment.text,
            })),
          ];
          const windowSeconds = (window_.end - window_.start) / SPEECH_RATE;
          doneSeconds += windowSeconds;
          const took = Math.max(0.001, (Date.now() - startedAt) / 1000);
          // The first window pays for loading the model, so its pace is
          // taken with a grain of salt until a second one has run.
          speed = speed === null ? windowSeconds / took / 1.5 : windowSeconds / took;
          publish(collected);
          if (index === startIndex) {
            window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 120);
          }
        } catch (caught) {
          if (runTokenRef.current !== token) return;
          const message = caught instanceof Error ? caught.message : "התמלול נכשל.";
          setStage(null);
          if (collected.length) publish(collected);
          if (message !== "התמלול בוטל.") setError(message);
          // Whatever stopped it, the next attempt starts at this window.
          setResume({ windows, index });
          return;
        }
      }
      setStage(null);
      if (!collected.length) {
        setError("לא זוהה דיבור בהקלטה. נסה שפה אחרת, או את המודל המדויק.");
      }
    },
    [audio, language, model, result, setError, speech, stage, trim],
  );

  const stop = () => {
    runTokenRef.current += 1;
    speech.cancel();
    setStage(null);
    if (stage) {
      // The window under way is the one to come back to.
      const windows = resume?.windows ?? null;
      if (windows) setResume({ windows, index: stage.index });
    }
  };

  const remaining =
    stage && stage.speed
      ? roughMinutes(
          Math.max(
            0,
            (stage.totalSeconds - stage.doneSeconds - (speech.progress / 100) * (stage.totalSeconds / stage.count)) /
              stage.speed,
          ),
        )
      : null;
  const overall = stage
    ? Math.min(
        99,
        Math.round(
          ((stage.doneSeconds + (speech.progress / 100) * (stage.totalSeconds / Math.max(1, stage.count))) /
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
            speech.cancel();
            setStage(null);
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
                {modelInfo.note}. ההפעלה הראשונה טוענת את המנוע ({modelInfo.size}) ועשויה להימשך
                דקה; אחר כך הכול מיידי, גם בלי אינטרנט.
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

        {audio && !busy && !resume && (
          <button className="primary-button" type="button" onClick={() => void run()}>
            <Wand2 size={20} /> {trim ? "תמלל את הקטע המסומן" : "תמלל את ההקלטה"}
            <small>{formatTime(trim ? trim.end - trim.start : audio.buffer.duration)}</small>
          </button>
        )}
        {audio && !busy && resume && (
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
            {stage.count > 1 && (
              <p className="transcript-stage">
                חלק {stage.index + 1} מתוך {stage.count} · {overall}% מההקלטה
                {remaining ? ` · נותרו ${remaining}` : ""}
              </p>
            )}
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
