import {
  Cpu,
  Download,
  Minus,
  Music4,
  Plus,
  Scissors,
  Smartphone,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AudioPicker,
  useAudioFile,
  type LoadedAudio,
} from "../components/AudioPicker";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { useAuth } from "../lib/auth";
import {
  separateStems,
  type SeparationProgress,
} from "../lib/stemSeparation";
import { channelsToBuffer, normalise } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import { saveRingtone } from "../lib/ringtoneHistory";
import {
  analyseStructure,
  snapToPhrase,
  type SongSections,
} from "../lib/structure";
import { useRenderedAudio } from "../lib/useRenderedAudio";
import { encodeWav } from "../lib/wav";

const DEFAULT_LENGTH = 30;
/** What an iPhone will accept as a ringtone. */
const IPHONE_LIMIT = 40;
const MIN_LENGTH = 3;
const MAX_LENGTH = 60;

type SectionKind = keyof Omit<SongSections, "confidence">;

const SECTION_LABELS: Record<SectionKind, { title: string; hint: string }> = {
  chorus: { title: "הפזמון שזוהה", hint: "הקטע החוזר והבולט ביותר" },
  verse: { title: "הבית שזוהה", hint: "קטע מוקדם ושקט יותר" },
  instrumental: { title: "קטע מוזיקלי", hint: "קטע יציב עם פחות שינויי קול" },
};

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

/**
 * Cuts a ringtone out of a song. Everything — the trim, the fades and the
 * gain — is rendered into a fresh buffer so the preview and the download are
 * byte-for-byte the same thing.
 */
export function RingtoneTool({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [context] = useState(sharedContext);

  useEffect(() => () => void context?.close(), [context]);

  return (
    <section className="tool-body ringtone-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Smartphone size={26} />
        </span>
        <div>
          <h1>יצירת צלצול</h1>
          <p>
            מעלים שיר, והאתר מחפש בשבילכם את הפזמון. משם אפשר לכוונן בגל הקול
            או בשניות בדיוק, להוסיף כניסה ויציאה רכות ולהוריד. הכול נשאר במכשיר
            שלך.
          </p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            void load(file);
          }}
          onClear={clear}
          hint="MP3, WAV, M4A, OGG · הצלצול ייחתך מהקובץ הזה"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {audio && context && (
          // Remounting on a new file is what resets the trim and the fades,
          // so none of that state has to be cleared by hand.
          <RingtoneEditor
            key={audio.url}
            audio={audio}
            context={context}
            userId={user?.id ?? null}
            onSaved={onSaved}
          />
        )}
      </div>
    </section>
  );
}

type EditorProps = {
  audio: LoadedAudio;
  context: AudioContext;
  userId: string | null;
  onSaved: () => void;
};

function RingtoneEditor({ audio, context, userId, onSaved }: EditorProps) {
  const duration = audio.buffer.duration;
  const [trim, setTrim] = useState<TrimRange>(() => ({
    start: 0,
    end: Math.min(DEFAULT_LENGTH, duration),
  }));
  const [fadeIn, setFadeIn] = useState(1);
  const [fadeOut, setFadeOut] = useState(2);
  const [gain, setGain] = useState(100);
  const [normalize, setNormalize] = useState(true);
  const [sections, setSections] = useState<SongSections | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKind | null>(null);
  const [snapNote, setSnapNote] = useState<string | null>(null);

  // The backing track produced by the AI separator, when one has been made.
  const [instrumental, setInstrumental] = useState<AudioBuffer | null>(null);
  const [useInstrumental, setUseInstrumental] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);

  const sourceBuffer = useInstrumental && instrumental ? instrumental : audio.buffer;
  const peaks = useMemo(() => buildPeaks(sourceBuffer), [sourceBuffer]);

  const range = useMemo(() => {
    const start = trim ? Math.max(0, Math.min(trim.start, duration)) : 0;
    const end = trim
      ? Math.max(start + 0.5, Math.min(trim.end, duration))
      : duration;
    return { start, end: Math.min(end, duration) };
  }, [duration, trim]);
  const length = range.end - range.start;

  // ---- structure ----

  // Analysing a four-minute song takes a moment, so it happens once the file
  // is on screen rather than blocking the editor from appearing.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const found = analyseStructure(audio.buffer, DEFAULT_LENGTH);
      if (cancelled) return;
      setSections(found);
      // The chorus is the suggestion worth making unprompted; the others are
      // there for anyone who disagrees.
      const snapped = snapToPhrase(
        audio.buffer,
        found.chorus,
        Math.min(duration, found.chorus + DEFAULT_LENGTH),
      );
      setTrim(snapped);
      setActiveSection("chorus");
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audio.buffer, duration]);

  const pickSection = useCallback(
    (kind: SectionKind) => {
      if (!sections) return;
      const start = Math.min(sections[kind], Math.max(0, duration - length));
      setActiveSection(kind);
      setTrim(
        snapToPhrase(audio.buffer, start, Math.min(duration, start + length)),
      );
      setSnapNote(null);
    },
    [audio.buffer, duration, length, sections],
  );

  const snapNow = useCallback(() => {
    const snapped = snapToPhrase(audio.buffer, range.start, range.end);
    setTrim(snapped);
    setSnapNote(
      `הקטע הותאם להפסקות טבעיות בקול: ${formatTime(snapped.start)} עד ${formatTime(snapped.end)}`,
    );
  }, [audio.buffer, range.end, range.start]);

  const nudgeStart = useCallback(
    (seconds: number) => {
      setTrim((current) => {
        const end = current?.end ?? Math.min(duration, DEFAULT_LENGTH);
        const start = Math.max(
          0,
          Math.min((current?.start ?? 0) + seconds, end - MIN_LENGTH),
        );
        return { start, end };
      });
      setSnapNote(null);
    },
    [duration],
  );

  const setLength = useCallback(
    (seconds: number) => {
      setTrim((current) => {
        const start = Math.min(current?.start ?? 0, Math.max(0, duration - seconds));
        return { start, end: Math.min(duration, start + seconds) };
      });
      setSnapNote(null);
    },
    [duration],
  );

  // ---- rendering ----

  const { buffer: rendered } = useRenderedAudio(
    `${useInstrumental}-${range.start.toFixed(3)}-${range.end.toFixed(3)}-${fadeIn}-${fadeOut}-${gain}-${normalize}`,
    () => {
      const buffer = sourceBuffer;
      const sampleRate = buffer.sampleRate;
      const from = Math.floor(range.start * sampleRate);
      const to = Math.min(buffer.length, Math.ceil(range.end * sampleRate));
      const frames = Math.max(1, to - from);
      const inSamples = Math.max(
        1,
        Math.min(frames / 2, Math.round(fadeIn * sampleRate)),
      );
      const outSamples = Math.max(
        1,
        Math.min(frames / 2, Math.round(fadeOut * sampleRate)),
      );
      const level = gain / 100;

      const channels = Array.from(
        { length: buffer.numberOfChannels },
        (_, channelIndex) => {
          const source = buffer.getChannelData(channelIndex);
          const output = new Float32Array(frames);
          for (let index = 0; index < frames; index += 1) {
            let envelope = level;
            if (fadeIn > 0 && index < inSamples) envelope *= index / inSamples;
            if (fadeOut > 0 && index > frames - outSamples) {
              envelope *= (frames - index) / outSamples;
            }
            output[index] = source[from + index] * envelope;
          }
          return output;
        },
      );
      if (normalize) normalise(channels);
      return channelsToBuffer(context, channels, sampleRate);
    },
  );

  // ---- AI backing track ----

  // The separator falls back to WebAssembly where WebGPU is missing and
  // resamples the song itself, so there is nothing left to gate on — only a
  // warning worth giving before someone waits.
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;

  const makeInstrumental = useCallback(async () => {
    setAiBusy(true);
    setAiProgress(0);
    setAiStatus("מכין את מודל ההפרדה…");
    try {
      const stems = await separateStems(audio.buffer, (progress: SeparationProgress) => {
        setAiProgress(Math.round(progress.progress * 100));
        setAiStatus(progress.message);
      });
      setInstrumental(
        channelsToBuffer(context, stems.instrumental, stems.sampleRate),
      );
      setUseInstrumental(true);
      setAiProgress(100);
      setAiStatus("הגרסה האינסטרומנטלית מוכנה — הצלצול נחתך ממנה עכשיו.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "ההפרדה נכשלה.";
      setAiStatus(
        message === "Failed to fetch"
          ? "לא הצלחנו להוריד את מודל ההפרדה. בדוק את החיבור לאינטרנט ונסה שוב."
          : `ההפרדה לא הושלמה: ${message}. כדאי לנסות שוב ולהשאיר את הכרטיסייה פתוחה בזמן העיבוד.`,
      );
    } finally {
      setAiBusy(false);
    }
  }, [audio.buffer, context]);

  // ---- export ----

  const exportWav = () => {
    if (!rendered) return;
    const channels = Array.from(
      { length: rendered.numberOfChannels },
      (_, index) => rendered.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: rendered.sampleRate });
    const title = audio.file.name.replace(/\.[^/.]+$/, "");
    const suffix = useInstrumental ? "-instrumental" : "";
    downloadFile(
      blob,
      `${safeFilename(title)}${suffix}-ringtone.wav`,
      "audio/wav",
    );
    // The profile history is a record of what was made, not a copy of the
    // audio: the file itself never leaves the device.
    void saveRingtone(
      {
        title,
        sourceName: audio.file.name,
        startSeconds: range.start,
        durationSeconds: length,
      },
      userId,
    ).then(onSaved);
  };

  const tooLongForIphone = length > IPHONE_LIMIT;

  return (
    <>
      {sections === null ? (
        <div className="processing-box">
          <div className="processing-top">
            <span>
              <Wand2 size={18} /> מחפש את הפזמון…
            </span>
          </div>
          <div className="progress-track indeterminate">
            <div />
          </div>
          <div className="processing-bottom">
            <small>
              מזהים חזרות מוזיקליות, קצב וצבע צליל כדי למצוא את הקטע המתאים.
            </small>
          </div>
        </div>
      ) : (
        <div className="section-picker">
          <div className="section-picker-head">
            <h3>
              <Music4 size={17} /> מה שיהיה בצלצול?
            </h3>
            <small>
              {sections.confidence >= 0.62
                ? "זוהתה חזרה מוזיקלית ברורה — אפשר גם לכוון ידנית על הגל."
                : "מצאנו את הקטע החוזר הקרוב ביותר — אפשר לכוון ידנית על הגל."}
            </small>
          </div>
          <div className="section-choices" role="group" aria-label="בחירת קטע">
            {(Object.keys(SECTION_LABELS) as SectionKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={activeSection === kind ? "active" : ""}
                aria-pressed={activeSection === kind}
                onClick={() => pickSection(kind)}
              >
                <b>{SECTION_LABELS[kind].title}</b>
                <small>{SECTION_LABELS[kind].hint}</small>
                <span className="section-time">
                  {formatTime(sections[kind])}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Waveform
        peaks={peaks}
        duration={duration}
        trim={trim}
        onTrimChange={(next) => {
          setTrim(next);
          setActiveSection(null);
          setSnapNote(null);
        }}
        cursor={null}
      />

      <div className="trim-fields">
        <label>
          <span>התחלה</span>
          <input
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={Number(range.start.toFixed(1))}
            onChange={(event) => {
              const start = Number(event.target.value);
              setTrim((current) => ({
                start,
                end: Math.max(
                  start + MIN_LENGTH,
                  current?.end ?? start + DEFAULT_LENGTH,
                ),
              }));
              setActiveSection(null);
            }}
          />
        </label>
        <label>
          <span>סיום</span>
          <input
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={Number(range.end.toFixed(1))}
            onChange={(event) => {
              const end = Number(event.target.value);
              setTrim((current) => ({
                start: Math.min(current?.start ?? 0, Math.max(0, end - MIN_LENGTH)),
                end,
              }));
              setActiveSection(null);
            }}
          />
        </label>
        <div className="trim-length">
          <strong>{formatTime(length)}</strong>
          <span>
            {tooLongForIphone
              ? "ארוך מ־40 שנ׳ — לאייפון כדאי לקצר"
              : "אורך הצלצול"}
          </span>
        </div>
      </div>

      <div className="fine-tune">
        <div className="nudge-row" role="group" aria-label="הזזת תחילת הקטע">
          <span>הזזת ההתחלה</span>
          {/* The plus and minus are drawn rather than written, so each button
              spells its direction out for a screen reader. */}
          <button
            type="button"
            aria-label="הקדם את ההתחלה בשנייה"
            onClick={() => nudgeStart(-1)}
          >
            <Minus size={13} aria-hidden="true" /> שנייה
          </button>
          <button
            type="button"
            aria-label="הקדם את ההתחלה בעשירית שנייה"
            onClick={() => nudgeStart(-0.1)}
          >
            <Minus size={13} aria-hidden="true" /> 0.1
          </button>
          <button
            type="button"
            aria-label="אחר את ההתחלה בעשירית שנייה"
            onClick={() => nudgeStart(0.1)}
          >
            <Plus size={13} aria-hidden="true" /> 0.1
          </button>
          <button
            type="button"
            aria-label="אחר את ההתחלה בשנייה"
            onClick={() => nudgeStart(1)}
          >
            <Plus size={13} aria-hidden="true" /> שנייה
          </button>
        </div>
        <label className="setting-field range-field">
          <span>
            אורך הצלצול <b>{Math.round(length)} שניות</b>
          </span>
          <input
            type="range"
            min={MIN_LENGTH}
            max={Math.max(MIN_LENGTH + 1, Math.min(MAX_LENGTH, Math.floor(duration)))}
            value={Math.round(Math.min(length, MAX_LENGTH))}
            onChange={(event) => setLength(Number(event.target.value))}
          />
        </label>
        <button className="secondary-button" type="button" onClick={snapNow}>
          <Scissors size={15} /> התאם להתחלה וסיום טבעיים
        </button>
        <small className="fine-tune-note">
          {snapNote ?? "מחפש הפסקות קצרות בקול כדי לא לחתוך באמצע משפט."}
        </small>
      </div>

      <div className="settings-panel">
        <div className="settings-grid">
          <label className="setting-field range-field">
            <span>
              כניסה רכה (Fade in) <b>{fadeIn.toFixed(1)} שנ׳</b>
            </span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={fadeIn}
              onChange={(event) => setFadeIn(Number(event.target.value))}
            />
          </label>
          <label className="setting-field range-field">
            <span>
              יציאה רכה (Fade out) <b>{fadeOut.toFixed(1)} שנ׳</b>
            </span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={fadeOut}
              onChange={(event) => setFadeOut(Number(event.target.value))}
            />
          </label>
          <label className="setting-field range-field">
            <span>
              עוצמה <b>{gain}%</b>
            </span>
            <input
              type="range"
              min={20}
              max={200}
              value={gain}
              onChange={(event) => setGain(Number(event.target.value))}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(event) => setNormalize(event.target.checked)}
            />
            <span>נרמל עוצמה — הצלצול יישמע חזק וברור</span>
          </label>
        </div>
      </div>

      <Transport buffer={rendered} label="השמע את הצלצול" />

      <div className="ai-separator">
        <div className="ai-separator-head">
          <span className="tool-intro-icon">
            <Cpu size={20} />
          </span>
          <div>
            <h3>
              <Sparkles size={16} /> צלצול אינסטרומנטלי
            </h3>
            <p>
              מודל Demucs רץ במכשיר שלך, מסיר את השירה ומשאיר רק את הנגינה —
              צלצול בלי מילים. בפעם הראשונה יורד מודל בגודל כ־172MB, ואחר כך
              הוא נשמר בדפדפן. השיר עצמו לא נשלח לשום מקום.
              {!hasGpu &&
                " בדפדפן הזה אין WebGPU, ולכן ההפרדה תרוץ על המעבד ותיקח הרבה יותר זמן."}
            </p>
          </div>
        </div>
        {instrumental ? (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={useInstrumental}
              onChange={(event) => setUseInstrumental(event.target.checked)}
            />
            <span>חתוך את הצלצול מהגרסה האינסטרומנטלית</span>
          </label>
        ) : (
          <>
            <button
              className="primary-button compact"
              type="button"
              onClick={makeInstrumental}
              disabled={aiBusy}
            >
              <Sparkles size={17} /> הפק גרסה אינסטרומנטלית
            </button>
            {aiBusy && (
              <div
                className="progress-track"
                role="progressbar"
                aria-label="התקדמות הפרדת השירה"
                aria-valuenow={aiProgress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${Math.max(2, aiProgress)}%` }} />
              </div>
            )}
          </>
        )}
        {aiStatus && (
          <small className="ai-status" role="status">
            {aiStatus}
          </small>
        )}
      </div>

      <div className="downloads-card">
        <div>
          <span className="download-icon">
            <Download size={22} />
          </span>
          <div>
            <h3>הורדת הצלצול</h3>
            <p>
              קובץ WAV באיכות מלאה. באנדרואיד מעבירים לתיקיית Ringtones;
              באייפון מייבאים דרך GarageBand או iTunes.
            </p>
          </div>
        </div>
        <div className="download-buttons">
          <button onClick={exportWav} type="button" disabled={!rendered}>
            <Smartphone size={17} />
            <span>
              WAV
              <small>
                {formatTime(length)} · {useInstrumental ? "בלי שירה" : "מוכן לטלפון"}
              </small>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
