import { Minus, Pause, Play, Plus, Timer, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaveButton } from "../components/SaveButton";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";

type SoundKind = "click" | "wood" | "beep";

type MeterOption = { id: string; beats: number; beatType: number; label: string };

const METERS: MeterOption[] = [
  { id: "2/4", beats: 2, beatType: 4, label: "2/4" },
  { id: "3/4", beats: 3, beatType: 4, label: "3/4" },
  { id: "4/4", beats: 4, beatType: 4, label: "4/4" },
  { id: "5/4", beats: 5, beatType: 4, label: "5/4" },
  { id: "6/8", beats: 6, beatType: 8, label: "6/8" },
  { id: "7/8", beats: 7, beatType: 8, label: "7/8" },
];

const SUBDIVISIONS = [
  { value: 1, label: "רבעים" },
  { value: 2, label: "שמיניות" },
  { value: 3, label: "טריולות" },
  { value: 4, label: "שש־עשריות" },
];

const SETTINGS_KEY = "musictools.metronome.v1";

type Saved = {
  bpm: number;
  meter: string;
  subdivision: number;
  sound: SoundKind;
  volume: number;
};

function normalizeSaved(parsed: Partial<Saved> | null | undefined, fallback: Saved): Saved {
  if (!parsed) return fallback;
  return {
    bpm: Math.max(30, Math.min(260, Number(parsed.bpm) || fallback.bpm)),
    meter: METERS.some((meter) => meter.id === parsed.meter) ? (parsed.meter as string) : fallback.meter,
    subdivision: [1, 2, 3, 4].includes(Number(parsed.subdivision)) ? Number(parsed.subdivision) : fallback.subdivision,
    sound: parsed.sound === "wood" || parsed.sound === "beep" ? parsed.sound : parsed.sound === "click" ? "click" : fallback.sound,
    volume: Math.max(0, Math.min(1, Number(parsed.volume) || fallback.volume)),
  };
}

function loadSaved(initial: SavedWork | null): Saved {
  const fallback: Saved = {
    bpm: 100,
    meter: "4/4",
    subdivision: 1,
    sound: "click",
    volume: 0.8,
  };
  let saved = fallback;
  try {
    saved = normalizeSaved(
      JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null,
      fallback,
    );
  } catch {
    // Private browsing; the defaults will do.
  }
  // A preset opened from the personal area sets the tempo, meter and sound;
  // the volume stays whatever this device is used to.
  if (initial?.kind !== "metronome") return saved;
  return normalizeSaved({ ...(initial.payload as Partial<Saved>), volume: saved.volume }, saved);
}

type Props = {
  initial?: SavedWork | null;
};

function tempoMarking(bpm: number) {
  if (bpm < 60) return "Largo · רחב";
  if (bpm < 76) return "Adagio · איטי";
  if (bpm < 108) return "Andante · הליכה";
  if (bpm < 120) return "Moderato · מתון";
  if (bpm < 156) return "Allegro · עליז";
  if (bpm < 200) return "Vivace · תוסס";
  return "Presto · מהיר מאוד";
}

type Tick = { time: number; beat: number; sub: number };

/**
 * Timing runs on the audio clock with a short look-ahead, the standard
 * pattern for a metronome that stays exact when the tab is busy. The UI only
 * observes which beat the clock has reached; it never drives it.
 */
export function MetronomeTool({ initial = null }: Props) {
  const [saved] = useState(() => loadSaved(initial));
  const [bpm, setBpm] = useState(saved.bpm);
  const [meterId, setMeterId] = useState(saved.meter);
  const [subdivision, setSubdivision] = useState(saved.subdivision);
  const [sound, setSound] = useState<SoundKind>(saved.sound);
  const [volume, setVolume] = useState(saved.volume);
  const [running, setRunning] = useState(false);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [flash, setFlash] = useState(0);
  const [tapHint, setTapHint] = useState("");

  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextTimeRef = useRef(0);
  const beatRef = useRef(0);
  const subRef = useRef(0);
  const queueRef = useRef<Tick[]>([]);
  const settingsRef = useRef({ bpm, subdivision, sound, volume });
  const meter = useMemo(
    () => METERS.find((item) => item.id === meterId) ?? METERS[2],
    [meterId],
  );
  const meterRef = useRef(meter);
  const tapsRef = useRef<number[]>([]);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  // A different tempo, meter or sound is a different preset.
  useEffect(() => resetSave(), [bpm, meterId, resetSave, sound, subdivision]);

  const savePreset = () => {
    const subdivisionLabel =
      SUBDIVISIONS.find((item) => item.value === subdivision)?.label ?? "";
    return saving.save({
      kind: "metronome",
      title: `${bpm} BPM · ${meter.label}`,
      summary: { bpm, meter: meter.label, subdivision, subdivisionLabel, sound },
      payload: { bpm, meter: meterId, subdivision, sound },
    });
  };

  useEffect(() => {
    settingsRef.current = { bpm, subdivision, sound, volume };
    meterRef.current = meter;
    if (masterRef.current) masterRef.current.gain.value = volume;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ bpm, meter: meterId, subdivision, sound, volume } satisfies Saved),
      );
    } catch {
      // Private browsing; settings simply do not persist.
    }
  }, [bpm, meter, meterId, subdivision, sound, volume]);

  const clickAt = useCallback((time: number, accent: boolean, isSub: boolean) => {
    const context = contextRef.current;
    const master = masterRef.current;
    if (!context || !master) return;
    const kind = settingsRef.current.sound;
    const gain = context.createGain();
    gain.connect(master);
    const level = accent ? 1 : isSub ? 0.35 : 0.65;

    if (kind === "click") {
      // A pitched blip with a noise transient reads as a real studio click.
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(accent ? 1760 : isSub ? 1175 : 1320, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(level, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.06);
    } else if (kind === "wood") {
      const osc = context.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(accent ? 900 : isSub ? 600 : 720, time);
      osc.frequency.exponentialRampToValueAtTime(accent ? 500 : 400, time + 0.04);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(level * 0.9, time + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.1);
    } else {
      const osc = context.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(accent ? 1320 : isSub ? 660 : 880, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(level * 0.4, time + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.09);
    }
  }, []);

  const schedule = useCallback(() => {
    const context = contextRef.current;
    if (!context) return;
    const lookahead = 0.12;
    while (nextTimeRef.current < context.currentTime + lookahead) {
      const { bpm: currentBpm, subdivision: subs } = settingsRef.current;
      const currentMeter = meterRef.current;
      const beat = beatRef.current;
      const sub = subRef.current;
      const accent = beat === 0 && sub === 0;
      clickAt(nextTimeRef.current, accent, sub !== 0);
      queueRef.current.push({ time: nextTimeRef.current, beat, sub });

      // In 6/8 and 7/8 the pulse is the eighth, so the beat is half as long.
      const beatSeconds = (60 / currentBpm) * (4 / currentMeter.beatType);
      nextTimeRef.current += beatSeconds / subs;
      subRef.current = (sub + 1) % subs;
      if (subRef.current === 0) beatRef.current = (beat + 1) % currentMeter.beats;
    }
  }, [clickAt]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const context = contextRef.current;
      if (context) {
        const queue = queueRef.current;
        while (queue.length && queue[0].time <= context.currentTime) {
          const next = queue.shift()!;
          if (next.sub === 0) {
            setActiveBeat(next.beat);
            setFlash((value) => value + 1);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const start = useCallback(async () => {
    if (!contextRef.current) {
      const Context =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) return;
      contextRef.current = new Context();
      masterRef.current = contextRef.current.createGain();
      masterRef.current.gain.value = settingsRef.current.volume;
      masterRef.current.connect(contextRef.current.destination);
    }
    const context = contextRef.current;
    if (context.state === "suspended") await context.resume();
    beatRef.current = 0;
    subRef.current = 0;
    queueRef.current = [];
    nextTimeRef.current = context.currentTime + 0.05;
    schedule();
    timerRef.current = window.setInterval(schedule, 25);
    setRunning(true);
    try {
      const lock = await (navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      }).wakeLock?.request("screen");
      if (lock) wakeLockRef.current = lock;
    } catch {
      // Wake lock is a nicety; a denied request changes nothing.
    }
  }, [schedule]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    queueRef.current = [];
    setRunning(false);
    setActiveBeat(-1);
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      void contextRef.current?.close();
      void wakeLockRef.current?.release().catch(() => undefined);
    },
    [],
  );

  const toggle = useCallback(() => {
    if (running) stop();
    else void start();
  }, [running, start, stop]);

  const nudge = useCallback((delta: number) => {
    setBpm((value) => Math.max(30, Math.min(260, value + delta)));
  }, []);

  const tap = useCallback(() => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length < 2) {
      setTapHint("המשך להקיש…");
      return;
    }
    const intervals = taps.slice(1).map((time, index) => time - taps[index]);
    const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const detected = Math.round(60000 / average);
    setBpm(Math.max(30, Math.min(260, detected)));
    setTapHint(`${taps.length} הקשות`);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        nudge(event.shiftKey ? 10 : 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudge(event.shiftKey ? -10 : -1);
      } else if (event.key.toLowerCase() === "t") {
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge, tap, toggle]);

  useAssistantTool("metronome", {
    state: () =>
      `מטרונום: ${bpm} BPM, משקל ${meter.label}, חלוקה ${SUBDIVISIONS.find((item) => item.value === subdivision)?.label ?? subdivision}, צליל ${sound}, עוצמה ${Math.round(volume * 100)}%, ${running ? "פועל" : "עצור"}.`,
    handlers: {
      "metronome.set": ({ bpm: nextBpm, meter: nextMeter, subdivision: nextSubdivision, sound: nextSound, volume: nextVolume }) => {
        const done: string[] = [];
        if (typeof nextBpm === "number") {
          const clamped = Math.max(30, Math.min(260, Math.round(nextBpm)));
          setBpm(clamped);
          done.push(`${clamped} BPM`);
        }
        if (typeof nextMeter === "string") {
          setMeterId(nextMeter);
          done.push(`משקל ${nextMeter}`);
        }
        if (typeof nextSubdivision === "number") {
          if (![1, 2, 3, 4].includes(nextSubdivision)) return { ok: false, message: "subdivision הוא 1, 2, 3 או 4" };
          setSubdivision(nextSubdivision);
          done.push(SUBDIVISIONS.find((item) => item.value === nextSubdivision)?.label ?? "");
        }
        if (nextSound === "click" || nextSound === "wood" || nextSound === "beep") {
          setSound(nextSound);
          done.push(`צליל ${nextSound}`);
        }
        if (typeof nextVolume === "number") {
          setVolume(Math.max(0, Math.min(1, nextVolume / 100)));
          done.push(`עוצמה ${Math.round(nextVolume)}%`);
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "metronome.start": () => {
        if (!running) void start();
        return { ok: true, message: `המטרונום פועל ב־${bpm} BPM` };
      },
      "metronome.stop": () => {
        stop();
        return { ok: true, message: "המטרונום נעצר" };
      },
      "metronome.save": async () => {
        const saved = await savePreset();
        return saved ? { ok: true, message: "הקצב נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
    },
  });

  const pendulumAngle = running ? (activeBeat % 2 === 0 ? -22 : 22) : 0;
  const beatSeconds = (60 / bpm) * (4 / meter.beatType);

  return (
    <section className="tool-body metronome">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Timer size={26} />
        </span>
        <div>
          <h1>מטרונום</h1>
          <p>בחר קצב ולחץ על הפעל.</p>
        </div>
        <div className="tool-intro-side">
          <SaveButton state={saving.state} onSave={() => void savePreset()} label="שמור את הקצב" message={saving.message} compact />
        </div>
      </div>

      <div className="metronome-stage" data-running={running}>
        <div className="pendulum-frame" aria-hidden="true">
          <div
            className="pendulum"
            style={{
              transform: `rotate(${pendulumAngle}deg)`,
              transitionDuration: running ? `${beatSeconds}s` : "0.4s",
            }}
          >
            <span className="pendulum-weight" />
          </div>
        </div>

        <div className="bpm-readout">
          <button className="bpm-step" onClick={() => nudge(-1)} type="button" aria-label="הורד BPM">
            <Minus size={22} />
          </button>
          <div className="bpm-value" key={flash}>
            <strong>{bpm}</strong>
            <span>BPM · {tempoMarking(bpm)}</span>
          </div>
          <button className="bpm-step" onClick={() => nudge(1)} type="button" aria-label="העלה BPM">
            <Plus size={22} />
          </button>
        </div>

        <input
          className="bpm-slider"
          type="range"
          min={30}
          max={260}
          value={bpm}
          onChange={(event) => setBpm(Number(event.target.value))}
          aria-label="קצב"
        />

        <div className="beat-dots" role="img" aria-label={`תיבה של ${meter.beats} פעמות`}>
          {Array.from({ length: meter.beats }, (_, index) => (
            <span
              key={index}
              className={`beat-dot ${index === activeBeat ? "is-active" : ""} ${index === 0 ? "is-accent" : ""}`}
            />
          ))}
        </div>

        <div className="metronome-actions">
          <button className="primary-button" onClick={toggle} type="button">
            {running ? <Pause size={20} /> : <Play size={20} />}
            {running ? "עצור" : "הפעל"}
          </button>
          <button className="secondary-button" onClick={tap} type="button">
            טאפ־טמפו{tapHint ? ` · ${tapHint}` : ""}
          </button>
        </div>
      </div>

      <div className="settings-panel">
        <div className="settings-grid">
          <div className="setting-field">
            <span>משקל</span>
            <div className="segmented-control wrap">
              {METERS.map((item) => (
                <button
                  key={item.id}
                  className={meterId === item.id ? "active" : ""}
                  onClick={() => setMeterId(item.id)}
                  type="button"
                  aria-pressed={meterId === item.id}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-field">
            <span>חלוקת משנה</span>
            <div className="segmented-control wrap">
              {SUBDIVISIONS.map((item) => (
                <button
                  key={item.value}
                  className={subdivision === item.value ? "active" : ""}
                  onClick={() => setSubdivision(item.value)}
                  type="button"
                  aria-pressed={subdivision === item.value}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-field">
            <span>צליל</span>
            <div className="segmented-control">
              {(["click", "wood", "beep"] as SoundKind[]).map((kind) => (
                <button
                  key={kind}
                  className={sound === kind ? "active" : ""}
                  onClick={() => setSound(kind)}
                  type="button"
                  aria-pressed={sound === kind}
                >
                  {kind === "click" ? "קליק" : kind === "wood" ? "עץ" : "ביפ"}
                </button>
              ))}
            </div>
          </div>
          <label className="setting-field range-field">
            <span>
              <Volume2 size={15} /> עוצמה <b>{Math.round(volume * 100)}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => setVolume(Number(event.target.value) / 100)}
            />
          </label>
        </div>
      </div>

      <div className="preset-strip">
        <span>קצבים נפוצים</span>
        <div className="preset-row" aria-label="קצבים נפוצים">
          {[60, 80, 100, 120, 140, 160, 180].map((preset) => (
            <button
              key={preset}
              type="button"
              className={bpm === preset ? "active" : ""}
              onClick={() => setBpm(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
