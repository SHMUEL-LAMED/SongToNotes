import { Download, Repeat, Snail, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { changeSpeedAndPitch, channelsToBuffer } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useRenderedAudio } from "../lib/useRenderedAudio";
import { useSaveWork } from "../lib/useSaveWork";
import { encodeWav } from "../lib/wav";
import type { SavedWork } from "../lib/works";

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

const SPEED_PRESETS = [50, 65, 75, 85, 100, 115, 125];

type Props = {
  /** A saved practice version to restore the dials from; the song is asked for again. */
  initial?: SavedWork | null;
};

function readInitial(work: SavedWork | null | undefined) {
  const payload = work?.payload ?? {};
  const loop = payload.loop as { start?: unknown; end?: unknown } | null | undefined;
  return {
    speed:
      typeof payload.speed === "number" ? Math.max(40, Math.min(160, Math.round(payload.speed))) : 75,
    semitones:
      typeof payload.semitones === "number"
        ? Math.max(-12, Math.min(12, Math.round(payload.semitones)))
        : 0,
    loop:
      loop && typeof loop.start === "number" && typeof loop.end === "number" && loop.end > loop.start
        ? { start: loop.start, end: loop.end }
        : null,
  };
}

/**
 * The practice slow-downer: tempo and key as two independent dials, plus a
 * loop drawn straight on the waveform for the passage being learned.
 */
export function SpeedTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [restored] = useState(() => readInitial(initial));
  const [speed, setSpeed] = useState(restored.speed);
  const [semitones, setSemitones] = useState(restored.semitones);
  const [loop, setLoop] = useState<TrimRange>(restored.loop);
  const [cursor, setCursor] = useState(0);
  const [context] = useState(sharedContext);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  useEffect(() => () => void context?.close(), [context]);

  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  const renderKey = audio && context ? `${audio.url}-${speed}-${semitones}` : "";
  useEffect(() => resetSave(), [renderKey, resetSave]);

  const { buffer: rendered, busy } = useRenderedAudio(
    renderKey,
    () => {
      if (!audio || !context) return null;
      const channels = changeSpeedAndPitch(audio.buffer, speed / 100, semitones);
      return channelsToBuffer(context, channels, audio.buffer.sampleRate);
    },
    120,
  );

  // The loop is drawn in source time; the rendered file is stretched, so the
  // player needs the same region scaled by the speed factor.
  const playerLoop = useMemo(() => {
    if (!loop) return null;
    const factor = 100 / speed;
    return { start: loop.start * factor, end: loop.end * factor };
  }, [loop, speed]);

  const buildFile = () => {
    if (!rendered || !audio) return null;
    const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) =>
      rendered.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: rendered.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
    const suffix = `${speed}pct${semitones ? `${semitones > 0 ? "+" : ""}${semitones}st` : ""}`;
    return new File([blob], `${base}-${suffix}.wav`, { type: "audio/wav" });
  };

  const exportWav = () => {
    const file = buildFile();
    if (!file) return;
    downloadFile(file, file.name, "audio/wav");
  };

  const saveToProfile = () => {
    const file = buildFile();
    if (!file || !audio || !rendered) return Promise.resolve(null);
    const base = audio.file.name.replace(/\.[^/.]+$/, "");
    return saving.save(
      {
        kind: "speed",
        title: `${base} — ${speed}%${semitones ? ` · ${semitones > 0 ? "+" : ""}${semitones}` : ""}`,
        sourceName: audio.file.name,
        summary: { speed, semitones, duration: rendered.duration, loop },
        payload: { speed, semitones, loop },
      },
      file,
    );
  };

  useAssistantTool("speed", {
    state: () =>
      audio
        ? `מאט ומאיץ: הקובץ „${audio.file.name}” (${formatTime(audio.buffer.duration)}), מהירות ${speed}%, טון ${semitones > 0 ? "+" : ""}${semitones}, ${loop ? `לולאה ${formatTime(loop.start)}–${formatTime(loop.end)}` : "בלי לולאה"}${busy ? "; מעבד את הגרסה" : ""}.`
        : "מאט ומאיץ: לא נבחר קובץ (רק הגולש יכול לבחור קובץ מהמכשיר או להקליט).",
    handlers: {
      "speed.set": ({ speed: nextSpeed, semitones: nextSemitones }) => {
        const done: string[] = [];
        if (typeof nextSpeed === "number") {
          const clamped = Math.max(40, Math.min(160, Math.round(nextSpeed)));
          setSpeed(clamped);
          done.push(`מהירות ${clamped}%`);
        }
        if (typeof nextSemitones === "number") {
          const clamped = Math.max(-12, Math.min(12, Math.round(nextSemitones)));
          setSemitones(clamped);
          done.push(`טון ${clamped > 0 ? "+" : ""}${clamped}`);
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "speed.loop": ({ start, end }) => {
        if (!audio) return { ok: false, message: "אין קובץ" };
        if (typeof start !== "number" && typeof end !== "number") {
          setLoop(null);
          return { ok: true, message: "הלולאה בוטלה" };
        }
        const from = Math.max(0, Math.min(audio.buffer.duration, typeof start === "number" ? start : 0));
        const to = Math.max(from + 0.2, Math.min(audio.buffer.duration, typeof end === "number" ? end : audio.buffer.duration));
        setLoop({ start: from, end: to });
        return { ok: true, message: `לולאה ${formatTime(from)}–${formatTime(to)}` };
      },
      "speed.download": () => {
        if (!rendered || busy) return { ok: false, message: audio ? "הגרסה עדיין מתעבדת; נסה שוב בעוד רגע" : "אין קובץ" };
        exportWav();
        return { ok: true, message: "קובץ ה־WAV ירד" };
      },
      "speed.save": async () => {
        if (!rendered || busy) return { ok: false, message: audio ? "הגרסה עדיין מתעבדת" : "אין קובץ" };
        const saved = await saveToProfile();
        return saved ? { ok: true, message: "הגרסה נשמרה באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "speed.read": () => ({
        ok: true,
        message: audio ? `${speed}%, ${semitones} חצאי טונים` : "אין קובץ",
        data: { file: audio?.file.name ?? null, duration: audio ? Number(audio.buffer.duration.toFixed(1)) : null, speed, semitones, loop, ready: Boolean(rendered) && !busy },
      }),
    },
  });

  return (
    <section className="tool-body speed-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Snail size={26} />
        </span>
        <div>
          <h1>מאט ומאיץ</h1>
          <p>שנה את המהירות והטון של השיר.</p>
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
          onClear={() => {
            setLoop(null);
            clear();
          }}
          allowRecording
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {initial && !audio && (
          <div className="notice-message" role="status">
            פתחת „{initial.title}”. המהירות והטון שוחזרו; בחר את השיר שוב כדי
            להפיק את הגרסה מחדש.
          </div>
        )}

        {audio && peaks && (
          <>
            <Waveform
              peaks={peaks}
              duration={audio.buffer.duration}
              trim={loop}
              onTrimChange={setLoop}
              cursor={cursor * (speed / 100)}
              selectLabel="לולאה"
              clearLabel="נגן את כל השיר"
              emptyLabel="סמן קטע בגל הקול כדי לנגן אותו בלולאה"
            />

            <div className="settings-panel">
              <div className="settings-grid">
                <label className="setting-field range-field">
                  <span>
                    מהירות <b>{speed}%</b>
                  </span>
                  <input
                    type="range"
                    min={40}
                    max={160}
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                  />
                  <div className="preset-row compact" aria-label="מהירויות נפוצות">
                    {SPEED_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={speed === preset ? "active" : ""}
                        onClick={() => setSpeed(preset)}
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                </label>
                <label className="setting-field range-field">
                  <span>
                    טון <b>{semitones > 0 ? "+" : ""}{semitones} חצאי טונים</b>
                  </span>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    value={semitones}
                    onChange={(event) => setSemitones(Number(event.target.value))}
                  />
                  <small>הקצב נשאר; רק הגובה משתנה.</small>
                </label>
              </div>
            </div>

            {busy ? (
              <div className="processing-box">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> מעבד את השיר…
                  </span>
                </div>
                <div className="progress-track indeterminate">
                  <div />
                </div>
              </div>
            ) : (
              <>
                <Transport
                  buffer={rendered}
                  loop={playerLoop}
                  label={loop ? "נגן את הלולאה" : "נגן"}
                  onTime={setCursor}
                />
                {loop && (
                  <p className="table-footnote">
                    <Repeat size={14} /> הלולאה {formatTime(loop.start)}–{formatTime(loop.end)} תנוגן שוב
                    ושוב ב־{speed}% מהמהירות המקורית.
                  </p>
                )}
              </>
            )}

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>הורדת הגרסה המעובדת</h3>
                  <p>השיר במהירות ובטון שבחרת.</p>
                </div>
              </div>
              <div className="download-buttons">
                <button onClick={exportWav} type="button" disabled={!rendered || busy}>
                  <Snail size={17} />
                  <span>
                    WAV<small>{speed}% · {semitones > 0 ? "+" : ""}{semitones} חצאי טונים</small>
                  </span>
                </button>
                <ShareButton build={buildFile} title="גרסה לתרגול" />
              </div>
              <SaveButton
                state={saving.state}
                onSave={() => void saveToProfile()}
                disabled={!rendered || busy}
                message={saving.message}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
