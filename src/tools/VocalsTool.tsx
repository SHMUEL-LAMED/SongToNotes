import { Cpu, Download, MicVocal, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { Transport } from "../components/Transport";
import {
  DEMUCS_SAMPLE_RATE,
  isNeuralSeparationSupported,
  separateWithDemucs,
  stemsToInstrumental,
  type NeuralProgress,
} from "../lib/demucs";
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
    setAiStatus("טוען את מנוע ההפרדה…");
    try {
      const buffer = audio.buffer;
      const left = buffer.getChannelData(0);
      const right =
        buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
      const report = (progress: NeuralProgress) => {
        setAiProgress(Math.round(progress.fraction * 100));
        setAiStatus(
          progress.stage === "downloading"
            ? `מוריד את מודל ההפרדה… ${Math.round(progress.fraction * 100)}%`
            : `מפריד שירה מכלי נגינה… ${Math.round(progress.fraction * 100)}%`,
        );
      };
      const stems = await separateWithDemucs(
        left,
        right,
        buffer.sampleRate,
        report,
      );
      const picked =
        target === "instrumental"
          ? stemsToInstrumental(stems)
          : stems.vocals;
      setRendered({
        key: settingsKey,
        buffer: channelsToBuffer(
          context,
          [picked.left, picked.right],
          buffer.sampleRate,
        ),
        wasMono: false,
      });
      setUsedAi(true);
      setAiProgress(100);
      setAiStatus("ההפרדה הושלמה.");
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "ההפרדה נכשלה.";
      setAiStatus(
        message === "Failed to fetch"
          ? "לא הצלחנו להוריד את מודל ההפרדה. בדוק את החיבור לאינטרנט ונסה שוב."
          : `ההפרדה לא הושלמה: ${message}`,
      );
    } finally {
      setAiBusy(false);
    }
  }, [audio, context, settingsKey, target]);

  const exportWav = () => {
    if (!result || !audio) return;
    const channels = Array.from(
      { length: result.numberOfChannels },
      (_, index) => result.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: result.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
    downloadFile(
      blob,
      `${base}-${target === "instrumental" ? "karaoke" : "vocals"}.wav`,
      "audio/wav",
    );
  };

  const isMono = audio ? audio.buffer.numberOfChannels < 2 : false;
  const aiAvailable = isNeuralSeparationSupported();
  const wrongRateForAi =
    audio !== null && audio.buffer.sampleRate !== DEMUCS_SAMPLE_RATE;
  const busy = separation.isRunning || aiBusy;

  return (
    <section className="tool-body vocals-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <MicVocal size={26} />
        </span>
        <div>
          <h1>הסרת שירה</h1>
          <p>
            הופכים כל שיר לקריוקי, או משאירים רק את הקול. ההפרדה המהירה בוחנת
            כל תדר בנפרד ולכן היא שומרת על הכלים שמסביב; מי שרוצה הפרדה
            אמיתית לגמרי יכול להריץ מודל AI במכשיר.
          </p>
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
            הקובץ הזה במונו, ולכן אין הפרש בין ערוצים לעבוד איתו. ההפרדה המהירה
            תיתן תוצאה חלקית בלבד —{" "}
            {aiAvailable
              ? "הפרדת ה־AI שלמטה כן מתמודדת עם מונו."
              : "הפרדת AI תעבוד כאן, אבל היא דורשת WebGPU שאינו זמין בדפדפן הזה."}
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
                  <small>פחות מ־100% משאיר שמץ של הצד השני כהדרכה.</small>
                </label>
                {target === "instrumental" && (
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
                התוצאה שלמעלה הופקה על ידי מודל ההפרדה. שינוי אחת ההגדרות יחזיר
                את ההפרדה המהירה.
              </p>
            )}
            {wasMono && !usedAi && (
              <p className="engine-note is-slow">
                הופעל מסלול המונו — התוצאה חלקית מטבעה.
              </p>
            )}

            <div className="ai-separator">
              <div className="ai-separator-head">
                <span className="tool-intro-icon">
                  <Cpu size={20} />
                </span>
                <div>
                  <h3>
                    <Sparkles size={16} /> הפרדה אמיתית עם AI
                  </h3>
                  <p>
                    מודל הפרדת מקורות שרץ במכשיר שלך ומפריד שירה, תופים, בס
                    וכלים לרצועות נפרדות. עובד גם על מונו ועל שירים שבהם השירה
                    אינה במרכז. בפעם הראשונה יורד מודל בגודל כ־170MB, ואחר כך
                    הוא נשמר בדפדפן. השיר עצמו לא נשלח לשום מקום.
                  </p>
                </div>
              </div>
              {!aiAvailable ? (
                <p className="notice-message">
                  ההפרדה הזו דורשת WebGPU, שאינו זמין בדפדפן הזה. אפשר לנסות
                  ב־Chrome או ב־Edge מעודכנים במחשב.
                </p>
              ) : wrongRateForAi ? (
                <p className="notice-message">
                  המודל עובד רק על קבצים בקצב דגימה 44.1kHz, והקובץ הזה ב־
                  {Math.round(audio.buffer.sampleRate / 100) / 10}kHz.
                </p>
              ) : (
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
                      <div style={{ width: `${aiProgress}%` }} />
                    </div>
                  )}
                </>
              )}
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
                  <p>קובץ WAV באיכות מלאה, מוכן לנגן, לשיר עליו או לערוך.</p>
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
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
