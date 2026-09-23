import {
  ArrowLeftRight,
  Dices,
  Download,
  Eraser,
  Grid3x3,
  Layers,
  LoaderCircle,
  Minus,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BeatPlayer,
  PRESETS,
  STEPS,
  VOICES,
  countHits,
  defaultMix,
  emptyPattern,
  normalizePattern,
  randomPattern,
  renderPattern,
  type Cell,
  type Mix,
  type Pattern,
  type VoiceId,
} from "../lib/drums";
import { downloadFile } from "../lib/export";
import { handOffTo } from "../lib/handoff";
import { useAssistantTool } from "../lib/useAssistantTool";
import { encodeWav, fromAudioBuffer } from "../lib/wav";

const STATE_KEY = "musictools.beats.v1";
const SAVED_KEY = "musictools.beats.saved.v1";

type Stored = { pattern: Pattern; bpm: number; swing: number; volume: number; mix: Mix };
/** A named beat keeps its mix too, so it sounds the way it did when it was saved. */
type SavedBeat = { id: string; name: string; bpm: number; swing: number; pattern: Pattern; mix?: Mix; volume?: number; createdAt: string };

function readStored(): Stored {
  const fallback: Stored = { pattern: PRESETS[0].pattern, bpm: PRESETS[0].bpm, swing: PRESETS[0].swing, volume: 0.85, mix: defaultMix() };
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const mix = readMix(parsed.mix);
    return {
      pattern: normalizePattern(parsed.pattern) ?? fallback.pattern,
      bpm: clamp(Number(parsed.bpm), 50, 220, fallback.bpm),
      swing: clamp(Number(parsed.swing), 0, 0.6, 0),
      volume: clamp(Number(parsed.volume), 0, 1, 0.85),
      mix,
    };
  } catch {
    return fallback;
  }
}

function readMix(raw: Partial<Mix> | undefined): Mix {
  const mix = defaultMix();
  for (const voice of VOICES) {
    const item = raw?.[voice.id];
    if (item) mix[voice.id] = { volume: clamp(Number(item.volume), 0, 1, 0.8), muted: Boolean(item.muted) };
  }
  return mix;
}

function readSaved(): SavedBeat[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const list = raw ? (JSON.parse(raw) as SavedBeat[]) : [];
    return Array.isArray(list)
      ? list.flatMap((item) => {
          const pattern = normalizePattern(item?.pattern);
          return pattern && typeof item.name === "string"
            ? [{
                ...item,
                pattern,
                bpm: clamp(Number(item.bpm), 50, 220, 100),
                swing: clamp(Number(item.swing), 0, 0.6, 0),
                mix: item.mix ? readMix(item.mix) : undefined,
                volume: item.volume === undefined ? undefined : clamp(Number(item.volume), 0, 1, 0.85),
              }]
            : [];
        })
      : [];
  } catch {
    return [];
  }
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** "1,5,9,13" or "1-4" → zero-based steps. */
function parseSteps(text: string) {
  const steps = new Set<number>();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let step = Number(range[1]); step <= Number(range[2]); step += 1) steps.add(step - 1);
    } else if (/^\d+$/.test(part)) {
      steps.add(Number(part) - 1);
    }
  }
  return [...steps].filter((step) => step >= 0 && step < STEPS);
}

/**
 * A sixteen-step drum machine. Every cell cycles rest → hit → accent; each row
 * has its own level and mute, and the whole groove can swing. The kit is
 * synthesised on the spot, and the loop renders to a WAV to download or to
 * send on to the mixer or the converter.
 */
export function BeatMakerTool() {
  const [initial] = useState(readStored);
  const [pattern, setPattern] = useState<Pattern>(initial.pattern);
  const [bpm, setBpm] = useState(initial.bpm);
  const [swing, setSwing] = useState(initial.swing);
  const [volume, setVolume] = useState(initial.volume);
  const [mix, setMix] = useState<Mix>(initial.mix);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [bars, setBars] = useState(4);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedBeat[]>(readSaved);
  const [name, setName] = useState("");
  const playerRef = useRef<BeatPlayer | null>(null);

  const player = useCallback(() => {
    if (!playerRef.current) playerRef.current = new BeatPlayer({ pattern, mix, bpm, swing, volume });
    return playerRef.current;
    // The player is created once; later changes reach it through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    playerRef.current?.update({ pattern, mix, bpm, swing, volume });
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ pattern, mix, bpm, swing, volume }));
    } catch {
      // Not remembered for next time; the beat still plays.
    }
  }, [bpm, mix, pattern, swing, volume]);

  useEffect(() => () => playerRef.current?.dispose(), []);

  // The playhead follows the audio clock, one frame at a time.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = -2;
    const tick = () => {
      const step = playerRef.current?.currentStep() ?? -1;
      if (step !== last) {
        last = step;
        setCurrent(step);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setCurrent(-1);
    };
  }, [playing]);

  const start = useCallback(async () => {
    try {
      await player().start();
      setPlaying(true);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "לא הצלחנו להפעיל את השמע.");
    }
  }, [player]);

  const stop = useCallback(() => {
    playerRef.current?.stop();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playerRef.current?.isPlaying) stop();
    else void start();
  }, [start, stop]);

  // Space starts and stops, unless the focus is on something Space already works.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const cycle = (voice: VoiceId, step: number) => {
    setPattern((previous) => {
      const row = [...previous[voice]];
      row[step] = ((row[step] + 1) % 3) as Cell;
      return { ...previous, [voice]: row };
    });
  };

  const setVoiceMix = (voice: VoiceId, change: Partial<Mix[VoiceId]>) => {
    setMix((previous) => ({ ...previous, [voice]: { ...previous[voice], ...change } }));
  };

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return false;
    setPattern(preset.pattern);
    setBpm(preset.bpm);
    setSwing(preset.swing);
    return true;
  };

  const render = async (length: number) => {
    const buffer = await renderPattern({ pattern, mix, bpm, swing, volume, bars: length });
    const blob = encodeWav(fromAudioBuffer(buffer));
    return new File([blob], `beat-${bpm}bpm-${length}bars.wav`, { type: "audio/wav" });
  };

  /** Renders and sends the loop; resolves with the file, or with the reason it did not happen. */
  const exportTo = async (
    target: "download" | "mixer" | "convert",
    length = bars,
  ): Promise<{ file: File } | { error: string }> => {
    if (busy) return { error: "ייצוא אחר כבר רץ." };
    if (!countHits(pattern)) {
      const message = "הרשת ריקה — צריך לפחות מכה אחת כדי שיהיה מה לייצא.";
      setError(message);
      return { error: message };
    }
    setBusy(target);
    setError(null);
    try {
      const file = await render(length);
      if (target === "download") downloadFile(file, file.name, file.type);
      else await handOffTo(target, file, "הביט ממכונת התופים");
      return { file };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "הייצוא נכשל.";
      setError(message);
      return { error: message };
    } finally {
      setBusy(null);
    }
  };

  const persistSaved = (list: SavedBeat[]) => {
    setSaved(list);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      setError("לא הצלחנו לשמור במכשיר — ייתכן שהאחסון מלא או חסום.");
    }
  };

  const saveCurrent = () => {
    const title = name.trim() || `ביט ${saved.length + 1} · ${bpm} BPM`;
    persistSaved([
      { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: title.slice(0, 60), bpm, swing, pattern, mix, volume, createdAt: new Date().toISOString() },
      ...saved,
    ].slice(0, 40));
    setName("");
  };

  useAssistantTool("beats", {
    state: () =>
      `מכונת תופים: ${playing ? "מנגנת" : "עצורה"}; ${bpm} BPM; סווינג ${Math.round(swing * 100)}%; ${countHits(pattern)} מכות ברשת. ${VOICES.map(
        (voice) => `${voice.id}: ${pattern[voice.id].map((cell) => (cell === 2 ? "X" : cell ? "x" : ".")).join("")}${mix[voice.id].muted ? " (מושתק)" : ""}`,
      ).join("; ")}.`,
    handlers: {
      "beats.play": async () => {
        await start();
        return { ok: true, message: "הביט מתנגן" };
      },
      "beats.stop": () => {
        stop();
        return { ok: true, message: "הביט נעצר" };
      },
      "beats.set": ({ bpm: nextBpm, swing: nextSwing, volume: nextVolume }) => {
        if (nextBpm !== undefined) setBpm(clamp(Number(nextBpm), 50, 220, bpm));
        if (nextSwing !== undefined) setSwing(clamp(Number(nextSwing) / 100, 0, 0.6, swing));
        if (nextVolume !== undefined) setVolume(clamp(Number(nextVolume) / 100, 0, 1, volume));
        return { ok: true, message: "ההגדרות עודכנו" };
      },
      "beats.preset": ({ style }) =>
        applyPreset(String(style))
          ? { ok: true, message: `נטען סגנון ${PRESETS.find((item) => item.id === style)?.label}` }
          : { ok: false, message: `אין סגנון בשם ${String(style)}` },
      "beats.random": () => {
        setPattern(randomPattern());
        return { ok: true, message: "נוצר ביט אקראי" };
      },
      "beats.clear": () => {
        setPattern(emptyPattern());
        return { ok: true, message: "הרשת נוקתה" };
      },
      "beats.steps": ({ voice, steps, accent, clear }) => {
        const id = VOICES.find((item) => item.id === voice)?.id;
        if (!id) return { ok: false, message: `אין כלי בשם ${String(voice)}` };
        const list = parseSteps(String(steps ?? ""));
        setPattern((previous) => {
          const row: Cell[] = clear ? Array<Cell>(STEPS).fill(0) : [...previous[id]];
          for (const step of list) row[step] = accent ? 2 : 1;
          return { ...previous, [id]: row };
        });
        return { ok: true, message: `${VOICES.find((item) => item.id === id)?.label}: ${list.length} צעדים` };
      },
      "beats.export": async ({ bars: nextBars }) => {
        const length = nextBars === undefined ? bars : Math.round(clamp(Number(nextBars), 1, 16, bars));
        if (nextBars !== undefined) setBars(length);
        const outcome = await exportTo("download", length);
        return "file" in outcome
          ? { ok: true, message: `${outcome.file.name} ירד (${length} תיבות)` }
          : { ok: false, message: outcome.error };
      },
    },
  });

  const hits = countHits(pattern);

  return (
    <section className="tool-body beats-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Grid3x3 size={26} />
        </span>
        <div>
          <h1>מכונת תופים</h1>
          <p>לוחצים על משבצת כדי להוסיף מכה. לחיצה שנייה מדגישה אותה, ושלישית מוחקת. רווח מפעיל ועוצר.</p>
        </div>
      </div>

      <div className="beat-deck">
        <button type="button" className={`beat-play ${playing ? "is-playing" : ""}`} onClick={toggle} aria-pressed={playing}>
          {playing ? <Square size={22} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          <span>{playing ? "עצירה" : "ניגון"}</span>
        </button>

        <div className="beat-tempo" dir="ltr">
          <button type="button" className="bpm-step" onClick={() => setBpm((value) => Math.max(50, value - 1))} aria-label="הורדת הקצב">
            <Minus size={18} />
          </button>
          <div className="beat-tempo-value">
            <strong>{bpm}</strong>
            <span>BPM</span>
          </div>
          <button type="button" className="bpm-step" onClick={() => setBpm((value) => Math.min(220, value + 1))} aria-label="העלאת הקצב">
            <Plus size={18} />
          </button>
        </div>

        <div className="beat-knobs">
          <label className="setting-field">
            <span>
              קצב <b>{bpm}</b>
            </span>
            <input type="range" min={50} max={220} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} aria-label="קצב הביט" />
          </label>
          <label className="setting-field">
            <span>
              סווינג <b>{Math.round(swing * 100)}%</b>
            </span>
            <input type="range" min={0} max={60} value={Math.round(swing * 100)} onChange={(event) => setSwing(Number(event.target.value) / 100)} aria-label="סווינג" />
          </label>
          <label className="setting-field">
            <span>
              <Volume2 size={14} /> עוצמה <b>{Math.round(volume * 100)}%</b>
            </span>
            <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(event) => setVolume(Number(event.target.value) / 100)} aria-label="עוצמה ראשית" />
          </label>
        </div>
      </div>

      <div className="preset-strip">
        <span>סגנונות</span>
        <div className="preset-row">
          {PRESETS.filter((preset) => preset.id !== "empty").map((preset) => (
            <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)}>
              {preset.label}
            </button>
          ))}
          <button type="button" onClick={() => setPattern(randomPattern())}>
            <Dices size={14} /> הפתיעו אותי
          </button>
          <button type="button" onClick={() => setPattern(emptyPattern())}>
            <Eraser size={14} /> ניקוי
          </button>
        </div>
      </div>

      <div className="beat-grid-wrap">
        <div className="beat-grid" dir="ltr" role="group" aria-label="רשת הצעדים">
          <div className="beat-row beat-ruler" aria-hidden="true">
            <span className="beat-voice" />
            <div className="beat-steps">
              {Array.from({ length: STEPS }, (_, step) => (
                <i key={step} className={`${step % 4 === 0 ? "is-beat" : ""} ${current === step ? "is-now" : ""}`}>
                  {step % 4 === 0 ? step / 4 + 1 : "·"}
                </i>
              ))}
            </div>
          </div>
          {VOICES.map((voice) => {
            const row = pattern[voice.id];
            const voiceMix = mix[voice.id];
            return (
              <div
                key={voice.id}
                className={`beat-row ${voiceMix.muted ? "is-muted" : ""}`}
                style={{ "--accent-hue": voice.hue } as CSSProperties}
              >
                <div className="beat-voice">
                  <button type="button" className="beat-voice-name" onClick={() => void player().preview(voice.id)} title={`השמעת ${voice.label}`}>
                    <b>{voice.short}</b>
                    <small dir="rtl">{voice.label}</small>
                  </button>
                  <button
                    type="button"
                    className={`mixer-toggle ${voiceMix.muted ? "active" : ""}`}
                    onClick={() => setVoiceMix(voice.id, { muted: !voiceMix.muted })}
                    aria-pressed={voiceMix.muted}
                    aria-label={`${voiceMix.muted ? "ביטול השתקה" : "השתקה"}: ${voice.label}`}
                  >
                    {voiceMix.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  <input
                    className="beat-level"
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(voiceMix.volume * 100)}
                    onChange={(event) => setVoiceMix(voice.id, { volume: Number(event.target.value) / 100 })}
                    aria-label={`עוצמה: ${voice.label}`}
                  />
                </div>
                <div className="beat-steps">
                  {row.map((cell, step) => (
                    <button
                      key={step}
                      type="button"
                      className={`beat-cell ${cell === 1 ? "is-on" : ""} ${cell === 2 ? "is-accent" : ""} ${step % 4 === 0 ? "is-beat" : ""} ${Math.floor(step / 4) % 2 ? "is-odd" : ""} ${current === step ? "is-now" : ""}`}
                      onClick={() => cycle(voice.id, step)}
                      aria-pressed={cell > 0}
                      aria-label={`${voice.label}, צעד ${step + 1}${cell === 2 ? ", מודגש" : ""}`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="table-footnote">
        {hits} מכות ברשת · תיבה אחת של 4/4 בשש־עשריות · הביט נשמר במכשיר ומחכה לך בפעם הבאה.
      </p>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      <div className="downloads-card">
        <div>
          <span className="download-icon">
            <Download size={22} />
          </span>
          <div>
            <h3>הביט כקובץ</h3>
            <p>לולאה של כמה תיבות, מוכנה להורדה, למיקסר או להמרה ל־MP3.</p>
          </div>
        </div>
        <div className="setting-field beat-bars">
          <span>אורך</span>
          <div className="segmented-control">
            {[1, 2, 4, 8].map((count) => (
              <button key={count} type="button" className={bars === count ? "active" : ""} onClick={() => setBars(count)} aria-pressed={bars === count}>
                {count === 1 ? "תיבה" : `${count} תיבות`}
              </button>
            ))}
          </div>
        </div>
        <div className="download-buttons">
          <button type="button" onClick={() => void exportTo("download")} disabled={Boolean(busy)}>
            {busy === "download" ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}
            <span>
              הורדת WAV<small>{bars} תיבות · {bpm} BPM</small>
            </span>
          </button>
          <button type="button" onClick={() => void exportTo("mixer")} disabled={Boolean(busy)}>
            {busy === "mixer" ? <LoaderCircle size={17} className="spin" /> : <Layers size={17} />}
            <span>
              למיקסר<small>ערוץ תופים לצד השירה</small>
            </span>
          </button>
          <button type="button" onClick={() => void exportTo("convert")} disabled={Boolean(busy)}>
            {busy === "convert" ? <LoaderCircle size={17} className="spin" /> : <ArrowLeftRight size={17} />}
            <span>
              להמרה ל־MP3<small>קובץ קטן לשיתוף</small>
            </span>
          </button>
        </div>
      </div>

      <div className="settings-panel">
        <div className="settings-title">
          <Save size={18} /> הביטים שלי <em>נשמרים במכשיר הזה</em>
        </div>
        <div className="beat-save">
          <input
            className="field"
            type="text"
            value={name}
            maxLength={60}
            placeholder="שם לביט, למשל „גרוב לשיר החדש”"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveCurrent();
            }}
            aria-label="שם הביט"
          />
          <button type="button" className="secondary-button" onClick={saveCurrent}>
            <Save size={16} /> שמירה
          </button>
        </div>
        {saved.length > 0 ? (
          <ul className="beat-saved">
            {saved.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="beat-saved-load"
                  onClick={() => {
                    setPattern(item.pattern);
                    setBpm(item.bpm);
                    setSwing(item.swing);
                    if (item.mix) setMix(item.mix);
                    if (item.volume !== undefined) setVolume(item.volume);
                  }}
                >
                  <b>{item.name}</b>
                  <small>
                    {item.bpm} BPM · {countHits(item.pattern)} מכות
                  </small>
                </button>
                <button
                  type="button"
                  className="icon-button is-danger"
                  onClick={() => persistSaved(saved.filter((other) => other.id !== item.id))}
                  aria-label={`מחיקת ${item.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="table-footnote">עוד אין ביטים שמורים. תנו לביט שם ולחצו „שמירה”.</p>
        )}
      </div>
    </section>
  );
}
