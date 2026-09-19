import { Drum, Hand, Play, RotateCcw, Square, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaveButton } from "../components/SaveButton";
import {
  LEVEL_LABELS,
  PATTERNS,
  describeTendency,
  hitTimes,
  judgeTap,
  patternsFor,
  scoreRound,
  type Pattern,
  type RhythmLevel,
  type RoundScore,
  type TapResult,
} from "../lib/rhythm";
import { useAssistantTool } from "../lib/useAssistantTool";
import { useSaveWork } from "../lib/useSaveWork";
import type { SavedWork } from "../lib/works";

const SETTINGS_KEY = "musictools.rhythm.v1";
const PROGRESS_KEY = "musictools.rhythm.progress.v1";
const COUNT_IN_BARS = 1;
const PLAY_BARS = 2;

type Saved = { level: RhythmLevel; bpm: number; patternId: string };
type Phase = "idle" | "countin" | "playing" | "done";

function loadSaved(initial: SavedWork | null): Saved {
  const fallback: Saved = { level: "easy", bpm: 90, patternId: "quarters" };
  const source = initial?.kind === "rhythm" ? initial.payload : (() => {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null;
    } catch {
      return null;
    }
  })();
  if (!source) return fallback;
  const level = source.level === "medium" || source.level === "hard" ? source.level : "easy";
  const patternId = typeof source.patternId === "string" && PATTERNS.some((item) => item.id === source.patternId && item.level === level) ? source.patternId : patternsFor(level)[0].id;
  return { level, bpm: typeof source.bpm === "number" ? Math.max(40, Math.min(200, Math.round(source.bpm))) : fallback.bpm, patternId };
}

type Progress = { rounds: number; best: number; history: number[] };

function loadProgress(): Progress {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null") as Partial<Progress> | null;
    return { rounds: Number(parsed?.rounds) || 0, best: Number(parsed?.best) || 0, history: Array.isArray(parsed?.history) ? parsed!.history!.slice(-20).map(Number) : [] };
  } catch {
    return { rounds: 0, best: 0, history: [] };
  }
}

type Props = { initial?: SavedWork | null };

/**
 * A rhythm trainer: a click counts one bar in, a pattern plays for two, and
 * the visitor taps along — space, any key, a tap on the pad. Each tap is
 * measured against the audio clock, so the verdict is about timing, not
 * about how fast React rendered. The round ends with a score, the rushing
 * or dragging tendency, and a bar for every hit.
 */
export function RhythmTool({ initial = null }: Props) {
  const [saved] = useState(() => loadSaved(initial));
  const [level, setLevel] = useState<RhythmLevel>(saved.level);
  const [bpm, setBpm] = useState(saved.bpm);
  const [patternId, setPatternId] = useState(saved.patternId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [beat, setBeat] = useState(-1);
  const [taps, setTaps] = useState<TapResult[]>([]);
  const [lastVerdict, setLastVerdict] = useState<TapResult | null>(null);
  const [score, setScore] = useState<RoundScore | null>(null);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [muteHits, setMuteHits] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const startAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const tapsRef = useRef<TapResult[]>([]);
  const hitsRef = useRef<number[]>([]);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  const pattern = useMemo<Pattern>(() => PATTERNS.find((item) => item.id === patternId) ?? patternsFor(level)[0], [level, patternId]);
  const beatSeconds = 60 / bpm;
  const barSeconds = beatSeconds * 4;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ level, bpm, patternId } satisfies Saved));
    } catch {
      // Private browsing.
    }
  }, [bpm, level, patternId]);
  useEffect(() => resetSave(), [resetSave, score]);
  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    cancelAnimationFrame(frameRef.current);
    void contextRef.current?.close();
  }, []);

  const context = () => {
    if (!contextRef.current) {
      const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      contextRef.current = Context ? new Context() : null;
    }
    return contextRef.current;
  };

  const click = useCallback((ctx: AudioContext, time: number, kind: "count" | "hit" | "tap") => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === "tap" ? "triangle" : "sine";
    osc.frequency.setValueAtTime(kind === "count" ? 1320 : kind === "hit" ? 880 : 440, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(kind === "tap" ? 0.5 : 0.7, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (kind === "count" ? 0.05 : 0.09));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    cancelAnimationFrame(frameRef.current);
    timerRef.current = null;
    setPhase("idle");
    setBeat(-1);
  }, []);

  const finish = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    const result = scoreRound(tapsRef.current, hitsRef.current);
    setScore(result);
    setPhase("done");
    setBeat(-1);
    setProgress((current) => {
      const next = { rounds: current.rounds + 1, best: Math.max(current.best, result.accuracy), history: [...current.history, result.accuracy].slice(-20) };
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      } catch {
        // Private browsing.
      }
      return next;
    });
  }, []);

  const start = async () => {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
    stop();
    setScore(null);
    setTaps([]);
    setLastVerdict(null);
    tapsRef.current = [];
    const startAt = ctx.currentTime + 0.15;
    const playFrom = startAt + COUNT_IN_BARS * barSeconds;
    startAtRef.current = playFrom;
    // The count-in: four clicks; then the pattern, twice, unless muted.
    for (let index = 0; index < COUNT_IN_BARS * 4; index += 1) click(ctx, startAt + index * beatSeconds, "count");
    const hits = hitTimes(pattern, bpm, PLAY_BARS);
    hitsRef.current = hits;
    if (!muteHits) for (const hit of hits) click(ctx, playFrom + hit, "hit");
    setPhase("countin");
    const tick = () => {
      const now = ctx.currentTime;
      if (now >= playFrom) {
        setPhase("playing");
        setBeat(Math.floor(((now - playFrom) / beatSeconds) % 4));
      } else {
        setBeat(Math.floor((now - startAt) / beatSeconds));
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    // A beat of grace after the last bar, for a late final tap.
    timerRef.current = window.setTimeout(finish, (playFrom - ctx.currentTime + PLAY_BARS * barSeconds + beatSeconds * 0.5) * 1000);
  };

  const tap = useCallback(() => {
    const ctx = contextRef.current;
    if (!ctx || (phase !== "playing" && phase !== "countin")) return;
    const at = ctx.currentTime - startAtRef.current;
    click(ctx, ctx.currentTime, "tap");
    if (at < -0.2) return;
    const result = judgeTap(at, hitsRef.current);
    tapsRef.current = [...tapsRef.current, result];
    setTaps(tapsRef.current);
    setLastVerdict(result);
  }, [click, phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === " " || event.key === "Enter" || /^[a-zA-Zא-ת]$/.test(event.key)) {
        event.preventDefault();
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap]);

  const save = () => {
    if (!score) return Promise.resolve(null);
    return saving.save({
      kind: "rhythm",
      title: `${pattern.name} · ${bpm} BPM`,
      summary: { accuracy: score.accuracy, levelLabel: LEVEL_LABELS[level], bpm, pattern: pattern.name, tendency: score.tendency },
      payload: { level, bpm, patternId, score },
    });
  };

  const verdictLabel = (verdict: TapResult["verdict"]) =>
    verdict === "perfect" ? "מושלם" : verdict === "good" ? "טוב" : verdict === "early" ? "מוקדם" : verdict === "late" ? "מאוחר" : "החטאה";
  const busy = phase === "countin" || phase === "playing";

  useAssistantTool("rhythm", {
    state: () =>
      `מאמן קצב: רמה ${LEVEL_LABELS[level]}, תבנית „${pattern.name}”, ${bpm} BPM${muteHits ? ", התבנית מושתקת" : ""}; ${
        busy ? "סיבוב פועל עכשיו" : score ? `תוצאת הסיבוב האחרון: ${score.accuracy}% (${describeTendency(score.tendency)})` : "אין סיבוב"
      }; שיא ${progress.best}% אחרי ${progress.rounds} סיבובים.`,
    handlers: {
      "rhythm.set": ({ level: nextLevel, bpm: nextBpm, pattern: nextPattern, mute }) => {
        if (busy) return { ok: false, message: "אי אפשר לשנות באמצע סיבוב; rhythm.stop עוצר" };
        const done: string[] = [];
        let chosenLevel = level;
        if (nextLevel === "easy" || nextLevel === "medium" || nextLevel === "hard") {
          chosenLevel = nextLevel;
          setLevel(nextLevel);
          setPatternId(patternsFor(nextLevel)[0].id);
          setScore(null);
          done.push(`רמה ${LEVEL_LABELS[nextLevel]}`);
        }
        if (typeof nextBpm === "number") {
          const clamped = Math.max(40, Math.min(200, Math.round(nextBpm)));
          setBpm(clamped);
          done.push(`${clamped} BPM`);
        }
        if (typeof nextPattern === "string" && nextPattern.trim()) {
          const wanted = nextPattern.trim();
          const options = patternsFor(chosenLevel);
          const found = options.find((item) => item.id.toLowerCase() === wanted.toLowerCase() || item.name === wanted) ?? options.find((item) => item.name.includes(wanted));
          if (!found) return { ok: false, message: `אין תבנית כזאת ברמה ${LEVEL_LABELS[chosenLevel]}; יש: ${options.map((item) => `${item.name} (${item.id})`).join(", ")}` };
          setPatternId(found.id);
          setScore(null);
          done.push(`תבנית ${found.name}`);
        }
        if (typeof mute === "boolean") {
          setMuteHits(mute);
          done.push(mute ? "בלי לשמוע את התבנית" : "עם התבנית");
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "rhythm.start": async () => {
        if (busy) return { ok: false, message: "סיבוב כבר פועל" };
        await start();
        return { ok: true, message: "הסיבוב התחיל: ספירה של תיבה ואז שתי תיבות להקשה (רווח או הקשה על הכרית)" };
      },
      "rhythm.stop": () => {
        if (!busy) return { ok: false, message: "אין סיבוב פעיל" };
        stop();
        return { ok: true, message: "הסיבוב נעצר" };
      },
      "rhythm.read": () => ({
        ok: true,
        message: score ? `${score.accuracy}% דיוק` : "אין תוצאה",
        data: {
          level,
          bpm,
          pattern: { id: pattern.id, name: pattern.name, steps: pattern.steps },
          patterns: patternsFor(level).map((item) => ({ id: item.id, name: item.name })),
          score,
          best: progress.best,
          rounds: progress.rounds,
        },
      }),
      "rhythm.save": async () => {
        if (!score) return { ok: false, message: "אין תוצאה לשמור; rhythm.start מתחיל סיבוב" };
        const saved = await save();
        return saved ? { ok: true, message: "התוצאה נשמרה באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
    },
  });

  return (
    <section className="tool-body rhythm-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Drum size={26} />
        </span>
        <div>
          <h1>מאמן קצב</h1>
          <p>מתופפים על המקלדת או על המסך לפי תבנית, והאתר מודד את הדיוק.</p>
        </div>
        {score && (
          <div className="tool-intro-side">
            <SaveButton state={saving.state} onSave={() => void save()} label="שמור את התוצאה" message={saving.message} compact />
          </div>
        )}
      </div>

      <div className="workspace-card">
        <div className="settings-panel">
          <div className="settings-grid">
            <div className="setting-field">
              <span id="rhythm-level">רמה</span>
              <div className="segmented-control" role="group" aria-labelledby="rhythm-level">
                {(Object.keys(LEVEL_LABELS) as RhythmLevel[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={level === item ? "active" : ""}
                    aria-pressed={level === item}
                    disabled={busy}
                    onClick={() => {
                      setLevel(item);
                      setPatternId(patternsFor(item)[0].id);
                      setScore(null);
                    }}
                  >
                    {LEVEL_LABELS[item]}
                  </button>
                ))}
              </div>
            </div>
            <label className="setting-field">
              <span>תבנית</span>
              <select value={patternId} onChange={(event) => { setPatternId(event.target.value); setScore(null); }} disabled={busy} aria-label="תבנית קצב">
                {patternsFor(level).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field range-field">
              <span>
                <Timer size={15} /> קצב <b>{bpm} BPM</b>
              </span>
              <input type="range" min={40} max={200} value={bpm} onChange={(event) => setBpm(Number(event.target.value))} disabled={busy} aria-label="קצב" />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={muteHits} onChange={(event) => setMuteHits(event.target.checked)} disabled={busy} />
              <span>בלי לשמוע את התבנית (רק ספירה) — קשה יותר</span>
            </label>
          </div>
        </div>

        <div className="rhythm-pattern" aria-label="התבנית">
          {pattern.steps.split("").map((step, index) => (
            <span key={index} className={`rhythm-step ${step === "1" ? "is-hit" : ""} ${index % 4 === 0 ? "is-beat" : ""} ${busy && Math.floor(index / 4) === beat ? "is-now" : ""}`} aria-hidden="true" />
          ))}
        </div>

        <button
          type="button"
          className={`rhythm-pad ${busy ? "is-live" : ""} ${lastVerdict ? `is-${lastVerdict.verdict}` : ""}`}
          onPointerDown={(event) => {
            event.preventDefault();
            tap();
          }}
          disabled={!busy}
          aria-label="הקש כאן בקצב"
        >
          <Hand size={30} />
          <strong>
            {phase === "countin" ? `${Math.min(4, beat + 1)}…` : phase === "playing" ? (lastVerdict ? verdictLabel(lastVerdict.verdict) : "עכשיו!") : "הקש כאן, או רווח במקלדת"}
          </strong>
          {phase === "playing" && lastVerdict && lastVerdict.target !== null && (
            <small>
              {lastVerdict.offset > 0 ? "+" : ""}
              {lastVerdict.offset} אלפיות
            </small>
          )}
        </button>

        <div className="rhythm-actions">
          {!busy ? (
            <button className="primary-button" type="button" onClick={() => void start()}>
              <Play size={20} /> {score ? "עוד סיבוב" : "התחל"}
              <small>ספירה של תיבה אחת, ואז שתי תיבות</small>
            </button>
          ) : (
            <button className="secondary-button" type="button" onClick={stop}>
              <Square size={16} /> עצור
            </button>
          )}
        </div>

        {score && (
          <div className="rhythm-score" aria-live="polite">
            <div className="stats-grid">
              <div className="stat-card">
                <span>דיוק</span>
                <strong>{score.accuracy}%</strong>
              </div>
              <div className="stat-card">
                <span>מושלם / טוב</span>
                <strong>
                  {score.perfect} / {score.good}
                </strong>
              </div>
              <div className="stat-card">
                <span>הוחטאו / עודפים</span>
                <strong>
                  {score.missed} / {score.extra}
                </strong>
              </div>
              <div className="stat-card">
                <span>השיא שלך</span>
                <strong>{progress.best}%</strong>
              </div>
            </div>
            <p className="engine-note">{describeTendency(score.tendency)}</p>
            <div className="rhythm-taps" aria-label="ההקשות">
              {taps.map((item, index) => (
                <span key={index} className={`rhythm-tap is-${item.verdict}`} title={`${item.offset} אלפיות`}>
                  <i style={{ insetInlineStart: `${50 + Math.max(-45, Math.min(45, item.offset / 4))}%` }} />
                </span>
              ))}
            </div>
            {progress.history.length > 1 && (
              <div className="rhythm-history" aria-label="הסיבובים האחרונים">
                {progress.history.map((value, index) => (
                  <span key={index} style={{ height: `${Math.max(6, value)}%` }} title={`${value}%`} />
                ))}
              </div>
            )}
            <div className="rhythm-score-actions">
              <button type="button" className="link-button" onClick={() => setScore(null)}>
                <RotateCcw size={14} /> נקה
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
