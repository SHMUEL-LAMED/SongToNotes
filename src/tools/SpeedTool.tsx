import { Download, Repeat, Snail, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { changeSpeedAndPitch, channelsToBuffer } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import { useRenderedAudio } from "../lib/useRenderedAudio";
import { encodeWav } from "../lib/wav";

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

const SPEED_PRESETS = [50, 65, 75, 85, 100, 115, 125];

/**
 * The practice slow-downer: tempo and key as two independent dials, plus a
 * loop drawn straight on the waveform for the passage being learned.
 */
export function SpeedTool() {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [speed, setSpeed] = useState(75);
  const [semitones, setSemitones] = useState(0);
  const [loop, setLoop] = useState<TrimRange>(null);
  const [cursor, setCursor] = useState(0);
  const [context] = useState(sharedContext);

  useEffect(() => () => void context?.close(), [context]);

  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  const { buffer: rendered, busy } = useRenderedAudio(
    audio && context ? `${audio.url}-${speed}-${semitones}` : "",
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
            </div>
          </>
        )}
      </div>
    </section>
  );
}
