import { Download, Pause, Play, Speech, Square, Volume2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { AiError, speakToFile } from "../lib/aiApi";
import { useAuth } from "../lib/auth";
import { downloadFile, safeFilename } from "../lib/export";
import { handOffTo } from "../lib/handoff";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";

const MAX_CHARS = 4000;
const SETTINGS_KEY = "musictools.tts.v1";

type Props = { initial?: SavedWork | null };

function languageOf(text: string) {
  return /[֐-׿]/.test(text) ? "he" : /[؀-ۿ]/.test(text) ? "ar" : "en";
}

/**
 * Text read aloud. The browser's own voices do the reading — they are part
 * of the phone or computer, nothing is fetched — with a choice of voice,
 * pace and pitch. For a recording to keep, the server's voice makes an MP3
 * (Hebrew only where the configured provider speaks it).
 */
export function TtsTool({ initial = null }: Props) {
  const { user } = useAuth();
  const [text, setText] = useState(() => (typeof initial?.payload.text === "string" ? initial.payload.text : ""));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState(() => {
    try {
      return (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as { voice?: string } | null)?.voice ?? "";
    } catch {
      return "";
    }
  });
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [spokenChars, setSpokenChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ file: File; url: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const language = languageOf(text);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, [supported]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ voice: voiceName }));
    } catch {
      // Private browsing.
    }
  }, [voiceName]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);
  useEffect(() => resetSave(), [resetSave, result]);

  // Voices for the text's language first, the rest after.
  const sorted = useMemo(() => {
    const mine = voices.filter((voice) => voice.lang.toLowerCase().startsWith(language));
    const others = voices.filter((voice) => !mine.includes(voice));
    return [...mine, ...others];
  }, [language, voices]);
  const hasLanguageVoice = sorted.some((voice) => voice.lang.toLowerCase().startsWith(language));
  const chosen = sorted.find((voice) => voice.name === voiceName) ?? sorted[0] ?? null;

  const speak = () => {
    if (!supported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.trim());
    if (chosen) utterance.voice = chosen;
    utterance.lang = chosen?.lang ?? (language === "he" ? "he-IL" : language === "ar" ? "ar" : "en-US");
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.onboundary = (event) => setSpokenChars(event.charIndex);
    utterance.onend = () => {
      setSpeaking(false);
      setPaused(false);
      setSpokenChars(0);
    };
    utterance.onerror = () => {
      setSpeaking(false);
      setPaused(false);
      setError("ההקראה נכשלה. נסה קול אחר.");
    };
    setError(null);
    setSpeaking(true);
    setPaused(false);
    window.speechSynthesis.speak(utterance);
  };

  const makeFile = async () => {
    if (!text.trim() || busy) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const file = await speakToFile(text.trim(), { speed: rate, format: "mp3", signal: controller.signal });
      if (controller.signal.aborted) return;
      const named = new File([file], `${safeFilename(text.trim().slice(0, 30) || "speech")}.mp3`, { type: file.type });
      setResult((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { file: named, url: URL.createObjectURL(named), text: text.trim() };
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof AiError || caught instanceof Error ? caught.message : "יצירת הקובץ נכשלה.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const save = () => {
    if (!result) return;
    void saving.save(
      {
        kind: "tts",
        title: result.text.slice(0, 40),
        summary: { characters: result.text.length, voice: "שרת", bytes: result.file.size },
        payload: { text: result.text },
      },
      result.file,
    );
  };

  return (
    <section className="tool-body tts-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Speech size={26} />
        </span>
        <div>
          <h1>טקסט לדיבור</h1>
          <p>מקלידים טקסט ושומעים אותו — בעברית ובשפות נוספות, בקול של המכשיר.</p>
        </div>
      </div>

      <div className="workspace-card">
        <textarea
          className="transcript-text tts-text"
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_CHARS))}
          placeholder="כתוב כאן מה להקריא…"
          rows={8}
          aria-label="הטקסט להקראה"
          dir="auto"
          maxLength={MAX_CHARS}
        />
        <div className="tts-meta">
          <span>
            {text.length}/{MAX_CHARS} תווים
          </span>
          {speaking && spokenChars > 0 && <span>מקריא… {Math.round((spokenChars / Math.max(1, text.length)) * 100)}%</span>}
        </div>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {!supported ? (
          <div className="notice-message" role="status">
            הדפדפן הזה לא תומך בהקראה. אפשר עדיין ליצור קובץ בשרת למטה.
          </div>
        ) : (
          <div className="settings-panel">
            <div className="settings-grid">
              <label className="setting-field">
                <span>
                  <Volume2 size={15} /> קול
                </span>
                <select value={chosen?.name ?? ""} onChange={(event) => setVoiceName(event.target.value)} aria-label="קול" disabled={!sorted.length}>
                  {sorted.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                  {!sorted.length && <option value="">טוען קולות…</option>}
                </select>
                <small>{hasLanguageVoice ? "הקולות של המכשיר, בשפת הטקסט קודם." : text.trim() ? "למכשיר הזה אין קול בשפת הטקסט; יישמע במבטא של קול אחר." : "הקולות מגיעים מהמכשיר — אין מה להוריד."}</small>
              </label>
              <label className="setting-field range-field">
                <span>
                  מהירות <b>{rate.toFixed(1)}×</b>
                </span>
                <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(event) => setRate(Number(event.target.value))} aria-label="מהירות" />
              </label>
              <label className="setting-field range-field">
                <span>
                  גובה <b>{pitch.toFixed(1)}</b>
                </span>
                <input type="range" min={0.5} max={2} step={0.1} value={pitch} onChange={(event) => setPitch(Number(event.target.value))} aria-label="גובה הקול" />
              </label>
            </div>
          </div>
        )}

        {supported && (
          <div className="transport">
            {!speaking ? (
              <button className="transport-button primary" type="button" onClick={speak} disabled={!text.trim()}>
                <Play size={19} /> הקרא
              </button>
            ) : (
              <button
                className="transport-button primary"
                type="button"
                onClick={() => {
                  if (paused) {
                    window.speechSynthesis.resume();
                    setPaused(false);
                  } else {
                    window.speechSynthesis.pause();
                    setPaused(true);
                  }
                }}
              >
                {paused ? <Play size={19} /> : <Pause size={19} />} {paused ? "המשך" : "השהה"}
              </button>
            )}
            <button
              className="transport-button"
              type="button"
              onClick={() => {
                window.speechSynthesis.cancel();
                setSpeaking(false);
                setPaused(false);
                setSpokenChars(0);
              }}
              disabled={!speaking}
              aria-label="עצור"
            >
              <Square size={16} />
            </button>
          </div>
        )}

        <div className="downloads-card">
          <div>
            <span className="download-icon">
              <Download size={22} />
            </span>
            <div>
              <h3>קובץ להורדה</h3>
              <p>
                הקראה שנעשית בשרת ונשמרת כ־MP3 — לשיתוף, לסרטון או לאזור האישי.
                {!user ? " צריך להתחבר לחשבון." : ""}
              </p>
            </div>
          </div>
          <div className="download-buttons">
            <button type="button" onClick={() => void makeFile()} disabled={!text.trim() || busy || !user}>
              <Wand2 size={17} />
              <span>
                {busy ? "מקליט בשרת…" : "צור MP3"}
                <small>{language === "he" ? "עברית תלויה בספק שהוגדר" : "בקול השרת"}</small>
              </span>
            </button>
            {result && (
              <>
                <button type="button" onClick={() => downloadFile(result.file, result.file.name, result.file.type)}>
                  <Download size={17} />
                  <span>
                    הורד<small>MP3</small>
                  </span>
                </button>
                <ShareButton build={() => result.file} title={result.file.name} />
                <button type="button" onClick={() => void handOffTo("convert", result.file, "ההקראה")}>
                  <Wand2 size={17} />
                  <span>
                    להמרה<small>WAV, קצב, עוצמה</small>
                  </span>
                </button>
              </>
            )}
          </div>
          {result && <audio controls src={result.url} className="convert-preview" aria-label="האזנה להקראה" />}
          <SaveButton state={saving.state} onSave={save} disabled={!result} label="שמור את ההקראה" message={saving.message} />
        </div>
      </div>
    </section>
  );
}
