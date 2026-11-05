import { Gauge, Mic, MicOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaveButton } from "../components/SaveButton";
import { centsOff, detectPitch, frequencyToMidi, midiToFrequency } from "../lib/dsp";
import { hebrewNoteName, scientificName } from "../lib/key";
import { parseNoteName } from "../lib/noteNames";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";

type Preset = { id: string; label: string; strings: number[] | null };

const PRESETS: Preset[] = [
  { id: "chromatic", label: "כרומטי", strings: null },
  { id: "guitar", label: "גיטרה", strings: [40, 45, 50, 55, 59, 64] },
  { id: "bass", label: "בס", strings: [28, 33, 38, 43] },
  { id: "ukulele", label: "יוקללה", strings: [67, 60, 64, 69] },
  { id: "violin", label: "כינור", strings: [55, 62, 69, 76] },
  { id: "cello", label: "צ׳לו", strings: [36, 43, 50, 57] },
];

type Reading = {
  frequency: number;
  midi: number;
  cents: number;
  clarity: number;
  level: number;
};

// Readings kept for the median. The detector runs on every other frame
// (~30 a second), so four of them span about 130 ms.
const HISTORY = 4;

/**
 * The lowest frequency worth searching for, and how many of the newest samples
 * to search. The detector's default floor (55 Hz) is above a bass's low E
 * (41 Hz) and A (55 Hz), which then never read at all; and correlating a full
 * 4096-sample window at 60 frames a second costs a busy core for nothing when
 * the lowest note is a guitar's 82 Hz. So both follow the instrument: the floor
 * sits a few semitones under its lowest string (or under a bass's low E for the
 * chromatic tuner), and the window holds about two and a half periods of it.
 */
function searchRange(strings: number[] | null, referenceA4: number, sampleRate: number, bufferSize: number) {
  const lowest = strings ? Math.min(...strings) : 28;
  const minFrequency = midiToFrequency(lowest, referenceA4) * 0.75;
  const maxLag = sampleRate / minFrequency;
  const window = Math.min(bufferSize, Math.ceil((maxLag * 2.5) / 1024) * 1024);
  return { minFrequency, window };
}

type Props = {
  initial?: SavedWork | null;
};

/** The instrument and reference pitch a saved setup asks for. */
function readInitial(work: SavedWork | null | undefined) {
  const payload = work?.kind === "tuner" ? work.payload : {};
  return {
    presetId: PRESETS.some((item) => item.id === payload.presetId)
      ? (payload.presetId as string)
      : "chromatic",
    referenceA4:
      typeof payload.referenceA4 === "number"
        ? Math.max(430, Math.min(450, Math.round(payload.referenceA4)))
        : 440,
  };
}

/**
 * The microphone feeds an analyser; every frame the latest window goes
 * through the autocorrelation detector and the median of the last few
 * readings drives the needle, which keeps it steady on a wobbly note.
 */
export function TunerTool({ initial = null }: Props) {
  const [restored] = useState(() => readInitial(initial));
  const [presetId, setPresetId] = useState(restored.presetId);
  const [referenceA4, setReferenceA4] = useState(restored.referenceA4);
  const [listening, setListening] = useState(false);
  // Waiting for the browser to hand over the microphone (the permission
  // prompt can sit open for a while); the button already offers to cancel.
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [toneMidi, setToneMidi] = useState<number | null>(null);

  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef(0);
  const historyRef = useRef<number[]>([]);
  const lastGoodRef = useRef(0);
  const referenceRef = useRef(referenceA4);
  const toneRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  // The reference tone has its own context: sharing the microphone's meant
  // that stopping the listening killed a sounding tone (its button stayed
  // lit), and listening after a tone orphaned the tone's context, still
  // playing, with nothing left to stop it.
  const toneContextRef = useRef<AudioContext | null>(null);
  // Bumped by every start and stop, so a microphone that is granted after
  // the visitor pressed stop, pressed start twice, or left the tool is
  // released at once instead of staying open with nothing reading it.
  const sessionRef = useRef(0);
  const stringsRef = useRef<number[] | null>(null);

  const preset = useMemo(
    () => PRESETS.find((item) => item.id === presetId) ?? PRESETS[0],
    [presetId],
  );
  const saving = useSaveWork();
  const resetSave = saving.reset;

  useEffect(() => resetSave(), [presetId, referenceA4, resetSave]);

  const saveSetup = () => {
    return saving.save({
      kind: "tuner",
      title: `${preset.label} · לה ${referenceA4} Hz`,
      summary: { presetId, presetLabel: preset.label, referenceA4 },
      payload: { presetId, referenceA4 },
    });
  };

  useEffect(() => {
    referenceRef.current = referenceA4;
    stringsRef.current = preset.strings;
  }, [preset.strings, referenceA4]);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    historyRef.current = [];
    setListening(false);
    setStarting(false);
    setReading(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    // Any earlier session (still waiting for permission, or running) ends here.
    stop();
    const session = sessionRef.current;
    setStarting(true);
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const Context =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      context = new Context();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      contextRef.current = context;
      streamRef.current = stream;
      analyserRef.current = analyser;
      setStarting(false);
      setListening(true);

      const buffer = new Float32Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        const node = analyserRef.current;
        const audio = contextRef.current;
        if (!node || !audio) return;
        frame += 1;
        if (frame % 2 === 1) {
          frameRef.current = requestAnimationFrame(tick);
          return;
        }
        node.getFloatTimeDomainData(buffer);
        const range = searchRange(stringsRef.current, referenceRef.current, audio.sampleRate, buffer.length);
        // The newest samples are at the end of the analyser's buffer.
        const pitch = detectPitch(buffer.subarray(buffer.length - range.window), audio.sampleRate, range.minFrequency);
        const now = performance.now();
        if (pitch.frequency > 0 && pitch.clarity > 0.8) {
          historyRef.current.push(pitch.frequency);
          if (historyRef.current.length > HISTORY) historyRef.current.shift();
          const sorted = [...historyRef.current].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          lastGoodRef.current = now;
          setReading({
            frequency: median,
            midi: Math.round(frequencyToMidi(median, referenceRef.current)),
            cents: centsOff(median, referenceRef.current),
            clarity: pitch.clarity,
            level: Math.min(1, pitch.rms * 6),
          });
        } else if (now - lastGoodRef.current > 600) {
          historyRef.current = [];
          const level = Math.min(1, pitch.rms * 6);
          // In silence the reading only carries the level meter; leaving it
          // alone when nothing visible moved spares a render every frame.
          setReading((current) =>
            !current || (current.clarity === 0 && Math.abs(current.level - level) < 0.01)
              ? current
              : { ...current, clarity: 0, level },
          );
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      if (session !== sessionRef.current) return;
      contextRef.current = null;
      streamRef.current = null;
      analyserRef.current = null;
      setListening(false);
      setStarting(false);
      setError(
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "לא ניתנה גישה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן."
          : "לא הצלחנו לפתוח את המיקרופון.",
      );
    }
  }, [stop]);

  const stopTone = useCallback(() => {
    const tone = toneRef.current;
    const context = toneContextRef.current;
    if (tone && context) {
      const now = context.currentTime;
      tone.gain.gain.setTargetAtTime(0.0001, now, 0.05);
      tone.osc.stop(now + 0.3);
    }
    toneRef.current = null;
    setToneMidi(null);
  }, []);

  useEffect(
    () => () => {
      stop();
      toneRef.current = null;
      void toneContextRef.current?.close();
      toneContextRef.current = null;
    },
    [stop],
  );

  const playTone = useCallback(
    (midi: number) => {
      if (toneMidi === midi) {
        stopTone();
        return;
      }
      stopTone();
      if (!toneContextRef.current) {
        const Context =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Context) return;
        toneContextRef.current = new Context();
      }
      const context = toneContextRef.current;
      void context.resume();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "triangle";
      osc.frequency.value = midiToFrequency(midi, referenceRef.current);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      toneRef.current = { osc, gain };
      setToneMidi(midi);
    },
    [stopTone, toneMidi],
  );

  // Against a preset the needle measures distance to the nearest string
  // rather than to the nearest semitone, so a badly flat string still says
  // "tune up" instead of naming the wrong note.
  const display = useMemo(() => {
    if (!reading || reading.clarity === 0) return null;
    if (!preset.strings) return reading;
    const exact = frequencyToMidi(reading.frequency, referenceA4);
    const nearest = preset.strings.reduce((best, candidate) =>
      Math.abs(candidate - exact) < Math.abs(best - exact) ? candidate : best,
    );
    return {
      ...reading,
      midi: nearest,
      cents: Math.max(-50, Math.min(50, (exact - nearest) * 100)),
    };
  }, [preset.strings, reading, referenceA4]);

  useAssistantTool("tuner", {
    state: () =>
      `מכוון כלים: ${preset.label}, לה = ${referenceA4} Hz, ${listening ? "מאזין למיקרופון" : "לא מאזין"}${display ? `; נקלט ${scientificName(display.midi)} (${Math.round(display.cents) > 0 ? "+" : ""}${Math.round(display.cents)} סנט, ${display.frequency.toFixed(1)} Hz)` : ""}${toneMidi !== null ? `; מושמע צליל ייחוס ${scientificName(toneMidi)}` : ""}.`,
    handlers: {
      "tuner.set": ({ instrument, referenceA4: reference }) => {
        const done: string[] = [];
        if (typeof instrument === "string") {
          const found = PRESETS.find((item) => item.id === instrument);
          if (!found) return { ok: false, message: `אין כלי כזה; יש: ${PRESETS.map((item) => item.id).join(", ")}` };
          setPresetId(found.id);
          done.push(found.label);
        }
        if (typeof reference === "number") {
          const clamped = Math.max(430, Math.min(450, Math.round(reference)));
          setReferenceA4(clamped);
          done.push(`לה = ${clamped} Hz`);
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "tuner.listen": async ({ on }) => {
        if (on) {
          if (!listening && !starting) await start();
          return { ok: true, message: "מאזין למיקרופון; נגן צליל" };
        }
        stop();
        return { ok: true, message: "ההאזנה נעצרה" };
      },
      "tuner.tone": ({ note }) => {
        const midi = parseNoteName(String(note));
        if (midi === null) return { ok: false, message: "כתוב תו כמו E2, A4 או C#3" };
        playTone(midi);
        return { ok: true, message: toneMidi === midi ? `הצליל ${scientificName(midi)} הופסק` : `מושמע ${scientificName(midi)}` };
      },
      "tuner.save": async () => {
        const saved = await saveSetup();
        return saved ? { ok: true, message: "הכיוון נשמר באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "tuner.read": () => ({
        ok: true,
        message: display ? `${scientificName(display.midi)}, ${Math.round(display.cents)} סנט` : listening ? "לא נקלט צליל ברור" : "לא מאזין",
        data: { listening, note: display ? scientificName(display.midi) : null, cents: display ? Math.round(display.cents) : null, frequency: display ? Number(display.frequency.toFixed(1)) : null, instrument: preset.id, referenceA4 },
      }),
    },
  });

  const inTune = display ? Math.abs(display.cents) <= 5 : false;
  const needleAngle = display ? (display.cents / 50) * 60 : 0;

  return (
    <section className="tool-body tuner">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Gauge size={26} />
        </span>
        <div>
          <h1>מכוון כלים</h1>
          <p>נגן צליל ליד המיקרופון כדי לכוון את הכלי.</p>
        </div>
        <div className="tool-intro-side">
          <SaveButton state={saving.state} onSave={() => void saveSetup()} label="שמור את הכיוון" message={saving.message} compact />
        </div>
      </div>

      <div className={`tuner-stage ${inTune ? "is-in-tune" : ""} ${display ? "has-signal" : ""}`}>
        <svg viewBox="0 0 320 190" className="tuner-gauge" aria-hidden="true">
          <defs>
            <linearGradient id="tuner-arc" x1="0" x2="1">
              <stop offset="0" stopColor="hsl(20 90% 60%)" />
              <stop offset="0.5" stopColor="hsl(150 70% 50%)" />
              <stop offset="1" stopColor="hsl(20 90% 60%)" />
            </linearGradient>
          </defs>
          <path
            d="M 30 160 A 130 130 0 0 1 290 160"
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M 30 160 A 130 130 0 0 1 290 160"
            fill="none"
            stroke="url(#tuner-arc)"
            strokeWidth="12"
            strokeLinecap="round"
            opacity={display ? 0.75 : 0.25}
          />
          {[-50, -25, 0, 25, 50].map((mark) => {
            const angle = ((mark / 50) * 60 - 90) * (Math.PI / 180);
            const x1 = 160 + Math.cos(angle) * 112;
            const y1 = 160 + Math.sin(angle) * 112;
            const x2 = 160 + Math.cos(angle) * 100;
            const y2 = 160 + Math.sin(angle) * 100;
            return (
              <line
                key={mark}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--text-muted)"
                strokeWidth={mark === 0 ? 3 : 1.5}
              />
            );
          })}
          <g
            className="tuner-needle"
            style={{ transform: `rotate(${needleAngle}deg)`, transformOrigin: "160px 160px" }}
          >
            <line x1="160" y1="160" x2="160" y2="48" strokeWidth="4" strokeLinecap="round" />
            <circle cx="160" cy="160" r="9" />
          </g>
        </svg>

        <div className="tuner-readout">
          {display ? (
            <>
              <strong className="tuner-note">{scientificName(display.midi)}</strong>
              <span className="tuner-hebrew">{hebrewNoteName(display.midi)}</span>
              <span className="tuner-cents">
                {/* Isolated left-to-right, or the RTL line moves the sign to
                    the far side of the number ("12-" for flat). The sign
                    follows the rounded value, so a note 0.4 cents sharp does
                    not read "+0". */}
                <bdi dir="ltr">
                  {Math.round(display.cents) > 0 ? "+" : ""}
                  {Math.round(display.cents)}
                </bdi>{" "}
                סנט · <bdi dir="ltr">{display.frequency.toFixed(1)} Hz</bdi>
              </span>
              <span className="tuner-hint">
                {inTune ? "מכוון ✓" : display.cents > 0 ? "גבוה מדי — שחרר" : "נמוך מדי — מתח"}
              </span>
            </>
          ) : (
            <>
              <strong className="tuner-note placeholder">—</strong>
              <span className="tuner-hint">
                {listening ? "מקשיב… נגן צליל" : "לחץ על „התחל להאזין”"}
              </span>
            </>
          )}
        </div>

        <div className="level-meter tuner-level" aria-hidden="true">
          <div style={{ width: `${Math.round((reading?.level ?? 0) * 100)}%` }} />
        </div>
      </div>

      <div className="metronome-actions">
        <button
          className="primary-button"
          onClick={() => (listening || starting ? stop() : void start())}
          type="button"
        >
          {listening || starting ? <MicOff size={20} /> : <Mic size={20} />}
          {listening || starting ? "עצור האזנה" : "התחל להאזין"}
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      <div className="settings-panel">
        <div className="settings-grid">
          <div className="setting-field" data-tour="tuner-instrument">
            <span>כלי</span>
            <div className="segmented-control wrap">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  className={presetId === item.id ? "active" : ""}
                  onClick={() => setPresetId(item.id)}
                  type="button"
                  aria-pressed={presetId === item.id}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <label className="setting-field range-field" data-tour="tuner-reference">
            <span>
              כיוון לה (A4) <b>{referenceA4} Hz</b>
            </span>
            <input
              type="range"
              min={430}
              max={450}
              value={referenceA4}
              onChange={(event) => setReferenceA4(Number(event.target.value))}
            />
            <small>440 הוא התקן. תזמורות מסוימות מכוונות ל־442.</small>
          </label>
        </div>

        {preset.strings && (
          <div className="string-row" aria-label="מיתרי הכלי">
            {preset.strings.map((midi) => (
              <button
                key={midi}
                type="button"
                className={`string-chip ${toneMidi === midi ? "active" : ""} ${display && display.midi === midi ? "is-detected" : ""}`}
                onClick={() => playTone(midi)}
                title="השמע צליל ייחוס"
              >
                <Volume2 size={14} />
                {scientificName(midi)}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
