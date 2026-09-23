import { Compass, Guitar, Pause, Piano as PianoIcon, Play, Repeat } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INSTRUMENTS, NotePlayer, type Instrument } from "../lib/synth";
import {
  CIRCLE,
  GUITAR_STRINGS,
  PROGRESSIONS,
  ROOTS,
  SCALES,
  STRING_NAMES,
  circleIndex,
  diatonicChords,
  findScale,
  rootFor,
  scaleNotes,
  stepPattern,
  type ScaleId,
} from "../lib/theory";
import type { DetectedNote } from "../lib/types";
import { useAssistantTool } from "../lib/useAssistantTool";

const STATE_KEY = "musictools.theory.v1";

function readStored(): { root: number; scale: ScaleId } {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as { root?: number; scale?: string } | null;
    if (parsed && Number.isInteger(parsed.root) && parsed.root! >= 0 && parsed.root! < 12) {
      return { root: parsed.root!, scale: findScale(parsed.scale ?? "major").id };
    }
  } catch {
    // Starts in C major.
  }
  return { root: 0, scale: "major" };
}

const note = (midi: number, start: number, duration: number): DetectedNote => ({ midi, start, duration, confidence: 1 });

/** An arc segment of the circle, from angle a0 to a1 (degrees, 0 = top), between two radii. */
function segment(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const point = (radius: number, angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return `${(cx + radius * Math.cos(rad)).toFixed(2)} ${(cy + radius * Math.sin(rad)).toFixed(2)}`;
  };
  return `M ${point(r1, a0)} A ${r1} ${r1} 0 0 1 ${point(r1, a1)} L ${point(r0, a1)} A ${r0} ${r0} 0 0 0 ${point(r0, a0)} Z`;
}

function labelAt(cx: number, cy: number, radius: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

const STEP_NAMES: Record<number, string> = { 1: "½", 2: "1", 3: "1½", 4: "2" };

/**
 * The theory explorer: pick a key on the circle of fifths or from the list,
 * pick a scale or mode, and see it spelled, drawn on a keyboard and a guitar
 * neck, with the chords it builds — every one of them playable.
 */
export function TheoryTool() {
  const [initial] = useState(readStored);
  const [root, setRoot] = useState(initial.root);
  const [scaleId, setScaleId] = useState<ScaleId>(initial.scale);
  const [sevenths, setSevenths] = useState(false);
  const [view, setView] = useState<"piano" | "guitar">("piano");
  const [instrument, setInstrument] = useState<Instrument>("piano");
  const [playing, setPlaying] = useState<string | null>(null);
  const [lit, setLit] = useState<number[]>([]);
  const playerRef = useRef<NotePlayer | null>(null);
  const timersRef = useRef<number[]>([]);

  const scale = findScale(scaleId);
  const notes = useMemo(() => scaleNotes(root, scale), [root, scale]);
  const chords = useMemo(() => diatonicChords(root, scale, sevenths), [root, scale, sevenths]);
  const rootName = rootFor(root, scale).name;
  const pcs = useMemo(() => new Set(notes.map((item) => item.pc)), [notes]);
  const nameOf = useMemo(() => new Map(notes.map((item) => [item.pc, item.name])), [notes]);
  const index = circleIndex(root, scale);
  const minorRing = ["minor", "harmonicMinor", "melodicMinor", "minorPentatonic", "blues"].includes(scale.id);
  const key = index >= 0 ? CIRCLE[index] : null;

  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ root, scale: scaleId }));
    } catch {
      // Not remembered; fine.
    }
  }, [root, scaleId]);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  useEffect(
    () => () => {
      clearTimers();
      playerRef.current?.dispose();
    },
    [],
  );

  const stop = useCallback(() => {
    clearTimers();
    playerRef.current?.stop(true);
    setPlaying(null);
    setLit([]);
  }, []);

  /** Plays a list of notes, lighting each one on the keyboard as it sounds. */
  const play = useCallback(
    (id: string, list: DetectedNote[]) => {
      clearTimers();
      if (!playerRef.current) playerRef.current = new NotePlayer();
      const player = playerRef.current;
      player.stop(true);
      player.setInstrument(instrument);
      player.load(list, 0);
      player.setHandlers({ onEnd: () => setPlaying((current) => (current === id ? null : current)) });
      void player.play(0);
      setPlaying(id);
      const starts = [...new Set(list.map((item) => item.start))].sort((a, b) => a - b);
      for (const start of starts) {
        timersRef.current.push(
          window.setTimeout(() => setLit(list.filter((item) => item.start === start).map((item) => item.midi)), start * 1000),
        );
      }
      const end = Math.max(...list.map((item) => item.start + item.duration));
      timersRef.current.push(
        window.setTimeout(() => {
          setLit([]);
          setPlaying((current) => (current === id ? null : current));
        }, end * 1000 + 80),
      );
    },
    [instrument],
  );

  const playScale = () => {
    if (playing === "scale") return stop();
    const base = 60 + root;
    const up = [...scale.steps.map((step) => base + step), base + 12];
    const sequence = [...up, ...up.slice(0, -1).reverse()];
    play("scale", sequence.map((midi, position) => note(midi, position * 0.3, 0.34)));
  };

  const playChord = (degree: number) => {
    const chord = chords[degree - 1];
    if (!chord) return;
    play(`chord-${degree}`, chord.midi.map((midi, position) => note(midi, position * 0.03, 1.3)));
  };

  const playProgression = (id: string, degrees: number[]) => {
    if (playing === id) return stop();
    const list: DetectedNote[] = [];
    degrees.forEach((degree, position) => {
      const chord = chords[degree - 1];
      if (!chord) return;
      chord.midi.forEach((midi) => list.push(note(midi, position * 0.95, 0.9)));
      list.push(note(chord.midi[0] - 12, position * 0.95, 0.9));
    });
    play(id, list);
  };

  const playSingle = (midi: number) => play(`note-${midi}`, [note(midi, 0, 0.8)]);

  const pickFromCircle = (position: number, ring: "major" | "minor") => {
    const item = CIRCLE[position];
    if (ring === "major") {
      setRoot(item.pc);
      setScaleId("major");
    } else {
      setRoot((item.pc + 9) % 12);
      setScaleId("minor");
    }
  };

  useAssistantTool("theory", {
    state: () =>
      `סייר תאוריה: ${rootName} ${scale.label}; תווים ${notes.map((item) => item.name).join(" ")}; ${
        chords.length ? `אקורדים: ${chords.map((chord) => `${chord.roman}=${chord.name}`).join(", ")}` : "סולם בלי אקורדים דיאטוניים"
      }; תצוגה ${view === "piano" ? "פסנתר" : "גיטרה"}.`,
    handlers: {
      "theory.set": ({ root: nextRoot, scale: nextScale, sevenths: nextSevenths, view: nextView }) => {
        if (nextRoot !== undefined) {
          const clean = String(nextRoot).replace("#", "♯").replace(/b$/, "♭");
          const found = ROOTS.find((item) => item.name === clean) ?? ROOTS.find((item) => item.pc === Number(nextRoot));
          const sharpAlias: Record<string, number> = { "C♯": 1, "D♯": 3, "G♭": 6, "G♯": 8, "A♯": 10 };
          const pc = found?.pc ?? sharpAlias[clean];
          if (pc === undefined) return { ok: false, message: `לא מכיר טוניקה בשם ${String(nextRoot)}` };
          setRoot(pc);
        }
        if (nextScale !== undefined) {
          if (!SCALES.some((item) => item.id === nextScale)) return { ok: false, message: `אין סולם בשם ${String(nextScale)}` };
          setScaleId(nextScale as ScaleId);
        }
        if (nextSevenths !== undefined) setSevenths(Boolean(nextSevenths));
        if (nextView === "piano" || nextView === "guitar") setView(nextView);
        return { ok: true, message: "הסולם עודכן" };
      },
      "theory.play": ({ what, degree }) => {
        if (what === "chord") {
          if (!chords.length) return { ok: false, message: "בסולם הזה אין אקורדים דיאטוניים" };
          playChord(Math.max(1, Math.min(7, Number(degree) || 1)));
          return { ok: true, message: "האקורד מתנגן" };
        }
        playScale();
        return { ok: true, message: "הסולם מתנגן" };
      },
    },
  });

  // Two octaves of keyboard from C4.
  const keys = useMemo(() => {
    const list: { midi: number; black: boolean; whiteIndex: number }[] = [];
    let white = 0;
    for (let midi = 60; midi < 84; midi += 1) {
      const black = [1, 3, 6, 8, 10].includes(midi % 12);
      list.push({ midi, black, whiteIndex: black ? white - 1 : white });
      if (!black) white += 1;
    }
    return list;
  }, []);
  const whiteCount = keys.filter((item) => !item.black).length;

  const size = 320;
  const c = size / 2;

  return (
    <section className="tool-body theory-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Compass size={26} />
        </span>
        <div>
          <h1>סייר תאוריה</h1>
          <p>בוחרים טוניקה וסולם — על מעגל הקווינטות או מהרשימה — ורואים ושומעים את התווים, המרווחים והאקורדים.</p>
        </div>
      </div>

      <div className="theory-top">
        <div className="circle-card">
          <svg viewBox={`0 0 ${size} ${size}`} className="fifths" role="group" aria-label="מעגל הקווינטות">
            {CIRCLE.map((item, position) => {
              const a0 = position * 30 - 15;
              const a1 = a0 + 30;
              const near = index >= 0 && (position === (index + 1) % 12 || position === (index + 11) % 12);
              const majorOn = position === index && !minorRing;
              const minorOn = position === index && minorRing;
              const majorLabel = labelAt(c, c, 128, position * 30);
              const minorLabel = labelAt(c, c, 84, position * 30);
              return (
                <g key={item.major}>
                  <path
                    d={segment(c, c, 104, 152, a0, a1)}
                    className={`fifths-seg ${majorOn ? "is-on" : ""} ${near && !minorRing ? "is-near" : ""}`}
                    onClick={() => pickFromCircle(position, "major")}
                    role="button"
                    aria-label={`${item.major} מז׳ור`}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pickFromCircle(position, "major");
                      }
                    }}
                  />
                  <text x={majorLabel.x} y={majorLabel.y} className={`fifths-label ${majorOn ? "is-on" : ""}`}>
                    {item.major}
                  </text>
                  <path
                    d={segment(c, c, 62, 104, a0, a1)}
                    className={`fifths-seg is-minor ${minorOn ? "is-on" : ""} ${near && minorRing ? "is-near" : ""}`}
                    onClick={() => pickFromCircle(position, "minor")}
                    role="button"
                    aria-label={`${item.minor.replace("m", "")} מינור`}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pickFromCircle(position, "minor");
                      }
                    }}
                  />
                  <text x={minorLabel.x} y={minorLabel.y} className={`fifths-label is-minor ${minorOn ? "is-on" : ""}`}>
                    {item.minor}
                  </text>
                </g>
              );
            })}
            <circle cx={c} cy={c} r={58} className="fifths-core" />
            <text x={c} y={c - 8} className="fifths-key">
              {rootName}
            </text>
            <text x={c} y={c + 16} className="fifths-sub">
              {key ? key.accidentals : ""}
            </text>
          </svg>
        </div>

        <div className="theory-controls settings-panel">
          <div className="setting-field">
            <span>טוניקה</span>
            <div className="root-picker" dir="ltr">
              {ROOTS.map((item) => (
                <button key={item.pc} type="button" className={root === item.pc ? "active" : ""} onClick={() => setRoot(item.pc)} aria-pressed={root === item.pc}>
                  {rootFor(item.pc, scale).name}
                </button>
              ))}
            </div>
          </div>
          <label className="setting-field">
            <span>סולם או מודוס</span>
            <select value={scaleId} onChange={(event) => setScaleId(event.target.value as ScaleId)} aria-label="סולם">
              {SCALES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>{scale.mood}</small>
          </label>
          <div className="theory-actions">
            <button type="button" className="primary-button compact" onClick={playScale}>
              {playing === "scale" ? <Pause size={17} /> : <Play size={17} />} {playing === "scale" ? "עצירה" : "השמעת הסולם"}
            </button>
            <select className="field" value={instrument} onChange={(event) => setInstrument(event.target.value as Instrument)} aria-label="צליל">
              {INSTRUMENTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <dl className="theory-facts">
            <div>
              <dt>סימני היתק</dt>
              <dd>{key ? key.accidentals : "—"}</dd>
            </div>
            <div>
              <dt>{scale.minorish ? "המז׳ור המקביל" : "המינור המקביל"}</dt>
              <dd dir="ltr">{key ? (scale.minorish ? key.major : key.minor) : "—"}</dd>
            </div>
            <div>
              <dt>מבנה (טונים)</dt>
              <dd dir="ltr">{stepPattern(scale).map((step) => STEP_NAMES[step] ?? step).join(" · ")}</dd>
            </div>
          </dl>
        </div>
      </div>

      <ol className="theory-notes" dir="ltr" aria-label="תווי הסולם">
        {notes.map((item, position) => (
          <li key={`${item.name}-${position}`} className={position === 0 ? "is-root" : ""}>
            <button type="button" onClick={() => playSingle(60 + root + item.semitones)} aria-label={`השמעת ${item.name}`}>
              <b>{item.name}</b>
              <small>{item.degree}</small>
            </button>
          </li>
        ))}
      </ol>

      <div className="workspace-card">
        <div className="result-toolbar">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === "piano"} className={view === "piano" ? "active" : ""} onClick={() => setView("piano")}>
              <PianoIcon size={16} /> פסנתר
            </button>
            <button type="button" role="tab" aria-selected={view === "guitar"} className={view === "guitar" ? "active" : ""} onClick={() => setView("guitar")}>
              <Guitar size={16} /> גיטרה
            </button>
          </div>
          <span className="table-footnote">לחיצה על תו משמיעה אותו · הטוניקה מסומנת בצבע מלא</span>
        </div>

        {view === "piano" ? (
          <div className="theory-piano" dir="ltr" style={{ "--white-count": whiteCount } as React.CSSProperties}>
            {keys.map((item) => {
              const inScale = pcs.has(item.midi % 12);
              const isRoot = item.midi % 12 === root;
              const on = lit.includes(item.midi);
              return (
                <button
                  key={item.midi}
                  type="button"
                  className={`theory-key ${item.black ? "black" : "white"} ${inScale ? "in-scale" : ""} ${isRoot ? "is-root" : ""} ${on ? "is-lit" : ""}`}
                  style={item.black ? { left: `calc((${item.whiteIndex} + 0.68) * (100% / ${whiteCount}))` } : undefined}
                  onClick={() => playSingle(item.midi)}
                  aria-label={inScale ? nameOf.get(item.midi % 12) : undefined}
                >
                  {inScale && <span>{nameOf.get(item.midi % 12)}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="fretboard-wrap">
            <div className="fretboard" dir="ltr">
              <div className="fret-numbers" aria-hidden="true">
                <span />
                {Array.from({ length: 13 }, (_, fret) => (
                  <span key={fret}>{fret}</span>
                ))}
              </div>
              {[...GUITAR_STRINGS].reverse().map((open, row) => (
                <div key={open} className="fret-string">
                  <span className="fret-name">{STRING_NAMES[STRING_NAMES.length - 1 - row]}</span>
                  {Array.from({ length: 13 }, (_, fret) => {
                    const midi = open + fret;
                    const inScale = pcs.has(midi % 12);
                    const isRoot = midi % 12 === root;
                    return (
                      <button
                        key={fret}
                        type="button"
                        className={`fret ${fret === 0 ? "is-open" : ""} ${inScale ? "in-scale" : ""} ${isRoot ? "is-root" : ""} ${lit.includes(midi) ? "is-lit" : ""}`}
                        onClick={() => playSingle(midi)}
                        aria-label={inScale ? `${nameOf.get(midi % 12)}, סריג ${fret}` : `סריג ${fret}`}
                      >
                        {inScale && <span>{nameOf.get(midi % 12)}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="fret-markers" aria-hidden="true">
                <span />
                {Array.from({ length: 13 }, (_, fret) => (
                  <span key={fret}>{[3, 5, 7, 9].includes(fret) ? "•" : fret === 12 ? "••" : ""}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {chords.length > 0 ? (
        <div className="workspace-card">
          <div className="result-toolbar">
            <div>
              <h2 className="theory-heading">האקורדים של הסולם</h2>
              <p className="table-footnote">אקורד על כל דרגה, בנוי מטרצות. לחיצה משמיעה.</p>
            </div>
            <div className="segmented-control">
              <button type="button" className={!sevenths ? "active" : ""} onClick={() => setSevenths(false)} aria-pressed={!sevenths}>
                משולשים
              </button>
              <button type="button" className={sevenths ? "active" : ""} onClick={() => setSevenths(true)} aria-pressed={sevenths}>
                ספטאקורדים
              </button>
            </div>
          </div>
          <div className="chord-cards">
            {chords.map((chord) => (
              <button
                key={chord.degree}
                type="button"
                className={`chord-card q-${chord.quality} ${playing === `chord-${chord.degree}` ? "is-playing" : ""}`}
                onClick={() => playChord(chord.degree)}
              >
                <span className="chord-roman" dir="ltr">{chord.roman}</span>
                <strong dir="ltr">{chord.name}</strong>
                <small>{chord.qualityLabel}</small>
                <span className="chord-notes" dir="ltr">
                  {chord.notes.join(" · ")}
                </span>
              </button>
            ))}
          </div>

          <div className="progressions">
            <h3>מהלכים מוכרים</h3>
            <ul>
              {PROGRESSIONS.filter((item) => Boolean(item.minor) === scale.minorish).map((item) => (
                <li key={item.id}>
                  <button type="button" className={`secondary-button ${playing === item.id ? "is-on" : ""}`} onClick={() => playProgression(item.id, item.degrees)}>
                    {playing === item.id ? <Pause size={15} /> : <Repeat size={15} />} {item.label}
                  </button>
                  <span dir="ltr">{item.degrees.map((degree) => chords[degree - 1]?.name).join(" – ")}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="notice-message">
          ל{scale.label} אין אקורדים דיאטוניים במובן הרגיל — הוא סולם של {notes.length} צלילים, שמנגנים בדרך כלל מעל אקורדי המז׳ור או המינור של אותה טוניקה.
        </p>
      )}
    </section>
  );
}
