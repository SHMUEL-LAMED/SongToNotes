import { AudioLines, Captions, Download, FileAudio, ScanSearch, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile, type LoadedAudio } from "../components/AudioPicker";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import {
  DEFAULT_DENOISE_SETTINGS,
  denoiseChannels,
  findQuietestRegion,
  removedPart,
  sanitiseSettings,
  type DenoiseRequest,
  type DenoiseResponse,
  type DenoiseResult,
  type DenoiseSettings,
  type HumSetting,
  type NoiseSource,
  type TimeRegion,
} from "../lib/denoise";
import type { ActionOutcome } from "../lib/assistantActions";
import { downloadFile, safeFilename } from "../lib/export";
import { handOffTo } from "../lib/handoff";
import { useAssistantTool } from "../lib/useAssistantTool";
import { encodeWav } from "../lib/wav";
import "./denoise.css";

const SETTINGS_KEY = "musictools.denoise.v1";
/** Shorter than this and the noise profile is mostly guesswork. */
const MIN_REGION = 0.1;

type SourceKind = NoiseSource["kind"];
type Listen = "before" | "after" | "removed";

type CleanResult = {
  /** The file this result belongs to; a new file makes it stale without an effect. */
  audioUrl: string;
  /** The settings it was made with, to tell when they have changed since. */
  key: string;
  cleaned: AudioBuffer;
  region: TimeRegion;
  clicks: number;
  reductionDb: number | null;
  seconds: number;
};

const HUM_OPTIONS: { value: HumSetting; label: string }[] = [
  { value: "off", label: "כבוי" },
  { value: "50", label: "50 הרץ" },
  { value: "60", label: "60 הרץ" },
];

const LISTEN_OPTIONS: { value: Listen; label: string }[] = [
  { value: "before", label: "לפני" },
  { value: "after", label: "אחרי" },
  { value: "removed", label: "מה הוסר" },
];

/** m:ss.t — a noise region is often under a second, which whole seconds would show as 0:00–0:00. */
function preciseTime(seconds: number) {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

function readSettings(): DenoiseSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? sanitiseSettings(JSON.parse(raw) as Partial<DenoiseSettings>) : { ...DEFAULT_DENOISE_SETTINGS };
  } catch {
    return { ...DEFAULT_DENOISE_SETTINGS };
  }
}

function toBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const buffer = new AudioBuffer({
    numberOfChannels: Math.max(1, channels.length),
    length: Math.max(1, channels[0]?.length ?? 1),
    sampleRate,
  });
  channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
  return buffer;
}

function copyChannels(buffer: AudioBuffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
}

class Cancelled extends Error {}

/**
 * Runs the clean-up on a worker, so a long file keeps the page responsive and
 * the progress bar moving. If the worker cannot start (an old browser, a
 * blocked module) the same code runs on the page instead — slower to live
 * with, but the result is identical.
 */
function startDenoise(
  buffer: AudioBuffer,
  settings: DenoiseSettings,
  source: NoiseSource,
  onProgress: (fraction: number) => void,
): { promise: Promise<DenoiseResult>; cancel: () => void } {
  let worker: Worker | null = null;
  let cancelled = false;
  let rejectJob: (reason: unknown) => void = () => undefined;

  const runHere = () =>
    new Promise<DenoiseResult>((resolve, reject) => {
      // A beat for the progress box to paint before the page is busy.
      window.setTimeout(() => {
        if (cancelled) return reject(new Cancelled());
        try {
          resolve(denoiseChannels(copyChannels(buffer), buffer.sampleRate, settings, source, onProgress));
        } catch (caught) {
          reject(caught);
        }
      }, 40);
    });

  const promise = new Promise<DenoiseResult>((resolve, reject) => {
    rejectJob = reject;
    try {
      worker = new Worker(new URL("../workers/denoise.worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker = null;
    }
    if (!worker) {
      runHere().then(resolve, reject);
      return;
    }
    const jobId = Date.now();
    let heard = false;
    worker.onmessage = (event: MessageEvent<DenoiseResponse>) => {
      const message = event.data;
      if (message.jobId !== jobId) return;
      heard = true;
      if (message.type === "progress") {
        onProgress(message.fraction);
        return;
      }
      worker?.terminate();
      worker = null;
      if (message.type === "done") resolve(message.result);
      else reject(new Error(message.message));
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (cancelled) return;
      // A worker that failed before saying anything most likely never
      // loaded; the page can still do the work itself.
      if (!heard) runHere().then(resolve, reject);
      else reject(new Error("הניקוי נעצר באמצע. נסו שוב."));
    };
    const channels = copyChannels(buffer);
    const request: DenoiseRequest = { jobId, channels, sampleRate: buffer.sampleRate, settings, source };
    worker.postMessage(request, channels.map((channel) => channel.buffer));
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker?.terminate();
      worker = null;
      rejectJob(new Cancelled());
    },
  };
}

/**
 * Noise reduction: a spectral gate learned from the quietest stretch of the
 * recording (or from one the visitor marks), mains-hum notches, a
 * de-clicker and a rumble filter — with a before/after switch to hear what
 * changed and what was taken out.
 */
export function DenoiseTool() {
  const { audio, error, setError, isLoading, progress, load, clear, maxBytes } = useAudioFile();
  const [settings, setSettings] = useState<DenoiseSettings>(readSettings);
  const [sourceKind, setSourceKind] = useState<SourceKind>("auto");
  const [trim, setTrim] = useState<TrimRange>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [rawResult, setResult] = useState<CleanResult | null>(null);
  const [listen, setListen] = useState<Listen>("before");
  const [cursor, setCursor] = useState<number | null>(null);
  const jobRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Private mode: the settings simply are not remembered.
    }
  }, [settings]);

  useEffect(() => () => jobRef.current?.cancel(), []);

  const result = rawResult && audio && rawResult.audioUrl === audio.url ? rawResult : null;
  const regionKey = sourceKind === "region" && trim ? `${trim.start.toFixed(2)}-${trim.end.toFixed(2)}` : "auto";
  const settingsKey = `${settings.strength}|${settings.hum}|${settings.declick}|${settings.highpass}|${regionKey}`;
  const stale = Boolean(result && result.key !== settingsKey);
  const mode: Listen = result ? listen : "before";

  // "What was removed" is only built while it is being listened to: it is a
  // third full copy of the audio, which a long file cannot always afford.
  const removedBuffer = useMemo(() => {
    if (!result || !audio || mode !== "removed") return null;
    const original = Array.from({ length: audio.buffer.numberOfChannels }, (_, index) => audio.buffer.getChannelData(index));
    const cleaned = Array.from({ length: result.cleaned.numberOfChannels }, (_, index) => result.cleaned.getChannelData(index));
    return toBuffer(removedPart(original, cleaned), audio.buffer.sampleRate);
  }, [audio, mode, result]);

  const playing: AudioBuffer | null = !audio
    ? null
    : mode === "after" && result
      ? result.cleaned
      : mode === "removed" && removedBuffer
        ? removedBuffer
        : audio.buffer;
  const peaks = useMemo(() => (playing ? buildPeaks(playing) : null), [playing]);

  const resetForFile = () => {
    jobRef.current?.cancel();
    jobRef.current = null;
    setBusy(null);
    setTrim(null);
    setSourceKind("auto");
    setResult(null);
    setRunError(null);
    setListen("before");
    setCursor(null);
  };

  const changeTrim = (next: TrimRange) => {
    setTrim(next);
    // Marking a stretch is itself the request to learn from it; clearing the
    // mark goes back to finding the quiet part automatically.
    setSourceKind(next ? "region" : "auto");
  };

  const markQuietest = useCallback(
    (target: LoadedAudio) => {
      const channels = Array.from({ length: target.buffer.numberOfChannels }, (_, index) => target.buffer.getChannelData(index));
      const region = findQuietestRegion(channels, target.buffer.sampleRate);
      setTrim(region);
      setSourceKind("region");
    },
    [],
  );

  const run = useCallback(async (): Promise<ActionOutcome> => {
    if (!audio) return { ok: false, message: "לא נבחר קובץ; רק הגולש יכול לבחור קובץ" };
    if (jobRef.current) return { ok: false, message: "הניקוי כבר רץ" };
    let source: NoiseSource = { kind: "auto" };
    if (sourceKind === "region") {
      if (!trim || trim.end - trim.start < MIN_REGION) {
        const message = "הקטע המסומן קצר מדי. סמנו בגל הקול לפחות חצי שנייה שיש בה רק רעש.";
        setRunError(message);
        return { ok: false, message };
      }
      source = { kind: "region", start: trim.start, end: trim.end };
    }
    setRunError(null);
    setBusy(0);
    const started = performance.now();
    const job = startDenoise(audio.buffer, settings, source, (fraction) => setBusy(fraction));
    jobRef.current = job;
    try {
      const outcome = await job.promise;
      const cleaned = toBuffer(outcome.channels, audio.buffer.sampleRate);
      const seconds = (performance.now() - started) / 1000;
      setResult({
        audioUrl: audio.url,
        key: settingsKey,
        cleaned,
        region: outcome.region,
        clicks: outcome.clicks,
        reductionDb: outcome.reductionDb,
        seconds,
      });
      setListen("after");
      const parts = ["ההקלטה נוקתה"];
      if (outcome.reductionDb !== null && settings.strength > 0) parts.push(`רעש הרקע ירד בכ־${Math.round(outcome.reductionDb)} dB`);
      if (settings.declick) parts.push(`תוקנו ${outcome.clicks} קליקים`);
      return {
        ok: true,
        message: parts.join("; "),
        data: { reductionDb: outcome.reductionDb, clicks: outcome.clicks, region: outcome.region, seconds },
      };
    } catch (caught) {
      if (caught instanceof Cancelled) return { ok: false, message: "הניקוי בוטל" };
      const message = caught instanceof Error && caught.message ? caught.message : "הניקוי נכשל. נסו שוב.";
      setRunError(message);
      return { ok: false, message };
    } finally {
      if (jobRef.current === job) jobRef.current = null;
      setBusy(null);
    }
  }, [audio, settings, settingsKey, sourceKind, trim]);

  const buildFile = useCallback(() => {
    if (!result || !audio) return null;
    const { cleaned } = result;
    const channels = Array.from({ length: cleaned.numberOfChannels }, (_, index) => cleaned.getChannelData(index));
    const blob = encodeWav({ channels, sampleRate: cleaned.sampleRate });
    return new File([blob], `${safeFilename(audio.file.name)}-clean.wav`, { type: "audio/wav" });
  }, [audio, result]);

  const download = useCallback((): ActionOutcome => {
    const file = buildFile();
    if (!file) return { ok: false, message: "אין עדיין הקלטה נקייה; קודם מריצים ניקוי" };
    downloadFile(file, file.name, "audio/wav");
    return { ok: true, message: `הקובץ ${file.name} ירד` };
  }, [buildFile]);

  useAssistantTool("denoise", {
    state: () => {
      const parts = [
        `ניקוי רעשים: ${audio ? `הקובץ ${audio.file.name} (${formatTime(audio.buffer.duration)})` : "לא נבחר קובץ (רק הגולש בוחר קובץ)"}.`,
        `הגדרות: עוצמה ${settings.strength}%, זמזום ${settings.hum === "off" ? "כבוי" : `${settings.hum} הרץ`}, הסרת קליקים ${settings.declick ? "פעילה" : "כבויה"}, סינון נמוכים ${settings.highpass ? "פעיל" : "כבוי"}.`,
        `לימוד הרעש: ${sourceKind === "region" && trim ? `מהקטע ${preciseTime(trim.start)}–${preciseTime(trim.end)}` : "אוטומטי מהקטע השקט ביותר"}.`,
      ];
      if (busy !== null) parts.push(`מנקה… ${Math.round(busy * 100)}%.`);
      if (result) parts.push(`יש תוצאה${stale ? " (מהגדרות קודמות)" : ""}${result.reductionDb !== null ? `, הרעש ירד בכ־${Math.round(result.reductionDb)} dB` : ""}.`);
      return parts.join(" ");
    },
    handlers: {
      "denoise.set": (params) => {
        const next: Partial<Record<keyof DenoiseSettings, unknown>> = { ...settings };
        if (params.strength !== undefined) {
          const value = Number(params.strength);
          if (!Number.isFinite(value)) return { ok: false, message: "העוצמה צריכה להיות מספר בין 0 ל־100" };
          next.strength = value;
        }
        if (params.hum !== undefined) {
          const hum = String(params.hum);
          if (!["off", "50", "60"].includes(hum)) return { ok: false, message: "זמזום: off, 50 או 60 בלבד" };
          next.hum = hum;
        }
        if (params.declick !== undefined) next.declick = Boolean(params.declick);
        if (params.highpass !== undefined) next.highpass = Boolean(params.highpass);
        const clean = sanitiseSettings(next);
        setSettings(clean);
        return {
          ok: true,
          message: `ההגדרות עודכנו: עוצמה ${clean.strength}%, זמזום ${clean.hum === "off" ? "כבוי" : `${clean.hum} הרץ`}, קליקים ${clean.declick ? "כן" : "לא"}, סינון נמוכים ${clean.highpass ? "כן" : "לא"}`,
          data: clean,
        };
      },
      "denoise.run": () => run(),
      "denoise.download": () => download(),
    },
  });

  const update = (patch: Partial<DenoiseSettings>) => setSettings((current) => ({ ...current, ...patch }));

  return (
    <section className="tool-body denoise-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <AudioLines size={26} />
        </span>
        <div>
          <h1>ניקוי רעשים</h1>
          <p>מסירים רחש רקע, זמזום חשמל וקליקים מהקלטה, ומשווים לפני ואחרי. הכול קורה בדפדפן — הקובץ לא יוצא מהמכשיר.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          progress={progress}
          maxBytes={maxBytes}
          onPick={(file) => {
            setError(null);
            resetForFile();
            void load(file);
          }}
          onClear={() => {
            resetForFile();
            clear();
          }}
          allowRecording
          hint="הקלטת קול, פודקאסט, הרצאה או שיר · הקובץ לא יוצא מהמכשיר"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {audio && (
          <>
            <div className="settings-panel">
              <div className="settings-grid">
                <label className="setting-field range-field">
                  <span>
                    עוצמת הניקוי <b>{settings.strength}%</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={settings.strength}
                    onChange={(event) => update({ strength: Number(event.target.value) })}
                    aria-label="עוצמת הניקוי"
                  />
                  <small>ככל שהעוצמה גבוהה יותר נעלם יותר רחש, אבל הקול עלול להישמע „מתכתי”. 40–70% מתאים לרוב ההקלטות.</small>
                </label>

                <div className="setting-field">
                  <span id="denoise-source">מאיפה ללמוד את הרעש</span>
                  <div className="segmented-control" role="group" aria-labelledby="denoise-source">
                    <button type="button" className={sourceKind === "auto" ? "active" : ""} aria-pressed={sourceKind === "auto"} onClick={() => setSourceKind("auto")}>
                      אוטומטית
                    </button>
                    <button
                      type="button"
                      className={sourceKind === "region" ? "active" : ""}
                      aria-pressed={sourceKind === "region"}
                      onClick={() => {
                        setSourceKind("region");
                        if (!trim) markQuietest(audio);
                      }}
                    >
                      מהקטע המסומן
                    </button>
                  </div>
                  <small>
                    {sourceKind === "auto"
                      ? "נמצא לבד את הקטע השקט ביותר בהקלטה ונלמד ממנו איך נשמע הרעש."
                      : "לימוד רעש מהקטע המסומן: סמנו בגל הקול חצי שנייה או יותר שיש בה רק רעש, בלי דיבור או נגינה."}
                  </small>
                  <button type="button" className="link-button denoise-find" onClick={() => markQuietest(audio)}>
                    <ScanSearch size={14} /> סמן לי את הקטע השקט ביותר
                  </button>
                </div>

                <div className="setting-field">
                  <span id="denoise-hum">זמזום חשמל</span>
                  <div className="segmented-control" role="group" aria-labelledby="denoise-hum">
                    {HUM_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={settings.hum === option.value ? "active" : ""}
                        aria-pressed={settings.hum === option.value}
                        onClick={() => update({ hum: option.value })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <small>בישראל ובאירופה החשמל ב־50 הרץ, בארה״ב ב־60. מסנן גם את ההרמוניות עד 1,000 הרץ.</small>
                </div>

                <div className="setting-field denoise-checks">
                  <label className="checkbox-field">
                    <input type="checkbox" checked={settings.declick} onChange={(event) => update({ declick: event.target.checked })} />
                    <span>הסרת קליקים ופצפוצים</span>
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={settings.highpass} onChange={(event) => update({ highpass: event.target.checked })} />
                    <span>סינון רעשים נמוכים (מתחת ל־80 הרץ)</span>
                  </label>
                </div>
              </div>
            </div>

            {peaks && playing && (
              <Waveform
                peaks={peaks}
                duration={playing.duration}
                trim={trim}
                onTrimChange={changeTrim}
                cursor={cursor}
                selectLabel="קטע הרעש"
                clearLabel="ביטול הסימון"
                emptyLabel="אפשר לסמן בגל הקול קטע שיש בו רק רעש"
                defaultSpan={1}
              />
            )}

            {runError && (
              <div className="error-message" role="alert">
                {runError}
              </div>
            )}

            {busy === null ? (
              <button className="primary-button" type="button" onClick={() => void run()}>
                <Wand2 size={20} /> {result && stale ? "נקה שוב עם ההגדרות החדשות" : result ? "נקה שוב" : "נקה את ההקלטה"}
                <small>{formatTime(audio.buffer.duration)}</small>
              </button>
            ) : (
              <div className="processing-box" aria-live="polite">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> מנקה את ההקלטה…
                  </span>
                  <strong>{Math.round(busy * 100)}%</strong>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="התקדמות הניקוי"
                  aria-valuenow={Math.round(busy * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${Math.max(2, busy * 100)}%` }} />
                </div>
                <button type="button" className="link-button" onClick={() => jobRef.current?.cancel()}>
                  <X size={14} /> בטל
                </button>
              </div>
            )}

            {result && (
              <div className="setting-field denoise-listen">
                <span id="denoise-listen">מה לשמוע</span>
                <div className="segmented-control" role="group" aria-labelledby="denoise-listen">
                  {LISTEN_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={mode === option.value ? "active" : ""}
                      aria-pressed={mode === option.value}
                      onClick={() => setListen(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <small>
                  {mode === "removed"
                    ? "רק מה שהוסר. אם שומעים כאן מילים או צלילים ברורים, כדאי להוריד את העוצמה."
                    : "אפשר להחליף תוך כדי השמעה — הנגינה ממשיכה מאותו מקום."}
                </small>
              </div>
            )}

            <Transport
              buffer={playing}
              label={mode === "after" ? "השמע אחרי" : mode === "removed" ? "השמע מה הוסר" : "השמע את המקור"}
              onTime={setCursor}
            />

            {result && (
              <div className="downloads-card denoise-result">
                <div>
                  <span className="download-icon">
                    <FileAudio size={22} />
                  </span>
                  <div>
                    <h3>ההקלטה הנקייה</h3>
                    <p>
                      {formatTime(result.cleaned.duration)} · WAV · נוקה ב־{result.seconds.toFixed(1)} שניות
                    </p>
                  </div>
                </div>
                <ul className="denoise-stats">
                  {result.reductionDb !== null && result.reductionDb > 0.5 && (
                    <li>
                      רעש הרקע ירד בכ־<b>{Math.round(result.reductionDb)} dB</b>
                    </li>
                  )}
                  {result.clicks > 0 && (
                    <li>
                      תוקנו <b>{result.clicks}</b> קליקים
                    </li>
                  )}
                  <li>
                    הרעש נלמד מהקטע <span dir="ltr">{preciseTime(result.region.start)}–{preciseTime(result.region.end)}</span>
                  </li>
                </ul>
                {stale && (
                  <div className="notice-message" role="status">
                    ההגדרות השתנו מאז הניקוי — מה שנשמע ויורד הוא עדיין התוצאה הקודמת.
                  </div>
                )}
                <div className="download-buttons">
                  <button type="button" onClick={() => download()}>
                    <Download size={17} />
                    <span>
                      הורד<small>קובץ WAV נקי</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const file = buildFile();
                      if (file) void handOffTo("transcript", file, "ההקלטה הנקייה");
                    }}
                  >
                    <Captions size={17} />
                    <span>
                      לתמלול<small>דיבור לטקסט</small>
                    </span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
