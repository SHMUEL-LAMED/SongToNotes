import { Dices, Download, History, Lock, LockOpen, Music, Pause, Piano, Play, Repeat, Shuffle, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { downloadFile } from "../lib/export";
import {
  MELODY_MOODS,
  MELODY_SCALES,
  accompanimentNotes,
  generateMelody,
  isMelodyMood,
  isMelodyScale,
  keyLabel,
  melodyLength,
  melodyToMidi,
  melodyToNotes,
  noteNamer,
  parseKeyName,
  parseSeedCode,
  randomSeed,
  scaleDefinition,
  seedCode,
  type Melody,
  type MelodyBars,
  type MelodyMood,
  type MelodyScale,
} from "../lib/melody";
import { LEAD_IN, savePianoLesson } from "../lib/pianoLesson";
import { INSTRUMENTS, NotePlayer, type Instrument } from "../lib/synth";
import { ROOTS } from "../lib/theory";
import type { DetectedNote } from "../lib/types";
import { useAssistantTool } from "../lib/useAssistantTool";
import "./melody.css";

const STATE_KEY = "musictools.melody.v1";

type Stored = {
  key: number;
  scale: MelodyScale;
  mood: MelodyMood;
  bpm: number;
  bars: MelodyBars;
  density: number;
  range: 1 | 2;
  chords: boolean;
  instrument: Instrument;
  loop: boolean;
  lockRhythm: boolean;
  lockNotes: boolean;
  rhythmSeed: number;
  noteSeed: number;
};

const clampBpm = (value: number, fallback: number) => Math.max(50, Math.min(200, Math.round(Number(value)) || fallback));
const isSeed = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) < 2 ** 31;

function readStored(): Stored {
  const defaults: Stored = {
    key: 0,
    scale: "major",
    mood: "happy",
    bpm: 112,
    bars: 4,
    density: 3,
    range: 1,
    chords: true,
    instrument: "piano",
    loop: true,
    lockRhythm: false,
    lockNotes: false,
    rhythmSeed: randomSeed(),
    noteSeed: randomSeed(),
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as Partial<Stored> | null;
    if (!parsed || typeof parsed !== "object") return defaults;
    return {
      key: Number.isInteger(parsed.key) && parsed.key! >= 0 && parsed.key! < 12 ? parsed.key! : defaults.key,
      scale: isMelodyScale(parsed.scale) ? parsed.scale : defaults.scale,
      mood: isMelodyMood(parsed.mood) ? parsed.mood : defaults.mood,
      bpm: clampBpm(Number(parsed.bpm), defaults.bpm),
      bars: [2, 4, 8].includes(Number(parsed.bars)) ? (Number(parsed.bars) as MelodyBars) : defaults.bars,
      density: [1, 2, 3, 4, 5].includes(Number(parsed.density)) ? Number(parsed.density) : defaults.density,
      range: parsed.range === 2 ? 2 : 1,
      chords: parsed.chords !== false,
      instrument: INSTRUMENTS.some((item) => item.id === parsed.instrument) ? parsed.instrument! : defaults.instrument,
      loop: parsed.loop !== false,
      lockRhythm: parsed.lockRhythm === true,
      lockNotes: parsed.lockNotes === true,
      rhythmSeed: isSeed(parsed.rhythmSeed) ? parsed.rhythmSeed : defaults.rhythmSeed,
      noteSeed: isSeed(parsed.noteSeed) ? parsed.noteSeed : defaults.noteSeed,
    };
  } catch {
    return defaults;
  }
}

/** The same notes back to back, so two players on separate clocks can loop without drifting apart. */
function repeatNotes(notes: DetectedNote[], passes: number, length: number) {
  const out: DetectedNote[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    for (const note of notes) out.push({ ...note, start: note.start + pass * length });
  }
  return out;
}

const plainKey = (label: string) => label.replace(/♯/g, "#").replace(/♭/g, "b");

/**
 * The melody generator: a key, a scale and a mood give a short original tune
 * over a chord progression. Redraw it, keep its rhythm or its notes, hear it
 * with an accompaniment, and take it away as MIDI or to the piano to learn.
 */
export function MelodyTool() {
  const [initial] = useState(readStored);
  const [key, setKey] = useState(initial.key);
  const [scale, setScale] = useState<MelodyScale>(initial.scale);
  const [mood, setMood] = useState<MelodyMood>(initial.mood);
  const [bpm, setBpm] = useState(initial.bpm);
  const [bars, setBars] = useState<MelodyBars>(initial.bars);
  const [density, setDensity] = useState(initial.density);
  const [range, setRange] = useState<1 | 2>(initial.range);
  const [chords, setChords] = useState(initial.chords);
  const [instrument, setInstrument] = useState<Instrument>(initial.instrument);
  const [loop, setLoop] = useState(initial.loop);
  const [lockRhythm, setLockRhythm] = useState(initial.lockRhythm);
  const [lockNotes, setLockNotes] = useState(initial.lockNotes);
  const [seeds, setSeeds] = useState({ rhythmSeed: initial.rhythmSeed, noteSeed: initial.noteSeed });
  const [history, setHistory] = useState<{ rhythmSeed: number; noteSeed: number }[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playBeat, setPlayBeat] = useState(-1);
  const leadRef = useRef<NotePlayer | null>(null);
  const backRef = useRef<NotePlayer | null>(null);

  const melody = useMemo(
    () => generateMelody({ key, scale, mood, bars, density, range, rhythmSeed: seeds.rhythmSeed, noteSeed: seeds.noteSeed }),
    [bars, density, key, mood, range, scale, seeds],
  );
  const leadNotes = useMemo(() => melodyToNotes(melody, bpm), [bpm, melody]);
  const backNotes = useMemo(() => (chords ? accompanimentNotes(melody, bpm) : []), [bpm, chords, melody]);
  const length = melodyLength(melody, bpm);
  const code = seedCode(seeds.rhythmSeed, seeds.noteSeed);
  const keyName = keyLabel(key, scale);
  const scaleLabel = MELODY_SCALES.find((item) => item.id === scale)?.label ?? "";
  const moodLabel = MELODY_MOODS.find((item) => item.id === mood)?.label ?? "";
  const namer = useMemo(() => noteNamer({ key, scale }), [key, scale]);
  // A piano tune sits well on strings; anything else on a piano.
  const backInstrument: Instrument = instrument === "piano" ? "strings" : "piano";

  useEffect(() => {
    try {
      const stored: Stored = { key, scale, mood, bpm, bars, density, range, chords, instrument, loop, lockRhythm, lockNotes, ...seeds };
      localStorage.setItem(STATE_KEY, JSON.stringify(stored));
    } catch {
      // Not remembered for next time.
    }
  }, [bars, bpm, chords, density, instrument, key, lockNotes, lockRhythm, loop, mood, range, scale, seeds]);

  /* ---- playback ---- */

  // Looping is done by laying the tune end to end for a few minutes rather
  // than by the players' own loop, which restarts each player on its own
  // timer and would let the melody and the chords slide apart.
  const loadPlayers = useCallback(() => {
    const lead = leadRef.current;
    const back = backRef.current;
    if (!lead || !back) return;
    const passes = loop ? Math.max(2, Math.min(64, Math.ceil(240 / length))) : 1;
    lead.setInstrument(instrument);
    lead.load(repeatNotes(leadNotes, passes, length), 0);
    back.setInstrument(backInstrument);
    back.setVolume(0.55);
    back.load(repeatNotes(backNotes, passes, length), 0);
    // Chords switched on mid-play join in where the melody is.
    if (lead.isPlaying && !back.isPlaying && backNotes.length) void back.play(lead.currentTime);
  }, [backInstrument, backNotes, instrument, leadNotes, length, loop]);

  const stop = useCallback(() => {
    leadRef.current?.stop(true);
    backRef.current?.stop(true);
    setPlaying(false);
  }, []);

  const start = useCallback(() => {
    if (!leadRef.current) {
      leadRef.current = new NotePlayer();
      backRef.current = new NotePlayer();
    }
    const lead = leadRef.current;
    const back = backRef.current!;
    lead.setHandlers({
      onEnd: () => {
        back.stop(true);
        setPlaying(false);
      },
    });
    lead.stop(true);
    back.stop(true);
    loadPlayers();
    void lead.play(0);
    if (backNotes.length) void back.play(0);
    setPlaying(true);
  }, [backNotes.length, loadPlayers]);

  const toggle = useCallback(() => {
    if (leadRef.current?.isPlaying) stop();
    else start();
  }, [start, stop]);

  // A change while it plays is heard at once, from the same place.
  useEffect(() => {
    if (leadRef.current?.isPlaying) loadPlayers();
  }, [loadPlayers]);

  useEffect(
    () => () => {
      leadRef.current?.dispose();
      backRef.current?.dispose();
    },
    [],
  );

  // The note under the playhead lights up.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const beat = 60 / bpm;
    const tick = () => {
      const time = leadRef.current?.currentTime ?? 0;
      setPlayBeat((time % length) / beat);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setPlayBeat(-1);
    };
  }, [bpm, length, playing]);

  // Space starts and stops, unless the focus is on something Space already works.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName)) return;
      if (target?.isContentEditable || target?.closest("[role=dialog]")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  /* ---- new melodies ---- */

  const applySeeds = useCallback(
    (next: { rhythmSeed: number; noteSeed: number }) => {
      setHistory((previous) => [...previous.slice(-29), seeds]);
      setSeeds(next);
    },
    [seeds],
  );

  const regenerate = useCallback(
    (options: { keepRhythm?: boolean; keepNotes?: boolean } = {}) => {
      const keepRhythm = options.keepRhythm ?? lockRhythm;
      const keepNotes = options.keepNotes ?? lockNotes;
      applySeeds({
        rhythmSeed: keepRhythm ? seeds.rhythmSeed : randomSeed(),
        // Both locked would change nothing, so the notes give way.
        noteSeed: keepNotes && !keepRhythm ? seeds.noteSeed : randomSeed(),
      });
    },
    [applySeeds, lockNotes, lockRhythm, seeds],
  );

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setSeeds(previous);
  };

  const pickMood = (next: MelodyMood) => {
    setMood(next);
    // Each mood suggests its tempo; the slider is still free to move after.
    setBpm(MELODY_MOODS.find((item) => item.id === next)?.bpm ?? bpm);
  };

  /* ---- taking it away ---- */

  const downloadMidi = useCallback(
    (tune: Melody = melody) => {
      const data = melodyToMidi(tune, bpm, chords);
      downloadFile(data, `melody-${plainKey(keyLabel(tune.settings.key, tune.settings.scale))}-${tune.settings.mood}-${bpm}bpm-${seedCode(tune.settings.rhythmSeed, tune.settings.noteSeed)}.mid`, "audio/midi");
    },
    [bpm, chords, melody],
  );

  // Handed to the virtual piano to learn, as song-to-notes does: its notes fall onto the keys.
  const learnOnPiano = useCallback(() => {
    stop();
    const round = (value: number) => Math.round(value * 1000) / 1000;
    savePianoLesson({
      title: `מנגינה ב־${keyName} (${moodLabel})`,
      notes: leadNotes.map((note) => ({ midi: note.midi, start: round(note.start + LEAD_IN), duration: round(note.duration) })),
    });
    window.location.assign("#/piano");
  }, [keyName, leadNotes, moodLabel, stop]);

  /* ---- the assistant ---- */

  useAssistantTool("melody", {
    state: () =>
      `מחולל מנגינות: סולם ${keyName} ${scaleLabel}, אווירה ${moodLabel}, ${bars} תיבות, ${bpm} BPM, צפיפות ${density}/5, טווח ${range === 2 ? "שתי אוקטבות" : "אוקטבה"}, ליווי אקורדים ${chords ? "פועל" : "כבוי"}, כלי ${INSTRUMENTS.find((item) => item.id === instrument)?.label}. ` +
      `האקורדים: ${melody.chords.map((slot) => slot.chord.name).join(" ")}. ${melody.notes.length} תווים: ${melody.notes.map((note) => namer(note.midi)).join(" ")}. קוד המנגינה ${code}; ${playing ? "מתנגנת" : "עצורה"}.`,
    handlers: {
      "melody.generate": ({ key: nextKey, scale: nextScale, mood: nextMood }) => {
        let pc = key;
        let chosenScale = scale;
        if (nextKey !== undefined && String(nextKey).trim()) {
          const parsed = parseKeyName(String(nextKey));
          if (parsed === null) return { ok: false, message: `לא מכיר טוניקה בשם ${String(nextKey)}` };
          pc = parsed;
          // "Am" asks for a minor key when no scale was named.
          if (nextScale === undefined && /^[A-Ga-g][#♯b♭]?m$/.test(String(nextKey).trim())) chosenScale = "minor";
        }
        if (nextScale !== undefined) {
          if (!isMelodyScale(nextScale)) return { ok: false, message: `אין סולם בשם ${String(nextScale)}` };
          chosenScale = nextScale;
        }
        if (nextMood !== undefined && !isMelodyMood(nextMood)) return { ok: false, message: `אין אווירה בשם ${String(nextMood)}` };
        const chosenMood = (nextMood as MelodyMood | undefined) ?? mood;
        setKey(pc);
        setScale(chosenScale);
        if (chosenMood !== mood) pickMood(chosenMood);
        const next = { rhythmSeed: randomSeed(), noteSeed: randomSeed() };
        applySeeds(next);
        const tune = generateMelody({ key: pc, scale: chosenScale, mood: chosenMood, bars, density, range, ...next });
        const label = `${keyLabel(pc, chosenScale)} ${MELODY_SCALES.find((item) => item.id === chosenScale)?.label}`;
        return {
          ok: true,
          message: `נוצרה מנגינה חדשה ב־${label}, ${MELODY_MOODS.find((item) => item.id === chosenMood)?.label} (קוד ${seedCode(next.rhythmSeed, next.noteSeed)})`,
          data: { chords: tune.chords.map((slot) => slot.chord.name), notes: tune.notes.length },
        };
      },
      "melody.set": ({ bpm: nextBpm, bars: nextBars, density: nextDensity, range: nextRange, chords: nextChords }) => {
        const changed: string[] = [];
        if (nextBpm !== undefined) {
          const value = clampBpm(Number(nextBpm), bpm);
          setBpm(value);
          changed.push(`קצב ${value}`);
        }
        if (nextBars !== undefined) {
          if (![2, 4, 8].includes(Number(nextBars))) return { ok: false, message: "מספר התיבות יכול להיות 2, 4 או 8" };
          setBars(Number(nextBars) as MelodyBars);
          changed.push(`${Number(nextBars)} תיבות`);
        }
        if (nextDensity !== undefined) {
          const value = Math.max(1, Math.min(5, Math.round(Number(nextDensity)) || density));
          setDensity(value);
          changed.push(`צפיפות ${value}`);
        }
        if (nextRange !== undefined) {
          const value = Number(nextRange) >= 2 ? 2 : 1;
          setRange(value);
          changed.push(value === 2 ? "טווח של שתי אוקטבות" : "טווח של אוקטבה");
        }
        if (nextChords !== undefined) {
          const value = nextChords === true || nextChords === "true";
          setChords(value);
          changed.push(value ? "עם ליווי" : "בלי ליווי");
        }
        return changed.length ? { ok: true, message: `עודכן: ${changed.join(", ")}` } : { ok: false, message: "לא נמסרה אף הגדרה לשינוי" };
      },
      "melody.play": ({ command }) => {
        if (command === "stop") {
          stop();
          return { ok: true, message: "המנגינה נעצרה" };
        }
        start();
        return { ok: true, message: loop ? "המנגינה מתנגנת בלולאה" : "המנגינה מתנגנת" };
      },
      "melody.export": () => {
        downloadMidi();
        return { ok: true, message: chords ? "קובץ MIDI עם המנגינה והאקורדים ירד" : "קובץ MIDI עם המנגינה ירד" };
      },
      "melody.piano": () => {
        learnOnPiano();
        return { ok: true, message: "המנגינה נשלחה לפסנתר ללימוד" };
      },
    },
  });

  const bothLocked = lockRhythm && lockNotes;

  return (
    <section className="tool-body melody-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <WandSparkles size={26} />
        </span>
        <div>
          <h1>מחולל מנגינות</h1>
          <p>בוחרים סולם, אווירה וקצב ומקבלים מנגינה מקורית על מהלך אקורדים — עם מוטיב שחוזר וסיום שנוחת בבית. אפשר לשמור את הקצב ולהחליף רק את התווים, או להפך.</p>
        </div>
      </div>

      <div className="settings-panel melody-setup">
        <div className="setting-field melody-field-wide">
          <span>אווירה</span>
          <div className="segmented-control" role="group" aria-label="אווירה">
            {MELODY_MOODS.map((item) => (
              <button key={item.id} type="button" className={item.id === mood ? "active" : ""} aria-pressed={item.id === mood} onClick={() => pickMood(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-field">
          <span>
            טוניקה <b dir="ltr">{keyName}</b>
          </span>
          <div className="root-picker" dir="ltr" role="group" aria-label="טוניקה">
            {ROOTS.map((item) => (
              <button key={item.pc} type="button" className={key === item.pc ? "active" : ""} aria-pressed={key === item.pc} onClick={() => setKey(item.pc)}>
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-field">
          <span>סולם</span>
          <div className="melody-chips" role="group" aria-label="סולם">
            {MELODY_SCALES.map((item) => (
              <button key={item.id} type="button" className={`chip-toggle ${item.id === scale ? "active" : ""}`} aria-pressed={item.id === scale} onClick={() => setScale(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-panel melody-shape">
        <div className="setting-field">
          <span>תיבות</span>
          <div className="segmented-control" role="group" aria-label="מספר תיבות">
            {([2, 4, 8] as MelodyBars[]).map((value) => (
              <button key={value} type="button" className={bars === value ? "active" : ""} aria-pressed={bars === value} onClick={() => setBars(value)}>
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-field">
          <span>טווח</span>
          <div className="segmented-control" role="group" aria-label="טווח">
            <button type="button" className={range === 1 ? "active" : ""} aria-pressed={range === 1} onClick={() => setRange(1)}>
              אוקטבה
            </button>
            <button type="button" className={range === 2 ? "active" : ""} aria-pressed={range === 2} onClick={() => setRange(2)}>
              שתי אוקטבות
            </button>
          </div>
        </div>
        <label className="setting-field">
          <span>
            צפיפות תווים <b>{density}</b>
          </span>
          <input type="range" min={1} max={5} step={1} value={density} onChange={(event) => setDensity(Number(event.target.value))} aria-label="צפיפות תווים" />
        </label>
        <label className="setting-field">
          <span>
            קצב <b>{bpm}</b> BPM
          </span>
          <input type="range" min={50} max={200} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} aria-label="קצב" />
        </label>
        <label className="setting-field">
          <span>צליל המנגינה</span>
          <select value={instrument} onChange={(event) => setInstrument(event.target.value as Instrument)}>
            {INSTRUMENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-field melody-check">
          <input type="checkbox" checked={chords} onChange={(event) => setChords(event.target.checked)} />
          <span>ליווי אקורדים ובס</span>
        </label>
      </div>

      <div className="melody-deck">
        <button type="button" className={`beat-play ${playing ? "is-playing" : ""}`} onClick={playing ? stop : start} aria-pressed={playing} title="רווח מנגן ועוצר">
          {playing ? <Pause size={22} /> : <Play size={24} fill="currentColor" />}
          <span>{playing ? "עצירה" : "ניגון"}</span>
        </button>
        <div className="melody-deck-main">
          <button type="button" className="primary-button compact" onClick={() => regenerate()} disabled={bothLocked} title={bothLocked ? "הקצב והתווים נעולים" : undefined}>
            <Dices size={17} /> מנגינה חדשה
          </button>
          <button type="button" className="secondary-button" onClick={() => regenerate({ keepRhythm: true, keepNotes: false })}>
            <Shuffle size={16} /> אותו קצב, תווים חדשים
          </button>
          <button type="button" className="secondary-button" onClick={undo} disabled={!history.length} title="חזרה למנגינה הקודמת">
            <History size={16} /> הקודמת
          </button>
        </div>
        <div className="melody-deck-toggles">
          <button type="button" className={`chip-toggle ${loop ? "active" : ""}`} aria-pressed={loop} onClick={() => setLoop(!loop)}>
            <Repeat size={14} /> לולאה
          </button>
          <button type="button" className={`chip-toggle ${lockRhythm ? "active" : ""}`} aria-pressed={lockRhythm} onClick={() => setLockRhythm(!lockRhythm)}>
            {lockRhythm ? <Lock size={14} /> : <LockOpen size={14} />} נעילת הקצב
          </button>
          <button type="button" className={`chip-toggle ${lockNotes ? "active" : ""}`} aria-pressed={lockNotes} onClick={() => setLockNotes(!lockNotes)}>
            {lockNotes ? <Lock size={14} /> : <LockOpen size={14} />} נעילת התווים
          </button>
        </div>
      </div>

      <div className="card melody-stage">
        <div className="melody-stage-head">
          <strong>
            <Music size={16} /> <span dir="ltr">{keyName}</span> {scaleLabel} · {moodLabel} · {bars} תיבות · {bpm} BPM
          </strong>
          <SeedField key={code} code={code} onApply={applySeeds} />
        </div>
        <MelodyRoll melody={melody} playBeat={playBeat} namer={namer} />
        <p className="melody-legend">
          <span className="melody-swatch is-strong" aria-hidden="true" /> תו על פעמה חזקה (צליל של האקורד)
          <span className="melody-swatch" aria-hidden="true" /> תו מעבר או שכן
        </p>
      </div>

      <div className="download-buttons melody-downloads">
        <button type="button" onClick={() => downloadMidi()}>
          <Download size={20} />
          <span>
            הורדת MIDI
            <small>{chords ? "ערוץ מנגינה וערוץ אקורדים" : "המנגינה בלבד"}</small>
          </span>
        </button>
        <button type="button" onClick={learnOnPiano}>
          <Piano size={20} />
          <span>
            ללמוד בפסנתר
            <small>התווים נופלים על הקלידים בפסנתר הווירטואלי</small>
          </span>
        </button>
      </div>
    </section>
  );
}

/** The seed code, editable: the same code with the same settings plays the same melody. */
function SeedField({ code, onApply }: { code: string; onApply: (seeds: { rhythmSeed: number; noteSeed: number }) => void }) {
  const [draft, setDraft] = useState(code);
  const [error, setError] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseSeedCode(draft);
    if (!parsed) {
      setError(true);
      return;
    }
    setError(false);
    if (seedCode(parsed.rhythmSeed, parsed.noteSeed) !== code) onApply(parsed);
  };
  return (
    <form className="melody-seed" onSubmit={submit}>
      <label>
        <span>קוד המנגינה</span>
        <input
          dir="ltr"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(false);
          }}
          aria-invalid={error}
          aria-describedby={error ? "melody-seed-error" : undefined}
          spellCheck={false}
          autoComplete="off"
          maxLength={15}
        />
      </label>
      <button type="submit" className="secondary-button compact">
        טעינה
      </button>
      {error && (
        <small id="melody-seed-error" className="melody-seed-error" role="alert">
          קוד כמו <span dir="ltr">K3F9-2P1X</span>
        </small>
      )}
    </form>
  );
}

const GUTTER = 38;
const HEADER = 26;
const MIN_BEAT = 10;

/** The melody as a piano roll: chord names over the bars, the playing note lit. */
function MelodyRoll({ melody, playBeat, namer }: { melody: Melody; playBeat: number; namer: (midi: number) => string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(280, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const top = melody.high + 1;
  const bottom = melody.low - 1;
  const rows = top - bottom + 1;
  const rowHeight = rows > 20 ? 9 : 14;
  const beatWidth = Math.max(MIN_BEAT, (width - GUTTER) / melody.beats);
  const svgWidth = GUTTER + beatWidth * melody.beats;
  const height = HEADER + rows * rowHeight;
  const x = (beat: number) => GUTTER + beat * beatWidth;
  const y = (midi: number) => HEADER + (top - midi) * rowHeight;
  // The rows the scale allows are shaded, so it shows which notes the tune may use.
  const pcsInKey = useMemo(
    () => new Set(scaleDefinition(melody.settings.scale).steps.map((step) => (melody.settings.key + step) % 12)),
    [melody.settings.key, melody.settings.scale],
  );
  const tonicPc = melody.settings.key;

  const rowsList = Array.from({ length: rows }, (_, index) => top - index);
  const summary = `${melody.notes.length} תווים: ${melody.notes.map((note) => namer(note.midi)).join(" ")}`;

  return (
    <div className="melody-roll" ref={wrapRef} dir="ltr">
      <svg width={svgWidth} height={height} viewBox={`0 0 ${svgWidth} ${height}`} role="img" aria-label={summary}>
        {rowsList.map((midi) => (
          <rect
            key={midi}
            x={GUTTER}
            y={y(midi)}
            width={svgWidth - GUTTER}
            height={rowHeight}
            className={midi % 12 === tonicPc ? "melody-row is-tonic" : pcsInKey.has(midi % 12) ? "melody-row is-scale" : "melody-row"}
          />
        ))}
        {rowsList
          .filter((midi) => midi % 12 === tonicPc || midi === melody.low || midi === melody.high)
          .map((midi) => (
            <text key={midi} x={GUTTER - 5} y={y(midi) + rowHeight / 2} className={`melody-row-label ${midi % 12 === tonicPc ? "is-tonic" : ""}`}>
              {namer(midi)}
            </text>
          ))}
        {Array.from({ length: melody.beats + 1 }, (_, beat) => (
          <line key={beat} x1={x(beat)} x2={x(beat)} y1={beat % 4 === 0 ? 0 : HEADER} y2={height} className={beat % 4 === 0 ? "melody-bar-line" : "melody-beat-line"} />
        ))}
        {melody.chords.map((slot, index) => {
          const now = playBeat >= slot.start && playBeat < slot.start + slot.length;
          return (
            <g key={index} className={`melody-chord ${now ? "is-now" : ""}`}>
              <rect x={x(slot.start) + 2} y={3} width={slot.length * beatWidth - 4} height={HEADER - 7} rx={6} />
              <text x={x(slot.start) + (slot.length * beatWidth) / 2} y={HEADER / 2}>
                {slot.chord.name}
              </text>
            </g>
          );
        })}
        {melody.notes.map((note, index) => {
          const now = playBeat >= note.start && playBeat < note.start + note.length;
          return (
            <rect
              key={index}
              x={x(note.start) + 1}
              y={y(note.midi) + 1}
              width={Math.max(3, note.length * beatWidth - 2)}
              height={rowHeight - 2}
              rx={3}
              className={`melody-note ${note.strong ? "is-strong" : ""} ${now ? "is-now" : ""}`}
            >
              <title>{namer(note.midi)}</title>
            </rect>
          );
        })}
        {playBeat >= 0 && <line x1={x(playBeat)} x2={x(playBeat)} y1={HEADER} y2={height} className="melody-playhead" />}
      </svg>
    </div>
  );
}
