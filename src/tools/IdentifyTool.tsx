import { Disc3, ExternalLink, FileAudio, LogIn, Mic, Search, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateAudioFile } from "../components/AudioPicker";
import { AiError, identifyAvailability, identifySong, type Identification } from "../lib/aiApi";
import { decodeAudioFile } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { MicRecorder, isRecordingSupported } from "../lib/record";
import { encodeWav } from "../lib/wav";

const CLIP_SECONDS = 12;
const CLIP_RATE = 16_000;

/** The middle of the file, downmixed and resampled to a small clip. */
async function clipFromFile(file: File): Promise<Blob> {
  const buffer = await decodeAudioFile(await file.arrayBuffer());
  const Offline = window.OfflineAudioContext || (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  const start = Math.max(0, Math.min(buffer.duration - CLIP_SECONDS, buffer.duration * 0.3));
  const seconds = Math.min(CLIP_SECONDS, buffer.duration);
  const offline = new Offline(1, Math.ceil(seconds * CLIP_RATE), CLIP_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0, start, seconds);
  const rendered = await offline.startRendering();
  return encodeWav({ channels: [rendered.getChannelData(0)], sampleRate: CLIP_RATE });
}

async function clipFromRecording(blob: Blob): Promise<Blob> {
  return clipFromFile(new File([blob], "clip.webm", { type: blob.type }));
}

/**
 * What song is this? A dozen seconds from the microphone, or from a file,
 * go to a recognition service on the server; back come the title, the
 * artist and where to listen. The service's key stays on the server.
 */
export function IdentifyTool() {
  const { user, signInWithGoogle } = useAuth();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recorder] = useState(() => new MicRecorder());
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Identification | null>(null);
  const [history, setHistory] = useState<Extract<Identification, { found: true }>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void identifyAvailability(controller.signal)
      .then(({ configured: ok }) => setConfigured(ok))
      .catch(() => setConfigured(null));
    return () => controller.abort();
  }, []);
  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    recorder.cancel();
  }, [recorder]);

  const lookup = async (clip: Blob) => {
    setBusy("מזהה…");
    setError(null);
    try {
      const found = await identifySong(clip);
      setResult(found);
      if (found.found) setHistory((current) => [found, ...current.filter((item) => item.title !== found.title || item.artist !== found.artist)].slice(0, 8));
    } catch (caught) {
      setError(caught instanceof AiError || caught instanceof Error ? caught.message : "הזיהוי נכשל.");
    } finally {
      setBusy(null);
    }
  };

  const startListening = async () => {
    setError(null);
    setResult(null);
    try {
      await recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds(recorder.elapsed);
        setLevel(recorder.level);
        if (recorder.elapsed >= CLIP_SECONDS) void stopListening();
      }, 100);
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "NotAllowedError" ? "לא ניתנה גישה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן." : "לא הצלחנו להתחיל להאזין.");
    }
  };

  const stopListening = async () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    try {
      const blob = await recorder.stop();
      setBusy("מכין את הקטע…");
      await lookup(await clipFromRecording(blob));
    } catch {
      setError("ההאזנה נכשלה. נסה שוב.");
      setBusy(null);
    }
  };

  const fromFile = async (file?: File | null) => {
    if (!file) return;
    const problem = validateAudioFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setResult(null);
    setBusy("מכין את הקטע…");
    setError(null);
    try {
      await lookup(await clipFromFile(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "לא הצלחנו לקרוא את הקובץ.");
      setBusy(null);
    }
  };

  return (
    <section className="tool-body identify-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Disc3 size={26} />
        </span>
        <div>
          <h1>מזהה שיר</h1>
          <p>מה השיר הזה? מקליטים כמה שניות, או מעלים קובץ, ומקבלים את השם והאמן.</p>
        </div>
      </div>

      <div className="workspace-card">
        {configured === false && (
          <div className="notice-message" role="status">
            זיהוי השירים עדיין לא הופעל באתר. מנהל האתר צריך להזין מפתח לשירות הזיהוי (IDENTIFY_API_KEY).
          </div>
        )}
        {!user ? (
          <div className="transcript-signin" role="status">
            <p>
              <LogIn size={16} /> הזיהוי נעשה בשרת — צריך להתחבר לחשבון, בחינם.
            </p>
            <button className="primary-button" type="button" onClick={() => signInWithGoogle().catch(() => setError("לא הצלחנו לפתוח את ההתחברות."))}>
              <LogIn size={20} /> התחברות עם Google
            </button>
          </div>
        ) : (
          <div className="identify-actions">
            <button type="button" className={`identify-listen ${recording ? "is-live" : ""}`} onClick={() => (recording ? void stopListening() : void startListening())} disabled={!isRecordingSupported() || busy !== null} aria-pressed={recording}>
              {recording ? <Square size={30} /> : <Mic size={30} />}
              <strong>{recording ? `מאזין… ${Math.ceil(CLIP_SECONDS - seconds)}` : busy ?? "האזן למה שמתנגן"}</strong>
              {recording && (
                <div className="level-meter" aria-hidden="true">
                  <div style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              )}
              {!recording && !busy && <small>כ־{CLIP_SECONDS} שניות מהמיקרופון</small>}
            </button>
            <label className="identify-file">
              <input ref={inputRef} type="file" accept="audio/*,video/*" className="native-file-input" onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so the same file can be chosen again after a retry.
                event.target.value = "";
                void fromFile(file);
              }} aria-label="בחר קובץ לזיהוי" disabled={busy !== null || recording} />
              <FileAudio size={18} /> או בחר קובץ
            </label>
          </div>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {result && !result.found && (
          <div className="notice-message" role="status">
            לא זוהה שיר בקטע הזה. נסה להתקרב לרמקול, או קטע עם שירה ברורה. נותרו היום {Math.max(0, result.limit - result.used)} זיהויים.
          </div>
        )}
        {result && result.found && (
          <div className="identify-result" aria-live="polite">
            {result.artwork && <img src={result.artwork} alt="" className="identify-art" />}
            <div className="identify-text">
              <span className="eyebrow-small">
                <Search size={14} /> זוהה
              </span>
              <h2 dir="auto">{result.title}</h2>
              <p dir="auto">
                {result.artist}
                {result.album ? ` · ${result.album}` : ""}
                {result.releaseDate ? ` · ${result.releaseDate.slice(0, 4)}` : ""}
              </p>
              <div className="identify-links">
                {result.links.spotify && (
                  <a href={result.links.spotify} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    Spotify <ExternalLink size={12} />
                  </a>
                )}
                {result.links.appleMusic && (
                  <a href={result.links.appleMusic} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    Apple Music <ExternalLink size={12} />
                  </a>
                )}
                {result.links.deezer && (
                  <a href={result.links.deezer} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    Deezer <ExternalLink size={12} />
                  </a>
                )}
                {result.links.song && (
                  <a href={result.links.song} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    עוד <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <small className="ai-status">
                {result.timecode ? `הקטע נמצא בדקה ${result.timecode} של השיר · ` : ""}נותרו היום {Math.max(0, result.limit - result.used)} זיהויים
              </small>
            </div>
          </div>
        )}

        {history.length > 1 && (
          <div className="identify-history">
            <span className="eyebrow-small">זוהו לאחרונה</span>
            <ul>
              {history.slice(1).map((item, index) => (
                <li key={index} dir="auto">
                  {item.title} — {item.artist}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
