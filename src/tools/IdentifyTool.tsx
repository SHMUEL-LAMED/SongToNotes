import { Disc3, ExternalLink, FileAudio, LogIn, Mic, RefreshCw, Search, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateAudioFile } from "../components/AudioPicker";
import { AiError, identifyAvailability, type Identification } from "../lib/aiApi";
import { decodeAudioFile } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { MIC_SECONDS, fileClipStarts, identifyClip, newSession, renderClip, soundStart } from "../lib/identifyClips";
import { MicRecorder, isRecordingSupported } from "../lib/record";
import { useAssistantTool } from "../lib/useAssistantTool";

/** A message shown while a further clip of the same song is tried. */
const TRYING_ANOTHER = "מנסה קטע נוסף…";

/**
 * Failures a further clip cannot fix — no account, no allowance left, the
 * service refusing the site's key or out of its own allowance. Any other
 * failure of one clip just moves on to the next, without a word.
 */
const STOP_CODES = new Set(["signed_out", "quota", "not_configured", "provider_key", "provider_busy", "session_limit"]);

/** Where the last identification came from, so "try another part" can go on from it. */
type Source = { kind: "file"; buffer: AudioBuffer; round: number } | { kind: "mic" };

/**
 * What song is this? Twenty seconds from the microphone, or up to three
 * clips of a file — its start, about 35% and about 65% — go one by one to a
 * recognition service on the server until one is recognised; back come the
 * title, the artist and where to listen. The service's key stays on the
 * server, and one identification is charged once, however many clips it took.
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
  // Every clip was tried and none was recognised: offer another part.
  const [exhausted, setExhausted] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
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

  /**
   * Sends the clips one after another, until one is recognised. A clip that
   * fails or finds nothing moves on to the next quietly; only a failure no
   * clip can fix is shown. All the clips share one session, charged once.
   */
  const lookup = async (clips: (() => Promise<Blob>)[]) => {
    setError(null);
    setResult(null);
    setExhausted(false);
    const session = newSession();
    let last: Identification | null = null;
    let answered = false;
    for (let index = 0; index < clips.length; index += 1) {
      setBusy(index === 0 ? "מזהה…" : TRYING_ANOTHER);
      try {
        const found = await identifyClip(await clips[index](), session);
        answered = true;
        last = found;
        if (found.found) {
          setResult(found);
          setHistory((current) => [found, ...current.filter((item) => item.title !== found.title || item.artist !== found.artist)].slice(0, 8));
          setBusy(null);
          return;
        }
      } catch (caught) {
        if (caught instanceof AiError && STOP_CODES.has(caught.code)) {
          setError(caught.message);
          setBusy(null);
          return;
        }
        // Any other failure of one clip: on to the next.
      }
    }
    setResult(last);
    setExhausted(true);
    if (!answered) setError("לא הצלחנו לזהות את השיר כרגע. אפשר לנסות שוב בקטע אחר.");
    setBusy(null);
  };

  const fileRound = async (buffer: AudioBuffer, round: number) => {
    setSource({ kind: "file", buffer, round });
    const starts = fileClipStarts(buffer, round);
    await lookup(starts.map((start) => () => renderClip(buffer, start)));
  };

  const startListening = async () => {
    setError(null);
    setResult(null);
    setExhausted(false);
    try {
      await recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds(recorder.elapsed);
        setLevel(recorder.level);
        if (recorder.elapsed >= MIC_SECONDS) void stopListening();
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
      const buffer = await decodeAudioFile(await blob.arrayBuffer());
      setSource({ kind: "mic" });
      // The whole recording, from where the sound starts: up to 20 seconds.
      const start = soundStart(buffer.getChannelData(0), buffer.sampleRate);
      await lookup([() => renderClip(buffer, start, MIC_SECONDS)]);
    } catch {
      setError("ההאזנה נכשלה. נסה שוב.");
      setBusy(null);
    }
  };

  /** "Try another part": the next places in the same file, or a fresh listen. */
  const tryAnother = async () => {
    if (!source) return;
    if (source.kind === "file") {
      await fileRound(source.buffer, source.round + 1);
    } else {
      await startListening();
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
    setExhausted(false);
    setBusy("מכין את הקטע…");
    setError(null);
    try {
      await fileRound(await decodeAudioFile(await file.arrayBuffer()), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "לא הצלחנו לקרוא את הקובץ.");
      setBusy(null);
    }
  };

  useAssistantTool("identify", {
    state: () =>
      `מזהה שיר: ${!user ? "הגולש לא מחובר (הזיהוי דורש חשבון)" : configured === false ? "השירות לא הופעל באתר" : recording ? `מאזין (${Math.ceil(MIC_SECONDS - seconds)} שניות נותרו)` : (busy ?? "מוכן להאזין")}${
        result ? (result.found ? `; זוהה לאחרונה: „${result.title}” של ${result.artist}${result.album ? ` (${result.album})` : ""}` : "; הניסיון האחרון לא זיהה שיר") : ""
      }.`,
    handlers: {
      "identify.listen": async ({ on }) => {
        if (!user) return { ok: false, message: "הזיהוי דורש חשבון מחובר" };
        if (on) {
          if (recording) return { ok: false, message: "כבר מאזין" };
          if (busy) return { ok: false, message: busy };
          if (!isRecordingSupported()) return { ok: false, message: "הדפדפן הזה לא תומך בהקלטה" };
          await startListening();
          return { ok: true, message: `מאזין ${MIC_SECONDS} שניות למה שמתנגן; התוצאה תופיע על המסך` };
        }
        if (!recording) return { ok: false, message: "לא מאזין כרגע" };
        await stopListening();
        return { ok: true, message: "ההאזנה נעצרה והקטע נשלח לזיהוי" };
      },
      "identify.read": () => {
        if (!result) return { ok: false, message: "עדיין לא היה זיהוי" };
        if (!result.found) return { ok: true, message: "לא זוהה שיר בניסיון האחרון", data: { found: false } };
        return {
          ok: true,
          message: `${result.title} — ${result.artist}`,
          data: { found: true, title: result.title, artist: result.artist, album: result.album, releaseDate: result.releaseDate, links: result.links },
        };
      },
    },
  });

  return (
    <section className="tool-body identify-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Disc3 size={26} />
        </span>
        <div>
          <h1>מזהה שיר</h1>
          <p>מה השיר הזה? מקליטים כמה שניות, או מעלים קובץ, ומקבלים את השם והאמן. מקובץ נבדקים עד שלושה קטעים שונים.</p>
        </div>
      </div>

      <div className="workspace-card">
        {configured === false && (
          <div className="notice-message" role="status">
            היכולת הזאת עדיין לא הופעלה באתר. מנהל האתר צריך להזין מפתח לשירות.{" "}
            <code dir="ltr">IDENTIFY_API_KEY</code>
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
              <strong>{recording ? `מאזין… ${Math.ceil(MIC_SECONDS - seconds)}` : busy ?? "האזן למה שמתנגן"}</strong>
              {recording && (
                <div className="level-meter" aria-hidden="true">
                  <div style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              )}
              {!recording && !busy && <small>כ־{MIC_SECONDS} שניות מהמיקרופון</small>}
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
        {busy === TRYING_ANOTHER && (
          <div className="notice-message" role="status" aria-live="polite">
            {TRYING_ANOTHER}
          </div>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {result && !result.found && (
          <div className="notice-message" role="status">
            {source?.kind === "file" ? "לא זוהה שיר באף אחד מהקטעים שנבדקו." : "לא זוהה שיר בהקלטה. נסה להתקרב לרמקול, או קטע עם שירה ברורה."} נותרו היום {Math.max(0, result.limit - result.used)} זיהויים.
          </div>
        )}
        {exhausted && source && !busy && !recording && (
          <button type="button" className="secondary-button identify-retry" onClick={() => void tryAnother()}>
            <RefreshCw size={16} /> נסה שוב בקטע אחר
          </button>
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
