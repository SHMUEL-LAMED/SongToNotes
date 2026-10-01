import { useEffect, useRef, useState } from "react";
import { CircleStop, Mic2, Play, RotateCcw } from "lucide-react";
import { MidiButton } from "../components/MidiButton";
import { useMidiInput } from "../lib/midiInput";
import "./pad.css";

/** `code` is the physical key, so the pads answer on a Hebrew layout too (where Q types "/"). */
type Pad = { name: string; key: string; code: string; color: string; kind: "kick" | "snare" | "hat" | "clap" | "tom" | "perc" };

const PADS: Pad[] = [
  { name: "קיק", key: "1", code: "Digit1", color: "#ff4d6d", kind: "kick" }, { name: "סנר", key: "2", code: "Digit2", color: "#ff8a3d", kind: "snare" }, { name: "היי־האט", key: "3", code: "Digit3", color: "#ffc857", kind: "hat" }, { name: "קלאפ", key: "4", code: "Digit4", color: "#7bdff2", kind: "clap" },
  { name: "טום נמוך", key: "q", code: "KeyQ", color: "#4cc9f0", kind: "tom" }, { name: "טום גבוה", key: "w", code: "KeyW", color: "#4361ee", kind: "tom" }, { name: "שייקר", key: "e", code: "KeyE", color: "#7209b7", kind: "perc" }, { name: "קאוובל", key: "r", code: "KeyR", color: "#f72585", kind: "perc" },
  { name: "קיק עמוק", key: "a", code: "KeyA", color: "#ff595e", kind: "kick" }, { name: "סנר קצר", key: "s", code: "KeyS", color: "#ffca3a", kind: "snare" }, { name: "האט פתוח", key: "d", code: "KeyD", color: "#8ac926", kind: "hat" }, { name: "מחיאת כף", key: "f", code: "KeyF", color: "#1982c4", kind: "clap" },
  { name: "בונגו", key: "z", code: "KeyZ", color: "#6a4c93", kind: "tom" }, { name: "רעש", key: "x", code: "KeyX", color: "#00b4d8", kind: "perc" }, { name: "רימשוט", key: "c", code: "KeyC", color: "#e85d04", kind: "perc" }, { name: "אפקט", key: "v", code: "KeyV", color: "#9b5de5", kind: "perc" },
];

/** Keys typed into a field belong to the field, not to the pads. */
function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}

export function PadTool() {
  const ctx = useRef<AudioContext | null>(null);
  const noiseRef = useRef<AudioBuffer | null>(null);
  const [active, setActive] = useState<ReadonlySet<number>>(() => new Set());
  const [recording, setRecording] = useState(false);
  const [events, setEvents] = useState<{ pad: number; at: number }[]>([]);
  const started = useRef(0);
  /** Every pending timeout (pad lights, replay lights), cleared on leaving the page. */
  const timers = useRef(new Set<number>());
  /** The current replay's output: dropping it silences whatever it still has queued. */
  const replayBus = useRef<GainNode | null>(null);

  const later = (callback: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      callback();
    }, ms);
    timers.current.add(id);
  };

  const ensureContext = () => {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx.current && AudioContextClass) ctx.current = new AudioContextClass();
    if (ctx.current?.state === "suspended") void ctx.current.resume().catch(() => undefined);
    return ctx.current;
  };

  /** Lights a pad for a moment; each pad keeps its own light, so fast rolls and chords all show. */
  const flash = (index: number) => {
    setActive((current) => new Set(current).add(index));
    later(() => setActive((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    }), 110);
  };

  /** Sounds a pad at audio time `at` into `destination`. */
  const sound = (audio: AudioContext, index: number, at: number, destination: AudioNode) => {
    const pad = PADS[index];
    const now = at;
    const gain = audio.createGain(); gain.connect(destination); gain.gain.setValueAtTime(0.0001, now);
    if (pad.kind === "hat" || pad.kind === "perc") {
      // One noise buffer per context, rather than a fresh one filled with random numbers per hit.
      if (!noiseRef.current || noiseRef.current.sampleRate !== audio.sampleRate) {
        const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.12), audio.sampleRate); const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        noiseRef.current = buffer;
      }
      const source = audio.createBufferSource(); source.buffer = noiseRef.current; const filter = audio.createBiquadFilter(); filter.type = "highpass"; filter.frequency.value = pad.kind === "hat" ? 5000 : 1200; source.connect(filter).connect(gain); source.start(now);
      gain.gain.exponentialRampToValueAtTime(0.32, now + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, now + (pad.kind === "hat" ? 0.08 : 0.16)); source.stop(now + 0.2);
    } else {
      const osc = audio.createOscillator(); osc.type = pad.kind === "snare" || pad.kind === "clap" ? "triangle" : "sine"; osc.frequency.setValueAtTime(pad.kind === "kick" ? 150 : pad.kind === "snare" ? 180 : 260 + index * 18, now); osc.frequency.exponentialRampToValueAtTime(pad.kind === "kick" ? 45 : 100, now + 0.18); osc.connect(gain); osc.start(now); gain.gain.exponentialRampToValueAtTime(0.48, now + 0.003); gain.gain.exponentialRampToValueAtTime(0.0001, now + (pad.kind === "kick" ? 0.45 : 0.22)); osc.stop(now + 0.5);
    }
  };

  const play = (index: number) => {
    const audio = ensureContext();
    if (!audio) return;
    sound(audio, index, audio.currentTime, audio.destination);
    flash(index);
    if (recording) setEvents((current) => [...current, { pad: index, at: performance.now() - started.current }]);
  };

  // The listener is added once and always calls the latest play (which sees the latest `recording`).
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+C, Ctrl+R and friends stay the browser's, and typing in a field stays typing.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      const index = PADS.findIndex((pad) => pad.code === event.code);
      if (index < 0) return;
      event.preventDefault();
      playRef.current(index);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Pad controllers start at note 36; sixteen notes up from there are the sixteen pads.
  const midi = useMidiInput({ onNoteOn: (note) => play((((note - 36) % PADS.length) + PADS.length) % PADS.length) });
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((id) => window.clearTimeout(id));
      pending.clear();
      void ctx.current?.close().catch(() => undefined);
      ctx.current = null;
    };
  }, []);
  const toggleRecord = () => { if (recording) setRecording(false); else { setEvents([]); started.current = performance.now(); setRecording(true); } };
  /** Plays the recording back on the audio clock, so it keeps the timing it was played with. */
  const replay = () => {
    const audio = ensureContext();
    if (!audio || !events.length) return;
    // A second press starts over instead of layering on top of the first.
    replayBus.current?.disconnect();
    const bus = audio.createGain();
    bus.connect(audio.destination);
    replayBus.current = bus;
    const base = audio.currentTime + 0.05;
    for (const event of events) {
      sound(audio, event.pad, base + event.at / 1000, bus);
      later(() => {
        if (replayBus.current === bus) flash(event.pad);
      }, 50 + event.at);
    }
  };
  const clear = () => {
    replayBus.current?.disconnect();
    replayBus.current = null;
    setEvents([]);
  };

  return <section className="pad-tool" dir="rtl"><div className="tool-intro"><h1>פדים לדי־ג׳יי</h1><p>לוח פדים צבעוני לנגינת ביטים ואפקטים. אפשר ללחוץ או לנגן מהמקלדת.</p></div><div className="pad-actions"><button type="button" data-tour="pads-record" onClick={toggleRecord}>{recording ? <><CircleStop size={17} /> עצור הקלטה</> : <><Mic2 size={17} /> הקלט רצף</>}</button><button type="button" className="secondary-button" onClick={replay} disabled={!events.length}><Play size={17} /> נגן רצף</button><button type="button" className="secondary-button" onClick={clear} disabled={!events.length}><RotateCcw size={17} /> נקה</button><MidiButton midi={midi} /></div>{recording && <p className="pad-recording"><span /> מקליט…</p>}<div className="pad-grid" dir="ltr">{PADS.map((pad, index) => <button type="button" key={pad.key} className={`pad ${active.has(index) ? "is-active" : ""}`} style={{ "--pad-color": pad.color } as React.CSSProperties} onPointerDown={(event) => { if (event.button === 0) play(index); }} onClick={(event) => { if (event.detail === 0) play(index); /* Enter or Space on a focused pad; a pointer already played on pointerdown. */ }} onContextMenu={(event) => event.preventDefault()} aria-label={`${pad.name}, מקש ${pad.key.toUpperCase()}`}><strong dir="rtl">{pad.name}</strong><kbd>{pad.key.toUpperCase()}</kbd></button>)}</div><p className="pad-help">אפשר להשתמש במקשים <span dir="ltr">1–4, Q–R, A–F, Z–V</span>.</p></section>;
}
