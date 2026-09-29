import { BellRing, Download, Loader2, Mic, SlidersHorizontal, Square, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { formatTime } from "../lib/audio";
import { downloadFile, safeFilename } from "../lib/export";
import { useOfferResult } from "../lib/currentFile";
import { handOffTo } from "../lib/handoff";
import { MicRecorder, recordingExtension } from "../lib/record";
import { useAssistantTool } from "../lib/useAssistantTool";
import {
  VOICE_EFFECTS,
  VoiceFxCancelled,
  clampIntensity,
  isVoiceEffectId,
  renderVoiceEffect,
  voiceEffect,
  type VoiceEffectId,
} from "../lib/voiceFx";
import { encodeWav } from "../lib/wav";
import "./voice.css";

const SETTINGS_KEY = "musictools.voice.v1";
/** Long enough to swallow a dragged slider, short enough to feel instant on a card tap. */
const RENDER_DELAY_MS = 180;

type Intensities = Record<VoiceEffectId, number>;
type Saved = { effect: VoiceEffectId; intensities: Intensities };

function defaultIntensities(): Intensities {
  return Object.fromEntries(VOICE_EFFECTS.map((effect) => [effect.id, effect.defaultIntensity])) as Intensities;
}

/** The last effect and dial positions are a per-visitor convenience; losing them costs nothing. */
function loadSaved(): Saved {
  const fallback: Saved = { effect: "robot", intensities: defaultIntensities() };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null;
    if (!parsed) return fallback;
    const intensities = defaultIntensities();
    for (const effect of VOICE_EFFECTS) {
      const value = parsed.intensities?.[effect.id];
      if (typeof value === "number") intensities[effect.id] = clampIntensity(value);
    }
    return { effect: isVoiceEffectId(parsed.effect) ? parsed.effect : fallback.effect, intensities };
  } catch {
    return fallback;
  }
}

type Rendered = { key: string; buffer: AudioBuffer | null; error: string | null };

/**
 * The voice changer: record or upload a voice, tap an effect card, and the
 * result is rendered offline — so it can be replayed, downloaded as WAV or
 * sent on to the ringtone maker exactly as heard.
 */
export function VoiceTool() {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [saved] = useState(loadSaved);
  const [effect, setEffect] = useState<VoiceEffectId>(saved.effect);
  const [intensities, setIntensities] = useState<Intensities>(saved.intensities);
  const [rendered, setRendered] = useState<Rendered>({ key: "", buffer: null, error: null });
  const [seek, setSeek] = useState<{ time: number; key: number; play?: boolean } | null>(null);
  // Remounting the transport is the one way to stop it from outside.
  const [transportKey, setTransportKey] = useState(0);
  // The picker records on its own button; this second recorder is only for
  // the assistant, which cannot press that button.
  const [recorder] = useState(() => new MicRecorder());
  const [assistantRecording, setAssistantRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const intensity = intensities[effect];
  const current = voiceEffect(effect);
  const renderKey = audio ? `${audio.url}|${effect}|${effect === "none" ? 0 : intensity}` : "";
  const ready = Boolean(renderKey) && rendered.key === renderKey;
  const busy = Boolean(renderKey) && !ready;
  const result = ready ? rendered.buffer : null;
  const renderError = ready ? rendered.error : null;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ effect, intensities }));
    } catch {
      // Private mode or full storage: the dials simply are not remembered.
    }
  }, [effect, intensities]);

  useEffect(() => {
    if (!audio) return;
    const key = `${audio.url}|${effect}|${effect === "none" ? 0 : intensity}`;
    let cancelled = false;
    // Aborting stops the array DSP's workers, so a render the visitor has
    // already moved on from (a dragged slider, another card) stops using
    // the CPU instead of finishing unseen.
    const controller = new AbortController();
    // The delay debounces the slider.
    const timer = window.setTimeout(() => {
      renderVoiceEffect(audio.buffer, effect, intensity, controller.signal)
        .then((buffer) => {
          if (!cancelled) setRendered({ key, buffer, error: null });
        })
        .catch((caught: unknown) => {
          if (cancelled || caught instanceof VoiceFxCancelled) return;
          const reason = caught instanceof Error && caught.message ? ` ${caught.message}` : "";
          setRendered({ key, buffer: null, error: `לא הצלחנו להחיל את האפקט.${reason}` });
        });
    }, RENDER_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [audio, effect, intensity]);

  useEffect(() => () => recorder.cancel(), [recorder]);

  useEffect(() => {
    if (!assistantRecording) return;
    const timer = window.setInterval(() => setRecordSeconds(recorder.elapsed), 200);
    return () => window.clearInterval(timer);
  }, [assistantRecording, recorder]);

  const setIntensity = (value: number) =>
    setIntensities((previous) => ({ ...previous, [effect]: clampIntensity(value) }));

  const buildFile = useCallback(() => {
    if (!result || !audio) return null;
    const channels = Array.from({ length: result.numberOfChannels }, (_, index) => result.getChannelData(index));
    const blob = encodeWav({ channels, sampleRate: result.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, "")) || "voice";
    return new File([blob], `${base}-${effect}.wav`, { type: "audio/wav" });
  }, [audio, effect, result]);

  // The changed voice is what goes on to the next tool (a ringtone, say).
  useOfferResult(effect === "none" ? null : result, `${safeFilename(audio?.file.name.replace(/\.[^/.]+$/, "") ?? "") || "voice"}-${effect}.wav`, () => buildFile()!);

  const exportWav = () => {
    const file = buildFile();
    if (file) downloadFile(file, file.name, "audio/wav");
    return Boolean(file);
  };

  const sendToRingtone = () => {
    const file = buildFile();
    if (file) void handOffTo("ringtone", file, `הקול עם אפקט „${current.name}”`);
  };

  const startAssistantRecording = async () => {
    try {
      await recorder.start();
      setRecordSeconds(0);
      setAssistantRecording(true);
      return null;
    } catch (caught) {
      return caught instanceof Error && caught.name === "NotAllowedError"
        ? "לא ניתנה גישה למיקרופון"
        : "לא הצלחנו להתחיל הקלטה";
    }
  };

  const stopAssistantRecording = async () => {
    try {
      const blob = await recorder.stop();
      setAssistantRecording(false);
      if (blob.size < 1000) return "ההקלטה קצרה מדי";
      await load(new File([blob], `הקלטה.${recordingExtension(blob)}`, { type: blob.type }));
      return null;
    } catch {
      setAssistantRecording(false);
      return "ההקלטה נכשלה";
    }
  };

  useAssistantTool("voice", {
    state: () => {
      const dial = effect === "none" ? "" : ` בעוצמה ${intensity}`;
      if (assistantRecording) return `שינוי קול: מקליט מהמיקרופון (${formatTime(recordSeconds)}). אפקט „${current.name}”${dial}.`;
      if (!audio) return `שינוי קול: אין עדיין הקלטה (הגולש יכול להקליט או להעלות קובץ). האפקט שנבחר: „${current.name}”${dial}.`;
      return `שינוי קול: „${audio.file.name}” (${formatTime(audio.buffer.duration)}), אפקט „${current.name}”${dial}${busy ? "; מעבד את האפקט" : result ? "; התוצאה מוכנה" : ""}.`;
    },
    handlers: {
      "voice.effect": ({ effect: next, intensity: nextIntensity }) => {
        if (!isVoiceEffectId(next)) {
          return { ok: false, message: `אין אפקט כזה. אפשר: ${VOICE_EFFECTS.map((item) => item.id).join(", ")}` };
        }
        setEffect(next);
        if (typeof nextIntensity === "number") {
          setIntensities((previous) => ({ ...previous, [next]: clampIntensity(nextIntensity) }));
        }
        const name = voiceEffect(next).name;
        return {
          ok: true,
          message: audio ? `האפקט „${name}” נבחר ומוחל על ההקלטה` : `האפקט „${name}” נבחר; הוא יוחל כשתהיה הקלטה`,
        };
      },
      "voice.record": async ({ command }) => {
        if (command === "start") {
          if (assistantRecording) return { ok: false, message: "כבר מקליט" };
          const problem = await startAssistantRecording();
          return problem ? { ok: false, message: problem } : { ok: true, message: "ההקלטה התחילה — מדברים עכשיו" };
        }
        if (command === "stop") {
          if (!assistantRecording) return { ok: false, message: "אין הקלטה פעילה" };
          const problem = await stopAssistantRecording();
          return problem ? { ok: false, message: problem } : { ok: true, message: "ההקלטה נשמרה והאפקט מוחל עליה" };
        }
        return { ok: false, message: "צריך לציין start או stop" };
      },
      "voice.play": ({ command }) => {
        if (command === "stop") {
          // Drop the pending play request too, or the fresh transport would
          // honour it on mount and start again.
          setSeek(null);
          setTransportKey((key) => key + 1);
          return { ok: true, message: "הנגינה נעצרה" };
        }
        if (command !== "play") return { ok: false, message: "צריך לציין play או stop" };
        if (!audio) return { ok: false, message: "אין עדיין הקלטה" };
        if (!result) return { ok: false, message: "האפקט עדיין מתעבד; נסה שוב בעוד רגע" };
        setSeek({ time: 0, key: Date.now(), play: true });
        return { ok: true, message: `מנגן עם אפקט „${current.name}”` };
      },
      "voice.download": () => {
        if (!audio) return { ok: false, message: "אין עדיין הקלטה" };
        if (!result) return { ok: false, message: "האפקט עדיין מתעבד; נסה שוב בעוד רגע" };
        return exportWav() ? { ok: true, message: "קובץ ה־WAV ירד" } : { ok: false, message: "ההורדה נכשלה" };
      },
    },
  });

  return (
    <section className="tool-body voice-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Wand2 size={26} />
        </span>
        <div>
          <h1>שינוי קול</h1>
          <p>מקליטים או מעלים קול, בוחרים אפקט — ומורידים את התוצאה.</p>
        </div>
      </div>

      <div className="workspace-card">
        {assistantRecording ? (
          <div className="recording-box">
            <span className="recording-dot" />
            <div className="recording-info">
              <strong>מקליט… {formatTime(recordSeconds)}</strong>
              <small>ההקלטה נשארת במכשיר שלך.</small>
            </div>
            <div className="recording-actions">
              <button
                className="primary-button compact"
                type="button"
                onClick={() => void stopAssistantRecording().then((problem) => problem && setError(problem))}
              >
                <Square size={16} /> סיים
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  recorder.cancel();
                  setAssistantRecording(false);
                }}
              >
                <Trash2 size={16} /> בטל
              </button>
            </div>
          </div>
        ) : (
          <AudioPicker
            audio={audio}
            isLoading={isLoading}
            onPick={(file) => {
              setError(null);
              void load(file);
            }}
            onClear={clear}
            hint="הקלטה קצרה של דיבור או שירה עובדת הכי טוב"
            allowRecording
          />
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="settings-panel voice-panel">
        <div className="settings-title">
          <SlidersHorizontal size={18} /> בחרו אפקט
          {!audio && <em>האפקט יוחל ברגע שתהיה הקלטה</em>}
        </div>
        <div className="voice-effects" role="radiogroup" aria-label="אפקט קול">
          {VOICE_EFFECTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={effect === item.id}
              className={`voice-effect${effect === item.id ? " active" : ""}`}
              onClick={() => setEffect(item.id)}
            >
              <span className="voice-effect-emoji" aria-hidden="true">
                {item.emoji}
              </span>
              <strong>{item.name}</strong>
              <small>{item.blurb}</small>
            </button>
          ))}
        </div>

        <label className={`setting-field range-field voice-intensity${effect === "none" ? " is-off" : ""}`}>
          <span>
            עוצמת האפקט <b>{effect === "none" ? "—" : intensity}</b>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={effect === "none" ? 0 : intensity}
            disabled={effect === "none"}
            onChange={(event) => setIntensity(Number(event.target.value))}
            aria-label="עוצמת האפקט"
          />
          {/* The page runs right to left, and so does the slider: its minimum is on the right. */}
          <small>{effect === "none" ? "בלי אפקט — שומעים את ההקלטה כמו שהיא." : "עדין מימין, קיצוני משמאל."}</small>
        </label>
      </div>

      {audio && (
        <>
          <div className="workspace-card voice-result">
            <div className="voice-result-head">
              <span className="voice-result-emoji" aria-hidden="true">
                {current.emoji}
              </span>
              <div>
                <h3>{effect === "none" ? "ההקלטה המקורית" : `הקול עם אפקט „${current.name}”`}</h3>
                <p aria-live="polite">
                  {busy ? (
                    <span className="voice-busy">
                      <Loader2 size={15} className="spin" /> מחיל את האפקט…
                    </span>
                  ) : result ? (
                    `${formatTime(result.duration)} · מוכן להשמעה`
                  ) : (
                    ""
                  )}
                </p>
              </div>
            </div>
            {renderError && (
              <div className="error-message" role="alert">
                {renderError}
              </div>
            )}
            <Transport key={transportKey} buffer={result} seek={seek} label="נגן" />
          </div>

          <div className="downloads-card">
            <div>
              <span className="download-icon">
                <Download size={22} />
              </span>
              <div>
                <h3>הורדה ושליחה</h3>
                <p>שומרים את הקול כקובץ, משתפים או הופכים אותו לרינגטון.</p>
              </div>
            </div>
            <div className="download-buttons">
              <button type="button" onClick={exportWav} disabled={!result}>
                <Mic size={17} />
                <span>
                  WAV<small>{current.name}{effect === "none" ? "" : ` · ${intensity}`}</small>
                </span>
              </button>
              <button type="button" onClick={sendToRingtone} disabled={!result}>
                <BellRing size={17} />
                <span>
                  לרינגטון<small>חיתוך והורדה לטלפון</small>
                </span>
              </button>
              <ShareButton build={buildFile} title={`קול עם אפקט ${current.name}`} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
