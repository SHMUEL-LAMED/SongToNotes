import { Dices, Download, Music4, NotebookPen, Pause, Play, RefreshCw, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadFile, notesToMidi } from "../lib/export";
import {
  BASS_STYLES,
  MOODS,
  PATTERNS,
  alternativesFor,
  arrange,
  chordFor,
  generateTokens,
  loopLength,
  spellProgression,
  toSongbookBody,
  type BassStyle,
  type Pattern,
} from "../lib/progression";
import { setSongbookDraft } from "../lib/songbook";
import { INSTRUMENTS, NotePlayer, type Instrument } from "../lib/synth";
import { ROOTS } from "../lib/theory";
import { useAssistantTool } from "../lib/useAssistantTool";

const STATE_KEY = "musictools.progression.v1";

type Stored = {
  key: number;
  mood: string;
  tokens: string[];
  sevenths: boolean;
  bpm: number;
  beats: number;
  pattern: Pattern;
  bass: BassStyle;
  instrument: Instrument;
};

const DEFAULTS: Stored = {
  key: 0,
  mood: "pop",
  tokens: ["1", "5", "6", "4"],
  sevenths: false,
  bpm: 96,
  beats: 4,
  pattern: "arpUpDown",
  bass: "rootFifth",
  instrument: "piano",
};

function readStored(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as Partial<Stored> | null;
    if (!parsed) return DEFAULTS;
    return {
      key: Number.isInteger(parsed.key) && parsed.key! >= 0 && parsed.key! < 12 ? parsed.key! : DEFAULTS.key,
      mood: MOODS.some((mood) => mood.id === parsed.mood) ? parsed.mood! : DEFAULTS.mood,
      tokens: Array.isArray(parsed.tokens) && parsed.tokens.length && parsed.tokens.length <= 8 ? parsed.tokens.map(String) : DEFAULTS.tokens,
      sevenths: Boolean(parsed.sevenths),
      bpm: Math.max(50, Math.min(200, Number(parsed.bpm) || DEFAULTS.bpm)),
      beats: [2, 4, 8].includes(Number(parsed.beats)) ? Number(parsed.beats) : DEFAULTS.beats,
      pattern: PATTERNS.some((item) => item.id === parsed.pattern) ? parsed.pattern! : DEFAULTS.pattern,
      bass: BASS_STYLES.some((item) => item.id === parsed.bass) ? parsed.bass! : DEFAULTS.bass,
      instrument: INSTRUMENTS.some((item) => item.id === parsed.instrument) ? parsed.instrument! : DEFAULTS.instrument,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * The progression generator: pick a key and a mood, get a progression that
 * suits it, swap any chord you don't like, and hear it looped with a chord
 * part and a bass line. It goes to the songbook as a lead sheet, or out as
 * MIDI for any other program.
 */
export function ProgressionTool() {
  const [initial] = useState(readStored);
  const [key, setKey] = useState(initial.key);
  const [moodId, setMoodId] = useState(initial.mood);
  const [tokens, setTokens] = useState(initial.tokens);
  const [sevenths, setSevenths] = useState(initial.sevenths);
  const [bpm, setBpm] = useState(initial.bpm);
  const [beats, setBeats] = useState(initial.beats);
  const [pattern, setPattern] = useState<Pattern>(initial.pattern);
  const [bass, setBass] = useState<BassStyle>(initial.bass);
  const [instrument, setInstrument] = useState<Instrument>(initial.instrument);
  const [click, setClick] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [swapping, setSwapping] = useState<number | null>(null);
  const playerRef = useRef<NotePlayer | null>(null);

  const mood = MOODS.find((item) => item.id === moodId) ?? MOODS[0];
  const chords = useMemo(() => spellProgression(tokens, key, mood.minor, sevenths), [key, mood.minor, sevenths, tokens]);
  const arrangement = useMemo(() => ({ bpm, beatsPerChord: beats, pattern, bass }), [bass, beats, bpm, pattern]);
  const notes = useMemo(() => arrange(chords, arrangement), [arrangement, chords]);
  const length = loopLength(chords, arrangement);
  const keyName = chordFor("1", key, mood.minor, false).name;

  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ key, mood: moodId, tokens, sevenths, bpm, beats, pattern, bass, instrument }));
    } catch {
      // Not remembered for next time.
    }
  }, [bass, beats, bpm, instrument, key, moodId, pattern, sevenths, tokens]);

  // A change while it plays is heard on the next pass, without stopping.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.setInstrument(instrument);
    player.load(notes, 0);
    player.setLoop({ start: 0, end: length });
    player.setClick(click ? { bpm, offset: 0, beatsPerMeasure: 4 } : null);
  }, [bpm, click, instrument, length, notes]);

  useEffect(() => () => playerRef.current?.dispose(), []);

  // The card under the playhead lights up.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const span = beats * (60 / bpm);
    const tick = () => {
      const time = playerRef.current?.currentTime ?? 0;
      setCurrent(Math.min(chords.length - 1, Math.floor((time % length) / span)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setCurrent(-1);
    };
  }, [beats, bpm, chords.length, length, playing]);

  const start = useCallback(() => {
    if (!playerRef.current) playerRef.current = new NotePlayer();
    const player = playerRef.current;
    player.setInstrument(instrument);
    player.load(notes, 0);
    player.setLoop({ start: 0, end: length });
    player.setClick(click ? { bpm, offset: 0, beatsPerMeasure: 4 } : null);
    void player.play(0);
    setPlaying(true);
  }, [bpm, click, instrument, length, notes]);

  const stop = useCallback(() => {
    playerRef.current?.stop(true);
    setPlaying(false);
  }, []);

  const generate = useCallback(
    (nextMood = mood) => {
      setTokens(generateTokens(nextMood));
      setSevenths(Boolean(nextMood.sevenths));
      setSwapping(null);
    },
    [mood],
  );

  const pickMood = (id: string) => {
    const next = MOODS.find((item) => item.id === id);
    if (!next) return;
    setMoodId(id);
    generate(next);
  };

  const replace = (index: number, token: string) => {
    setTokens((previous) => previous.map((item, at) => (at === index ? token : item)));
    setSwapping(null);
  };

  const toSongbook = () => {
    setSongbookDraft({ title: `מהלך ב־${keyName}`, body: toSongbookBody(chords) });
    window.location.assign("#/songbook");
  };

  const downloadMidi = () => {
    // Four passes, so it can be dropped into a project as a section.
    const passes = [0, 1, 2, 3].flatMap((pass) => notes.map((item) => ({ ...item, start: item.start + pass * length })));
    const data = notesToMidi(passes, { bpm, quantized: false, offset: 0, stepsPerBeat: 4, transpose: 0 });
    downloadFile(data, `progression-${chords.map((chord) => chord.plain).join("-")}-${bpm}bpm.mid`, "audio/midi");
  };

  useAssistantTool("progressions", {
    state: () =>
      `מחולל מהלכים: סולם ${keyName}, אווירה ${mood.label}, המהלך ${chords.map((chord) => `${chord.name} (${chord.roman})`).join(" – ")}, ${bpm} BPM, ${beats} פעמות לאקורד, ליווי ${PATTERNS.find((item) => item.id === pattern)?.label}, בס ${BASS_STYLES.find((item) => item.id === bass)?.label}; ${playing ? "מתנגן" : "עצור"}.`,
    handlers: {
      "progressions.generate": ({ mood: nextMood, key: nextKey }) => {
        if (nextKey !== undefined) {
          const clean = String(nextKey).replace("#", "♯").replace(/b$/, "♭");
          const found = ROOTS.find((item) => item.name === clean) ?? ROOTS.find((item) => item.pc === Number(nextKey));
          const alias: Record<string, number> = { "C♯": 1, "D♯": 3, "G♭": 6, "G♯": 8, "A♯": 10 };
          const pc = found?.pc ?? alias[clean];
          if (pc === undefined) return { ok: false, message: `לא מכיר סולם בשם ${String(nextKey)}` };
          setKey(pc);
        }
        const target = nextMood ? MOODS.find((item) => item.id === nextMood) : mood;
        if (!target) return { ok: false, message: `אין אווירה בשם ${String(nextMood)}` };
        setMoodId(target.id);
        generate(target);
        return { ok: true, message: `נוצר מהלך ${target.label}` };
      },
      "progressions.set": ({ bpm: nextBpm, beats: nextBeats, pattern: nextPattern, bass: nextBass, sevenths: nextSevenths }) => {
        if (nextBpm !== undefined) setBpm(Math.max(50, Math.min(200, Number(nextBpm) || bpm)));
        if (nextBeats !== undefined && [2, 4, 8].includes(Number(nextBeats))) setBeats(Number(nextBeats));
        if (nextPattern !== undefined && PATTERNS.some((item) => item.id === nextPattern)) setPattern(nextPattern as Pattern);
        if (nextBass !== undefined && BASS_STYLES.some((item) => item.id === nextBass)) setBass(nextBass as BassStyle);
        if (nextSevenths !== undefined) setSevenths(Boolean(nextSevenths));
        return { ok: true, message: "ההגדרות עודכנו" };
      },
      "progressions.play": () => {
        start();
        return { ok: true, message: "המהלך מתנגן בלולאה" };
      },
      "progressions.stop": () => {
        stop();
        return { ok: true, message: "נעצר" };
      },
      "progressions.songbook": () => {
        toSongbook();
        return { ok: true, message: "המהלך נשלח לשירון" };
      },
    },
  });

  return (
    <section className="tool-body progression-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Music4 size={26} />
        </span>
        <div>
          <h1>מחולל מהלכי אקורדים</h1>
          <p>בוחרים סולם ואווירה ומקבלים מהלך שמתנגן בלולאה עם ליווי ובס. לחיצה על אקורד מחליפה אותו.</p>
        </div>
      </div>

      <div className="settings-panel prog-setup">
        <div className="setting-field">
          <span>אווירה</span>
          <div className="chip-row">
            {MOODS.map((item) => (
              <button key={item.id} type="button" className={`chip-toggle ${item.id === moodId ? "active" : ""}`} aria-pressed={item.id === moodId} onClick={() => pickMood(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-field">
          <span>
            סולם <b dir="ltr">{keyName}</b>
          </span>
          <div className="root-picker" dir="ltr">
            {ROOTS.map((item) => (
              <button key={item.pc} type="button" className={key === item.pc ? "active" : ""} onClick={() => setKey(item.pc)} aria-pressed={key === item.pc}>
                {item.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="prog-deck">
        <button type="button" className={`beat-play ${playing ? "is-playing" : ""}`} onClick={playing ? stop : start} aria-pressed={playing}>
          {playing ? <Pause size={22} /> : <Play size={24} fill="currentColor" />}
          <span>{playing ? "עצירה" : "ניגון"}</span>
        </button>
        <button type="button" className="primary-button" onClick={() => generate()}>
          <Dices size={17} /> מהלך חדש
        </button>
        <label className="checkbox-field">
          <input type="checkbox" checked={sevenths} onChange={(event) => setSevenths(event.target.checked)} />
          <span>אקורדי ספטימה</span>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={click} onChange={(event) => setClick(event.target.checked)} />
          <span>
            <Timer size={14} /> מטרונום
          </span>
        </label>
      </div>

      <ol className="prog-chords" dir="ltr" aria-label="המהלך">
        {chords.map((chord, index) => (
          <li key={`${index}-${chord.token}`} className={`${current === index ? "is-now" : ""} ${swapping === index ? "is-open" : ""}`}>
            <button type="button" className="prog-chord" onClick={() => setSwapping(swapping === index ? null : index)} aria-expanded={swapping === index} aria-label={`${chord.name}, החלפת האקורד`}>
              <strong>{chord.name}</strong>
              <small>{chord.roman}</small>
              <RefreshCw size={13} aria-hidden="true" />
            </button>
            {swapping === index && (
              <div className="prog-swap" role="group" aria-label="אקורד אחר">
                {alternativesFor(chord.token, mood.minor).map((token) => {
                  const option = chordFor(token, key, mood.minor, sevenths);
                  return (
                    <button key={token} type="button" onClick={() => replace(index, token)}>
                      {option.name}
                      <small>{option.roman}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="settings-panel prog-arrange">
        <label className="setting-field">
          <span>
            קצב <b>{bpm}</b> BPM
          </span>
          <input type="range" min={50} max={200} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} aria-label="קצב" />
        </label>
        <label className="setting-field">
          <span>אורך כל אקורד</span>
          <select value={beats} onChange={(event) => setBeats(Number(event.target.value))}>
            <option value={2}>חצי תיבה</option>
            <option value={4}>תיבה</option>
            <option value={8}>שתי תיבות</option>
          </select>
        </label>
        <label className="setting-field">
          <span>ליווי</span>
          <select value={pattern} onChange={(event) => setPattern(event.target.value as Pattern)}>
            {PATTERNS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-field">
          <span>בס</span>
          <select value={bass} onChange={(event) => setBass(event.target.value as BassStyle)}>
            {BASS_STYLES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-field">
          <span>צליל</span>
          <select value={instrument} onChange={(event) => setInstrument(event.target.value as Instrument)}>
            {INSTRUMENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tool-inline-actions">
        <button type="button" className="secondary-button" onClick={toSongbook}>
          <NotebookPen size={16} /> לשירון
        </button>
        <button type="button" className="secondary-button" onClick={downloadMidi}>
          <Download size={16} /> הורדת MIDI
        </button>
      </div>
    </section>
  );
}
