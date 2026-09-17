import { Circle, Download, Piano, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { midiToFrequency } from "../lib/dsp";
import { downloadFile, notesToMidi } from "../lib/export";
import { plainNoteName, scientificName } from "../lib/key";
import type { DetectedNote } from "../lib/types";

type Timbre = "piano" | "organ" | "synth";

const KEYBOARD_ROW = "awsedftgyhujkolp;'";
const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const SCALES: { id: string; label: string; steps: number[] }[] = [
  { id: "none", label: "ללא", steps: [] },
  { id: "major", label: "מז׳ור", steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", label: "מינור", steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonic", label: "מינור הרמוני", steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: "pent-major", label: "פנטטוני מז׳ור", steps: [0, 2, 4, 7, 9] },
  { id: "pent-minor", label: "פנטטוני מינור", steps: [0, 3, 5, 7, 10] },
  { id: "blues", label: "בלוז", steps: [0, 3, 5, 6, 7, 10] },
  { id: "dorian", label: "דוריאני", steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", label: "מיקסולידי", steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: "freygish", label: "פריגי דומיננטי", steps: [0, 1, 4, 5, 7, 8, 10] },
];

const BLACK = new Set([1, 3, 6, 8, 10]);

type Voice = { osc: OscillatorNode[]; gain: GainNode; release: () => void };

/**
 * A playable keyboard with its own small synth. Held keys are tracked by
 * MIDI number so the mouse, touch and the computer keyboard can all hold
 * notes at once, and the recorder simply timestamps those transitions.
 */
export function PianoTool() {
  const [octave, setOctave] = useState(3);
  const [octaveCount, setOctaveCount] = useState(() =>
    window.innerWidth < 720 ? 2 : 3,
  );
  const [timbre, setTimbre] = useState<Timbre>("piano");
  const [sustain, setSustain] = useState(false);
  const [showNames, setShowNames] = useState(true);
  const [scaleRoot, setScaleRoot] = useState(0);
  const [scaleId, setScaleId] = useState("none");
  const [held, setHeld] = useState<Set<number>>(() => new Set());
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<DetectedNote[]>([]);
  const [volume, setVolume] = useState(0.7);

  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const timbreRef = useRef(timbre);
  const sustainRef = useRef(sustain);
  const recordingRef = useRef<{ startedAt: number; open: Map<number, number> } | null>(null);
  const pointerNoteRef = useRef<number | null>(null);

  useEffect(() => {
    timbreRef.current = timbre;
    sustainRef.current = sustain;
    if (masterRef.current) masterRef.current.gain.value = volume;
  }, [sustain, timbre, volume]);

  const ensureContext = useCallback(() => {
    if (!contextRef.current) {
      const Context =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) return null;
      contextRef.current = new Context();
      masterRef.current = contextRef.current.createGain();
      masterRef.current.gain.value = volume;
      // A soft limiter keeps chords from clipping when many keys are down.
      const compressor = contextRef.current.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.ratio.value = 6;
      masterRef.current.connect(compressor);
      compressor.connect(contextRef.current.destination);
    }
    if (contextRef.current.state === "suspended") void contextRef.current.resume();
    return contextRef.current;
  }, [volume]);

  useEffect(() => () => void contextRef.current?.close(), []);

  const noteOn = useCallback(
    (midi: number) => {
      const context = ensureContext();
      const master = masterRef.current;
      if (!context || !master || voicesRef.current.has(midi)) return;
      const now = context.currentTime;
      const frequency = midiToFrequency(midi);
      const gain = context.createGain();
      gain.connect(master);
      const oscillators: OscillatorNode[] = [];
      const kind = timbreRef.current;

      if (kind === "piano") {
        const body = context.createOscillator();
        body.type = "triangle";
        body.frequency.value = frequency;
        const bright = context.createOscillator();
        bright.type = "sine";
        bright.frequency.value = frequency * 2;
        const brightGain = context.createGain();
        brightGain.gain.value = 0.3;
        bright.connect(brightGain);
        brightGain.connect(gain);
        body.connect(gain);
        oscillators.push(body, bright);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.02, now + 4);
      } else if (kind === "organ") {
        [1, 2, 3, 4].forEach((harmonic, index) => {
          const osc = context.createOscillator();
          osc.type = "sine";
          osc.frequency.value = frequency * harmonic;
          const partial = context.createGain();
          partial.gain.value = [0.5, 0.3, 0.15, 0.1][index];
          osc.connect(partial);
          partial.connect(gain);
          oscillators.push(osc);
        });
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
      } else {
        const saw = context.createOscillator();
        saw.type = "sawtooth";
        saw.frequency.value = frequency;
        const detuned = context.createOscillator();
        detuned.type = "sawtooth";
        detuned.frequency.value = frequency;
        detuned.detune.value = 8;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(Math.min(12000, frequency * 8), now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(300, frequency * 2), now + 0.6);
        filter.Q.value = 4;
        saw.connect(filter);
        detuned.connect(filter);
        filter.connect(gain);
        oscillators.push(saw, detuned);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
      }

      oscillators.forEach((osc) => osc.start(now));
      const release = () => {
        const at = context.currentTime;
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), at);
        const tail = kind === "piano" ? 0.25 : kind === "organ" ? 0.08 : 0.35;
        gain.gain.exponentialRampToValueAtTime(0.0001, at + tail);
        oscillators.forEach((osc) => osc.stop(at + tail + 0.05));
      };
      voicesRef.current.set(midi, { osc: oscillators, gain, release });
      setHeld((current) => new Set(current).add(midi));

      const session = recordingRef.current;
      if (session && !session.open.has(midi)) {
        session.open.set(midi, performance.now());
      }
    },
    [ensureContext],
  );

  const noteOff = useCallback((midi: number, force = false) => {
    setHeld((current) => {
      if (!current.has(midi)) return current;
      const next = new Set(current);
      next.delete(midi);
      return next;
    });
    const session = recordingRef.current;
    if (session) {
      const startedAt = session.open.get(midi);
      if (startedAt !== undefined) {
        session.open.delete(midi);
        const start = (startedAt - session.startedAt) / 1000;
        const duration = Math.max(0.05, (performance.now() - startedAt) / 1000);
        setRecorded((current) => [...current, { midi, start, duration, confidence: 0.9 }]);
      }
    }
    if (sustainRef.current && !force) return;
    const voice = voicesRef.current.get(midi);
    if (!voice) return;
    voice.release();
    voicesRef.current.delete(midi);
  }, []);

  // Turning sustain off releases whatever the pedal was still holding.
  useEffect(() => {
    if (sustain) return;
    voicesRef.current.forEach((voice, midi) => {
      if (!held.has(midi)) {
        voice.release();
        voicesRef.current.delete(midi);
      }
    });
  }, [held, sustain]);

  const lowest = (octave + 1) * 12;
  const keys = useMemo(() => {
    const list: { midi: number; black: boolean; whiteIndex: number }[] = [];
    let whiteIndex = 0;
    for (let midi = lowest; midi <= lowest + octaveCount * 12; midi += 1) {
      const black = BLACK.has(midi % 12);
      list.push({ midi, black, whiteIndex: black ? whiteIndex - 1 : whiteIndex });
      if (!black) whiteIndex += 1;
    }
    return list;
  }, [lowest, octaveCount]);
  const whiteCount = keys.filter((key) => !key.black).length;

  const scale = useMemo(() => SCALES.find((item) => item.id === scaleId) ?? SCALES[0], [scaleId]);
  const inScale = useCallback(
    (midi: number) => scale.steps.length > 0 && scale.steps.includes((((midi - scaleRoot) % 12) + 12) % 12),
    [scale.steps, scaleRoot],
  );

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        setOctave((value) => Math.max(0, value - 1));
        return;
      }
      if (key === "x") {
        setOctave((value) => Math.min(7, value + 1));
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setSustain(true);
        return;
      }
      const index = KEYBOARD_ROW.indexOf(event.key);
      if (index < 0) return;
      event.preventDefault();
      noteOn(lowest + index);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSustain(false);
        return;
      }
      const index = KEYBOARD_ROW.indexOf(event.key);
      if (index < 0) return;
      noteOff(lowest + index);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [lowest, noteOff, noteOn]);

  const toggleRecording = () => {
    if (recording) {
      const session = recordingRef.current;
      if (session) {
        session.open.forEach((startedAt, midi) => {
          setRecorded((current) => [
            ...current,
            {
              midi,
              start: (startedAt - session.startedAt) / 1000,
              duration: Math.max(0.05, (performance.now() - startedAt) / 1000),
              confidence: 0.9,
            },
          ]);
        });
      }
      recordingRef.current = null;
      setRecording(false);
    } else {
      setRecorded([]);
      recordingRef.current = { startedAt: performance.now(), open: new Map() };
      setRecording(true);
    }
  };

  const downloadMidi = () => {
    const data = notesToMidi(recorded, {
      bpm: 120,
      quantized: false,
      offset: 0,
      stepsPerBeat: 4,
      transpose: 0,
    });
    downloadFile(data, "piano-recording.mid", "audio/midi");
  };

  const heldNames = Array.from(held)
    .sort((a, b) => a - b)
    .map((midi) => scientificName(midi));

  return (
    <section className="tool-body piano-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Piano size={26} />
        </span>
        <div>
          <h1>פסנתר וירטואלי</h1>
          <p>נגן בעכבר, במגע או במקלדת.</p>
        </div>
      </div>

      <div className="piano-status" aria-live="polite">
        <span className="piano-held">{heldNames.length ? heldNames.join("  ") : "—"}</span>
        {recording && <span className="recording-chip"><span className="recording-dot small" /> מקליט · {recorded.length} תווים</span>}
      </div>

      <div
        className="piano-keys"
        dir="ltr"
        style={{ "--white-count": whiteCount } as React.CSSProperties}
        onPointerLeave={() => {
          if (pointerNoteRef.current !== null) noteOff(pointerNoteRef.current);
          pointerNoteRef.current = null;
        }}
      >
        {keys.map((key) => {
          const active = held.has(key.midi);
          const highlighted = inScale(key.midi);
          const isRoot = scale.steps.length > 0 && ((key.midi - scaleRoot) % 12 + 12) % 12 === 0;
          const mappedKey = KEYBOARD_ROW[key.midi - lowest];
          return (
            <button
              key={key.midi}
              type="button"
              className={`piano-key ${key.black ? "black" : "white"} ${active ? "is-active" : ""} ${highlighted ? "in-scale" : ""} ${isRoot ? "is-root" : ""}`}
              style={
                key.black
                  ? { left: `calc((${key.whiteIndex} + 0.68) * (100% / ${whiteCount}))` }
                  : undefined
              }
              aria-label={plainNoteName(key.midi)}
              aria-pressed={active}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                pointerNoteRef.current = key.midi;
                noteOn(key.midi);
              }}
              onPointerEnter={(event) => {
                if (event.buttons !== 1) return;
                if (pointerNoteRef.current !== null && pointerNoteRef.current !== key.midi) {
                  noteOff(pointerNoteRef.current);
                }
                pointerNoteRef.current = key.midi;
                noteOn(key.midi);
              }}
              onPointerUp={() => {
                noteOff(key.midi);
                pointerNoteRef.current = null;
              }}
              onPointerCancel={() => {
                noteOff(key.midi);
                pointerNoteRef.current = null;
              }}
            >
              {showNames && !key.black && (
                <span className="piano-key-name">
                  {scientificName(key.midi)}
                  {mappedKey && <small>{mappedKey.toUpperCase()}</small>}
                </span>
              )}
              {showNames && key.black && mappedKey && (
                <span className="piano-key-name">
                  <small>{mappedKey.toUpperCase()}</small>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="piano-controls">
        <div className="segmented-control" role="group" aria-label="אוקטבה">
          <button type="button" onClick={() => setOctave((value) => Math.max(0, value - 1))}>
            אוקטבה −
          </button>
          <span className="segmented-label">C{octave}–C{octave + octaveCount}</span>
          <button type="button" onClick={() => setOctave((value) => Math.min(7, value + 1))}>
            אוקטבה +
          </button>
        </div>
        <button
          className={`secondary-button ${sustain ? "is-on" : ""}`}
          type="button"
          onClick={() => setSustain((value) => !value)}
          aria-pressed={sustain}
        >
          פדל סוסטיין {sustain ? "פועל" : "כבוי"}
        </button>
        <button
          className={`secondary-button ${recording ? "is-danger" : ""}`}
          type="button"
          onClick={toggleRecording}
        >
          {recording ? <Square size={16} /> : <Circle size={16} />}
          {recording ? "עצור הקלטה" : "הקלט נגינה"}
        </button>
        {!recording && recorded.length > 0 && (
          <button className="primary-button compact" type="button" onClick={downloadMidi}>
            <Download size={16} /> הורד MIDI ({recorded.length} תווים)
          </button>
        )}
      </div>

      <div className="settings-panel">
        <div className="settings-grid">
          <div className="setting-field">
            <span>צליל</span>
            <div className="segmented-control">
              {(["piano", "organ", "synth"] as Timbre[]).map((kind) => (
                <button
                  key={kind}
                  className={timbre === kind ? "active" : ""}
                  onClick={() => setTimbre(kind)}
                  type="button"
                  aria-pressed={timbre === kind}
                >
                  {kind === "piano" ? "פסנתר" : kind === "organ" ? "אורגן" : "סינת׳"}
                </button>
              ))}
            </div>
          </div>
          <label className="setting-field">
            <span>הדגשת סולם</span>
            <div className="tempo-row">
              <select value={scaleRoot} onChange={(event) => setScaleRoot(Number(event.target.value))} aria-label="טוניקה">
                {ROOT_NAMES.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <select value={scaleId} onChange={(event) => setScaleId(event.target.value)} aria-label="סוג סולם">
                {SCALES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <div className="setting-field">
            <span>תצוגה</span>
            <div className="segmented-control">
              <button className={octaveCount === 2 ? "active" : ""} onClick={() => setOctaveCount(2)} type="button">
                2 אוקטבות
              </button>
              <button className={octaveCount === 3 ? "active" : ""} onClick={() => setOctaveCount(3)} type="button">
                3 אוקטבות
              </button>
            </div>
          </div>
          <label className="setting-field range-field">
            <span>
              עוצמה <b>{Math.round(volume * 100)}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => setVolume(Number(event.target.value) / 100)}
            />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={showNames} onChange={(event) => setShowNames(event.target.checked)} />
            <span>הצג שמות תווים ומקשים</span>
          </label>
        </div>
      </div>
    </section>
  );
}
