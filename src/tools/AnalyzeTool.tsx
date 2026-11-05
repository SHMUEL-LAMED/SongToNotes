import { Activity, Disc3, Music4, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { formatTime } from "../lib/audio";
import {
  averageLoudness,
  detectKeyFromAudio,
  detectTempoFromAudio,
  type AudioKey,
  type AudioTempo,
} from "../lib/dsp";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";
import type { AnalyzeRequest, AnalyzeResponse } from "../workers/analyze.worker";

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

/** A saved analysis, shown again without the song it came from. */
type Restored = {
  title: string;
  sourceName: string | null;
  duration: number;
  channels: number;
  sampleRate: number;
  analysis: Analysis;
};

type Props = {
  initial?: SavedWork | null;
};

/**
 * Reads a saved analysis back into the tool's own shape. Anything the record
 * lacks — an older entry, a hand-edited one — makes the whole thing invalid
 * rather than a card with holes in it.
 */
function readInitial(work: SavedWork | null | undefined): Restored | null {
  if (!work || work.kind !== "analysis") return null;
  const payload = work.payload;
  const tempo = payload.tempo as Partial<AudioTempo> | undefined;
  const key = payload.key as Partial<AudioKey> | undefined;
  if (
    !tempo ||
    !key ||
    typeof tempo.bpm !== "number" ||
    !Number.isFinite(tempo.bpm) ||
    typeof key.tonicPitchClass !== "number" ||
    // An index into the note names: anything else renders "undefined מז׳ור".
    !Number.isInteger(key.tonicPitchClass) ||
    key.tonicPitchClass < 0 ||
    key.tonicPitchClass > 11 ||
    !Array.isArray(key.chroma) ||
    key.chroma.length !== 12
  ) {
    return null;
  }
  return {
    title: work.title,
    sourceName: work.sourceName,
    duration: typeof payload.duration === "number" ? payload.duration : 0,
    channels: typeof payload.channels === "number" ? payload.channels : 2,
    sampleRate: typeof payload.sampleRate === "number" ? payload.sampleRate : 44100,
    analysis: {
      tempo: {
        bpm: tempo.bpm,
        confidence: typeof tempo.confidence === "number" ? tempo.confidence : 0,
      } as AudioTempo,
      key: {
        tonicPitchClass: key.tonicPitchClass,
        mode: key.mode === "minor" ? "minor" : "major",
        confidence: typeof key.confidence === "number" ? key.confidence : 0,
        chroma: key.chroma.map((value) => (typeof value === "number" ? value : 0)),
      } as AudioKey,
      loudness: typeof payload.loudness === "number" ? payload.loudness : 0,
      ms: 0,
    },
  };
}

function keyLabel(key: AudioKey) {
  return `${NOTE_NAMES[key.tonicPitchClass]} ${key.mode === "major" ? "מז׳ור" : "מינור"}`;
}

/**
 * Whether any pitch was heard at all. A silent file comes back as "C major"
 * with an all-zero profile, which the page used to present — Camelot code,
 * relative key and all — as the song's key.
 */
function hasKey(key: AudioKey) {
  return key.chroma.some((value) => value > 0);
}

/** A mono copy of the song, to hand to the worker without giving up the page's own buffer. */
function monoCopy(buffer: AudioBuffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(buffer.length);
  const scale = 1 / buffer.numberOfChannels;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) mono[index] += data[index] * scale;
  }
  return mono;
}

/** The same readers on this thread, for a browser that cannot start the worker. */
function analyseHere(buffer: AudioBuffer) {
  return {
    tempo: detectTempoFromAudio(buffer),
    key: detectKeyFromAudio(buffer),
    loudness: averageLoudness(buffer),
  };
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

export function AnalyzeTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  // `analysis` is null when the reading failed, so the page can say so rather
  // than showing "listening…" forever.
  const [result, setResult] = useState<{ key: string; analysis: Analysis | null } | null>(null);
  const [restored] = useState(() => readInitial(initial));
  const saving = useSaveWork();
  const resetSave = saving.reset;

  const analysisKey = audio?.url ?? "";
  useEffect(() => {
    if (!audio) return;
    let cancelled = false;
    let worker: Worker | null = null;
    const url = audio.url;
    const startedAt = performance.now();
    const finish = (reading: Omit<Analysis, "ms"> | null) => {
      if (cancelled) return;
      setResult({ key: url, analysis: reading ? { ...reading, ms: performance.now() - startedAt } : null });
    };
    // The gap lets the pending state paint before the downmix takes the thread.
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL("../workers/analyze.worker.ts", import.meta.url), { type: "module" });
      } catch {
        worker = null;
      }
      if (!worker) {
        try {
          finish(analyseHere(audio.buffer));
        } catch {
          finish(null);
        }
        return;
      }
      const running = worker;
      running.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
        running.terminate();
        const reply = event.data;
        finish(reply.type === "done" ? { tempo: reply.tempo, key: reply.key, loudness: reply.loudness } : null);
      };
      running.onerror = (event) => {
        event.preventDefault();
        running.terminate();
        finish(null);
      };
      const mono = monoCopy(audio.buffer);
      const request: AnalyzeRequest = { mono, sampleRate: audio.buffer.sampleRate };
      running.postMessage(request, [mono.buffer]);
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // A song replaced or a page left mid-analysis: the old reading is not
      // wanted, and a worker left running would keep a core busy for nothing.
      (worker as Worker | null)?.terminate();
    };
  }, [audio]);

  useEffect(() => resetSave(), [analysisKey, resetSave]);

  const settled = result !== null && result.key === analysisKey;
  const fresh = settled ? result.analysis : null;
  const failed = Boolean(audio) && settled && !fresh;
  const busy = Boolean(audio) && !settled;
  // Until a song is picked, a restored analysis stands in for a fresh one.
  const showingSaved = !audio && restored !== null;
  const analysis = fresh ?? (showingSaved ? restored.analysis : null);
  const shownDuration = audio ? audio.buffer.duration : (restored?.duration ?? 0);
  const shownChannels = audio ? audio.buffer.numberOfChannels : (restored?.channels ?? 2);

  const keyHeard = analysis ? hasKey(analysis.key) : false;
  const relative = analysis && keyHeard ? relativeKey(analysis.key) : null;
  const shownKey = analysis && keyHeard ? keyLabel(analysis.key) : "—";
  const shownCamelot = analysis && keyHeard ? camelot(analysis.key) : "—";
  const chromaMax = analysis ? Math.max(...analysis.key.chroma, 0.0001) : 1;

  const saveAnalysis = () => {
    if (!audio || !fresh) return Promise.resolve(null);
    return saving.save({
      kind: "analysis",
      title: audio.file.name.replace(/\.[^/.]+$/, ""),
      sourceName: audio.file.name,
      summary: {
        bpm: fresh.tempo.bpm,
        keyName: hasKey(fresh.key) ? keyLabel(fresh.key) : "—",
        camelot: hasKey(fresh.key) ? camelot(fresh.key) : "—",
        loudness: fresh.loudness,
        duration: audio.buffer.duration,
      },
      payload: {
        tempo: fresh.tempo,
        key: fresh.key,
        loudness: fresh.loudness,
        duration: audio.buffer.duration,
        channels: audio.buffer.numberOfChannels,
        sampleRate: audio.buffer.sampleRate,
      },
    });
  };

  useAssistantTool("analyze", {
    state: () =>
      `מזהה קצב וסולם: ${audio ? `השיר „${audio.file.name}”` : showingSaved ? `ניתוח שמור של „${restored.title}”` : "לא נבחר שיר (רק הגולש בוחר קובץ)"}; ${
        busy
          ? "מנתח עכשיו"
          : analysis
            ? `${analysis.tempo.bpm ? `${Math.round(analysis.tempo.bpm)} BPM (${confidenceLabel(analysis.tempo.confidence)})` : "קצב לא זוהה"}, ${keyHeard ? `${shownKey} (${confidenceLabel(analysis.key.confidence)})` : "סולם לא זוהה (אין צלילים בקובץ)"}${relative ? `, סולם יחסי ${keyLabel(relative)}` : ""}${keyHeard ? `, Camelot ${shownCamelot}` : ""}, עוצמה ממוצעת ${Math.round(analysis.loudness * 100)}%, משך ${formatTime(shownDuration)}`
            : failed
              ? "הניתוח נכשל"
              : "אין ניתוח"
      }.`,
    handlers: {
      "analyze.read": () => {
        if (!analysis) return { ok: false, message: failed ? "הניתוח נכשל; אפשר לבחור את השיר שוב" : "אין ניתוח; הגולש צריך לבחור שיר" };
        return {
          ok: true,
          message: `${Math.round(analysis.tempo.bpm)} BPM, ${shownKey}`,
          data: {
            bpm: Math.round(analysis.tempo.bpm),
            bpmAlternatives: analysis.tempo.bpm > 0 ? [Math.round(analysis.tempo.bpm / 2), Math.round(analysis.tempo.bpm * 2)] : [],
            tempoConfidence: Number(analysis.tempo.confidence.toFixed(2)),
            key: keyHeard ? shownKey : null,
            keyHebrew: keyHeard ? HEBREW_NAMES[analysis.key.tonicPitchClass] : null,
            keyConfidence: Number(analysis.key.confidence.toFixed(2)),
            relativeKey: relative ? keyLabel(relative) : null,
            camelot: keyHeard ? shownCamelot : null,
            loudness: Math.round(analysis.loudness * 100),
            duration: Number(shownDuration.toFixed(1)),
            chroma: analysis.key.chroma.map((value, index) => ({ note: NOTE_NAMES[index], weight: Number(value.toFixed(3)) })),
          },
        };
      },
      "analyze.save": async () => {
        if (!audio || !fresh) return { ok: false, message: "אין ניתוח טרי לשמור" };
        const saved = await saveAnalysis();
        return saved ? { ok: true, message: "הניתוח נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
    },
  });

  return (
    <section className="tool-body analyze-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Activity size={26} />
        </span>
        <div>
          <h1>מזהה קצב וסולם</h1>
          <p>בחר שיר לזיהוי הקצב והסולם.</p>
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

        {showingSaved && (
          <div className="notice-message" role="status">
            ניתוח שמור של „{restored.title}”. בחר שיר כדי לנתח מחדש.
          </div>
        )}

        {failed && (
          <div className="error-message" role="alert">
            לא הצלחנו לנתח את השיר. אפשר לבחור אותו שוב, או קובץ אחר.
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

        {analysis && !busy && (
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
                <strong>{shownKey}</strong>
                <span>
                  {keyHeard
                    ? `${HEBREW_NAMES[analysis.key.tonicPitchClass]} · ${confidenceLabel(analysis.key.confidence)}`
                    : "לא נשמעו צלילים"}
                </span>
                {relative && <small>סולם יחסי: {keyLabel(relative)}</small>}
              </div>
              <div className="stat-card">
                <strong>{shownCamelot}</strong>
                <span>
                  <Disc3 size={13} /> קוד Camelot
                </span>
              </div>
              <div className="stat-card">
                <strong>{formatTime(shownDuration)}</strong>
                <span>משך</span>
              </div>
              <div className="stat-card">
                <strong>{Math.round(analysis.loudness * 100)}%</strong>
                <span>
                  <Volume2 size={13} /> עוצמה ממוצעת
                </span>
              </div>
            </div>

            {keyHeard && (
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
            )}

            {audio && fresh && (
              <SaveButton
                state={saving.state}
                onSave={() => void saveAnalysis()}
                label="שמור את הניתוח"
                message={saving.message}
              />
            )}

            <p className="engine-note">
              {fresh ? `הניתוח הסתיים ב־${(analysis.ms / 1000).toFixed(1)} שנ׳ · ` : ""}
              {/* No sample rate here: the decoded buffer is at the device's
                  rate, not the file's, so a 48 kHz file read as "44.1 kHz". */}
              {shownChannels === 1 ? "מונו" : "סטריאו"}. לתווים מלאים של המנגינה, פתח את „שיר לתווים”.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
