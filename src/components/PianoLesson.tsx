import { Eye, GraduationCap, Hand, Pause, Play, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { lessonSteps, type LessonNote } from "../lib/pianoLesson";

type Mode = "watch" | "practice";
const SPEEDS = [0.5, 0.75, 1];
/** Seconds of the song the falling notes show above the keys. */
const WINDOW = 3;

type KeyBox = { x: number; width: number; black: boolean };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

type Props = {
  title: string;
  /** The lesson's notes, already on the keys shown. */
  notes: LessonNote[];
  /** The keyboard below: its keys carry data-midi, and the notes fall onto them. */
  keysRef: RefObject<HTMLDivElement | null>;
  /** Changes when the keys change, so they are measured again. */
  layout: string;
  play: (midi: number) => void;
  release: (midi: number) => void;
  /** The piano calls it with every key the visitor plays. */
  pressRef: MutableRefObject<((midi: number) => void) | null>;
  /** The keys to light as "play these". */
  onGuide: (midis: number[]) => void;
  onClose: () => void;
};

/**
 * Learning a song on the virtual piano, the way Synthesia shows it: the notes
 * fall onto the keys that play them. Watching, the song plays itself and the
 * keys go down; practising, it waits at every note until the visitor plays it
 * (mouse, touch, the computer's keys or a MIDI keyboard), and keeps count.
 */
export function PianoLesson({ title, notes, keysRef, layout, play, release, pressRef, onGuide, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("watch");
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [tally, setTally] = useState({ hits: 0, misses: 0 });
  const [shown, setShown] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

  const ordered = useMemo(() => [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi), [notes]);
  const steps = useMemo(() => lessonSteps(ordered), [ordered]);
  // The step each note is played in.
  const stepOf = useMemo(() => {
    const out: number[] = [];
    let index = 0;
    for (const note of ordered) {
      while (index + 1 < steps.length && steps[index + 1].start <= note.start) index += 1;
      out.push(index);
    }
    return out;
  }, [ordered, steps]);
  const end = useMemo(() => ordered.reduce((last, note) => Math.max(last, note.start + note.duration), 0) + 0.4, [ordered]);

  // What every frame reads and writes lives in refs: a frame never renders the page.
  const position = useRef(0);
  const step = useRef(0);
  const pressed = useRef(new Set<number>());
  const sounding = useRef(new Map<number, number>());
  const nextNote = useRef(0);
  const keys = useRef(new Map<number, KeyBox>());
  const modeRef = useRef(mode);
  const runningRef = useRef(running);
  // The piano's own functions, the latest of them, so a render of the piano never restarts the song.
  const piano = useRef({ play, release, onGuide });

  useEffect(() => {
    piano.current = { play, release, onGuide };
  }, [onGuide, play, release]);

  useEffect(() => {
    modeRef.current = mode;
    runningRef.current = running;
  }, [mode, running]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = canvas.width / Math.max(1, width);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const style = getComputedStyle(canvas);
    const white = style.getPropertyValue("--lesson-white").trim() || "#7c5cff";
    const black = style.getPropertyValue("--lesson-black").trim() || "#4b32c8";
    const guide = style.getPropertyValue("--lesson-guide").trim() || "#ff9f1c";
    const grid = style.getPropertyValue("--lesson-grid").trim() || "rgba(127,127,127,0.18)";

    // A faint line at every C, to find one's place.
    context.fillStyle = grid;
    keys.current.forEach((box, midi) => {
      if (midi % 12 === 0) context.fillRect(Math.round(box.x), 0, 1, height);
    });

    const now = position.current;
    const perSecond = height / WINDOW;
    const practising = modeRef.current === "practice";
    ordered.forEach((note, index) => {
      const bottom = height - (note.start - now) * perSecond;
      const top = bottom - note.duration * perSecond;
      if (bottom < 0 || top > height) return;
      const box = keys.current.get(note.midi);
      if (!box) return;
      // Practising, what is due now is lit, and what was already played fades.
      const due = practising && stepOf[index] === step.current;
      context.globalAlpha = practising && stepOf[index] < step.current ? 0.3 : 1;
      context.fillStyle = due ? guide : box.black ? black : white;
      const y = Math.max(top, -6);
      const x = box.x + 1.5;
      const w = Math.max(2, box.width - 3);
      const h = Math.max(3, Math.min(bottom, height) - y);
      context.beginPath();
      if (typeof context.roundRect === "function") context.roundRect(x, y, w, h, 5);
      else context.rect(x, y, w, h);
      context.fill();
    });
    context.globalAlpha = 1;
  }, [ordered, stepOf]);

  // Where each key is, measured from the keyboard itself, again whenever it or the canvas changes.
  useEffect(() => {
    const board = keysRef.current;
    const canvas = canvasRef.current;
    if (!board || !canvas) return;
    const measure = () => {
      const frame = canvas.getBoundingClientRect();
      const map = new Map<number, KeyBox>();
      board.querySelectorAll<HTMLElement>("[data-midi]").forEach((element) => {
        const box = element.getBoundingClientRect();
        map.set(Number(element.dataset.midi), { x: box.left - frame.left, width: box.width, black: element.classList.contains("black") });
      });
      keys.current = map;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      draw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [keysRef, layout, draw]);

  const silence = useCallback(() => {
    sounding.current.forEach((_, midi) => piano.current.release(midi));
    sounding.current.clear();
  }, []);

  const moveTo = useCallback((index: number) => {
    step.current = index;
    pressed.current = new Set();
    setStepIndex(index);
  }, []);

  const rewind = useCallback(() => {
    silence();
    position.current = 0;
    nextNote.current = 0;
    moveTo(0);
    setTally({ hits: 0, misses: 0 });
    setShown(0);
    setDone(false);
    draw();
  }, [draw, moveTo, silence]);

  const finish = useCallback(() => {
    silence();
    setRunning(false);
    setDone(true);
  }, [silence]);

  // Practising, the keys to play next are lit, from before the song starts.
  const guide = useMemo(() => (mode === "practice" && !done ? (steps[stepIndex]?.midis ?? []) : []), [done, mode, stepIndex, steps]);
  useEffect(() => {
    piano.current.onGuide(guide);
  }, [guide]);

  useEffect(
    () => () => {
      silence();
      piano.current.onGuide([]);
    },
    [silence],
  );

  // The visitor's own playing: in practice, each key of the waiting step counts once.
  useEffect(() => {
    pressRef.current = (midi) => {
      if (modeRef.current !== "practice") return;
      const waiting = steps[step.current];
      if (!waiting) return;
      if (!runningRef.current) {
        // Playing a lit key starts the song; any other key, before it starts, is just playing.
        if (!waiting.midis.includes(midi)) return;
        runningRef.current = true;
        setRunning(true);
      }
      if (!waiting.midis.includes(midi)) {
        setTally((current) => ({ ...current, misses: current.misses + 1 }));
        return;
      }
      pressed.current.add(midi);
      if (!waiting.midis.every((item) => pressed.current.has(item))) return;
      setTally((current) => ({ ...current, hits: current.hits + waiting.midis.length }));
      moveTo(step.current + 1);
    };
    return () => {
      pressRef.current = null;
    };
  }, [moveTo, pressRef, steps]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    let lastShown = 0;
    const tick = (time: number) => {
      const delta = Math.min(0.1, Math.max(0, time - last) / 1000) * speed;
      last = time;
      let now = position.current + delta;
      if (modeRef.current === "practice") {
        const waiting = steps[step.current];
        if (!waiting) {
          position.current = now;
          draw();
          finish();
          return;
        }
        // The song waits at each note for the visitor to play it.
        if (now >= waiting.start) now = waiting.start;
      } else {
        for (const [midi, until] of sounding.current) {
          if (until <= now) {
            piano.current.release(midi);
            sounding.current.delete(midi);
          }
        }
        while (nextNote.current < ordered.length && ordered[nextNote.current].start <= now) {
          const note = ordered[nextNote.current];
          nextNote.current += 1;
          if (sounding.current.has(note.midi)) piano.current.release(note.midi);
          piano.current.play(note.midi);
          sounding.current.set(note.midi, note.start + note.duration);
        }
      }
      position.current = now;
      draw();
      if (time - lastShown > 200) {
        lastShown = time;
        setShown(now);
      }
      if (modeRef.current === "watch" && now >= end) {
        setShown(end);
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw, end, finish, ordered, running, speed, steps]);

  const toggle = () => {
    if (running) {
      silence();
      setRunning(false);
      return;
    }
    if (done) rewind();
    setRunning(true);
  };

  const choose = (next: Mode) => {
    if (next === mode) return;
    setRunning(false);
    setMode(next);
    rewind();
  };

  return (
    <div className="piano-lesson">
      <div className="piano-lesson-head">
        <strong className="piano-lesson-title">
          <GraduationCap size={17} aria-hidden="true" />
          <span>לימוד:</span>{" "}
          <span className="piano-lesson-song" dir="auto" translate="no">
            {title || "שיר"}
          </span>
        </strong>
        <span className="piano-lesson-status" aria-live="polite">
          {mode === "practice" ? (
            `${tally.hits} נכונים · ${tally.misses} טעויות`
          ) : (
            <span dir="ltr">
              {clock(shown)} / {clock(end)}
            </span>
          )}
          {done && <b>סיימת!</b>}
        </span>
        <button type="button" className="icon-button" onClick={onClose} aria-label="סגירת הלימוד" title="סגירת הלימוד">
          <X size={16} />
        </button>
      </div>
      <div className="piano-lesson-bar">
        <div className="segmented-control" role="group" aria-label="מצב הלימוד">
          <button type="button" className={mode === "watch" ? "active" : ""} aria-pressed={mode === "watch"} onClick={() => choose("watch")}>
            <Eye size={14} /> צפייה
          </button>
          <button type="button" className={mode === "practice" ? "active" : ""} aria-pressed={mode === "practice"} onClick={() => choose("practice")}>
            <Hand size={14} /> תרגול
          </button>
        </div>
        <div className="segmented-control" role="group" aria-label="מהירות">
          {SPEEDS.map((value) => (
            <button key={value} type="button" className={speed === value ? "active" : ""} aria-pressed={speed === value} onClick={() => setSpeed(value)}>
              {Math.round(value * 100)}%
            </button>
          ))}
        </div>
        <button type="button" className="primary-button compact" onClick={toggle}>
          {running ? <Pause size={16} /> : <Play size={16} />} {running ? "השהה" : done ? "שוב" : "התחל"}
        </button>
        <button
          type="button"
          className="secondary-button compact"
          onClick={() => {
            setRunning(false);
            rewind();
          }}
        >
          <RotateCcw size={15} /> מההתחלה
        </button>
      </div>
      {mode === "practice" && !running && !done && stepIndex === 0 && (
        <p className="piano-lesson-hint">בתרגול השיר מחכה לך: נגן את המקשים המוארים — בעכבר, במגע, במקלדת המחשב או במקלדת MIDI.</p>
      )}
      <canvas ref={canvasRef} className="piano-lesson-canvas" aria-hidden="true" />
    </div>
  );
}
