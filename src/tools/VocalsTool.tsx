import { Download, MicVocal, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { Transport } from "../components/Transport";
import { channelsToBuffer, midSideSplit, normalise, removeVocals } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import { useRenderedAudio } from "../lib/useRenderedAudio";
import { encodeWav } from "../lib/wav";

type Mode = "instrumental" | "vocals";

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

/**
 * Centre-channel cancellation. The lead vocal on almost every mix sits dead
 * centre, so subtracting what the two channels share removes most of it; the
 * bass, which sits there too, is filtered out of the subtraction and kept.
 */
export function VocalsTool() {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [mode, setMode] = useState<Mode>("instrumental");
  const [strength, setStrength] = useState(100);
  const [keepBass, setKeepBass] = useState(true);
  const [compare, setCompare] = useState(false);
  const [context] = useState(sharedContext);

  useEffect(() => () => void context?.close(), [context]);

  const { buffer: rendered, busy } = useRenderedAudio(
    audio && context ? `${audio.url}-${mode}-${strength}-${keepBass}` : "",
    () => {
      if (!audio || !context) return null;
      const amount = strength / 100;
      const channels =
        mode === "instrumental"
          ? removeVocals(audio.buffer, amount, keepBass ? 140 : 0)
          : midSideSplit(audio.buffer, amount, "centre");
      normalise(channels, 0.95);
      return channelsToBuffer(context, channels, audio.buffer.sampleRate);
    },
    60,
  );

  const exportWav = () => {
    if (!rendered || !audio) return;
    const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) =>
      rendered.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: rendered.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
    downloadFile(blob, `${base}-${mode === "instrumental" ? "karaoke" : "vocals"}.wav`, "audio/wav");
  };

  const isMono = audio ? audio.buffer.numberOfChannels < 2 : false;

  return (
    <section className="tool-body vocals-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <MicVocal size={26} />
        </span>
        <div>
          <h1>הסרת שירה</h1>
          <p>
            הופכים כל שיר לקריוקי, או משאירים רק את הקול. עובד הכי טוב על
            הקלטות סטריאו שבהן השירה במרכז — כמו רוב השירים המסחריים.
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
          hint="קובץ סטריאו נותן את התוצאה הטובה ביותר"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {isMono && (
          <div className="notice-message" role="status">
            הקובץ הזה במונו, ולכן אין הפרדה בין ערוצים — ההשפעה תהיה מוגבלת.
          </div>
        )}

        {audio && (
          <>
            <div className="settings-panel">
              <div className="settings-grid">
                <div className="setting-field">
                  <span>מה להשאיר?</span>
                  <div className="segmented-control">
                    <button
                      className={mode === "instrumental" ? "active" : ""}
                      onClick={() => setMode("instrumental")}
                      type="button"
                      aria-pressed={mode === "instrumental"}
                    >
                      ליווי בלבד (קריוקי)
                    </button>
                    <button
                      className={mode === "vocals" ? "active" : ""}
                      onClick={() => setMode("vocals")}
                      type="button"
                      aria-pressed={mode === "vocals"}
                    >
                      שירה בלבד
                    </button>
                  </div>
                </div>
                <label className="setting-field range-field">
                  <span>
                    עוצמת ההפרדה <b>{strength}%</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={strength}
                    onChange={(event) => setStrength(Number(event.target.value))}
                  />
                  <small>פחות מ־100% משאיר שמץ של השירה כהדרכה.</small>
                </label>
                {mode === "instrumental" && (
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={keepBass}
                      onChange={(event) => setKeepBass(event.target.checked)}
                    />
                    <span>שמור על הבס והתוף — הם יושבים במרכז יחד עם השירה</span>
                  </label>
                )}
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={compare}
                    onChange={(event) => setCompare(event.target.checked)}
                  />
                  <span>השווה למקור בזמן ההשמעה</span>
                </label>
              </div>
            </div>

            {busy ? (
              <div className="processing-box">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> מפריד את הערוצים…
                  </span>
                </div>
                <div className="progress-track indeterminate">
                  <div />
                </div>
              </div>
            ) : (
              <Transport
                buffer={compare ? audio.buffer : rendered}
                label={compare ? "השמע את המקור" : mode === "instrumental" ? "השמע את הקריוקי" : "השמע את השירה"}
              />
            )}

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>הורדת התוצאה</h3>
                  <p>קובץ WAV באיכות מלאה, מוכן לנגן, לשיר עליו או לערוך.</p>
                </div>
              </div>
              <div className="download-buttons">
                <button onClick={exportWav} type="button" disabled={!rendered || busy}>
                  <MicVocal size={17} />
                  <span>
                    WAV<small>{mode === "instrumental" ? "גרסת קריוקי" : "השירה בלבד"}</small>
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
