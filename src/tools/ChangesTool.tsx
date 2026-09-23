import { Play, RotateCcw, Shuffle, Square, Trophy, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChordDiagram } from "../components/ChordDiagram";
import {
  DRILL_CHORDS,
  SUGGESTED_PAIRS,
  findDrillChord,
  pairKey,
  pairStats,
  perMinute,
  readHistory,
  strumNotes,
  writeHistory,
  type DrillChord,
  type DrillResult,
} from "../lib/changes";
import { NotePlayer } from "../lib/synth";
import type { DetectedNote } from "../lib/types";
import { useAssistantTool } from "../lib/useAssistantTool";

type Phase = "idle" | "countdown" | "running" | "done";

const DURATIONS = [30, 60, 120];
const COUNTDOWN = 3;

const strum = (chord: DrillChord): DetectedNote[] =>
  strumNotes(chord).map((midi, index) => ({ midi, start: index * 0.018, duration: 1.1, confidence: 0.7 }));

/**
 * One-minute changes: pick two chords, press start, and tap every time your
 * hand lands the other chord cleanly. The count is the score; the best for
 * each pair is kept, and the last runs are drawn so progress is visible.
 */
export function ChangesTool() {
  const [first, setFirst] = useState("G");
  const [second, setSecond] = useState("C");
  const [seconds, setSeconds] = useState(60);
  const [sound, setSound] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const [left, setLeft] = useState(60);
  const [countdown, setCountdown] = useState(COUNTDOWN);
  const [history, setHistory] = useState<DrillResult[]>(readHistory);
  const [lastBest, setLastBest] = useState(0);
  const playerRef = useRef<NotePlayer | null>(null);
  const endsAtRef = useRef(0);
  const countRef = useRef(0);

  const a = findDrillChord(first) ?? DRILL_CHORDS[0];
  const b = findDrillChord(second) ?? DRILL_CHORDS[1];
  const pair = pairKey(a.id, b.id);
  const stats = useMemo(() => pairStats(history, pair), [history, pair]);
  // Which chord the hand is heading for: the first, then every tap swaps.
  const target = count % 2 === 0 ? b : a;
  const holding = count % 2 === 0 ? a : b;

  const play = useCallback((notes: DetectedNote[]) => {
    if (!playerRef.current) playerRef.current = new NotePlayer();
    const player = playerRef.current;
    player.load(notes, 0);
    void player.play(0);
  }, []);

  useEffect(() => () => playerRef.current?.dispose(), []);

  const finish = useCallback(() => {
    const result: DrillResult = { pair, changes: countRef.current, seconds, at: new Date().toISOString() };
    setLastBest(pairStats(history, pair).best);
    setHistory((previous) => {
      const next = [...previous, result];
      writeHistory(next);
      return next;
    });
    setPhase("done");
    play([{ midi: 84, start: 0, duration: 0.25, confidence: 0.8 }, { midi: 88, start: 0.18, duration: 0.4, confidence: 0.8 }]);
  }, [history, pair, play, seconds]);

  // The count-in, then the clock, both off one frame loop.
  useEffect(() => {
    if (phase !== "countdown" && phase !== "running") return;
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const remaining = (endsAtRef.current - now) / 1000;
      if (phase === "countdown") {
        const shown = Math.ceil(remaining);
        setCountdown(shown);
        if (remaining <= 0) {
          endsAtRef.current = now + seconds * 1000;
          setLeft(seconds);
          setPhase("running");
          return;
        }
      } else {
        setLeft(Math.max(0, Math.ceil(remaining)));
        if (remaining <= 0) {
          finish();
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [finish, phase, seconds]);

  const start = useCallback(() => {
    countRef.current = 0;
    setCount(0);
    setCountdown(COUNTDOWN);
    endsAtRef.current = performance.now() + COUNTDOWN * 1000;
    setPhase("countdown");
    if (sound) play(strum(a));
  }, [a, play, sound]);

  const stop = useCallback(() => setPhase("idle"), []);

  const tap = useCallback(() => {
    if (phase !== "running") return;
    countRef.current += 1;
    setCount(countRef.current);
    if (sound) play(strum(countRef.current % 2 === 1 ? b : a));
  }, [a, b, phase, play, sound]);

  // Space or Enter counts a change, so the strumming hand never leaves the guitar for long.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== "Space" && event.key !== "Enter")) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag && /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (phase === "running") {
        event.preventDefault();
        tap();
      } else if (event.code === "Space" && (phase === "idle" || phase === "done") && tag !== "BUTTON") {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start, tap]);

  const choosePair = (x: string, y: string) => {
    setFirst(x);
    setSecond(y);
    setPhase("idle");
  };

  useAssistantTool("changes", {
    state: () =>
      `מאמן מעברים: הזוג ${a.id} ↔ ${b.id}, ${seconds} שניות, שיא ${stats.best} מעברים לדקה מתוך ${stats.runs} סבבים; ${phase === "running" ? `רץ, ${count} מעברים` : phase === "done" ? `הסבב האחרון: ${count}` : "מחכה להתחלה"}.`,
    handlers: {
      "changes.set": ({ first: nextFirst, second: nextSecond, seconds: nextSeconds }) => {
        if (nextFirst !== undefined && !findDrillChord(String(nextFirst))) return { ok: false, message: `אין אקורד ${String(nextFirst)} במאמן` };
        if (nextSecond !== undefined && !findDrillChord(String(nextSecond))) return { ok: false, message: `אין אקורד ${String(nextSecond)} במאמן` };
        if (nextFirst !== undefined) setFirst(String(nextFirst));
        if (nextSecond !== undefined) setSecond(String(nextSecond));
        if (nextSeconds !== undefined && DURATIONS.includes(Number(nextSeconds))) setSeconds(Number(nextSeconds));
        setPhase("idle");
        return { ok: true, message: "הזוג עודכן" };
      },
      "changes.start": () => {
        start();
        return { ok: true, message: "הסבב מתחיל בספירה לאחור" };
      },
      "changes.stats": () => ({
        ok: true,
        message: "הסטטיסטיקה של הזוג",
        data: { pair: `${a.id}/${b.id}`, best: stats.best, runs: stats.runs, recent: stats.recent.map(perMinute) },
      }),
    },
  });

  const recentMax = Math.max(10, ...stats.recent.map(perMinute));
  const lastRate = phase === "done" ? perMinute({ changes: count, seconds }) : 0;
  const record = phase === "done" && lastRate > lastBest && stats.runs > 1;

  return (
    <section className="tool-body changes-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Shuffle size={26} />
        </span>
        <div>
          <h1>מאמן מעברים בין אקורדים</h1>
          <p>בוחרים שני אקורדים ומתחילים. בכל פעם שהיד נוחתת נקי על האקורד השני, לוחצים על הכפתור הגדול או על רווח. המטרה: לשפר את השיא.</p>
        </div>
      </div>

      <div className="settings-panel changes-setup">
        <div className="setting-field">
          <span>זוגות מומלצים</span>
          <div className="chip-row" dir="ltr">
            {SUGGESTED_PAIRS.map(([x, y]) => (
              <button key={`${x}-${y}`} type="button" className={`chip-toggle ${pairKey(x, y) === pair ? "active" : ""}`} onClick={() => choosePair(x, y)} aria-pressed={pairKey(x, y) === pair}>
                {x} ↔ {y}
              </button>
            ))}
          </div>
        </div>
        <div className="changes-pickers">
          <label className="setting-field">
            <span>אקורד ראשון</span>
            <select value={first} onChange={(event) => choosePair(event.target.value, second)}>
              {DRILL_CHORDS.map((chord) => (
                <option key={chord.id} value={chord.id} disabled={chord.id === second}>
                  {chord.id}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field">
            <span>אקורד שני</span>
            <select value={second} onChange={(event) => choosePair(first, event.target.value)}>
              {DRILL_CHORDS.map((chord) => (
                <option key={chord.id} value={chord.id} disabled={chord.id === first}>
                  {chord.id}
                </option>
              ))}
            </select>
          </label>
          <div className="setting-field">
            <span>משך</span>
            <div className="segmented-control" role="group" aria-label="משך הסבב">
              {DURATIONS.map((value) => (
                <button key={value} type="button" className={seconds === value ? "active" : ""} aria-pressed={seconds === value} onClick={() => setSeconds(value)} disabled={phase === "running" || phase === "countdown"}>
                  {value === 120 ? "2 דק׳" : value === 60 ? "דקה" : "30 שנ׳"}
                </button>
              ))}
            </div>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />
            <span>
              <Volume2 size={14} /> לשמוע את האקורד בכל מעבר
            </span>
          </label>
        </div>
      </div>

      <div className="changes-stage">
        <div className="changes-diagrams" dir="ltr">
          {[a, b].map((chord) => (
            <button key={chord.id} type="button" className={`changes-chord ${phase === "running" && chord.id === target.id ? "is-target" : ""} ${phase === "running" && chord.id === holding.id ? "is-holding" : ""}`} onClick={() => play(strum(chord))} aria-label={`השמעת ${chord.id}`}>
              <ChordDiagram root={chord.root} quality={chord.quality} size={120} active={phase === "running" && chord.id === target.id} />
            </button>
          ))}
        </div>

        <div className="changes-board" aria-live="polite">
          {phase === "countdown" && <strong className="changes-big">{countdown}</strong>}
          {phase === "running" && (
            <>
              <strong className="changes-big">{count}</strong>
              <span className="changes-clock">{left} שניות · עכשיו ל־<b dir="ltr">{target.id}</b></span>
            </>
          )}
          {phase === "done" && (
            <>
              {record && (
                <span className="changes-record">
                  <Trophy size={16} /> שיא חדש!
                </span>
              )}
              <strong className="changes-big">{count}</strong>
              <span className="changes-clock">
                מעברים ב־{seconds} שניות{seconds !== 60 ? ` · ${lastRate} לדקה` : ""}
              </span>
            </>
          )}
          {phase === "idle" && (
            <span className="changes-clock">
              {stats.runs ? `השיא שלך בזוג הזה: ${stats.best} לדקה` : "עוד לא תרגלת את הזוג הזה"}
            </span>
          )}
        </div>

        {phase === "running" ? (
          <button type="button" className="changes-tap" onPointerDown={(event) => {
            event.preventDefault();
            tap();
          }}>
            החלפתי
            <small>או רווח</small>
          </button>
        ) : (
          <div className="tool-inline-actions changes-actions">
            {phase === "countdown" ? (
              <button type="button" className="secondary-button" onClick={stop}>
                <Square size={16} /> ביטול
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={start}>
                {phase === "done" ? <RotateCcw size={17} /> : <Play size={17} />}
                {phase === "done" ? "עוד סבב" : "התחלה"}
              </button>
            )}
          </div>
        )}
        {phase === "running" && (
          <button type="button" className="link-button" onClick={stop}>
            הפסקה בלי לשמור
          </button>
        )}
      </div>

      {stats.recent.length > 0 && (
        <div className="workspace-card changes-history">
          <h2>הסבבים האחרונים ב־<span dir="ltr">{a.id} ↔ {b.id}</span></h2>
          <ol className="changes-bars" aria-label="מעברים לדקה בסבבים האחרונים">
            {stats.recent.map((item, index) => {
              const rate = perMinute(item);
              return (
                <li key={`${item.at}-${index}`} title={new Date(item.at).toLocaleString("he-IL")}>
                  <span className="changes-bar" style={{ blockSize: `${Math.max(6, (rate / recentMax) * 100)}%` }} data-best={rate === stats.best ? "1" : undefined} />
                  <b>{rate}</b>
                </li>
              );
            })}
          </ol>
          <p className="changes-note">מעברים לדקה. {stats.runs} סבבים בסך הכול, נשמרים במכשיר הזה.</p>
        </div>
      )}
    </section>
  );
}
