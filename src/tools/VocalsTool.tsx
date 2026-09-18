import { Cpu, Download, MicVocal, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import {
  describeSeparationError,
  prefetchSeparationModel,
  separateStems,
  type SeparationProgress,
} from "../lib/stemSeparation";
import { channelsToBuffer } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import type { SeparateTarget } from "../lib/separate";
import { useSeparation } from "../lib/useSeparation";
import { encodeWav } from "../lib/wav";

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

/**
 * Turns a song into a backing track, or into the voice alone.
 *
 * The fast path reads the stereo image bin by bin — see {@link ../lib/separate}
 * for why that is a different thing from subtracting one channel from the
 * other. The AI path runs a real separation network on the device for anyone
 * whose browser can, and is the only option that works on a mono recording or
 * on a mix where the singer is not centred.
 */
export function VocalsTool() {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [target, setTarget] = useState<SeparateTarget>("instrumental");
  const [strength, setStrength] = useState(100);
  const [keepBass, setKeepBass] = useState(true);
  const [compare, setCompare] = useState(false);
  const [context] = useState(sharedContext);
  const separation = useSeparation(context);

  // The result is stored with the settings that produced it, so a stale
  // rendering is never shown next to controls that have already moved on.
  const [rendered, setRendered] = useState<{
    key: string;
    buffer: AudioBuffer;
    wasMono: boolean;
  } | null>(null);
  const [usedAi, setUsedAi] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => () => void context?.close(), [context]);
  // Fetched in the background from the moment the tool opens, so pressing
  // the AI button later does not begin with a long first-time wait.
  useEffect(() => prefetchSeparationModel(), []);

  const runFast = separation.run;
  const settingsKey = audio
    ? `${audio.url}|${target}|${strength}|${keepBass}`
    : "";

  useEffect(() => {
    if (!audio || !settingsKey) return;
    // The gap debounces a dragged slider, so passing through five values
    // still costs one separation rather than five.
    const timer = window.setTimeout(() => {
      setUsedAi(false);
      setAiStatus(null);
      void runFast(audio.buffer, {
        target,
        strength: strength / 100,
        // A voice has nothing below about 140 Hz worth keeping, and the bass
        // and kick that live down there are the last thing a backing track
        // should lose — so the band is protected when making one, and
        // discarded when isolating the singer.
        keepBelowHz: target === "instrumental" ? (keepBass ? 150 : 0) : 130,
      })
        .then((separated) =>
          setRendered({
            key: settingsKey,
            buffer: separated.buffer,
            wasMono: separated.wasMono,
          }),
        )
        .catch(() => {
          // A cancelled run belongs to settings nobody is looking at any
          // more; a failed one has already put its reason on screen.
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [audio, keepBass, runFast, settingsKey, strength, target]);

  // An AI result is keyed to the settings that asked for it too, so the two
  // paths can hand their output to the same player and download button.
  const matches = rendered !== null && rendered.key === settingsKey;
  const result = matches ? rendered.buffer : null;
  const wasMono = matches ? rendered.wasMono : false;

  const runAi = useCallback(async () => {
    if (!audio || !context) return;
    setAiBusy(true);
    setAiProgress(0);
    setAiStatus("מכין את ההפרדה…");
    try {
      const report = (progress: SeparationProgress) => {
        setAiProgress(Math.round(progress.progress * 100));
        setAiStatus(progress.message);
      };
      const stems = await separateStems(audio.buffer, report);
      const picked = target === "instrumental" ? stems.instrumental : stems.vocals;
      setRendered({
        key: settingsKey,
        buffer: channelsToBuffer(context, picked, stems.sampleRate),
        wasMono: false,
      });
      setUsedAi(true);
      setAiProgress(100);
      setAiStatus("ההפרדה הושלמה.");
    } catch (caught) {
      setAiStatus(describeSeparationError(caught));
    } finally {
      setAiBusy(false);
    }
  }, [audio, context, settingsKey, target]);

  const buildFile = () => {
    if (!result || !audio) return null;
    const channels = Array.from(
      { length: result.numberOfChannels },
      (_, index) => result.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: result.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
    return new File(
      [blob],
      `${base}-${target === "instrumental" ? "karaoke" : "vocals"}.wav`,
      { type: "audio/wav" },
    );
  };

  const exportWav = () => {
    const file = buildFile();
    if (!file) return;
    downloadFile(file, file.name, "audio/wav");
  };

  const isMono = audio ? audio.buffer.numberOfChannels < 2 : false;
  // The separator falls back to WebAssembly where WebGPU is missing and
  // resamples the song itself, so there is nothing left to gate on.
  const busy = separation.isRunning || aiBusy;

  return (
    <section className="tool-body vocals-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <MicVocal size={26} />
        </span>
        <div>
          <h1>הסרת שירה</h1>
          <p>בחר שיר והפרד בין השירה לליווי.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            setRendered(null);
            setUsedAi(false);
            setAiStatus(null);
            void load(file);
          }}
          onClear={() => {
            setRendered(null);
            clear();
          }}
          hint="קובץ סטריאו נותן את התוצאה הטובה ביותר"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {separation.error && !error && (
          <div className="error-message" role="alert">
            {separation.error}
          </div>
        )}
        {isMono && !usedAi && (
          <div className="notice-message" role="status">
            לקובץ מונו מומלץ לבחור בהפרדת AI.
          </div>
        )}

        {audio && (
          <>
            <div className="settings-panel">
              <div className="settings-grid">
                <div className="setting-field">
                  <span id="vocals-target">מה להשאיר?</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-labelledby="vocals-target"
                  >
                    <button
                      className={target === "instrumental" ? "active" : ""}
                      onClick={() => setTarget("instrumental")}
                      type="button"
                      aria-pressed={target === "instrumental"}
                    >
                      ליווי בלבד (קריוקי)
                    </button>
                    <button
                      className={target === "vocals" ? "active" : ""}
                      onClick={() => setTarget("vocals")}
                      type="button"
                      aria-pressed={target === "vocals"}
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
                  <small>הפחת את העוצמה להשארת חלק מהצליל המקורי.</small>
                </label>
                {target === "instrumental" && (
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={keepBass}
                      onChange={(event) => setKeepBass(event.target.checked)}
                    />
                    <span>שמור על הבס והתופים</span>
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

            {separation.isRunning ? (
              <div className="processing-box">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> מפריד את הצלילים…
                  </span>
                  <strong aria-live="polite">{separation.progress}%</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="התקדמות ההפרדה"
                  aria-valuenow={separation.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${separation.progress}%` }} />
                </div>
              </div>
            ) : (
              <Transport
                buffer={compare ? audio.buffer : result}
                label={
                  compare
                    ? "השמע את המקור"
                    : target === "instrumental"
                      ? "השמע את הקריוקי"
                      : "השמע את השירה"
                }
              />
            )}

            {usedAi && (
              <p className="engine-note">
                תוצאת AI. שינוי ההגדרות יחזיר להפרדה מהירה.
              </p>
            )}
            {wasMono && !usedAi && (
              <p className="engine-note is-slow">
                תוצאת ההפרדה חלקית.
              </p>
            )}

            <div className="ai-separator">
              <div className="ai-separator-head">
                <span className="tool-intro-icon">
                  <Cpu size={20} />
                </span>
                <div>
                  <h3>
                    <Sparkles size={16} /> הפרדה מלאה עם AI
                  </h3>
                  <p>ההפעלה הראשונה עשויה להימשך כמה דקות.</p>
                </div>
              </div>
              <>
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={runAi}
                  disabled={busy}
                >
                  <Sparkles size={17} />
                  {target === "instrumental"
                    ? "הפק אינסטרומנטלי עם AI"
                    : "הפק שירה בלבד עם AI"}
                </button>
                {aiBusy && (
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label="התקדמות הפרדת ה־AI"
                    aria-valuenow={aiProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div style={{ width: `${Math.max(2, aiProgress)}%` }} />
                  </div>
                )}
              </>
              {aiStatus && (
                <small className="ai-status" role="status">
                  {aiStatus}
                </small>
              )}
            </div>

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>הורדת התוצאה</h3>
                  <p>קובץ WAV.</p>
                </div>
              </div>
              <div className="download-buttons">
                <button onClick={exportWav} type="button" disabled={!result || busy}>
                  <MicVocal size={17} />
                  <span>
                    WAV
                    <small>
                      {target === "instrumental" ? "גרסת קריוקי" : "השירה בלבד"}
                    </small>
                  </span>
                </button>
                <ShareButton
                  build={buildFile}
                  title={target === "instrumental" ? "גרסת קריוקי" : "השירה בלבד"}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
