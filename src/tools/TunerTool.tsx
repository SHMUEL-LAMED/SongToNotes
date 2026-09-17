import { Gauge, Mic, MicOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { centsOff, detectPitch, frequencyToMidi, midiToFrequency } from "../lib/dsp";
import { hebrewNoteName, scientificName } from "../lib/key";

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

const HISTORY = 6;

/**
 * The microphone feeds an analyser; every frame the latest window goes
 * through the autocorrelation detector and the median of the last few
 * readings drives the needle, which keeps it steady on a wobbly note.
 */
export function TunerTool() {
  const [presetId, setPresetId] = useState("chromatic");
  const [referenceA4, setReferenceA4] = useState(440);
  const [listening, setListening] = useState(false);
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

  const preset = useMemo(
    () => PRESETS.find((item) => item.id === presetId) ?? PRESETS[0],
    [presetId],
  );

  useEffect(() => {
    referenceRef.current = referenceA4;
  }, [referenceA4]);

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    historyRef.current = [];
    setListening(false);
    setReading(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const Context =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      const context = new Context();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      contextRef.current = context;
      streamRef.current = stream;
      analyserRef.current = analyser;
      setListening(true);

      const buffer = new Float32Array(analyser.fftSize);
      const tick = () => {
        const node = analyserRef.current;
        const audio = contextRef.current;
        if (!node || !audio) return;
        node.getFloatTimeDomainData(buffer);
        const pitch = detectPitch(buffer, audio.sampleRate);
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
          setReading((current) => (current ? { ...current, clarity: 0, level: Math.min(1, pitch.rms * 6) } : null));
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "לא ניתנה גישה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן."
          : "לא הצלחנו לפתוח את המיקרופון.",
      );
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  const stopTone = useCallback(() => {
    const tone = toneRef.current;
    if (tone && contextRef.current) {
      const now = contextRef.current.currentTime;
      tone.gain.gain.setTargetAtTime(0.0001, now, 0.05);
      tone.osc.stop(now + 0.3);
    } else if (tone) {
      tone.osc.stop();
    }
    toneRef.current = null;
    setToneMidi(null);
  }, []);

  const playTone = useCallback(
    (midi: number) => {
      if (toneMidi === midi) {
        stopTone();
        return;
      }
      stopTone();
      if (!contextRef.current) {
        const Context =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Context) return;
        contextRef.current = new Context();
      }
      const context = contextRef.current;
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
          <p>
            נגן צליל אחד ליד המיקרופון. המחוג מראה כמה סנטים הצליל גבוה או נמוך,
            וירוק פירושו מכוון.
          </p>
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
                {display.cents > 0 ? "+" : ""}
                {Math.round(display.cents)} סנט · {display.frequency.toFixed(1)} Hz
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
          onClick={() => (listening ? stop() : void start())}
          type="button"
        >
          {listening ? <MicOff size={20} /> : <Mic size={20} />}
          {listening ? "עצור האזנה" : "התחל להאזין"}
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      <div className="settings-panel">
        <div className="settings-grid">
          <div className="setting-field">
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
          <label className="setting-field range-field">
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
