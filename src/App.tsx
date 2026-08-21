import {
  AudioLines,
  AudioWaveform,
  Check,
  ChevronLeft,
  Download,
  FileAudio,
  FileMusic,
  ListMusic,
  LockKeyhole,
  Music2,
  RotateCcw,
  Settings2,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteEventTime } from "@spotify/basic-pitch";
import { PianoRoll } from "./components/PianoRoll";
import { SheetMusic } from "./components/SheetMusic";
import {
  createGrid,
  downloadFile,
  estimateTempo,
  gridToAbc,
  gridToMusicXml,
  midiName,
  notesToCsv,
  notesToMidi,
  type ViewMode,
} from "./music";
import { transcribeAudio } from "./transcription";

type Tab = "sheet" | "piano" | "notes";

const ACCEPTED_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac"];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function cleanFilename(name: string) {
  return name.replace(/\.[^/.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-");
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteEventTime[]>([]);
  const [sensitivity, setSensitivity] = useState(62);
  const [viewMode, setViewMode] = useState<ViewMode>("melody");
  const [tempoOverride, setTempoOverride] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("sheet");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!file) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const estimatedBpm = useMemo(() => estimateTempo(notes), [notes]);
  const bpm = tempoOverride || estimatedBpm;
  const title = file ? file.name.replace(/\.[^/.]+$/, "") : "SongToNotes";
  const grid = useMemo(
    () => createGrid(notes, bpm, viewMode),
    [notes, bpm, viewMode],
  );
  const abc = useMemo(() => gridToAbc(grid, title), [grid, title]);

  function validateAndSetFile(candidate?: File) {
    if (!candidate) return;
    const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setError("יש לבחור קובץ אודיו מסוג MP3, WAV, OGG, FLAC, M4A או AAC.");
      return;
    }
    if (candidate.size > 150 * 1024 * 1024) {
      setError("הקובץ גדול מדי. הגודל המרבי בגרסה הזו הוא 150MB.");
      return;
    }
    setFile(candidate);
    setNotes([]);
    setError(null);
    setProgress(0);
  }

  async function startTranscription() {
    if (!file || isProcessing) return;
    setIsProcessing(true);
    setError(null);
    setNotes([]);
    setProgress(0);
    try {
      const detectedNotes = await transcribeAudio(
        file,
        { sensitivity },
        setProgress,
      );
      if (!detectedNotes.length) {
        throw new Error(
          "לא נמצאו תווים ברורים. נסה להעלות קטע עם כלי אחד או להעלות את הרגישות.",
        );
      }
      setNotes(detectedNotes);
      setTempoOverride(0);
      window.setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth" }),
        100,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "אירעה שגיאה בזמן ניתוח השיר.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  function reset() {
    setFile(null);
    setNotes([]);
    setError(null);
    setProgress(0);
    setTempoOverride(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  function download(kind: "midi" | "musicxml" | "abc" | "csv") {
    const base = cleanFilename(title) || "song-to-notes";
    if (kind === "midi") {
      downloadFile(notesToMidi(notes, bpm), `${base}.mid`, "audio/midi");
    } else if (kind === "musicxml") {
      downloadFile(
        gridToMusicXml(grid, title),
        `${base}.musicxml`,
        "application/vnd.recordare.musicxml+xml;charset=utf-8",
      );
    } else if (kind === "abc") {
      downloadFile(abc, `${base}.abc`, "text/vnd.abc;charset=utf-8");
    } else {
      downloadFile(notesToCsv(notes), `${base}.csv`, "text/csv;charset=utf-8");
    }
  }

  const duration = notes.length
    ? Math.max(...notes.map((note) => note.startTimeSeconds + note.durationSeconds))
    : 0;

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="SongToNotes">
          <span className="brand-mark"><Music2 size={22} /></span>
          <span>SongToNotes</span>
        </a>
        <div className="privacy-pill">
          <LockKeyhole size={15} />
          הקובץ נשאר אצלך בדפדפן
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="eyebrow"><Sparkles size={16} /> זיהוי תווים חכם</div>
        <h1>הופכים כל מנגינה<br /><span>לתווים שאפשר לעבוד איתם</span></h1>
        <p>
          מעלים שיר או הקלטה, והמערכת מזהה את התווים ומכינה קובצי MIDI,
          MusicXML ותצוגת תווים — ישירות בדפדפן.
        </p>
        <div className="hero-points">
          <span><Check size={16} /> ללא הרשמה</span>
          <span><Check size={16} /> עיבוד מקומי ופרטי</span>
          <span><Check size={16} /> הורדה לעריכה</span>
        </div>
      </section>

      <section className="workspace-section">
        <div className="workspace-card">
          <div className="workspace-heading">
            <div>
              <span className="step-number">1</span>
              <h2>בחר קובץ שמע</h2>
              <p>לתוצאה הטובה ביותר מומלץ להתחיל בכלי נגינה יחיד או בשירה נקייה.</p>
            </div>
            {file && (
              <button className="icon-button" onClick={reset} aria-label="הסר קובץ">
                <X size={19} />
              </button>
            )}
          </div>

          {!file ? (
            <button
              className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                validateAndSetFile(event.dataTransfer.files[0]);
              }}
              type="button"
            >
              <span className="upload-icon"><UploadCloud size={34} /></span>
              <strong>גרור לכאן שיר או לחץ לבחירה</strong>
              <span>MP3, WAV, OGG, FLAC, M4A, AAC · עד 150MB</span>
            </button>
          ) : (
            <div className="selected-file">
              <span className="file-icon"><FileAudio size={30} /></span>
              <div className="file-details">
                <strong>{file.name}</strong>
                <span>{formatBytes(file.size)}</span>
              </div>
              {audioUrl && <audio controls src={audioUrl} preload="metadata" />}
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".mp3,.wav,.ogg,.flac,.m4a,.aac,audio/*"
            hidden
            onChange={(event) => validateAndSetFile(event.target.files?.[0])}
          />

          <div className="settings-panel">
            <div className="settings-title"><Settings2 size={18} /> הגדרות זיהוי</div>
            <div className="settings-grid">
              <label className="setting-field">
                <span>מה להוציא מהשיר?</span>
                <div className="segmented-control">
                  <button
                    className={viewMode === "melody" ? "active" : ""}
                    onClick={() => setViewMode("melody")}
                    type="button"
                  >
                    מנגינה ראשית
                  </button>
                  <button
                    className={viewMode === "full" ? "active" : ""}
                    onClick={() => setViewMode("full")}
                    type="button"
                  >
                    כל התווים
                  </button>
                </div>
              </label>
              <label className="setting-field range-field">
                <span>רגישות לזיהוי <b>{sensitivity}%</b></span>
                <input
                  type="range"
                  min="20"
                  max="90"
                  value={sensitivity}
                  onChange={(event) => setSensitivity(Number(event.target.value))}
                />
                <small>רגישות גבוהה מזהה יותר תווים, כולל צלילים חלשים.</small>
              </label>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          {isProcessing ? (
            <div className="processing-box">
              <div className="processing-top">
              <span><AudioWaveform size={20} /> מנתח את הצלילים והתווים…</span>
                <strong>{progress}%</strong>
              </div>
              <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>
              <small>השיר מעובד במחשב שלך ואינו מועלה לשום שרת.</small>
            </div>
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={!file}
              onClick={startTranscription}
            >
              <AudioLines size={21} />
              הפוך את השיר לתווים
              <ChevronLeft size={20} />
            </button>
          )}
        </div>
      </section>

      {notes.length > 0 && (
        <section className="results-section" ref={resultsRef}>
          <div className="results-header">
            <div>
              <div className="eyebrow"><Check size={16} /> הניתוח הושלם</div>
              <h2>התווים של „{title}”</h2>
            </div>
            <button className="secondary-button" onClick={reset} type="button">
              <RotateCcw size={17} /> שיר חדש
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card"><strong>{notes.length.toLocaleString("he-IL")}</strong><span>תווים זוהו</span></div>
            <div className="stat-card"><strong>{bpm}</strong><span>BPM משוער</span></div>
            <div className="stat-card"><strong>{Math.floor(duration / 60)}:{String(Math.round(duration % 60)).padStart(2, "0")}</strong><span>משך שנותח</span></div>
            <div className="stat-card"><strong>{grid.measureCount}</strong><span>תיבות בתצוגה</span></div>
          </div>

          <div className="result-toolbar">
            <div className="tabs" role="tablist">
              <button className={activeTab === "sheet" ? "active" : ""} onClick={() => setActiveTab("sheet")} type="button"><FileMusic size={17} /> תווים</button>
              <button className={activeTab === "piano" ? "active" : ""} onClick={() => setActiveTab("piano")} type="button"><AudioWaveform size={17} /> Piano Roll</button>
              <button className={activeTab === "notes" ? "active" : ""} onClick={() => setActiveTab("notes")} type="button"><ListMusic size={17} /> רשימת תווים</button>
            </div>
            <label className="tempo-control">
              קצב
              <input
                type="number"
                min="40"
                max="240"
                value={bpm}
                onChange={(event) => setTempoOverride(Number(event.target.value) || estimatedBpm)}
              />
              BPM
            </label>
          </div>

          <div className="result-canvas">
            {activeTab === "sheet" && <SheetMusic abc={abc} />}
            {activeTab === "piano" && <PianoRoll notes={notes} />}
            {activeTab === "notes" && (
              <div className="note-table-wrap">
                <table className="note-table">
                  <thead><tr><th>#</th><th>תו</th><th>MIDI</th><th>התחלה</th><th>משך</th><th>ביטחון</th></tr></thead>
                  <tbody>
                    {notes.slice(0, 1000).map((note, index) => (
                      <tr key={`${note.startTimeSeconds}-${note.pitchMidi}-${index}`}>
                        <td>{index + 1}</td>
                        <td>{midiName(note.pitchMidi)}</td>
                        <td>{note.pitchMidi}</td>
                        <td>{note.startTimeSeconds.toFixed(2)} שנ׳</td>
                        <td>{note.durationSeconds.toFixed(2)} שנ׳</td>
                        <td>{Math.round(note.amplitude * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="downloads-card">
            <div>
              <span className="download-icon"><Download size={23} /></span>
              <div><h3>הורדת התוצאה</h3><p>פתח בתוכנת תווים, אולפן או גיליון נתונים.</p></div>
            </div>
            <div className="download-buttons">
              <button onClick={() => download("musicxml")} type="button"><FileMusic size={17} /><span>MusicXML<small>MuseScore ותוכנות תווים</small></span></button>
              <button onClick={() => download("midi")} type="button"><Music2 size={17} /><span>MIDI<small>תוכנות אולפן ונגינה</small></span></button>
              <button onClick={() => download("abc")} type="button"><FileMusic size={17} /><span>ABC<small>קובץ תווים טקסטואלי</small></span></button>
              <button onClick={() => download("csv")} type="button"><ListMusic size={17} /><span>CSV<small>רשימת כל התווים</small></span></button>
            </div>
          </div>
        </section>
      )}

      <section className="how-it-works">
        <div className="section-heading"><span>פשוט ומהיר</span><h2>כך זה עובד</h2></div>
        <div className="process-grid">
          <div><span>01</span><UploadCloud /><h3>מעלים שיר</h3><p>בוחרים קובץ מהמחשב או גוררים אותו לחלון.</p></div>
          <div><span>02</span><AudioWaveform /><h3>המנוע מקשיב</h3><p>מודל מוזיקלי מזהה גובה, התחלה ומשך לכל צליל.</p></div>
          <div><span>03</span><FileMusic /><h3>מקבלים תווים</h3><p>צופים בתוצאה ומורידים אותה להמשך עריכה.</p></div>
        </div>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark"><Music2 size={20} /></span><span>SongToNotes</span></a>
        <p>זיהוי אוטומטי הוא נקודת פתיחה מצוינת. בהקלטות עמוסות מומלץ לעבור על התוצאה ולתקן אותה בתוכנת תווים.</p>
      </footer>
    </main>
  );
}
