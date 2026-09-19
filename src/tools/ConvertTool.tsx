import { ArrowLeftRight, Captions, Download, FileAudio, FileMusic, Smartphone, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, formatBytes, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { BITRATES, SAMPLE_RATES, convertAudio, estimateBytes, type ConvertOptions, type OutputFormat } from "../lib/convert";
import { downloadFile } from "../lib/export";
import { handOffTo } from "../lib/handoff";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";

const SETTINGS_KEY = "musictools.convert.v1";

type Saved = { format: OutputFormat; sampleRate: number; channels: 1 | 2 | "keep"; kbps: number };

function loadSaved(): Saved {
  const fallback: Saved = { format: "mp3", sampleRate: 44_100, channels: "keep", kbps: 192 };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null;
    if (!parsed) return fallback;
    return {
      format: parsed.format === "wav" ? "wav" : "mp3",
      sampleRate: SAMPLE_RATES.some((item) => item.value === parsed.sampleRate) ? (parsed.sampleRate as number) : fallback.sampleRate,
      channels: parsed.channels === 1 || parsed.channels === 2 ? parsed.channels : "keep",
      kbps: BITRATES.some((item) => item.value === parsed.kbps) ? (parsed.kbps as number) : fallback.kbps,
    };
  } catch {
    return fallback;
  }
}

type Props = { initial?: SavedWork | null };

/**
 * Any audio in, MP3 or WAV out — at the sample rate, channel count and
 * bitrate the visitor wants, trimmed and levelled. All of it in the browser:
 * the file never leaves the device. The result can go straight to another
 * tool instead of being downloaded and picked again.
 */
export function ConvertTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [saved] = useState(loadSaved);
  const [format, setFormat] = useState<OutputFormat>(saved.format);
  const [sampleRate, setSampleRate] = useState(saved.sampleRate);
  const [channels, setChannels] = useState<1 | 2 | "keep">(saved.channels);
  const [kbps, setKbps] = useState(saved.kbps);
  const [gain, setGain] = useState(100);
  const [normalise, setNormalise] = useState(false);
  const [trim, setTrim] = useState<TrimRange>(null);
  const [busy, setBusy] = useState<{ message: string; fraction: number } | null>(null);
  const [result, setResult] = useState<{ file: File; url: string; key: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(initial ? `פתחת „${initial.title}”. בחר את הקובץ שוב כדי להמיר מחדש.` : null);
  const abortRef = useRef<AbortController | null>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;
  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ format, sampleRate, channels, kbps } satisfies Saved));
    } catch {
      // Private browsing.
    }
  }, [channels, format, kbps, sampleRate]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const options: ConvertOptions = { format, sampleRate, channels, kbps, trim, gain: gain / 100, normalise };
  const settingsKey = audio ? `${audio.url}|${JSON.stringify(options)}` : "";
  useEffect(() => resetSave(), [resetSave, settingsKey]);
  const fresh = result !== null && result.key === settingsKey;
  const seconds = audio ? (trim ? trim.end - trim.start : audio.buffer.duration) : 0;
  const estimate = audio ? estimateBytes(seconds, options, audio.buffer.numberOfChannels) : 0;

  /** Resolves with the converted file, or null when it failed or was cancelled. */
  const run = async (): Promise<File | null> => {
    if (!audio || busy) return null;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy({ message: "מתחיל…", fraction: 0 });
    setError(null);
    try {
      const file = await convertAudio(audio.buffer, audio.file.name, options, (message, fraction) => {
        if (!controller.signal.aborted) setBusy({ message, fraction });
      }, controller.signal);
      if (controller.signal.aborted) return null;
      setResult((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { file, url: URL.createObjectURL(file), key: settingsKey };
      });
      return file;
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "ההמרה נכשלה.");
      return null;
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(null);
      }
    }
  };

  const save = () => {
    if (!fresh || !result || !audio) return Promise.resolve(null);
    return saving.save(
      {
        kind: "convert",
        title: result.file.name,
        sourceName: audio.file.name,
        summary: { format, sampleRate, channels: channels === "keep" ? audio.buffer.numberOfChannels : channels, kbps: format === "mp3" ? kbps : null, duration: seconds, bytes: result.file.size },
        payload: { format, sampleRate, channels, kbps, gain, normalise, trim },
      },
      result.file,
    );
  };

  useAssistantTool("convert", {
    state: () =>
      `המרת פורמטים: ${audio ? `הקובץ „${audio.file.name}” (${formatTime(audio.buffer.duration)}, ${(audio.buffer.sampleRate / 1000).toFixed(1)} kHz, ${audio.buffer.numberOfChannels === 1 ? "מונו" : "סטריאו"})` : "לא נבחר קובץ (רק הגולש בוחר קובץ)"}; יעד ${format.toUpperCase()}, ${sampleRate} Hz, ערוצים ${channels === "keep" ? "כמו המקור" : channels === 1 ? "מונו" : "סטריאו"}${format === "mp3" ? `, ${kbps} kbps` : ""}, עוצמה ${gain}%${normalise ? ", נרמול" : ""}${trim ? `, קטע ${formatTime(trim.start)}–${formatTime(trim.end)}` : ""}; ${
        busy ? `ממיר עכשיו (${Math.round(busy.fraction * 100)}%)` : fresh && result ? `יש תוצאה: ${result.file.name} (${formatBytes(result.file.size)})` : "אין תוצאה להגדרות האלה"
      }.`,
    handlers: {
      "convert.read": () => ({
        ok: true,
        message: audio ? `${format.toUpperCase()}, ${sampleRate} Hz` : "אין קובץ",
        data: { file: audio?.file.name ?? null, format, sampleRate, channels, kbps, gain, normalise, trim, result: fresh && result ? { name: result.file.name, bytes: result.file.size } : null, busy: Boolean(busy) },
      }),
      "convert.set": ({ format: nextFormat, sampleRate: nextRate, channels: nextChannels, kbps: nextKbps, gain: nextGain, normalise: nextNormalise }) => {
        const done: string[] = [];
        if (nextFormat === "mp3" || nextFormat === "wav") {
          setFormat(nextFormat);
          done.push(nextFormat.toUpperCase());
        }
        if (typeof nextRate === "number") {
          const nearest = SAMPLE_RATES.reduce((best, item) => (Math.abs(item.value - nextRate) < Math.abs(best.value - nextRate) ? item : best));
          setSampleRate(nearest.value);
          done.push(nearest.label);
        }
        if (nextChannels === "keep" || nextChannels === "1" || nextChannels === "2") {
          setChannels(nextChannels === "keep" ? "keep" : nextChannels === "1" ? 1 : 2);
          done.push(nextChannels === "keep" ? "ערוצים כמו המקור" : nextChannels === "1" ? "מונו" : "סטריאו");
        }
        if (typeof nextKbps === "number") {
          const nearest = BITRATES.reduce((best, item) => (Math.abs(item.value - nextKbps) < Math.abs(best.value - nextKbps) ? item : best));
          setKbps(nearest.value);
          done.push(nearest.label);
        }
        if (typeof nextGain === "number") {
          const clamped = Math.max(20, Math.min(300, Math.round(nextGain)));
          setGain(clamped);
          done.push(`עוצמה ${clamped}%`);
        }
        if (typeof nextNormalise === "boolean") {
          setNormalise(nextNormalise);
          done.push(nextNormalise ? "נרמול פועל" : "בלי נרמול");
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "convert.run": async () => {
        if (!audio) return { ok: false, message: "אין קובץ; הגולש צריך לבחור קובץ" };
        if (busy) return { ok: false, message: "כבר ממיר" };
        const file = await run();
        return file ? { ok: true, message: `ההמרה הושלמה: ${file.name} (${formatBytes(file.size)})` } : { ok: false, message: "ההמרה נכשלה או בוטלה" };
      },
      "convert.download": () => {
        if (!fresh || !result) return { ok: false, message: "אין תוצאה להגדרות האלה; convert.run ממיר" };
        downloadFile(result.file, result.file.name, result.file.type);
        return { ok: true, message: `${result.file.name} ירד` };
      },
      "convert.save": async () => {
        if (!fresh || !result) return { ok: false, message: "אין תוצאה; convert.run ממיר" };
        const saved = await save();
        return saved ? { ok: true, message: "הקובץ נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "convert.sendTo": ({ tool }) => {
        if (!fresh || !result) return { ok: false, message: "אין תוצאה; convert.run ממיר" };
        void handOffTo(String(tool), result.file, "הקובץ המומר");
        return { ok: true, message: `הקובץ נשלח לכלי ${String(tool)}` };
      },
    },
  });

  return (
    <section className="tool-body convert-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <ArrowLeftRight size={26} />
        </span>
        <div>
          <h1>המרת פורמטים</h1>
          <p>MP3, WAV, M4A, OGG, FLAC ועוד — לקובץ MP3 או WAV באיכות שתבחר, בדפדפן.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            setNotice(null);
            setTrim(null);
            setResult(null);
            void load(file);
          }}
          onClear={() => {
            abortRef.current?.abort();
            setResult(null);
            setTrim(null);
            clear();
          }}
          allowRecording
          hint="כל קובץ שמע או וידאו · הקובץ לא יוצא מהמכשיר"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="notice-message" role="status">
            {notice}
          </div>
        )}

        {audio && (
          <>
            <div className="settings-panel">
              <div className="settings-grid">
                <div className="setting-field">
                  <span id="convert-format">פורמט היעד</span>
                  <div className="segmented-control" role="group" aria-labelledby="convert-format">
                    <button type="button" className={format === "mp3" ? "active" : ""} aria-pressed={format === "mp3"} onClick={() => setFormat("mp3")}>
                      MP3
                    </button>
                    <button type="button" className={format === "wav" ? "active" : ""} aria-pressed={format === "wav"} onClick={() => setFormat("wav")}>
                      WAV
                    </button>
                  </div>
                  <small>{format === "mp3" ? "קטן ונפוץ, מתאים לטלפון ולשיתוף." : "ללא דחיסה, לעריכה ולאיכות מלאה."}</small>
                </div>
                <label className="setting-field">
                  <span>קצב דגימה</span>
                  <select value={sampleRate} onChange={(event) => setSampleRate(Number(event.target.value))} aria-label="קצב דגימה">
                    {SAMPLE_RATES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <small>המקור: {(audio.buffer.sampleRate / 1000).toFixed(1)} kHz</small>
                </label>
                <label className="setting-field">
                  <span>ערוצים</span>
                  <select value={String(channels)} onChange={(event) => setChannels(event.target.value === "keep" ? "keep" : (Number(event.target.value) as 1 | 2))} aria-label="ערוצים">
                    <option value="keep">כמו המקור ({audio.buffer.numberOfChannels === 1 ? "מונו" : "סטריאו"})</option>
                    <option value="2">סטריאו</option>
                    <option value="1">מונו</option>
                  </select>
                </label>
                {format === "mp3" && (
                  <label className="setting-field">
                    <span>איכות MP3</span>
                    <select value={kbps} onChange={(event) => setKbps(Number(event.target.value))} aria-label="קצב סיביות">
                      {BITRATES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="setting-field range-field">
                  <span>
                    עוצמה <b>{gain}%</b>
                  </span>
                  <input type="range" min={20} max={300} value={gain} onChange={(event) => setGain(Number(event.target.value))} aria-label="עוצמה" />
                </label>
                <label className="checkbox-field">
                  <input type="checkbox" checked={normalise} onChange={(event) => setNormalise(event.target.checked)} />
                  <span>נרמל לעוצמה מלאה</span>
                </label>
              </div>
            </div>

            {peaks && (
              <Waveform peaks={peaks} duration={audio.buffer.duration} trim={trim} onTrimChange={setTrim} selectLabel="קטע להמרה" clearLabel="המר את כל הקובץ" emptyLabel="אפשר לסמן קטע בגל הקול כדי להמיר רק אותו" />
            )}

            {!busy && (
              <button className="primary-button" type="button" onClick={() => void run()}>
                <Wand2 size={20} /> המר ל־{format.toUpperCase()}
                <small>
                  {formatTime(seconds)} · בערך {formatBytes(estimate)}
                </small>
              </button>
            )}
            {busy && (
              <div className="processing-box" aria-live="polite">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> {busy.message}
                  </span>
                  <strong>{Math.round(busy.fraction * 100)}%</strong>
                </div>
                <div className="progress-track" role="progressbar" aria-label="התקדמות ההמרה" aria-valuenow={Math.round(busy.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${Math.max(2, busy.fraction * 100)}%` }} />
                </div>
                <button type="button" className="link-button" onClick={() => abortRef.current?.abort()}>
                  <X size={14} /> בטל
                </button>
              </div>
            )}

            {fresh && result && (
              <div className="downloads-card convert-result">
                <div>
                  <span className="download-icon">
                    <FileAudio size={22} />
                  </span>
                  <div>
                    <h3>{result.file.name}</h3>
                    <p>
                      {formatBytes(result.file.size)} · {format.toUpperCase()} · {(sampleRate / 1000).toFixed(1)} kHz
                    </p>
                  </div>
                </div>
                <audio controls src={result.url} className="convert-preview" aria-label="האזנה לתוצאה" />
                <div className="download-buttons">
                  <button type="button" onClick={() => downloadFile(result.file, result.file.name, result.file.type)}>
                    <Download size={17} />
                    <span>
                      הורד<small>{format.toUpperCase()}</small>
                    </span>
                  </button>
                  <ShareButton build={() => result.file} title={result.file.name} />
                  <button type="button" onClick={() => void handOffTo("ringtone", result.file, "הקובץ המומר")}>
                    <Smartphone size={17} />
                    <span>
                      לצלצול<small>המשך בכלי הצלצולים</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => void handOffTo("notes", result.file, "הקובץ המומר")}>
                    <FileMusic size={17} />
                    <span>
                      לתווים<small>זיהוי תווים</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => void handOffTo("transcript", result.file, "הקובץ המומר")}>
                    <Captions size={17} />
                    <span>
                      לתמלול<small>דיבור לטקסט</small>
                    </span>
                  </button>
                </div>
                <SaveButton state={saving.state} onSave={() => void save()} label="שמור את הקובץ" message={saving.message} />
              </div>
            )}
            {!fresh && <Transport buffer={audio.buffer} loop={trim ? { start: trim.start, end: trim.end } : null} label="השמע את המקור" />}
          </>
        )}
      </div>
    </section>
  );
}
