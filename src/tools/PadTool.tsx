import { useEffect, useRef, useState } from "react";
import { CircleStop, Mic2, Play, RotateCcw } from "lucide-react";
import "./pad.css";

type Pad = { name: string; key: string; color: string; kind: "kick" | "snare" | "hat" | "clap" | "tom" | "perc" };

const PADS: Pad[] = [
  { name: "קיק", key: "1", color: "#ff4d6d", kind: "kick" }, { name: "סנר", key: "2", color: "#ff8a3d", kind: "snare" }, { name: "היי־האט", key: "3", color: "#ffc857", kind: "hat" }, { name: "קלאפ", key: "4", color: "#7bdff2", kind: "clap" },
  { name: "טום נמוך", key: "q", color: "#4cc9f0", kind: "tom" }, { name: "טום גבוה", key: "w", color: "#4361ee", kind: "tom" }, { name: "שייקר", key: "e", color: "#7209b7", kind: "perc" }, { name: "קאוובל", key: "r", color: "#f72585", kind: "perc" },
  { name: "קיק עמוק", key: "a", color: "#ff595e", kind: "kick" }, { name: "סנר קצר", key: "s", color: "#ffca3a", kind: "snare" }, { name: "האט פתוח", key: "d", color: "#8ac926", kind: "hat" }, { name: "מחיאת כף", key: "f", color: "#1982c4", kind: "clap" },
  { name: "בונגו", key: "z", color: "#6a4c93", kind: "tom" }, { name: "רעש", key: "x", color: "#00b4d8", kind: "perc" }, { name: "רימשוט", key: "c", color: "#e85d04", kind: "perc" }, { name: "אפקט", key: "v", color: "#9b5de5", kind: "perc" },
];

export function PadTool() {
  const ctx = useRef<AudioContext | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [events, setEvents] = useState<{ pad: number; at: number }[]>([]);
  const started = useRef(0);

  const ensureContext = () => {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx.current && AudioContextClass) ctx.current = new AudioContextClass();
    if (ctx.current?.state === "suspended") void ctx.current.resume();
    return ctx.current;
  };
  const play = (index: number, shouldRecord = true) => {
    const audio = ensureContext();
    if (!audio) return;
    const pad = PADS[index];
    const now = audio.currentTime;
    const gain = audio.createGain(); gain.connect(audio.destination); gain.gain.setValueAtTime(0.0001, now);
    if (pad.kind === "hat" || pad.kind === "perc") {
      const buffer = audio.createBuffer(1, audio.sampleRate * 0.12, audio.sampleRate); const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = audio.createBufferSource(); source.buffer = buffer; const filter = audio.createBiquadFilter(); filter.type = "highpass"; filter.frequency.value = pad.kind === "hat" ? 5000 : 1200; source.connect(filter).connect(gain); source.start(now);
      gain.gain.exponentialRampToValueAtTime(0.32, now + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, now + (pad.kind === "hat" ? 0.08 : 0.16)); source.stop(now + 0.2);
    } else {
      const osc = audio.createOscillator(); osc.type = pad.kind === "snare" || pad.kind === "clap" ? "triangle" : "sine"; osc.frequency.setValueAtTime(pad.kind === "kick" ? 150 : pad.kind === "snare" ? 180 : 260 + index * 18, now); osc.frequency.exponentialRampToValueAtTime(pad.kind === "kick" ? 45 : 100, now + 0.18); osc.connect(gain); osc.start(now); gain.gain.exponentialRampToValueAtTime(0.48, now + 0.003); gain.gain.exponentialRampToValueAtTime(0.0001, now + (pad.kind === "kick" ? 0.45 : 0.22)); osc.stop(now + 0.5);
    }
    setActive(index); window.setTimeout(() => setActive(null), 110);
    if (shouldRecord && recording) setEvents((current) => [...current, { pad: index, at: performance.now() - started.current }]);
  };
  useEffect(() => { const onKey = (event: KeyboardEvent) => { const index = PADS.findIndex((pad) => pad.key === event.key.toLowerCase()); if (index >= 0 && !event.repeat) { event.preventDefault(); play(index); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); });
  useEffect(() => () => { void ctx.current?.close(); }, []);
  const toggleRecord = () => { if (recording) setRecording(false); else { setEvents([]); started.current = performance.now(); setRecording(true); } };
  const replay = () => { if (!events.length) return; const base = performance.now(); events.forEach((event) => window.setTimeout(() => play(event.pad, false), event.at)); void base; };

  return <section className="pad-tool" dir="rtl"><div className="tool-intro"><h1>פדים לדי־ג׳יי</h1><p>לוח פדים צבעוני לנגינת ביטים ואפקטים. אפשר ללחוץ או לנגן מהמקלדת.</p></div><div className="pad-actions"><button type="button" onClick={toggleRecord}>{recording ? <><CircleStop size={17} /> עצור הקלטה</> : <><Mic2 size={17} /> הקלט רצף</>}</button><button type="button" className="secondary-button" onClick={replay} disabled={!events.length}><Play size={17} /> נגן רצף</button><button type="button" className="secondary-button" onClick={() => setEvents([])} disabled={!events.length}><RotateCcw size={17} /> נקה</button></div>{recording && <p className="pad-recording"><span /> מקליט…</p>}<div className="pad-grid">{PADS.map((pad, index) => <button type="button" key={pad.key} className={`pad ${active === index ? "is-active" : ""}`} style={{ "--pad-color": pad.color } as React.CSSProperties} onPointerDown={() => play(index)} aria-label={`${pad.name}, מקש ${pad.key}`}><strong>{pad.name}</strong><kbd>{pad.key}</kbd></button>)}</div><p className="pad-help">אפשר להשתמש במקשים 1–4, Q–R, A–F ו־Z–V.</p></section>;
}
