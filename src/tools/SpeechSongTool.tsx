import { BellRing, Download, Layers, Loader2, MessageCircleHeart, Music2, SlidersHorizontal, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { formatTime } from "../lib/audio";
import { useOfferResult } from "../lib/currentFile";
import { downloadFile, safeFilename } from "../lib/export";
import { parseKeyName } from "../lib/melody";
import { handOffTo } from "../lib/handoff";
import { MicRecorder, recordingExtension } from "../lib/record";
import {
  DEFAULT_SETTINGS,
  MAX_SECONDS,
  SPEECH_SONG_BEATS,
  SPEECH_SONG_MODES,
  analyzeSpeech,
  beatLabel,
  findSyllables,
  isSpeechSongBeat,
  isSpeechSongMode,
  keyLabel,
  planSpeechSong,
  prepareVoice,
  rankHooks,
  renderSpeechSong,
  renderVocal,
  type Phrase,
  type SpeechAnalysis,
  type SpeechSongMode,
  type SpeechSongPlan,
  type SpeechSongSettings,
  type Syllable,
} from "../lib/speechSong";
import { ROOTS } from "../lib/theory";
import { useAssistantTool } from "../lib/useAssistantTool";
import { encodeWav } from "../lib/wav";
import "./speechsong.css";

const SETTINGS_KEY = "musictools.speechsong.v1";
/** Long enough to swallow a dragged slider, short enough to feel instant on a tap. */
const RENDER_DELAY_MS = 250;
const MODE_EMOJI: Record<SpeechSongMode, string> = { song: "🎤", rap: "🎧", hook: "🔁" };

type AllSettings = Record<SpeechSongMode, SpeechSongSettings>;
type Saved = { mode: SpeechSongMode; settings: AllSettings };

function clampSettings(mode: SpeechSongMode, raw: Partial<SpeechSongSettings> | undefined): SpeechSongSettings {
  const base = DEFAULT_SETTINGS[mode];
  if (!raw) return base;
  const number = (value: unknown, fallback: number, low: number, high: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
  return {
    mode,
    bpm: Math.round(number(raw.bpm, base.bpm, 70, 140)),
    keyPc: raw.keyPc === null ? null : typeof raw.keyPc === "number" ? ((Math.round(raw.keyPc) % 12) + 12) % 12 : base.keyPc,
    minor: typeof raw.minor === "boolean" ? raw.minor : base.minor,
    beat: isSpeechSongBeat(raw.beat) ? raw.beat : base.beat,
    repeats: Math.round(number(raw.repeats, base.repeats, 1, 6)),
    backing: number(raw.backing, base.backing, 0, 1),
  };
}

/** The last mode and dials are a per-visitor convenience; losing them costs nothing. */
function loadSaved(): Saved {
  const fallback: Saved = { mode: "song", settings: { ...DEFAULT_SETTINGS } };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null;
    if (!parsed) return fallback;
    return {
      mode: isSpeechSongMode(parsed.mode) ? parsed.mode : "song",
      settings: {
        song: clampSettings("song", parsed.settings?.song),
        rap: clampSettings("rap", parsed.settings?.rap),
        hook: clampSettings("hook", parsed.settings?.hook),
      },
    };
  } catch {
    return fallback;
  }
}

type Analysed = {
  key: string;
  voice: Float32Array;
  rate: number;
  analysis: SpeechAnalysis;
  syllables: Syllable[];
  hooks: Phrase[];
  trimmed: boolean;
};

type Rendered = { key: string; buffer: AudioBuffer | null; plan: SpeechSongPlan | null; error: string | null };

/** The tune the voice sings, drawn as a strip of note blocks (or, for rap, beats). */
function TuneStrip({ plan }: { plan: SpeechSongPlan }) {
  const width = 600;
  const height = 90;
  const length = plan.bars * plan.barSeconds;
  const midis = plan.notes.flatMap((note) => (note.midi === null ? [] : [note.midi]));
  const low = midis.length ? Math.min(...midis) - 2 : 0;
  const high = midis.length ? Math.max(...midis) + 2 : 1;
  const x = (time: number) => (time / length) * width;
  const beats = Math.round(length / (plan.barSeconds / 4));
  return (
    <svg className="speechsong-strip" data-tour="speechsong-strip" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={plan.mode === "rap" ? "ההברות על הביט" : "המנגינה שהקול שר"}>
      {Array.from({ length: beats + 1 }, (_, index) => (
        <line key={index} className={index % 4 === 0 ? "bar" : "beat"} x1={x((index * plan.barSeconds) / 4)} x2={x((index * plan.barSeconds) / 4)} y1={0} y2={height} />
      ))}
      {plan.notes.map((note) => {
        const y = note.midi === null ? height / 2 - 8 : height - 8 - ((note.midi - low) / Math.max(1, high - low)) * (height - 16);
        return <rect key={note.syllable} className={note.onBeat ? "note on-beat" : "note"} x={x(note.start)} y={y - 4} width={Math.max(3, x(note.end) - x(note.start) - 1)} height={note.midi === null ? 16 : 8} rx={3} />;
      })}
    </svg>
  );
}

/**
 * Speech to song: record or upload a few spoken lines and get them back as
 * a sung song, a rap on the beat, or the catchiest line looped as a chorus,
 * with drums, chords and bass under it.
 */
export function SpeechSongTool() {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [saved] = useState(loadSaved);
  const [mode, setMode] = useState<SpeechSongMode>(saved.mode);
  const [all, setAll] = useState<AllSettings>(saved.settings);
  const [hookIndex, setHookIndex] = useState(0);
  const [analysed, setAnalysed] = useState<Analysed | null>(null);
  const [rendered, setRendered] = useState<Rendered>({ key: "", buffer: null, plan: null, error: null });
  const [seek, setSeek] = useState<{ time: number; key: number; play?: boolean } | null>(null);
  // Remounting the transport is the one way to stop it from outside.
  const [transportKey, setTransportKey] = useState(0);
  // The picker records on its own button; this second recorder is only for
  // the assistant, which cannot press that button.
  const [recorder] = useState(() => new MicRecorder());
  const [assistantRecording, setAssistantRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const settings = all[mode];
  const maxSeconds = MAX_SECONDS[mode];
  const analysisKey = audio ? `${audio.url}|${maxSeconds}` : "";
  const ready = analysed && analysed.key === analysisKey ? analysed : null;
  const hook = mode === "hook" ? (ready?.hooks[Math.min(hookIndex, Math.max(0, (ready?.hooks.length ?? 1) - 1))] ?? null) : null;
  const renderKey = ready ? `${analysisKey}|${JSON.stringify(settings)}|${hook ? `${hook.from}-${hook.to}` : ""}` : "";
  const done = Boolean(renderKey) && rendered.key === renderKey;
  const busy = Boolean(audio) && !done && !error;
  const result = done ? rendered.buffer : null;
  const plan = done ? rendered.plan : null;
  const renderError = done ? rendered.error : null;
  const current = SPEECH_SONG_MODES.find((item) => item.id === mode)!;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode, settings: all }));
    } catch {
      // Private mode or full storage: the dials simply are not remembered.
    }
  }, [mode, all]);

  // Listening to the recording once: loudness, pitch, syllables and hooks.
  useEffect(() => {
    if (!audio) return;
    let cancelled = false;
    // A tick first, so the spinner paints before the main thread is busy.
    const timer = window.setTimeout(() => {
      const { buffer } = audio;
      const frames = Math.min(buffer.length, Math.round(maxSeconds * buffer.sampleRate));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).subarray(0, frames));
      const voice = prepareVoice(channels);
      const analysis = analyzeSpeech(voice, buffer.sampleRate);
      const syllables = findSyllables(analysis);
      if (cancelled) return;
      setAnalysed({
        key: `${audio.url}|${maxSeconds}`,
        voice,
        rate: buffer.sampleRate,
        analysis,
        syllables,
        hooks: rankHooks(syllables),
        trimmed: frames < buffer.length,
      });
      setHookIndex(0);
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [audio, maxSeconds]);

  // The song itself, again whenever a dial moves.
  useEffect(() => {
    if (!ready || !renderKey) return;
    let cancelled = false;
    const key = renderKey;
    const timer = window.setTimeout(() => {
      const syllables = hook ? ready.syllables.slice(hook.from, hook.to) : ready.syllables;
      if (syllables.length < 2) {
        setRendered({ key, buffer: null, plan: null, error: "לא שמענו מספיק דיבור בהקלטה. נסו משפט או שניים, ברור ובלי מוזיקה ברקע." });
        return;
      }
      const songPlan = planSpeechSong(syllables, settings);
      const vocal = renderVocal(ready.voice, ready.rate, ready.analysis, songPlan);
      renderSpeechSong(vocal, ready.rate, songPlan, settings)
        .then((buffer) => {
          if (!cancelled) setRendered({ key, buffer, plan: songPlan, error: null });
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          const reason = caught instanceof Error && caught.message ? ` ${caught.message}` : "";
          setRendered({ key, buffer: null, plan: null, error: `לא הצלחנו להכין את השיר.${reason}` });
        });
    }, RENDER_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, renderKey, hook, settings]);

  useEffect(() => () => recorder.cancel(), [recorder]);

  useEffect(() => {
    if (!assistantRecording) return;
    const timer = window.setInterval(() => setRecordSeconds(recorder.elapsed), 200);
    return () => window.clearInterval(timer);
  }, [assistantRecording, recorder]);

  const update = (patch: Partial<SpeechSongSettings>) =>
    setAll((previous) => ({ ...previous, [mode]: clampSettings(mode, { ...previous[mode], ...patch }) }));

  const baseName = safeFilename(audio?.file.name.replace(/\.[^/.]+$/, "") ?? "") || "speech";
  const fileName = `${baseName}-${mode}.wav`;

  const buildFile = useCallback(() => {
    if (!result) return null;
    const channels = Array.from({ length: result.numberOfChannels }, (_, index) => result.getChannelData(index));
    return new File([encodeWav({ channels, sampleRate: result.sampleRate })], fileName, { type: "audio/wav" });
  }, [fileName, result]);

  // The song is what goes on to the next tool.
  useOfferResult(result, fileName, () => buildFile()!);

  const exportWav = () => {
    const file = buildFile();
    if (file) downloadFile(file, file.name, "audio/wav");
    return Boolean(file);
  };

  const startAssistantRecording = async () => {
    try {
      await recorder.start();
      setRecordSeconds(0);
      setAssistantRecording(true);
      return null;
    } catch (caught) {
      return caught instanceof Error && caught.name === "NotAllowedError" ? "לא ניתנה גישה למיקרופון" : "לא הצלחנו להתחיל הקלטה";
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

  const keyText = plan ? keyLabel(plan.keyPc, plan.minor) : settings.keyPc === null ? "לפי הקול" : keyLabel(settings.keyPc, settings.minor);
  const chordsText = plan ? plan.chords.map((chord) => chord.name).join(" · ") : "";
  const describeHooks = (hooks: Phrase[]) => hooks.map((item, index) => `${index + 1}: ${formatTime(item.start)}–${formatTime(item.end)}`).join(", ");

  const sendTo = (tool: "mixer" | "ringtone") => {
    const file = buildFile();
    if (file) void handOffTo(tool, file, "השיר מדיבור לשיר");
  };

  useAssistantTool("speechsong", {
    state: () => {
      const dials = `מצב „${current.label}”, ביט ${beatLabel(settings.beat)}, ${settings.bpm} BPM, סולם ${keyText}, ${settings.repeats} חזרות`;
      if (assistantRecording) return `דיבור לשיר: מקליט מהמיקרופון (${formatTime(recordSeconds)}). ${dials}.`;
      if (!audio) return `דיבור לשיר: אין עדיין הקלטה (הגולש יכול להקליט או להעלות קובץ). ${dials}.`;
      const hooks = mode === "hook" && ready?.hooks.length ? `; משפטים לפזמון: ${describeHooks(ready.hooks)}, נבחר ${hookIndex + 1}` : "";
      return `דיבור לשיר: „${audio.file.name}”${ready ? `, ${ready.syllables.length} הברות` : ""}. ${dials}${hooks}${busy ? "; מכין את השיר" : result ? `; השיר מוכן (${formatTime(result.duration)})` : ""}.`;
    },
    handlers: {
      "speechsong.mode": ({ mode: next }) => {
        if (!isSpeechSongMode(next)) return { ok: false, message: "אפשר: song, rap או hook" };
        setMode(next);
        return { ok: true, message: `עבר למצב „${SPEECH_SONG_MODES.find((item) => item.id === next)!.label}”` };
      },
      "speechsong.set": ({ bpm, beat, key, minor, repeats, backing, hook: hookNumber }) => {
        const patch: Partial<SpeechSongSettings> = {};
        if (typeof bpm === "number") patch.bpm = bpm;
        if (typeof beat === "string") {
          if (!isSpeechSongBeat(beat)) return { ok: false, message: `אין ביט כזה. אפשר: ${SPEECH_SONG_BEATS.join(", ")}` };
          patch.beat = beat;
        }
        if (typeof key === "string") {
          if (key === "auto") patch.keyPc = null;
          else {
            const pc = parseKeyName(key);
            if (pc === null) return { ok: false, message: "סולם לא מוכר; אפשר auto או שם תו כמו C, F#, Bb" };
            patch.keyPc = pc;
          }
        }
        if (typeof minor === "boolean") patch.minor = minor;
        if (typeof repeats === "number") patch.repeats = repeats;
        if (typeof backing === "number") patch.backing = backing / 100;
        update(patch);
        if (typeof hookNumber === "number") setHookIndex(Math.max(0, Math.round(hookNumber) - 1));
        return { ok: true, message: "ההגדרות עודכנו, והשיר מוכן מחדש" };
      },
      "speechsong.record": async ({ command }) => {
        if (command === "start") {
          if (assistantRecording) return { ok: false, message: "כבר מקליט" };
          const problem = await startAssistantRecording();
          return problem ? { ok: false, message: problem } : { ok: true, message: "ההקלטה התחילה — מדברים עכשיו" };
        }
        if (command === "stop") {
          if (!assistantRecording) return { ok: false, message: "אין הקלטה פעילה" };
          const problem = await stopAssistantRecording();
          return problem ? { ok: false, message: problem } : { ok: true, message: "ההקלטה נשמרה, והשיר בהכנה" };
        }
        return { ok: false, message: "צריך לציין start או stop" };
      },
      "speechsong.play": ({ command }) => {
        if (command === "stop") {
          setSeek(null);
          setTransportKey((value) => value + 1);
          return { ok: true, message: "הנגינה נעצרה" };
        }
        if (command !== "play") return { ok: false, message: "צריך לציין play או stop" };
        if (!audio) return { ok: false, message: "אין עדיין הקלטה" };
        if (!result) return { ok: false, message: "השיר עדיין בהכנה; נסה שוב בעוד רגע" };
        setSeek({ time: 0, key: Date.now(), play: true });
        return { ok: true, message: "מנגן את השיר" };
      },
      "speechsong.download": () => {
        if (!result) return { ok: false, message: audio ? "השיר עדיין בהכנה" : "אין עדיין הקלטה" };
        return exportWav() ? { ok: true, message: "קובץ ה־WAV ירד" } : { ok: false, message: "ההורדה נכשלה" };
      },
    },
  });

  return (
    <section className="tool-body speechsong-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <MessageCircleHeart size={26} />
        </span>
        <div>
          <h1>דיבור לשיר</h1>
          <p>אומרים משפט — ומקבלים אותו בחזרה מושר, כראפ על ביט או כפזמון שחוזר.</p>
        </div>
      </div>

      <div className="speechsong-modes" role="radiogroup" aria-label="מה לעשות עם הדיבור" data-tour="speechsong-modes">
        {SPEECH_SONG_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={mode === item.id}
            className={`speechsong-mode${mode === item.id ? " active" : ""}`}
            onClick={() => setMode(item.id)}
          >
            <span className="speechsong-mode-emoji" aria-hidden="true">
              {MODE_EMOJI[item.id]}
            </span>
            <strong>{item.label}</strong>
            <small>{item.blurb}</small>
          </button>
        ))}
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
              <button className="primary-button compact" type="button" onClick={() => void stopAssistantRecording().then((problem) => problem && setError(problem))}>
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
            hint={mode === "hook" ? "נאום, שיחה או הודעה קולית — עד שלוש דקות" : "משפט או שניים של דיבור ברור, בלי מוזיקה ברקע"}
            allowRecording
          />
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {ready?.trimmed && <p className="speechsong-note">נלקחו רק {maxSeconds} השניות הראשונות של ההקלטה.</p>}
      </div>

      {mode === "hook" && ready && ready.hooks.length > 0 && (
        <div className="settings-panel" data-tour="speechsong-hooks">
          <div className="settings-title">
            <Music2 size={18} /> המשפטים שהכי מתאימים לפזמון
          </div>
          <div className="speechsong-hooks" role="radiogroup" aria-label="המשפט לפזמון">
            {ready.hooks.map((item, index) => (
              <button key={`${item.from}-${item.to}`} type="button" role="radio" aria-checked={hookIndex === index} className={`chip-toggle${hookIndex === index ? " active" : ""}`} onClick={() => setHookIndex(index)}>
                {index === 0 ? "★ " : ""}
                <bdi dir="ltr">
                  {formatTime(item.start)}–{formatTime(item.end)}
                </bdi>{" "}
                · {item.to - item.from} הברות
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="settings-panel" data-tour="speechsong-settings">
        <div className="settings-title">
          <SlidersHorizontal size={18} /> הביט והמנגינה
          {!audio && <em>השיר יוכן ברגע שתהיה הקלטה</em>}
        </div>
        <div className="settings-grid">
          <div className="setting-field">
            <span>ביט</span>
            <div className="speechsong-chips" role="group" aria-label="ביט">
              {SPEECH_SONG_BEATS.map((beat) => (
                <button key={beat} type="button" className={`chip-toggle${settings.beat === beat ? " active" : ""}`} aria-pressed={settings.beat === beat} onClick={() => update({ beat })}>
                  {beatLabel(beat)}
                </button>
              ))}
            </div>
          </div>
          <label className="setting-field range-field">
            <span>
              קצב <b>{settings.bpm} BPM</b>
            </span>
            <input type="range" min={70} max={140} value={settings.bpm} onChange={(event) => update({ bpm: Number(event.target.value) })} aria-label="קצב" />
          </label>
          <div className="setting-field">
            <span>
              סולם <b>{keyText}</b>
            </span>
            <div className="speechsong-key">
              <select
                value={settings.keyPc === null ? "auto" : String(settings.keyPc)}
                onChange={(event) => update({ keyPc: event.target.value === "auto" ? null : Number(event.target.value) })}
                aria-label="טוניקה"
              >
                <option value="auto">לפי הקול שלך</option>
                {ROOTS.map((root) => (
                  <option key={root.pc} value={root.pc}>
                    {root.name}
                  </option>
                ))}
              </select>
              <div className="segmented-control" role="group" aria-label="מז׳ור או מינור">
                <button type="button" className={settings.minor ? "" : "active"} aria-pressed={!settings.minor} onClick={() => update({ minor: false })}>
                  מז׳ור
                </button>
                <button type="button" className={settings.minor ? "active" : ""} aria-pressed={settings.minor} onClick={() => update({ minor: true })}>
                  מינור
                </button>
              </div>
            </div>
          </div>
          <div className="setting-field">
            <span>חזרות</span>
            <div className="segmented-control" role="group" aria-label="כמה פעמים הקול חוזר">
              {[1, 2, 3, 4].map((value) => (
                <button key={value} type="button" className={settings.repeats === value ? "active" : ""} aria-pressed={settings.repeats === value} onClick={() => update({ repeats: value })}>
                  {value}
                </button>
              ))}
            </div>
          </div>
          <label className="setting-field range-field">
            <span>
              עוצמת הליווי <b>{Math.round(settings.backing * 100)}</b>
            </span>
            <input type="range" min={0} max={100} value={Math.round(settings.backing * 100)} onChange={(event) => update({ backing: Number(event.target.value) / 100 })} aria-label="עוצמת הליווי" />
          </label>
        </div>
      </div>

      {audio && (
        <>
          <div className="workspace-card speechsong-result">
            <div className="speechsong-result-head">
              <span className="speechsong-result-emoji" aria-hidden="true">
                {MODE_EMOJI[mode]}
              </span>
              <div>
                <h3>{mode === "song" ? "הדיבור, מושר" : mode === "rap" ? "הדיבור, כראפ" : "הפזמון"}</h3>
                <p aria-live="polite">
                  {busy ? (
                    <span className="speechsong-busy">
                      <Loader2 size={15} className="spin" /> {ready ? "מכין את השיר…" : "מקשיב להקלטה…"}
                    </span>
                  ) : result && plan ? (
                    `${formatTime(result.duration)} · ${keyLabel(plan.keyPc, plan.minor)} · ${plan.bpm} BPM · ${plan.notes.length} הברות`
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
            {plan && (
              <>
                <TuneStrip plan={plan} />
                <p className="speechsong-chords" dir="ltr">
                  {chordsText}
                </p>
              </>
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
                <p>שומרים את השיר, ממשיכים לעבוד עליו במיקסר או הופכים אותו לרינגטון.</p>
              </div>
            </div>
            <div className="download-buttons">
              <button type="button" onClick={exportWav} disabled={!result}>
                <Download size={17} />
                <span>
                  WAV<small>{current.label}</small>
                </span>
              </button>
              <button type="button" onClick={() => sendTo("mixer")} disabled={!result}>
                <Layers size={17} />
                <span>
                  למיקסר<small>להוסיף ערוצים</small>
                </span>
              </button>
              <button type="button" onClick={() => sendTo("ringtone")} disabled={!result}>
                <BellRing size={17} />
                <span>
                  לרינגטון<small>חיתוך והורדה לטלפון</small>
                </span>
              </button>
              <ShareButton build={buildFile} title="השיר שלי מדיבור" />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
