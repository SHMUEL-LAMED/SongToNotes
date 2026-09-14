import { AudioLines, Gauge, Music, Pause, Play, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const NOTES = [
  ["דו", 261.63], ["רה", 293.66], ["מי", 329.63], ["פה", 349.23],
  ["סול", 392], ["לה", 440], ["סי", 493.88],
] as const;

const BEATS_PER_BAR = 4;
/** How far ahead of the audio clock beats are queued, in seconds. */
const LOOKAHEAD = 0.12;
const SCHEDULER_MS = 25;

export function MusicQuickTools() {
  const [bpm, setBpm] = useState(100);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [tapBpm, setTapBpm] = useState<number | null>(null);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const tapTimes = useRef<number[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const voice = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  // The scheduler reads the tempo from a ref, so moving the slider bends the
  // running click instead of restarting it — which used to fire a beat on
  // every single step of the drag.
  const bpmRef = useRef(bpm);
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  const ensureContext = useCallback(() => {
    const context = audioContext.current ?? new AudioContext();
    audioContext.current = context;
    if (context.state === "suspended") void context.resume();
    return context;
  }, []);

  useEffect(() => {
    if (!metronomeOn) {
      setBeat(-1);
      return;
    }
    const context = ensureContext();
    // Beats are placed on the audio clock rather than fired from a timer, so
    // the click stays in time even while the page is busy elsewhere.
    let nextTime = context.currentTime + 0.08;
    let index = 0;
    const queued: { at: number; index: number }[] = [];

    const click = (at: number, accent: boolean) => {
      const source = context.createOscillator();
      const gain = context.createGain();
      source.frequency.value = accent ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.15, at + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
      source.connect(gain).connect(context.destination);
      source.start(at);
      source.stop(at + 0.07);
    };

    const schedule = () => {
      while (nextTime < context.currentTime + LOOKAHEAD) {
        click(nextTime, index % BEATS_PER_BAR === 0);
        queued.push({ at: nextTime, index: index % BEATS_PER_BAR });
        nextTime += 60 / bpmRef.current;
        index += 1;
      }
    };
    schedule();
    const timer = window.setInterval(schedule, SCHEDULER_MS);

    // The dot lights up when the beat it belongs to actually sounds.
    let frame = requestAnimationFrame(function follow() {
      while (queued.length && queued[0].at <= context.currentTime) {
        setBeat(queued.shift()!.index);
      }
      frame = requestAnimationFrame(follow);
    });

    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
    };
  }, [ensureContext, metronomeOn]);

  useEffect(() => () => {
    const context = audioContext.current;
    audioContext.current = null;
    void context?.close();
  }, []);

  const tap = () => {
    const now = performance.now();
    const recent = [...tapTimes.current.filter((time) => now - time < 3000), now].slice(-6);
    tapTimes.current = recent;
    if (recent.length < 2) return;
    const gaps = recent.slice(1).map((time, index) => time - recent[index]);
    setTapBpm(Math.round(60000 / (gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)));
  };

  /** Applies the tapped tempo to the metronome, so the two tools work together. */
  const useTappedTempo = () => {
    if (!tapBpm) return;
    setBpm(Math.max(40, Math.min(220, tapBpm)));
  };

  const playTone = (name: string, frequency: number) => {
    const context = ensureContext();
    const now = context.currentTime;
    // Fade the previous tone out instead of cutting it, which used to click.
    const previous = voice.current;
    if (previous) {
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setTargetAtTime(0.0001, now, 0.015);
      previous.osc.stop(now + 0.12);
    }

    const source = context.createOscillator();
    const gain = context.createGain();
    source.type = "sine";
    source.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
    gain.gain.setValueAtTime(0.13, now + 1.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    source.connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + 1.35);

    const entry = { osc: source, gain };
    voice.current = entry;
    setActiveNote(name);
    source.onended = () => {
      if (voice.current === entry) voice.current = null;
      setActiveNote((current) => (current === name ? null : current));
    };
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
          <div className="beat-dots" aria-hidden="true">
            {Array.from({ length: BEATS_PER_BAR }, (_, index) => (
              <i
                key={index}
                className={
                  beat === index
                    ? index === 0 ? "is-on is-accent" : "is-on"
                    : undefined
                }
              />
            ))}
          </div>
          <input aria-label="מהירות המטרונום" type="range" min="40" max="220" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} />
          <button type="button" className="quick-action" aria-pressed={metronomeOn} onClick={() => setMetronomeOn((value) => !value)}>{metronomeOn ? <Pause size={17} /> : <Play size={17} />}{metronomeOn ? "עצור" : "הפעל מטרונום"}</button>
        </article>
        <article className="quick-tool-card">
          <span className="quick-tool-icon"><AudioLines size={23} /></span>
          <h3>מצא את הקצב</h3><p>הקש לפי פעימות השיר ונחשב את הקצב.</p>
          <strong className="tool-value" aria-live="polite">{tapBpm ?? "—"} <small>BPM</small></strong>
          <button type="button" className="tap-button" onClick={tap}>הקש בקצב</button>
          <div className="tool-actions">
            <button type="button" className="tool-reset" disabled={!tapBpm} onClick={useTappedTempo}>העבר למטרונום</button>
            <button type="button" className="tool-reset" onClick={() => { tapTimes.current = []; setTapBpm(null); }}>איפוס</button>
          </div>
        </article>
        <article className="quick-tool-card">
          <span className="quick-tool-icon"><Music size={23} /></span>
          <h3>צלילי כיוון</h3><p>השמע תו נקי כדי לכוון קול או כלי נגינה (לה = 440Hz).</p>
          <div className="note-buttons">{NOTES.map(([name, frequency]) => (
            <button
              key={name}
              type="button"
              className={activeNote === name ? "is-sounding" : undefined}
              onClick={() => playTone(name, frequency)}
              aria-label={`השמע ${name}`}
            ><Volume2 size={14} />{name}</button>
          ))}</div>
        </article>
      </div>
    </section>
  );
}
