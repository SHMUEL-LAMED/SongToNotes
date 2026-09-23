import { ArrowLeftRight, Captions, Clapperboard, Download, FileMusic, Guitar, MicVocal, Smartphone, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes, validateAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { decodeAudioFile, formatTime } from "../lib/audio";
import { convertAudio } from "../lib/convert";
import { downloadFile } from "../lib/export";
import { handOffTo, hasHandoff, takeHandoff } from "../lib/handoff";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";

const MAX_BYTES = 800 * 1024 * 1024;

type Extracted = { file: File; buffer: AudioBuffer; videoUrl: string };

/**
 * The sound of a video, as a file. The browser decodes the video's audio
 * track itself (MP4, MOV, WebM, MKV where the browser can play it), so
 * nothing goes up; the result is a WAV or MP3 to download, or to send on to
 * any other tool on the site.
 */
export function VideoTool() {
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [busy, setBusy] = useState<{ message: string; fraction: number } | null>(null);
  const [result, setResult] = useState<{ file: File; url: string; format: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  useEffect(() => () => {
    if (extracted) URL.revokeObjectURL(extracted.videoUrl);
  }, [extracted]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);
  useEffect(() => resetSave(), [resetSave, result]);

  const pick = async (file?: File | null) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`הקובץ גדול מדי (${formatBytes(file.size)}). הגבול הוא ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    const problem = validateAudioFile(file, MAX_BYTES);
    if (problem && !/^video\//.test(file.type)) {
      setError(problem);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const buffer = await decodeAudioFile(await file.arrayBuffer());
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error("לא נמצא שמע בסרטון.");
      setExtracted((previous) => {
        if (previous) URL.revokeObjectURL(previous.videoUrl);
        return { file, buffer, videoUrl: URL.createObjectURL(file) };
      });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "";
      setError(`לא הצלחנו לקרוא את השמע מ„${file.name}”. ${reason || "ייתכן שהדפדפן אינו מנגן את הפורמט הזה (למשל MKV או AVI); MP4, MOV ו־WebM נתמכים."}`);
    } finally {
      setLoading(false);
    }
  };

  /** Resolves with the audio file, or null when it failed. */
  const run = async (): Promise<File | null> => {
    if (!extracted || busy) return null;
    setBusy({ message: "מתחיל…", fraction: 0 });
    setError(null);
    try {
      const file = await convertAudio(
        extracted.buffer,
        extracted.file.name,
        { format, sampleRate: Math.min(48_000, Math.max(22_050, extracted.buffer.sampleRate)), channels: "keep", kbps: 192, trim: null, gain: 1, normalise: false },
        (message, fraction) => setBusy({ message, fraction }),
      );
      setResult((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { file, url: URL.createObjectURL(file), format };
      });
      return file;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "החילוץ נכשל.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!result || !extracted) return Promise.resolve(null);
    return saving.save(
      {
        kind: "convert",
        title: result.file.name,
        sourceName: extracted.file.name,
        summary: { format: result.format, sampleRate: extracted.buffer.sampleRate, channels: extracted.buffer.numberOfChannels, duration: extracted.buffer.duration, bytes: result.file.size, fromVideo: true },
        payload: { format: result.format, fromVideo: true },
      },
      result.file,
    );
  };

  // A video dropped on the home page's quick start arrives here, once.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });
  useEffect(() => {
    if (!hasHandoff()) return;
    void takeHandoff().then((handed) => {
      if (handed) void pickRef.current(handed.file);
    });
  }, []);

  const targets = [
    { id: "transcript", label: "לתמלול", note: "כתוביות לסרטון", icon: Captions },
    { id: "ringtone", label: "לצלצול", note: "מהסרטון לטלפון", icon: Smartphone },
    { id: "notes", label: "לתווים", note: "זיהוי תווים", icon: FileMusic },
    { id: "vocals", label: "להסרת שירה", note: "קריוקי מהסרטון", icon: MicVocal },
    { id: "chords", label: "לאקורדים", note: "אקורדים לגיטרה", icon: Guitar },
    { id: "convert", label: "להמרה", note: "קצב, ערוצים, איכות", icon: ArrowLeftRight },
  ];

  useAssistantTool("video", {
    state: () =>
      `וידאו לאודיו: ${extracted ? `הסרטון „${extracted.file.name}” (${formatTime(extracted.buffer.duration)}, ${formatBytes(extracted.file.size)})` : "לא נבחר סרטון (רק הגולש בוחר קובץ)"}; פורמט יעד ${format.toUpperCase()}; ${
        busy ? `מחלץ עכשיו (${Math.round(busy.fraction * 100)}%)` : result ? `יש קובץ מוכן: ${result.file.name} (${formatBytes(result.file.size)})` : "אין קובץ עדיין"
      }.`,
    handlers: {
      "video.read": () => ({
        ok: true,
        message: extracted ? (result ? "יש קובץ מוכן" : "הסרטון נטען") : "אין סרטון",
        data: { video: extracted?.file.name ?? null, duration: extracted ? Number(extracted.buffer.duration.toFixed(1)) : null, format, result: result ? { name: result.file.name, bytes: result.file.size } : null, busy: Boolean(busy) },
      }),
      "video.set": ({ format: next }) => {
        if (next !== "mp3" && next !== "wav") return { ok: false, message: "format הוא mp3 או wav" };
        setFormat(next);
        return { ok: true, message: `פורמט ${next.toUpperCase()}` };
      },
      "video.run": async () => {
        if (!extracted) return { ok: false, message: "אין סרטון; הגולש צריך לבחור קובץ" };
        if (busy) return { ok: false, message: "כבר מחלץ" };
        const file = await run();
        return file ? { ok: true, message: `השמע חולץ: ${file.name} (${formatBytes(file.size)})` } : { ok: false, message: "החילוץ נכשל" };
      },
      "video.download": () => {
        if (!result) return { ok: false, message: "אין קובץ; video.run מחלץ" };
        downloadFile(result.file, result.file.name, result.file.type);
        return { ok: true, message: `${result.file.name} ירד` };
      },
      "video.save": async () => {
        if (!result) return { ok: false, message: "אין קובץ; video.run מחלץ" };
        const saved = await save();
        return saved ? { ok: true, message: "הקובץ נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "video.sendTo": ({ tool }) => {
        if (!result) return { ok: false, message: "אין קובץ; video.run מחלץ" };
        void handOffTo(String(tool), result.file, "השמע מהסרטון");
        return { ok: true, message: `השמע נשלח לכלי ${String(tool)}` };
      },
    },
  });

  return (
    <section className="tool-body video-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Clapperboard size={26} />
        </span>
        <div>
          <h1>המרת וידאו לאודיו</h1>
          <p>מוציאים את הצליל מסרטון, ומשם לכל כלי באתר — הכול בדפדפן.</p>
        </div>
      </div>

      <div className="workspace-card">
        {!extracted ? (
          <label
            className={`drop-zone ${dragging ? "is-dragging" : ""}`}
            aria-disabled={loading}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void pick(event.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={inputRef}
              className="native-file-input"
              type="file"
              accept="video/*,.mp4,.mov,.webm,.mkv,.m4v,.avi"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void pick(file);
              }}
              aria-label="בחר סרטון"
              disabled={loading}
            />
            <span className="upload-icon">
              <Clapperboard size={30} />
            </span>
            <strong>{loading ? "קורא את הסרטון…" : "בחר סרטון או גרור לכאן"}</strong>
            <span>MP4, MOV, WebM · עד {formatBytes(MAX_BYTES)} · הסרטון לא יוצא מהמכשיר</span>
            {loading && (
              <div className="progress-track indeterminate" aria-label="קורא את הסרטון">
                <div />
              </div>
            )}
          </label>
        ) : (
          <div className="selected-file video-selected">
            <video src={extracted.videoUrl} controls className="video-preview" aria-label="הסרטון שנבחר" />
            <div className="file-details">
              <strong>{extracted.file.name}</strong>
              <span>
                {formatTime(extracted.buffer.duration)} · {extracted.buffer.numberOfChannels === 1 ? "מונו" : "סטריאו"} · {(extracted.buffer.sampleRate / 1000).toFixed(1)} kHz · {formatBytes(extracted.file.size)}
              </span>
            </div>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setExtracted(null);
                setResult(null);
                setError(null);
              }}
            >
              בחר סרטון אחר
            </button>
          </div>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {extracted && (
          <>
            <Transport buffer={extracted.buffer} label="השמע את הצליל שחולץ" />
            <div className="settings-panel">
              <div className="settings-grid">
                <div className="setting-field">
                  <span id="video-format">פורמט השמע</span>
                  <div className="segmented-control" role="group" aria-labelledby="video-format">
                    <button type="button" className={format === "mp3" ? "active" : ""} aria-pressed={format === "mp3"} onClick={() => setFormat("mp3")}>
                      MP3
                    </button>
                    <button type="button" className={format === "wav" ? "active" : ""} aria-pressed={format === "wav"} onClick={() => setFormat("wav")}>
                      WAV
                    </button>
                  </div>
                  <small>לשליטה בקצב הדגימה, בערוצים ובאיכות — "להמרה" למטה.</small>
                </div>
              </div>
            </div>
            {!busy ? (
              <button className="primary-button" type="button" onClick={() => void run()}>
                <Wand2 size={20} /> חלץ את השמע כ־{format.toUpperCase()}
              </button>
            ) : (
              <div className="processing-box" aria-live="polite">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> {busy.message}
                  </span>
                  <strong>{Math.round(busy.fraction * 100)}%</strong>
                </div>
                <div className="progress-track" role="progressbar" aria-label="התקדמות" aria-valuenow={Math.round(busy.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${Math.max(2, busy.fraction * 100)}%` }} />
                </div>
              </div>
            )}
            {result && (
              <div className="downloads-card">
                <div>
                  <span className="download-icon">
                    <Download size={22} />
                  </span>
                  <div>
                    <h3>{result.file.name}</h3>
                    <p>{formatBytes(result.file.size)} · מוכן להורדה או להמשך עבודה</p>
                  </div>
                </div>
                <div className="download-buttons">
                  <button type="button" onClick={() => downloadFile(result.file, result.file.name, result.file.type)}>
                    <Download size={17} />
                    <span>
                      הורד<small>{result.format.toUpperCase()}</small>
                    </span>
                  </button>
                  <ShareButton build={() => result.file} title={result.file.name} />
                  {targets.map((target) => {
                    const Icon = target.icon;
                    return (
                      <button key={target.id} type="button" onClick={() => void handOffTo(target.id, result.file, "השמע מהסרטון")}>
                        <Icon size={17} />
                        <span>
                          {target.label}
                          <small>{target.note}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <SaveButton state={saving.state} onSave={() => void save()} label="שמור את הקובץ" message={saving.message} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
