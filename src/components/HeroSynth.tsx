import { Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * The home page's toy: two octaves that really play, through a small
 * synthesiser built on Web Audio, with the sound drawn live on a scope
 * above them. Nothing is loaded and nothing leaves the page; the audio
 * context is only made on the first touch, as browsers require.
 */

type Wave = OscillatorType;

const WAVES: { id: Wave; label: string }[] = [
  { id: "sine", label: "סינוס" },
  { id: "triangle", label: "משולש" },
  { id: "sawtooth", label: "מסור" },
  { id: "square", label: "ריבוע" },
];

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const HEBREW = ["דו", "דו#", "רה", "רה#", "מי", "פה", "פה#", "סול", "סול#", "לה", "לה#", "סי"];

/** C4 to C6: two octaves and the closing C. */
const LOW = 60;
const HIGH = 84;
const KEYS = Array.from({ length: HIGH - LOW + 1 }, (_, index) => {
  const midi = LOW + index;
  const black = NAMES[midi % 12].includes("#");
  // How many white keys lie below this one: where a black key straddles the line.
  const whitesBelow = Array.from({ length: index }, (_, below) => LOW + below).filter((note) => !NAMES[note % 12].includes("#")).length;
  return { midi, black, whitesBelow };
});
const WHITE_COUNT = KEYS.filter((key) => !key.black).length;

const CHORDS: { name: string; notes: number[] }[] = [
  { name: "C", notes: [60, 64, 67, 72] },
  { name: "Am", notes: [69, 72, 76, 81] },
  { name: "F", notes: [65, 69, 72, 77] },
  { name: "G", notes: [67, 71, 74, 79] },
];

/** Beethoven's Ode to Joy, the opening phrase: [midi, beats]. */
const TUNE: [number, number][] = [
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
  [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
  [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
  [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
];
const BEAT_MS = 300;

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

type Voice = { oscillators: OscillatorNode[]; gain: GainNode };

type Engine = { context: AudioContext; master: GainNode; analyser: AnalyserNode };

export function HeroSynth() {
  const engineRef = useRef<Engine | null>(null);
  const voicesRef = useRef(new Map<number, Voice>());
  const pointerNoteRef = useRef<number | null>(null);
  const pressingRef = useRef(false);
  // Stable sets, cleared rather than replaced, so the unmount cleanup sees every timer.
  const tuneTimersRef = useRef(new Set<number>());
  const chordTimersRef = useRef(new Set<number>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const quietSinceRef = useRef(0);
  const waveRef = useRef<Wave>("sawtooth");

  const [wave, setWave] = useState<Wave>("sawtooth");
  const [active, setActive] = useState<number[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const [playingTune, setPlayingTune] = useState(false);

  const syncActive = () => setActive([...voicesRef.current.keys()]);

  /** Draws the scope: the live wave while something sounds, a calm line otherwise. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const stroke = context.createLinearGradient(0, 0, width, 0);
    stroke.addColorStop(0, "#a78bfa");
    stroke.addColorStop(0.55, "#f472b6");
    stroke.addColorStop(1, "#fbbf24");
    context.strokeStyle = stroke;
    context.lineWidth = 2.4;
    context.lineJoin = "round";
    context.shadowColor = "rgba(244, 114, 182, 0.75)";
    context.shadowBlur = 14;
    context.beginPath();

    const analyser = engineRef.current?.analyser;
    if (analyser) {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      // Start at a rising zero crossing, so the wave stands still instead of running.
      let start = 0;
      for (let index = 1; index < samples.length / 2; index += 1) {
        if (samples[index - 1] < 0 && samples[index] >= 0) {
          start = index;
          break;
        }
      }
      const span = Math.min(samples.length - start, 900);
      for (let index = 0; index < span; index += 1) {
        const x = (index / (span - 1)) * width;
        const y = height / 2 - samples[start + index] * height * 0.9;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
    } else {
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
    }
    context.stroke();
  }, []);

  /** Keeps the scope moving while notes sound, and a moment after, then rests. */
  const runScope = useCallback(() => {
    if (frameRef.current) return;
    const tick = () => {
      draw();
      const sounding = voicesRef.current.size > 0;
      if (sounding) quietSinceRef.current = performance.now();
      if (sounding || performance.now() - quietSinceRef.current < 700) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = 0;
        draw();
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw]);

  const engine = () => {
    if (!engineRef.current) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return null;
      const context = new Context();
      const master = context.createGain();
      master.gain.value = 0.32;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(analyser);
      analyser.connect(context.destination);
      engineRef.current = { context, master, analyser };
    }
    if (engineRef.current.context.state === "suspended") void engineRef.current.context.resume();
    return engineRef.current;
  };

  const start = (midi: number) => {
    const current = engine();
    if (!current || voicesRef.current.has(midi)) return;
    const { context, master } = current;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.42, now + 0.012);
    gain.gain.setTargetAtTime(0.26, now + 0.012, 0.25);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(5200, now);
    filter.frequency.setTargetAtTime(1800, now, 0.3);
    filter.Q.value = 3;
    filter.connect(gain);
    gain.connect(master);
    // Two oscillators a few cents apart: a fuller, slightly chorused tone.
    const oscillators = [-6, 6].map((detune) => {
      const oscillator = context.createOscillator();
      oscillator.type = waveRef.current;
      oscillator.frequency.value = frequency(midi);
      oscillator.detune.value = detune;
      oscillator.connect(filter);
      oscillator.start(now);
      return oscillator;
    });
    voicesRef.current.set(midi, { oscillators, gain });
    setLast(midi);
    syncActive();
    runScope();
  };

  const stop = (midi: number) => {
    const voice = voicesRef.current.get(midi);
    const context = engineRef.current?.context;
    if (!voice || !context) return;
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.setTargetAtTime(0, now, 0.09);
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + 0.6));
    voicesRef.current.delete(midi);
    syncActive();
  };

  const stopAll = () => [...voicesRef.current.keys()].forEach(stop);

  const stopTune = () => {
    tuneTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    tuneTimersRef.current.clear();
    setPlayingTune(false);
    stopAll();
  };

  const playTune = () => {
    if (playingTune) {
      stopTune();
      return;
    }
    if (!engine()) return;
    setPlayingTune(true);
    let at = 0;
    TUNE.forEach(([midi, beats]) => {
      const length = beats * BEAT_MS;
      later(tuneTimersRef.current, () => start(midi), at);
      later(tuneTimersRef.current, () => stop(midi), at + length * 0.85);
      at += length;
    });
    later(tuneTimersRef.current, () => setPlayingTune(false), at);
  };

  const playChord = (notes: number[]) => {
    notes.forEach((midi, index) => later(chordTimersRef.current, () => start(midi), index * 28));
    later(chordTimersRef.current, () => notes.forEach(stop), 900);
  };

  // The key under a pointer, whether it pressed there or slid onto it —
  // touch keeps its pointer on the first element, so this asks the page.
  const keyAt = (event: PointerEvent) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const key = element instanceof HTMLElement ? element.closest<HTMLElement>("[data-midi]") : null;
    return key ? Number(key.dataset.midi) : null;
  };

  const moveTo = (midi: number | null) => {
    if (midi === pointerNoteRef.current) return;
    if (pointerNoteRef.current !== null) stop(pointerNoteRef.current);
    pointerNoteRef.current = midi;
    if (midi !== null) start(midi);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressingRef.current = true;
    moveTo(keyAt(event));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pressingRef.current) return;
    const midi = keyAt(event);
    if (midi !== null) {
      moveTo(midi);
      return;
    }
    // Between two keys the note holds; off the keyboard it stops.
    const rect = event.currentTarget.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) moveTo(null);
  };
  const release = () => {
    pressingRef.current = false;
    moveTo(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      start(midi);
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>, midi: number) => {
    if (event.key === " " || event.key === "Enter") stop(midi);
  };

  const chooseWave = (next: Wave) => {
    waveRef.current = next;
    setWave(next);
  };

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    const observer = canvas && "ResizeObserver" in window ? new ResizeObserver(() => draw()) : null;
    if (canvas) observer?.observe(canvas);
    const voices = voicesRef.current;
    const timers = [tuneTimersRef.current, chordTimersRef.current];
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frameRef.current);
      timers.forEach((set) => {
        set.forEach((timer) => window.clearTimeout(timer));
        set.clear();
      });
      voices.clear();
      void engineRef.current?.context.close().catch(() => undefined);
      engineRef.current = null;
    };
  }, [draw]);

  return (
    <div className="synth" aria-label="סינתיסייזר לנגינה">
      <div className="synth-top">
        <span className="synth-brand">
          <i className={`synth-led ${active.length ? "is-on" : ""}`} aria-hidden="true" />
          STN·24
          <small>נגנו — זה מנגן באמת</small>
        </span>
        <div className="synth-waves" role="group" aria-label="צורת הגל">
          {WAVES.map((item) => (
            <button key={item.id} type="button" className={wave === item.id ? "is-on" : ""} aria-pressed={wave === item.id} onClick={() => chooseWave(item.id)}>
              <WaveGlyph wave={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="synth-screen">
        <canvas ref={canvasRef} className="synth-scope" aria-hidden="true" />
        <div className="synth-readout" aria-live="polite">
          <b dir="ltr">{last === null ? "—" : noteName(last)}</b>
          <span>{last === null ? "לחצו על קליד" : HEBREW[last % 12]}</span>
          <small dir="ltr">{last === null ? "0.0 Hz" : `${frequency(last).toFixed(1)} Hz`}</small>
        </div>
      </div>

      <div className="synth-pads">
        {CHORDS.map((chord) => (
          <button key={chord.name} type="button" className="synth-pad" onClick={() => playChord(chord.notes)}>
            <span dir="ltr">{chord.name}</span>
          </button>
        ))}
        <button type="button" className={`synth-pad is-tune ${playingTune ? "is-on" : ""}`} onClick={playTune}>
          {playingTune ? <Square size={14} /> : <Play size={14} />}
          {playingTune ? "עצירה" : "נגנו לי מנגינה"}
        </button>
      </div>

      <div
        className="synth-keys"
        dir="ltr"
        style={{ gridTemplateColumns: `repeat(${WHITE_COUNT}, 1fr)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        {KEYS.map((key) => {
          const on = active.includes(key.midi);
          const label = `${HEBREW[key.midi % 12]} (${noteName(key.midi)})`;
          if (key.black) {
            // A black key sits on the line between the white key before it and the next.
            return (
              <button
                key={key.midi}
                type="button"
                data-midi={key.midi}
                className={`synth-key is-black ${on ? "is-on" : ""}`}
                style={{ left: `calc(${(key.whitesBelow / WHITE_COUNT) * 100}% - ${(0.62 / WHITE_COUNT) * 50}%)`, width: `${(0.62 / WHITE_COUNT) * 100}%` }}
                aria-label={label}
                onKeyDown={(event) => onKeyDown(event, key.midi)}
                onKeyUp={(event) => onKeyUp(event, key.midi)}
                onBlur={() => stop(key.midi)}
              />
            );
          }
          return (
            <button
              key={key.midi}
              type="button"
              data-midi={key.midi}
              className={`synth-key is-white ${on ? "is-on" : ""}`}
              aria-label={label}
              onKeyDown={(event) => onKeyDown(event, key.midi)}
              onKeyUp={(event) => onKeyUp(event, key.midi)}
              onBlur={() => stop(key.midi)}
            >
              {key.midi % 12 === 0 && <span dir="rtl">דו</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A timeout that forgets itself once it has run, kept in `timers` until then. */
function later(timers: Set<number>, run: () => void, ms: number) {
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    run();
  }, ms);
  timers.add(timer);
}

function WaveGlyph({ wave }: { wave: Wave }) {
  const paths: Partial<Record<Wave, string>> = {
    sine: "M1 8 C4 1, 7 1, 9 8 S14 15, 17 8",
    triangle: "M1 8 L5 2 L13 14 L17 8",
    sawtooth: "M1 13 L9 3 L9 13 L17 3",
    square: "M1 13 L1 3 L9 3 L9 13 L17 13 L17 3",
  };
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
      <path d={paths[wave]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
