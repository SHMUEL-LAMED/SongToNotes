import { Activity, Disc3, Music4, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { formatTime } from "../lib/audio";
import {
  averageLoudness,
  detectKeyFromAudio,
  detectTempoFromAudio,
  type AudioKey,
  type AudioTempo,
} from "../lib/dsp";

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const HEBREW_NAMES = ["דו", "דו♯", "רה", "רה♯", "מי", "פה", "פה♯", "סול", "סול♯", "לה", "לה♯", "סי"];

// The Camelot wheel: the notation DJs use to mix in key. Adjacent numbers and
// the same number across A/B are harmonically compatible.
const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

type Analysis = {
  tempo: AudioTempo;
  key: AudioKey;
  loudness: number;
  ms: number;
};

function keyLabel(key: AudioKey) {
  return `${NOTE_NAMES[key.tonicPitchClass]} ${key.mode === "major" ? "מז׳ור" : "מינור"}`;
}

function relativeKey(key: AudioKey): AudioKey {
  return key.mode === "major"
    ? { ...key, tonicPitchClass: (key.tonicPitchClass + 9) % 12, mode: "minor" }
    : { ...key, tonicPitchClass: (key.tonicPitchClass + 3) % 12, mode: "major" };
}

function camelot(key: AudioKey) {
  return key.mode === "major"
    ? CAMELOT_MAJOR[key.tonicPitchClass]
    : CAMELOT_MINOR[key.tonicPitchClass];
}

function confidenceLabel(value: number) {
  if (value > 0.75) return "ביטחון גבוה";
  if (value > 0.45) return "ביטחון בינוני";
  return "ביטחון נמוך";
}

export function AnalyzeTool() {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [result, setResult] = useState<{ key: string; analysis: Analysis } | null>(null);

  const analysisKey = audio?.url ?? "";
  useEffect(() => {
    if (!audio) return;
    let cancelled = false;
    // The transform is synchronous and slow; the gap lets the pending state
    // paint before it takes the thread.
    const timer = window.setTimeout(() => {
      const startedAt = performance.now();
      const tempo = detectTempoFromAudio(audio.buffer);
      const key = detectKeyFromAudio(audio.buffer);
      const loudness = averageLoudness(audio.buffer);
      if (cancelled) return;
      setResult({
        key: audio.url,
        analysis: { tempo, key, loudness, ms: performance.now() - startedAt },
      });
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audio]);

  const analysis = result && result.key === analysisKey ? result.analysis : null;
  const busy = Boolean(audio) && !analysis;

  const relative = analysis ? relativeKey(analysis.key) : null;
  const chromaMax = analysis ? Math.max(...analysis.key.chroma, 0.0001) : 1;

  return (
    <section className="tool-body analyze-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Activity size={26} />
        </span>
        <div>
          <h1>מזהה קצב וסולם</h1>
          <p>
            ניתוח מהיר של כל שיר: BPM, סולם, קוד Camelot לדי־ג׳יי ופרופיל
            הצלילים — בשניות, בלי לחכות לניתוח התווים המלא.
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
          allowRecording
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {audio && busy && (
          <div className="processing-box">
            <div className="processing-top">
              <span>
                <Activity size={18} /> מאזין לשיר…
              </span>
            </div>
            <div className="progress-track indeterminate">
              <div />
            </div>
          </div>
        )}

        {audio && analysis && !busy && (
          <>
            <div className="stats-grid analyze-stats">
              <div className="stat-card is-hero">
                <strong>{analysis.tempo.bpm ? Math.round(analysis.tempo.bpm) : "—"}</strong>
                <span>BPM · {confidenceLabel(analysis.tempo.confidence)}</span>
                {analysis.tempo.bpm > 0 && (
                  <small>
                    או {Math.round(analysis.tempo.bpm / 2)} / {Math.round(analysis.tempo.bpm * 2)}
                  </small>
                )}
              </div>
              <div className="stat-card is-hero">
                <strong>{keyLabel(analysis.key)}</strong>
                <span>
                  {HEBREW_NAMES[analysis.key.tonicPitchClass]} · {confidenceLabel(analysis.key.confidence)}
                </span>
                {relative && <small>סולם יחסי: {keyLabel(relative)}</small>}
              </div>
              <div className="stat-card">
                <strong>{camelot(analysis.key)}</strong>
                <span>
                  <Disc3 size={13} /> קוד Camelot
                </span>
              </div>
              <div className="stat-card">
                <strong>{formatTime(audio.buffer.duration)}</strong>
                <span>משך</span>
              </div>
              <div className="stat-card">
                <strong>{Math.round(analysis.loudness * 100)}%</strong>
                <span>
                  <Volume2 size={13} /> עוצמה ממוצעת
                </span>
              </div>
            </div>

            <div className="chroma-card">
              <div className="settings-title">
                <Music4 size={18} /> פרופיל הצלילים
                <em>כמה כל תו נוכח לאורך השיר</em>
              </div>
              <div className="chroma-bars" dir="ltr" role="img" aria-label="התפלגות הצלילים בשיר">
                {analysis.key.chroma.map((value, index) => {
                  const inKey =
                    (analysis.key.mode === "major"
                      ? [0, 2, 4, 5, 7, 9, 11]
                      : [0, 2, 3, 5, 7, 8, 10]
                    ).includes((index - analysis.key.tonicPitchClass + 12) % 12);
                  return (
                    <div
                      key={index}
                      className={`chroma-bar ${inKey ? "in-key" : ""} ${index === analysis.key.tonicPitchClass ? "is-tonic" : ""}`}
                    >
                      <div style={{ height: `${Math.round((value / chromaMax) * 100)}%` }} />
                      <span>{NOTE_NAMES[index]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="engine-note">
              הניתוח הסתיים ב־{(analysis.ms / 1000).toFixed(1)} שנ׳ · {audio.buffer.numberOfChannels === 1 ? "מונו" : "סטריאו"} ·{" "}
              {Math.round(audio.buffer.sampleRate / 100) / 10} kHz. לתווים מלאים של המנגינה, פתח את „שיר לתווים”.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
