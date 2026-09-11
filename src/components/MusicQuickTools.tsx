import { AudioLines, Gauge, Music, Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const NOTES = [
  ["דו", 261.63], ["רה", 293.66], ["מי", 329.63], ["פה", 349.23],
  ["סול", 392], ["לה", 440], ["סי", 493.88],
] as const;

export function MusicQuickTools() {
  const [bpm, setBpm] = useState(100);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [tapBpm, setTapBpm] = useState<number | null>(null);
  const tapTimes = useRef<number[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const oscillator = useRef<OscillatorNode | null>(null);

  useEffect(() => {
    if (!metronomeOn) return;
    const beep = () => {
      const context = audioContext.current ?? new AudioContext();
      audioContext.current = context;
      const source = context.createOscillator();
      const gain = context.createGain();
      source.frequency.value = 880;
      gain.gain.setValueAtTime(.16, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .055);
      source.connect(gain).connect(context.destination);
      source.start();
      source.stop(context.currentTime + .06);
    };
    beep();
    const timer = window.setInterval(beep, 60000 / bpm);
    return () => window.clearInterval(timer);
  }, [bpm, metronomeOn]);

  useEffect(() => () => {
    oscillator.current?.stop();
    void audioContext.current?.close();
  }, []);

  const tap = () => {
    const now = performance.now();
    const recent = [...tapTimes.current.filter((time) => now - time < 3000), now].slice(-6);
    tapTimes.current = recent;
    if (recent.length < 2) return;
    const gaps = recent.slice(1).map((time, index) => time - recent[index]);
    setTapBpm(Math.round(60000 / (gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)));
  };

  const playTone = (frequency: number) => {
    oscillator.current?.stop();
    const context = audioContext.current ?? new AudioContext();
    audioContext.current = context;
    const source = context.createOscillator();
    const gain = context.createGain();
    source.type = "sine";
    source.frequency.value = frequency;
    gain.gain.value = .12;
    source.connect(gain).connect(context.destination);
    source.start();
    oscillator.current = source;
    window.setTimeout(() => {
      if (oscillator.current === source) oscillator.current = null;
      try { source.stop(); } catch { /* already stopped */ }
    }, 1200);
  };

  return (
    <section className="quick-tools" aria-labelledby="quick-tools-title">
      <div className="quick-tools-heading">
        <div><span>עוד כלים</span><h2 id="quick-tools-title">כל מה שמוזיקאי צריך, במקום אחד</h2></div>
        <p>כלים מהירים שעובדים מיד, ללא העלאה וללא התקנה.</p>
      </div>
      <div className="quick-tools-grid">
        <article className="quick-tool-card">
          <span className="quick-tool-icon"><Gauge size={23} /></span>
          <h3>מטרונום</h3><p>שמור על קצב מדויק בזמן נגינה.</p>
          <strong className="tool-value">{bpm} <small>BPM</small></strong>
          <input aria-label="מהירות המטרונום" type="range" min="40" max="220" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
          <button type="button" className="quick-action" onClick={() => setMetronomeOn((value) => !value)}>{metronomeOn ? <Pause size={17} /> : <Play size={17} />}{metronomeOn ? "עצור" : "הפעל מטרונום"}</button>
        </article>
        <article className="quick-tool-card">
          <span className="quick-tool-icon"><AudioLines size={23} /></span>
          <h3>מצא את הקצב</h3><p>הקש לפי פעימות השיר ונחשב את הקצב.</p>
          <strong className="tool-value">{tapBpm ?? "—"} <small>BPM</small></strong>
          <button type="button" className="tap-button" onClick={tap}>הקש בקצב</button>
          <button type="button" className="tool-reset" onClick={() => { tapTimes.current = []; setTapBpm(null); }}>איפוס</button>
        </article>
        <article className="quick-tool-card">
          <span className="quick-tool-icon"><Music size={23} /></span>
          <h3>צלילי כיוון</h3><p>השמע תו נקי כדי לכוון קול או כלי נגינה.</p>
          <div className="note-buttons">{NOTES.map(([name, frequency]) => <button key={name} type="button" onClick={() => playTone(frequency)} aria-label={`השמע ${name}`}><Volume2 size={14} />{name}</button>)}</div>
        </article>
      </div>
    </section>
  );
}
