import { Cpu, Download, MicVocal, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiError, separateOnServer } from "../lib/aiApi";
import { decodeAudioFile } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
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
import { useSaveWork } from "../lib/useSaveWork";
import { useSeparation } from "../lib/useSeparation";
import { encodeWav } from "../lib/wav";
import type { SavedWork } from "../lib/works";

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

type Props = {
  /**
   * A saved separation the personal area asked this tool to open. The song
   * itself was never stored, so the settings are restored and the visitor is
   * asked for the file again.
   */
  initial?: SavedWork | null;
};

function readInitial(work: SavedWork | null | undefined) {
  const payload = work?.payload ?? {};
  return {
    target: payload.target === "vocals" ? ("vocals" as const) : ("instrumental" as const),
    strength:
      typeof payload.strength === "number"
        ? Math.max(0, Math.min(100, Math.round(payload.strength)))
        : 100,
    keepBass: typeof payload.keepBass === "boolean" ? payload.keepBass : true,
  };
}

/**
 * Turns a song into a backing track, or into the voice alone.
 *
 * The fast path reads the stereo image bin by bin — see {@link ../lib/separate}
 * for why that is a different thing from subtracting one channel from the
 * other. The AI path sends the song to the site's server, where a real
 * separation network runs ({@link ../lib/aiApi}); nothing is fetched onto
 * the device. It is the only option that works on a mono recording or on a
 * mix where the singer is not centred. Until the server has a key, the same
 * network can still run in the browser, at the cost of a large download.
 */
export function VocalsTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [restored] = useState(() => readInitial(initial));
  const [target, setTarget] = useState<SeparateTarget>(restored.target);
  const [strength, setStrength] = useState(restored.strength);
  const [keepBass, setKeepBass] = useState(restored.keepBass);
  const [compare, setCompare] = useState(false);
  const [context] = useState(sharedContext);
  const { user } = useAuth();
  const separation = useSeparation(context);
  const aiAbortRef = useRef<AbortController | null>(null);
  // Set when the server has no separation key yet, so the browser path is offered.
  const [serverMissing, setServerMissing] = useState(false);
  const saving = useSaveWork();
  const resetSave = saving.reset;

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
  // The network is fetched only once the visitor has chosen the browser path:
  // it is 180MB, and the server path needs none of it.
  useEffect(() => {
    if (serverMissing) prefetchSeparationModel();
  }, [serverMissing]);

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

  // A change of settings is a different result, so the save button offers
  // to save again rather than still saying "נשמר" over a new rendering.
  useEffect(() => resetSave(), [resetSave, settingsKey, usedAi]);

  // An AI result is keyed to the settings that asked for it too, so the two
  // paths can hand their output to the same player and download button.
  const matches = rendered !== null && rendered.key === settingsKey;
  const result = matches ? rendered.buffer : null;
  const wasMono = matches ? rendered.wasMono : false;

  /** The server path: upload, wait, fetch the stem the visitor asked for. */
  const runAi = useCallback(async () => {
    if (!audio || !context) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiBusy(true);
    setAiProgress(0);
    setAiStatus("מכין את ההפרדה…");
    try {
      const stems = await separateOnServer(
        audio.file,
        decodeAudioFile,
        (message, percent) => {
          if (controller.signal.aborted) return;
          setAiStatus(message);
          if (percent !== null) setAiProgress(percent);
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const picked = target === "instrumental" ? stems.instrumental : stems.vocals;
      if (!picked) throw new AiError("provider_error", "השרת לא החזיר את הערוץ המבוקש.");
      setRendered({ key: settingsKey, buffer: picked, wasMono: false });
      setUsedAi(true);
      setAiProgress(100);
      setAiStatus(`ההפרדה הושלמה בשרת. נוצלו היום ${stems.used} מתוך ${stems.limit} שירים.`);
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (caught instanceof AiError && caught.code === "not_configured") {
        setServerMissing(true);
        setAiStatus("ההפרדה בשרת עדיין לא הופעלה. אפשר להפריד בדפדפן — זה מוריד רשת של 180MB בפעם הראשונה.");
      } else {
        setAiStatus(caught instanceof Error ? caught.message : "ההפרדה נכשלה.");
      }
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setAiBusy(false);
      }
    }
  }, [audio, context, settingsKey, target]);

  /** The browser path, offered only while the server has no key. */
  const runAiInBrowser = useCallback(async () => {
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

  const saveToProfile = () => {
    const file = buildFile();
    if (!file || !audio || !result) return;
    const base = audio.file.name.replace(/\.[^/.]+$/, "");
    void saving.save(
      {
        kind: "vocals",
        title: `${base} — ${target === "instrumental" ? "קריוקי" : "שירה בלבד"}`,
        sourceName: audio.file.name,
        summary: {
          target,
          strength,
          keepBass,
          usedAi,
          duration: result.duration,
          mono: wasMono,
        },
        payload: { target, strength, keepBass, usedAi },
      },
      file,
    );
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
        {initial && !audio && (
          <div className="notice-message" role="status">
            פתחת „{initial.title}”. ההגדרות שוחזרו; בחר את השיר שוב כדי להפיק את
            התוצאה מחדש.
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
                  <p>
                    נעשית בשרת של האתר — אין מה להוריד או להתקין, וזה עובד גם בטלפון. לוקח בדרך
                    כלל כדקה.{!user ? " צריך להתחבר לחשבון." : ""}
                  </p>
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
                {serverMissing && !aiBusy && (
                  <button className="link-button" type="button" onClick={runAiInBrowser} disabled={busy}>
                    <Cpu size={14} /> הפרד בדפדפן במקום (הורדה חד־פעמית של 180MB)
                  </button>
                )}
                {aiBusy && (
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => {
                      aiAbortRef.current?.abort();
                      aiAbortRef.current = null;
                      setAiBusy(false);
                      setAiStatus("ההפרדה בוטלה.");
                    }}
                  >
                    בטל
                  </button>
                )}
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
              <SaveButton
                state={saving.state}
                onSave={saveToProfile}
                disabled={!result || busy}
                message={saving.message}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
