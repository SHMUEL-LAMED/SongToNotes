import {
  AudioLines,
  AudioWaveform,
  Check,
  ChevronLeft,
  Download,
  FileAudio,
  FileMusic,
  History,
  Image,
  ListMusic,
  LockKeyhole,
  Mic,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PianoRoll } from "./components/PianoRoll";
import { AccountPanel } from "./components/AccountPanel";
import { SignInScreen } from "./components/SignInScreen";
import { SheetMusic, sheetToSvg } from "./components/SheetMusic";
import { Waveform } from "./components/Waveform";
import {
  decodeAudioFile,
  formatTime,
  isAudioSupported,
  prepareAudioOverview,
  prepareForModel,
  type AudioOverview,
  type TrimRange,
} from "./lib/audio";
import { scoreToAbc } from "./lib/abc";
import { useAuth } from "./lib/auth";
import {
  downloadFile,
  notesToCsv,
  notesToMidi,
  safeFilename,
} from "./lib/export";
import { detectKey, keyName, scientificName } from "./lib/key";
import {
  saveTranscription,
  type SavedTranscription,
} from "./lib/history";
import { scoreToMusicXml } from "./lib/musicxml";
import {
  isRecordingSupported,
  MicRecorder,
  recordingExtension,
} from "./lib/record";
import { DEFAULT_REFINE, noteSpan, refineNotes } from "./lib/refine";
import { buildScore } from "./lib/score";
import { NotePlayer } from "./lib/synth";
import { alignOffset, estimateTempo } from "./lib/tempo";
import type { DetectedNote, ViewMode } from "./lib/types";
import { useTranscriber } from "./lib/useTranscriber";

type Tab = "sheet" | "piano" | "notes";

const ACCEPTED_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
  "aac",
  "opus",
  "webm",
];
const MAX_BYTES = 150 * 1024 * 1024;
const SETTINGS_KEY = "songtonotes.settings.v1";

type Settings = {
  sensitivity: number;
  harmonicCleanup: number;
  minDuration: number;
  mode: ViewMode;
  stepsPerBeat: number;
  beatsPerMeasure: number;
  transpose: number;
  withChords: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  sensitivity: 62,
  harmonicCleanup: 0.6,
  minDuration: 0.08,
  mode: "melody",
  stepsPerBeat: 4,
  beatsPerMeasure: 4,
  transpose: 0,
  withChords: true,
};

function normalizeSettings(parsed: Partial<Settings> | null | undefined): Settings {
  if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS;
  const numberInRange = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(minimum, Math.min(maximum, value))
      : fallback;
  const stepsPerBeat = [1, 2, 3, 4, 8].includes(parsed.stepsPerBeat ?? 0)
    ? (parsed.stepsPerBeat as number)
    : DEFAULT_SETTINGS.stepsPerBeat;
  const beatsPerMeasure = [2, 3, 4, 6].includes(parsed.beatsPerMeasure ?? 0)
    ? (parsed.beatsPerMeasure as number)
    : DEFAULT_SETTINGS.beatsPerMeasure;
  return {
    sensitivity: numberInRange(
      parsed.sensitivity,
      DEFAULT_SETTINGS.sensitivity,
      20,
      90,
    ),
    harmonicCleanup: numberInRange(
      parsed.harmonicCleanup,
      DEFAULT_SETTINGS.harmonicCleanup,
      0,
      1,
    ),
    minDuration: numberInRange(
      parsed.minDuration,
      DEFAULT_SETTINGS.minDuration,
      0.02,
      0.3,
    ),
    mode: parsed.mode === "full" ? "full" : "melody",
    stepsPerBeat,
    beatsPerMeasure,
    transpose: Math.round(
      numberInRange(parsed.transpose, DEFAULT_SETTINGS.transpose, -12, 12),
    ),
    withChords:
      typeof parsed.withChords === "boolean"
        ? parsed.withChords
        : DEFAULT_SETTINGS.withChords,
  };
}

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(stored) as Partial<Settings> | null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function WorkspaceApp() {
  const { user, profile, signInWithGoogle } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [historyTitle, setHistoryTitle] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<AudioOverview | null>(null);
  const [decodedBuffer, setDecodedBuffer] = useState<AudioBuffer | null>(null);
  const [trim, setTrim] = useState<TrimRange>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [rawNotes, setRawNotes] = useState<DetectedNote[]>([]);
  const [analysisOffset, setAnalysisOffset] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [bpmOverride, setBpmOverride] = useState(0);
  const [bpmDraft, setBpmDraft] = useState("");

  const [elapsed, setElapsed] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("sheet");
  const [zoom, setZoom] = useState(70);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  const [recorder] = useState(() => new MicRecorder());
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const sheetSvgRef = useRef<SVGSVGElement | null>(null);
  const playerRef = useRef<NotePlayer | null>(null);

  const transcriber = useTranscriber();
  const cancelTranscription = transcriber.cancel;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing blocks storage; the settings simply do not persist.
    }
  }, [settings]);

  useEffect(
    () => () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

  useEffect(() => () => recorder.cancel(), [recorder]);

  useEffect(() => {
    if (!transcriber.isRunning) return;
    // The counter is zeroed where the run starts, so the effect only ticks.
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed((Date.now() - startedAt) / 1000),
      250,
    );
    return () => window.clearInterval(timer);
  }, [transcriber.isRunning]);

  // ---- everything below is derived, so no control ever costs another
  // ---- inference pass ----

  const refineOptions = useMemo(
    () => ({
      ...DEFAULT_REFINE,
      // A high sensitivity keeps quieter notes; a low one keeps only the
      // notes the model was most certain about.
      minConfidence: (1 - settings.sensitivity / 100) * 0.62,
      harmonicCleanup: settings.harmonicCleanup,
      minDuration: settings.minDuration,
      mode: settings.mode,
    }),
    [settings.sensitivity, settings.harmonicCleanup, settings.minDuration, settings.mode],
  );

  const notes = useMemo(
    () => refineNotes(rawNotes, refineOptions),
    [rawNotes, refineOptions],
  );

  const detectedTempo = useMemo(() => estimateTempo(notes), [notes]);
  const tempo = useMemo(() => {
    if (!bpmOverride) return detectedTempo;
    return {
      bpm: bpmOverride,
      offset: alignOffset(notes, bpmOverride),
      fit: detectedTempo.fit,
    };
  }, [bpmOverride, detectedTempo, notes]);

  const keySignature = useMemo(() => detectKey(notes), [notes]);
  const title = file
    ? file.name.replace(/\.[^/.]+$/, "")
    : historyTitle ?? "SongToNotes";

  const score = useMemo(
    () =>
      buildScore(notes, {
        title,
        tempo,
        meter: { beats: settings.beatsPerMeasure, beatType: 4 },
        stepsPerBeat: settings.stepsPerBeat,
        mode: settings.mode,
        transpose: settings.transpose,
        key: keySignature,
      }),
    [
      notes,
      title,
      tempo,
      settings.beatsPerMeasure,
      settings.stepsPerBeat,
      settings.mode,
      settings.transpose,
      keySignature,
    ],
  );

  const abc = useMemo(
    () => scoreToAbc(score, { withChords: settings.withChords }),
    [score, settings.withChords],
  );

  const duration = useMemo(() => noteSpan(notes), [notes]);

  // ---- playback ----

  useEffect(() => {
    const player = new NotePlayer();
    player.setHandlers({
      onEnd: () => {
        setIsPlaying(false);
        setPlayhead(0);
      },
    });
    playerRef.current = player;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    playerRef.current?.load(notes, settings.transpose);
  }, [notes, settings.transpose]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const player = playerRef.current;
      if (player) setPlayhead(player.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  const togglePlayback = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !notes.length) return;
    if (player.isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      await player.play();
      setIsPlaying(true);
    }
  }, [notes.length]);

  const stopPlayback = useCallback(() => {
    playerRef.current?.stop(true);
    setIsPlaying(false);
    setPlayhead(0);
  }, []);

  const seek = useCallback((time: number) => {
    playerRef.current?.seek(time);
    setPlayhead(time);
  }, []);

  // ---- loading audio ----

  const loadAudio = useCallback(async (candidate: File) => {
    setIsPreparing(true);
    setError(null);
    setNotice(null);
    setRawNotes([]);
    setTrim(null);
    setBpmOverride(0);
    setBpmDraft("");
    setHistoryTitle(null);
    try {
      const buffer = await decodeAudioFile(await candidate.arrayBuffer());
      const info = prepareAudioOverview(buffer);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(candidate);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setDecodedBuffer(buffer);
      setPrepared(info);
      setFile(candidate);
    } catch (caughtError) {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      setAudioUrl(null);
      setFile(null);
      setDecodedBuffer(null);
      setPrepared(null);
      setError(
        caughtError instanceof Error
          ? `לא הצלחנו לפתוח את הקובץ. ${caughtError.message}`
          : "לא הצלחנו לפתוח את הקובץ.",
      );
    } finally {
      setIsPreparing(false);
    }
  }, []);

  const validateAndLoad = useCallback(
    (candidate?: File | null) => {
      if (!candidate) return;
      if (candidate.size === 0) {
        setError("קובץ האודיו ריק. יש לבחור קובץ שמכיל הקלטה.");
        return;
      }
      const extension = candidate.name.split(".").pop()?.toLowerCase() ?? "";
      const looksAudio =
        candidate.type.startsWith("audio/") ||
        ACCEPTED_EXTENSIONS.includes(extension);
      if (!looksAudio) {
        setError("יש לבחור קובץ אודיו — למשל MP3, WAV, OGG, FLAC, M4A או AAC.");
        return;
      }
      if (candidate.size > MAX_BYTES) {
        setError("הקובץ גדול מדי. הגודל המרבי הוא 150MB.");
        return;
      }
      void loadAudio(candidate);
    },
    [loadAudio],
  );

  const loadDemo = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}demo.wav`);
      if (!response.ok) throw new Error("הקובץ אינו זמין.");
      const blob = await response.blob();
      await loadAudio(new File([blob], "דוגמה.wav", { type: "audio/wav" }));
      setNotice("נטענה מנגינת דוגמה. לחץ על הכפתור כדי להפוך אותה לתווים.");
    } catch {
      setError("לא הצלחנו לטעון את קובץ הדוגמה.");
    }
  }, [loadAudio]);

  // ---- recording ----

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordSeconds(recorder.elapsed);
      setMicLevel(recorder.level);
    }, 100);
    return () => window.clearInterval(timer);
  }, [isRecording, recorder]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      await recorder.start();
      setIsRecording(true);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.name === "NotAllowedError"
          ? "לא ניתנה גישה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן."
          : "לא הצלחנו להתחיל הקלטה.",
      );
    }
  }, [recorder]);

  const finishRecording = useCallback(async () => {
    try {
      const blob = await recorder.stop();
      setIsRecording(false);
      setRecordSeconds(0);
      setMicLevel(0);
      if (blob.size < 1000) {
        setError("ההקלטה קצרה מדי. נסה שוב.");
        return;
      }
      const name = `הקלטה.${recordingExtension(blob)}`;
      await loadAudio(new File([blob], name, { type: blob.type }));
    } catch {
      setIsRecording(false);
      setError("ההקלטה נכשלה.");
    }
  }, [loadAudio, recorder]);

  const cancelRecording = useCallback(() => {
    recorder.cancel();
    setIsRecording(false);
    setRecordSeconds(0);
    setMicLevel(0);
  }, [recorder]);

  // ---- analysis ----

  const startTranscription = useCallback(async () => {
    if (!decodedBuffer || transcriber.isRunning) return;
    setError(null);
    setNotice(null);
    setElapsed(0);
    stopPlayback();
    try {
      const info = await prepareForModel(decodedBuffer, trim);
      setAnalysisOffset(info.startOffset);
      const detected = await transcriber.transcribe(info.samples);
      if (!detected.length) {
        setError(
          "לא נמצאו תווים ברורים. נסה קטע עם כלי אחד או שירה נקייה, או העלה את הרגישות.",
        );
        return;
      }
      setRawNotes(detected);
      if (user) {
        const refined = refineNotes(detected, refineOptions);
        const savedTempo = estimateTempo(refined);
        const savedKey = detectKey(refined);
        void saveTranscription({
          user_id: user.id,
          title,
          source_name: file?.name ?? null,
          note_count: refined.length,
          duration_seconds: noteSpan(refined),
          bpm: savedTempo.bpm,
          key_name: keyName(savedKey),
          analysis_offset: info.startOffset,
          raw_notes: detected,
          settings,
        })
          .then(() => {
            setHistoryRefreshToken((value) => value + 1);
            setNotice("התוצאה נשמרה אוטומטית בפרופיל שלך.");
          })
          .catch(() =>
            setNotice("התווים מוכנים, אבל לא הצלחנו לשמור אותם בהיסטוריה."),
          );
      }
      window.setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth" }),
        120,
      );
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "אירעה שגיאה.";
      if (message !== "הניתוח בוטל.") setError(message);
    }
  }, [decodedBuffer, file, refineOptions, settings, stopPlayback, title, transcriber, trim, user]);

  const reset = useCallback(() => {
    cancelTranscription();
    stopPlayback();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setAudioUrl(null);
    setFile(null);
    setHistoryTitle(null);
    setDecodedBuffer(null);
    setPrepared(null);
    setRawNotes([]);
    setTrim(null);
    setError(null);
    setNotice(null);
    setBpmOverride(0);
    setBpmDraft("");
    if (inputRef.current) inputRef.current.value = "";
  }, [cancelTranscription, stopPlayback]);

  const openSavedTranscription = useCallback(
    (item: SavedTranscription) => {
      cancelTranscription();
      stopPlayback();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      setAudioUrl(null);
      setFile(null);
      setDecodedBuffer(null);
      setPrepared(null);
      setTrim(null);
      setError(null);
      setRawNotes(Array.isArray(item.raw_notes) ? item.raw_notes : []);
      setAnalysisOffset(Number(item.analysis_offset) || 0);
      setSettings(normalizeSettings(item.settings as Partial<Settings>));
      setBpmOverride(0);
      setBpmDraft("");
      setHistoryTitle(item.title);
      setAccountOpen(false);
      setNotice("פתחת תוצאה שמורה. קובץ השמע המקורי לא נשמר מטעמי פרטיות.");
      window.setTimeout(
        () => resultsRef.current?.scrollIntoView({ behavior: "smooth" }),
        100,
      );
    },
    [cancelTranscription, stopPlayback],
  );

  // ---- downloads ----

  function download(kind: "midi" | "musicxml" | "abc" | "csv" | "svg") {
    const base = safeFilename(title);
    if (kind === "midi") {
      downloadFile(
        notesToMidi(notes, {
          bpm: tempo.bpm,
          quantized: true,
          offset: tempo.offset,
          stepsPerBeat: settings.stepsPerBeat,
          transpose: settings.transpose,
        }),
        `${base}.mid`,
        "audio/midi",
      );
    } else if (kind === "musicxml") {
      downloadFile(
        scoreToMusicXml(score),
        `${base}.musicxml`,
        "application/vnd.recordare.musicxml+xml;charset=utf-8",
      );
    } else if (kind === "abc") {
      downloadFile(abc, `${base}.abc`, "text/vnd.abc;charset=utf-8");
    } else if (kind === "csv") {
      downloadFile(
        notesToCsv(notes, keySignature, settings.transpose),
        `${base}.csv`,
        "text/csv;charset=utf-8",
      );
    } else {
      const svg = sheetToSvg(sheetSvgRef.current);
      if (!svg) {
        setError("התווים עדיין לא הוצגו. פתח את לשונית התווים ונסה שוב.");
        return;
      }
      downloadFile(svg, `${base}.svg`, "image/svg+xml;charset=utf-8");
    }
  }

  const update = useCallback(
    <K extends keyof Settings>(field: K, value: Settings[K]) => {
      setSettings((previous) => ({ ...previous, [field]: value }));
    },
    [],
  );

  const supported = isAudioSupported();
  const canRecord = isRecordingSupported();
  const hasResults = notes.length > 0;

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="SongToNotes">
          <span className="brand-mark">
            <Music2 size={22} />
          </span>
          <span>SongToNotes</span>
        </a>
        <div className="topbar-actions">
          <div className="privacy-pill">
            <LockKeyhole size={15} />
            הקובץ נשאר אצלך בדפדפן
          </div>
          {!user ? (
            <button
              className="account-button"
              type="button"
              onClick={() =>
                void signInWithGoogle().catch(() =>
                  setError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."),
                )
              }
            >
              <span><UserRound size={18} /></span>
              <span className="account-button-copy">
                <strong>התחברות</strong>
                <small><History size={12} /> לשמירת היסטוריה</small>
              </span>
            </button>
          ) : (
            <button
              className="account-button"
              type="button"
              onClick={() => setAccountOpen(true)}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span><UserRound size={18} /></span>
              )}
              <span className="account-button-copy">
                <strong>{profile?.full_name?.split(" ")[0] || "הפרופיל שלי"}</strong>
                <small><History size={12} /> היסטוריה</small>
              </span>
            </button>
          )}
        </div>
      </nav>

      <AccountPanel
        open={accountOpen}
        refreshToken={historyRefreshToken}
        onClose={() => setAccountOpen(false)}
        onOpenItem={openSavedTranscription}
      />

      <section className="hero" id="top">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="eyebrow">
          <Sparkles size={16} /> זיהוי תווים חכם
        </div>
        <h1>
          הופכים כל מנגינה
          <br />
          <span>לתווים שאפשר לעבוד איתם</span>
        </h1>
        <p>
          מעלים שיר, מקליטים זמזום או בוחרים קטע מתוך הקלטה — והמערכת מזהה את
          התווים, את הקצב ואת הסולם, ומכינה תווים, MIDI ו־MusicXML ישירות
          בדפדפן.
        </p>
        <div className="hero-points">
          <span>
            <Check size={16} /> היסטוריה אישית ושמורה
          </span>
          <span>
            <Check size={16} /> עיבוד מקומי ופרטי
          </span>
          <span>
            <Check size={16} /> האזנה לתוצאה לפני הורדה
          </span>
        </div>
      </section>

      <section className="workspace-section">
        <div className="workspace-card">
          <div className="workspace-heading">
            <div>
              <span className="step-number">1</span>
              <h2>בחר מקור שמע</h2>
              <p>
                התוצאה הטובה ביותר מתקבלת מכלי נגינה יחיד או משירה נקייה.
              </p>
            </div>
            {file && (
              <button
                className="icon-button"
                onClick={reset}
                aria-label="הסר קובץ"
                type="button"
              >
                <X size={19} />
              </button>
            )}
          </div>

          {!supported && (
            <div className="error-message" role="alert">
              הדפדפן הזה אינו תומך בעיבוד אודיו. נסה בכרום, אדג׳, ספארי או
              פיירפוקס מעודכנים.
            </div>
          )}

          {isRecording ? (
            <div className="recording-box">
              <span className="recording-dot" />
              <div className="recording-info">
                <strong>מקליט… {formatTime(recordSeconds)}</strong>
                <div className="level-meter" aria-hidden="true">
                  <div style={{ width: `${Math.round(micLevel * 100)}%` }} />
                </div>
                <small>שיר או זמזם את המנגינה. ההקלטה נשארת במכשיר שלך.</small>
              </div>
              <div className="recording-actions">
                <button
                  className="primary-button compact"
                  onClick={finishRecording}
                  type="button"
                >
                  <Square size={16} /> סיים
                </button>
                <button
                  className="secondary-button"
                  onClick={cancelRecording}
                  type="button"
                >
                  <Trash2 size={16} /> בטל
                </button>
              </div>
            </div>
          ) : !file ? (
            <>
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
                  validateAndLoad(event.dataTransfer.files[0]);
                }}
                type="button"
                disabled={isPreparing}
              >
                <span className="upload-icon">
                  <UploadCloud size={34} />
                </span>
                <strong>
                  {isPreparing ? "טוען את הקובץ…" : "גרור לכאן שיר או לחץ לבחירה"}
                </strong>
                <span>MP3, WAV, OGG, FLAC, M4A, AAC · עד 150MB</span>
              </button>
              <div className="source-alternatives">
                {canRecord && (
                  <button
                    className="secondary-button"
                    onClick={startRecording}
                    type="button"
                  >
                    <Mic size={17} /> הקלט מהמיקרופון
                  </button>
                )}
                <button
                  className="secondary-button"
                  onClick={loadDemo}
                  type="button"
                >
                  <Wand2 size={17} /> נסה מנגינת דוגמה
                </button>
              </div>
            </>
          ) : (
            <div className="selected-file">
              <span className="file-icon">
                <FileAudio size={30} />
              </span>
              <div className="file-details">
                <strong>{file.name}</strong>
                <span>
                  {formatBytes(file.size)}
                  {prepared ? ` · ${formatTime(prepared.sourceDuration)}` : ""}
                </span>
              </div>
              {audioUrl && (
                <audio
                  controls
                  src={audioUrl}
                  preload="metadata"
                  aria-label={`השמעת ${file.name}`}
                />
              )}
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,.webm,audio/*"
            hidden
            onChange={(event) => validateAndLoad(event.target.files?.[0])}
          />

          {prepared && file && (
            <Waveform
              peaks={prepared.peaks}
              duration={prepared.sourceDuration}
              trim={trim}
              onTrimChange={setTrim}
            />
          )}

          <div className="settings-panel">
            <div className="settings-title">
              <Settings2 size={18} /> הגדרות זיהוי
            </div>
            <div className="settings-grid">
              <div className="setting-field">
                <span id="mode-label">מה להוציא מהשיר?</span>
                <div
                  className="segmented-control"
                  role="group"
                  aria-labelledby="mode-label"
                >
                  <button
                    className={settings.mode === "melody" ? "active" : ""}
                    onClick={() => update("mode", "melody")}
                    aria-pressed={settings.mode === "melody"}
                    type="button"
                  >
                    מנגינה ראשית
                  </button>
                  <button
                    className={settings.mode === "full" ? "active" : ""}
                    onClick={() => update("mode", "full")}
                    aria-pressed={settings.mode === "full"}
                    type="button"
                  >
                    כל התווים
                  </button>
                </div>
              </div>
              <label className="setting-field range-field">
                <span>
                  רגישות לזיהוי <b>{settings.sensitivity}%</b>
                </span>
                <input
                  type="range"
                  min="20"
                  max="90"
                  value={settings.sensitivity}
                  onChange={(event) =>
                    update("sensitivity", Number(event.target.value))
                  }
                />
                <small>
                  רגישות גבוהה מזהה יותר תווים, כולל צלילים חלשים. אפשר לשנות
                  גם אחרי הניתוח.
                </small>
              </label>
            </div>
          </div>

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

          {transcriber.isRunning ? (
            <div className="processing-box">
              <div className="processing-top">
                <span>
                  <AudioWaveform size={20} /> מנתח את הצלילים והתווים…
                </span>
                <strong aria-live="polite">
                  {transcriber.progress}% · {formatTime(elapsed)}
                </strong>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="התקדמות ניתוח השיר"
                aria-valuenow={transcriber.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${transcriber.progress}%` }} />
              </div>
              <div className="processing-bottom">
                <small>
                  {transcriber.onMainThread
                    ? "העיבוד ברקע לא קיבל גישה לכרטיס המסך, ולכן הוא רץ ישירות בדף כדי להאיץ אותו. הדף עשוי לא להגיב עד לסיום."
                    : "העיבוד רץ ברקע במכשיר שלך — הדף נשאר זמין, והשיר לא נשלח לשום שרת."}
                </small>
                <button
                  className="secondary-button"
                  onClick={transcriber.cancel}
                  type="button"
                >
                  בטל
                </button>
              </div>
            </div>
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={!file || isPreparing || !supported}
              onClick={startTranscription}
            >
              <AudioLines size={21} />
              {trim ? "הפוך את הקטע הנבחר לתווים" : "הפוך את השיר לתווים"}
              <ChevronLeft size={20} />
            </button>
          )}
        </div>
      </section>

      {hasResults && (
        <section className="results-section" ref={resultsRef}>
          <div className="results-header">
            <div>
              <div className="eyebrow">
                <Check size={16} /> הניתוח הושלם
              </div>
              <h2>התווים של „{title}”</h2>
            </div>
            <button className="secondary-button" onClick={reset} type="button">
              <RotateCcw size={17} /> שיר חדש
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <strong>{notes.length.toLocaleString("he-IL")}</strong>
              <span>תווים בתצוגה</span>
            </div>
            <div className="stat-card">
              <strong>{Math.round(tempo.bpm)}</strong>
              <span>BPM {bpmOverride ? "ידני" : "משוער"}</span>
            </div>
            <div className="stat-card">
              <strong>{keyName(keySignature)}</strong>
              <span>סולם משוער</span>
            </div>
            <div className="stat-card">
              <strong>{formatTime(duration)}</strong>
              <span>משך שנותח</span>
            </div>
            <div className="stat-card">
              <strong>{score.measureCount}</strong>
              <span>תיבות</span>
            </div>
          </div>

          {transcriber.timings && (
            <p
              className={
                transcriber.timings.backend === "cpu"
                  ? "engine-note is-slow"
                  : "engine-note"
              }
            >
              {transcriber.timings.backend === "cpu"
                ? `הניתוח רץ על המעבד בלבד (${Math.round(transcriber.timings.infer / 1000)} שנ׳) — הדפדפן הזה לא סיפק האצת GPU בכלל. סימון קטע קצר בגל הקול יקצר את הזמן בהתאם.`
                : `הניתוח רץ בהאצת GPU והסתיים ב־${Math.round(transcriber.timings.infer / 1000)} שנ׳${transcriber.onMainThread ? " (בדף עצמו, כי העיבוד ברקע לא קיבל גישה לכרטיס המסך)" : ""}.`}
            </p>
          )}

          <div className="transport">
            <button
              className="transport-button primary"
              onClick={togglePlayback}
              type="button"
              aria-label={isPlaying ? "השהה" : "נגן את התווים שזוהו"}
            >
              {isPlaying ? <Pause size={19} /> : <Play size={19} />}
              {isPlaying ? "השהה" : "נגן את התוצאה"}
            </button>
            <button
              className="transport-button"
              onClick={stopPlayback}
              type="button"
              aria-label="עצור"
            >
              <Square size={16} />
            </button>
            <input
              className="transport-seek"
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.01}
              value={Math.min(playhead, duration)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="מיקום הנגינה"
            />
            <span className="transport-time">
              {formatTime(playhead)} / {formatTime(duration)}
            </span>
          </div>

          <div className="refine-panel">
            <div className="settings-title">
              <Wand2 size={18} /> כוונון התוצאה
              <em>כל שינוי מתעדכן מיד, בלי לנתח מחדש</em>
            </div>
            <div className="refine-grid">
              <label className="setting-field range-field">
                <span>
                  ניקוי הרמוניות{" "}
                  <b>{Math.round(settings.harmonicCleanup * 100)}%</b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(settings.harmonicCleanup * 100)}
                  onChange={(event) =>
                    update("harmonicCleanup", Number(event.target.value) / 100)
                  }
                />
                <small>מסיר צלילים עליונים שנוצרים מאותו תו.</small>
              </label>

              <label className="setting-field range-field">
                <span>
                  אורך תו מזערי <b>{Math.round(settings.minDuration * 1000)} מ״ש</b>
                </span>
                <input
                  type="range"
                  min="20"
                  max="300"
                  step="10"
                  value={Math.round(settings.minDuration * 1000)}
                  onChange={(event) =>
                    update("minDuration", Number(event.target.value) / 1000)
                  }
                />
                <small>מסנן נקישות ורעשים קצרים.</small>
              </label>

              <label className="setting-field">
                <span>רשת קוונטיזציה</span>
                <select
                  value={settings.stepsPerBeat}
                  onChange={(event) =>
                    update("stepsPerBeat", Number(event.target.value))
                  }
                >
                  <option value={1}>רבעים</option>
                  <option value={2}>שמיניות</option>
                  <option value={3}>טריולות</option>
                  <option value={4}>שש־עשרוניות</option>
                  <option value={8}>שלושים־ושתיים</option>
                </select>
                <small>רשת עדינה שומרת פרטים, גסה יותר קלה לקריאה.</small>
              </label>

              <label className="setting-field">
                <span>משקל</span>
                <select
                  value={settings.beatsPerMeasure}
                  onChange={(event) =>
                    update("beatsPerMeasure", Number(event.target.value))
                  }
                >
                  <option value={4}>4/4</option>
                  <option value={3}>3/4</option>
                  <option value={2}>2/4</option>
                  <option value={6}>6/4</option>
                </select>
              </label>

              <label className="setting-field">
                <span>קצב (BPM)</span>
                <div className="tempo-row">
                  <input
                    type="number"
                    min="40"
                    max="240"
                    value={bpmDraft || Math.round(tempo.bpm)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setBpmDraft(raw);
                      const parsed = Number(raw);
                      if (parsed >= 40 && parsed <= 240) setBpmOverride(parsed);
                    }}
                    onBlur={() => setBpmDraft("")}
                  />
                  {bpmOverride > 0 && (
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => {
                        setBpmOverride(0);
                        setBpmDraft("");
                      }}
                    >
                      חזרה לזיהוי אוטומטי
                    </button>
                  )}
                </div>
              </label>

              <label className="setting-field">
                <span>
                  טרנספוזיציה{" "}
                  <b>
                    {settings.transpose > 0 ? "+" : ""}
                    {settings.transpose}
                  </b>
                </span>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  value={settings.transpose}
                  onChange={(event) =>
                    update("transpose", Number(event.target.value))
                  }
                />
                <small>הזזת כל התווים בחצאי טונים.</small>
              </label>

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={settings.withChords}
                  onChange={(event) =>
                    update("withChords", event.target.checked)
                  }
                />
                <span>הצג סימוני אקורדים מעל התווים</span>
              </label>
            </div>
          </div>

          <div className="result-toolbar">
            <div className="tabs" role="tablist" aria-label="תצוגות התוצאה">
              <button
                role="tab"
                id="tab-sheet"
                aria-selected={activeTab === "sheet"}
                aria-controls="panel-sheet"
                className={activeTab === "sheet" ? "active" : ""}
                onClick={() => setActiveTab("sheet")}
                type="button"
              >
                <FileMusic size={17} /> תווים
              </button>
              <button
                role="tab"
                id="tab-piano"
                aria-selected={activeTab === "piano"}
                aria-controls="panel-piano"
                className={activeTab === "piano" ? "active" : ""}
                onClick={() => setActiveTab("piano")}
                type="button"
              >
                <AudioWaveform size={17} /> Piano Roll
              </button>
              <button
                role="tab"
                id="tab-notes"
                aria-selected={activeTab === "notes"}
                aria-controls="panel-notes"
                className={activeTab === "notes" ? "active" : ""}
                onClick={() => setActiveTab("notes")}
                type="button"
              >
                <ListMusic size={17} /> רשימת תווים
              </button>
            </div>
            {activeTab === "piano" && (
              <label className="tempo-control">
                תקריב
                <input
                  type="range"
                  min="24"
                  max="220"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
            )}
          </div>

          <div className="result-canvas">
            {activeTab === "sheet" && (
              <div id="panel-sheet" role="tabpanel" aria-labelledby="tab-sheet">
                <SheetMusic
                  abc={abc}
                  onRendered={(svg) => {
                    sheetSvgRef.current = svg;
                  }}
                />
              </div>
            )}
            {activeTab === "piano" && (
              <div id="panel-piano" role="tabpanel" aria-labelledby="tab-piano">
                <PianoRoll
                  notes={notes}
                  tempo={tempo}
                  meter={{ beats: settings.beatsPerMeasure, beatType: 4 }}
                  keySignature={keySignature}
                  transpose={settings.transpose}
                  playhead={playhead}
                  zoom={zoom}
                  onSeek={seek}
                />
              </div>
            )}
            {activeTab === "notes" && (
              <div
                id="panel-notes"
                role="tabpanel"
                aria-labelledby="tab-notes"
                className="note-table-wrap"
              >
                <table className="note-table">
                  <caption className="sr-only">רשימת התווים שזוהו בשיר</caption>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>תו</th>
                      <th>MIDI</th>
                      <th>התחלה</th>
                      <th>משך</th>
                      <th>ביטחון</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.slice(0, 800).map((note, index) => {
                      const midi = note.midi + settings.transpose;
                      return (
                        <tr key={`${note.start}-${midi}-${index}`}>
                          <td>{index + 1}</td>
                          <td>{scientificName(midi, keySignature.fifths)}</td>
                          <td>{midi}</td>
                          <td>
                            {(note.start + analysisOffset).toFixed(2)} שנ׳
                          </td>
                          <td>{note.duration.toFixed(2)} שנ׳</td>
                          <td>{Math.round(note.confidence * 100)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {notes.length > 800 && (
                  <p className="table-footnote">
                    מוצגים 800 התווים הראשונים מתוך{" "}
                    {notes.length.toLocaleString("he-IL")}. קובץ ה־CSV מכיל את
                    כולם.
                  </p>
                )}
              </div>
            )}
          </div>

          {score.truncated && (
            <p className="table-footnote">
              השיר ארוך מהתצוגה המרבית, והתווים נחתכו בסוף. אפשר לסמן קטע קצר
              יותר בגל הקול לקבלת תווים מלאים.
            </p>
          )}

          <div className="downloads-card">
            <div>
              <span className="download-icon">
                <Download size={23} />
              </span>
              <div>
                <h3>הורדת התוצאה</h3>
                <p>פתח בתוכנת תווים, אולפן או גיליון נתונים.</p>
              </div>
            </div>
            <div className="download-buttons">
              <button onClick={() => download("musicxml")} type="button">
                <FileMusic size={17} />
                <span>
                  MusicXML<small>MuseScore ותוכנות תווים</small>
                </span>
              </button>
              <button onClick={() => download("midi")} type="button">
                <Music2 size={17} />
                <span>
                  MIDI<small>תוכנות אולפן ונגינה</small>
                </span>
              </button>
              <button onClick={() => download("svg")} type="button">
                <Image size={17} />
                <span>
                  תמונת תווים<small>SVG להדפסה ולשיתוף</small>
                </span>
              </button>
              <button onClick={() => download("abc")} type="button">
                <FileMusic size={17} />
                <span>
                  ABC<small>קובץ תווים טקסטואלי</small>
                </span>
              </button>
              <button onClick={() => download("csv")} type="button">
                <ListMusic size={17} />
                <span>
                  CSV<small>רשימת כל התווים</small>
                </span>
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="how-it-works">
        <div className="section-heading">
          <span>פשוט ומהיר</span>
          <h2>כך זה עובד</h2>
        </div>
        <div className="process-grid">
          <div>
            <span>01</span>
            <UploadCloud />
            <h3>מעלים או מקליטים</h3>
            <p>
              בוחרים קובץ, גוררים אותו לחלון או מזמזמים ישירות למיקרופון.
            </p>
          </div>
          <div>
            <span>02</span>
            <AudioWaveform />
            <h3>המנוע מקשיב</h3>
            <p>
              מודל מוזיקלי מזהה גובה, התחלה ומשך לכל צליל, ומעריך קצב וסולם.
            </p>
          </div>
          <div>
            <span>03</span>
            <FileMusic />
            <h3>מכווננים ומורידים</h3>
            <p>
              מאזינים לתוצאה, מכווננים אותה בזמן אמת ומורידים להמשך עריכה.
            </p>
          </div>
        </div>
      </section>

      <footer>
        <a className="brand" href="#top">
          <span className="brand-mark">
            <Music2 size={20} />
          </span>
          <span>SongToNotes</span>
        </a>
        <p>
          זיהוי אוטומטי הוא נקודת פתיחה מצוינת. בהקלטות עמוסות מומלץ לעבור על
          התוצאה ולתקן אותה בתוכנת תווים — קובץ MusicXML נועד בדיוק לכך.
        </p>
      </footer>
    </main>
  );
}

export default function App() {
  const { user, loading, guest } = useAuth();

  if (loading) {
    return (
      <main className="auth-screen">
        <div className="auth-loading" role="status">
          <span className="brand-mark"><Music2 size={22} /></span>
          <strong>טוען את החשבון שלך…</strong>
        </div>
      </main>
    );
  }

  return user || guest ? <WorkspaceApp /> : <SignInScreen />;
}
