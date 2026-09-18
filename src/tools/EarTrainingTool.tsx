import { Check, Ear, Play, RotateCcw, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_STATS,
  LEVEL_LABELS,
  MODE_HINTS,
  MODE_LABELS,
  accuracy,
  createQuestion,
  normalizeStats,
  questionSeconds,
  recordAnswer,
  type ExerciseMode,
  type IntervalStyle,
  type Level,
  type Question,
  type Stats,
} from "../lib/earTraining";
import { NotePlayer } from "../lib/synth";

const SETTINGS_KEY = "musictools.eartraining.v1";

/**
 * `KeyboardEvent.key` carries one character, so only the first nine answers
 * can have a digit of their own — at the hard interval level there are twelve.
 * The rest are answered by clicking, and the interface says so rather than
 * promising a key that would land on answer 1.
 */
const KEYED_CHOICES = 9;

const MODES: ExerciseMode[] = ["intervals", "chords", "degrees"];
const LEVELS: Level[] = ["easy", "medium", "hard"];
const STYLES: { id: IntervalStyle; label: string }[] = [
  { id: "melodic", label: "בזה אחר זה" },
  { id: "harmonic", label: "יחד" },
];

type Saved = {
  mode: ExerciseMode;
  level: Level;
  intervalStyle: IntervalStyle;
  stats: Record<ExerciseMode, Stats>;
};

const EMPTY_BOARD: Record<ExerciseMode, Stats> = {
  intervals: EMPTY_STATS,
  chords: EMPTY_STATS,
  degrees: EMPTY_STATS,
};

function loadSaved(): Saved {
  const fallback: Saved = {
    mode: "intervals",
    level: "easy",
    intervalStyle: "melodic",
    stats: EMPTY_BOARD,
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<Saved> | null;
    if (!parsed) return fallback;
    const stats = (parsed.stats ?? {}) as Partial<Record<ExerciseMode, unknown>>;
    return {
      mode: MODES.includes(parsed.mode as ExerciseMode) ? (parsed.mode as ExerciseMode) : fallback.mode,
      level: LEVELS.includes(parsed.level as Level) ? (parsed.level as Level) : fallback.level,
      intervalStyle: parsed.intervalStyle === "harmonic" ? "harmonic" : "melodic",
      stats: {
        intervals: normalizeStats(stats.intervals),
        chords: normalizeStats(stats.chords),
        degrees: normalizeStats(stats.degrees),
      },
    };
  } catch {
    return fallback;
  }
}

/**
 * A quiz for the ear: the site already knows how to make notes, so the
 * training is a matter of playing a couple of them and asking what was heard.
 * Nothing is fetched and nothing is recorded — the score lives in this
 * browser only.
 */
export function EarTrainingTool() {
  const [saved] = useState(loadSaved);
  const [mode, setMode] = useState<ExerciseMode>(saved.mode);
  const [level, setLevel] = useState<Level>(saved.level);
  const [intervalStyle, setIntervalStyle] = useState<IntervalStyle>(saved.intervalStyle);
  const [board, setBoard] = useState<Record<ExerciseMode, Stats>>(saved.stats);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const playerRef = useRef<NotePlayer | null>(null);
  const idleTimerRef = useRef(0);
  const rootRef = useRef<HTMLElement>(null);
  const stats = board[mode];

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ mode, level, intervalStyle, stats: board } satisfies Saved),
      );
    } catch {
      // Private browsing; the score simply does not outlive the tab.
    }
  }, [board, intervalStyle, level, mode]);

  const player = useCallback(() => {
    if (!playerRef.current) {
      playerRef.current = new NotePlayer();
      playerRef.current.setInstrument("piano");
      playerRef.current.setVolume(0.9);
    }
    return playerRef.current;
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(idleTimerRef.current);
      playerRef.current?.dispose();
      playerRef.current = null;
    },
    [],
  );

  const play = useCallback(
    (item: Question) => {
      const engine = player();
      engine.setHandlers({ onEnd: () => setPlaying(false) });
      // `load` restarts a player that was already running, at the position it
      // had reached. Replaying mid-phrase would then schedule the notes twice
      // — once from there and once from the top — and the two attacks overlap
      // into a click on the very interval the ear is meant to judge. Stopping
      // first leaves exactly one start.
      engine.stop(true);
      engine.load(
        item.notes.map((note) => ({ ...note, confidence: 0.9 })),
        0,
      );
      setPlaying(true);
      void engine.play(0);
      // `onEnd` fires off the audio clock; this is only the safety net for a
      // context that was suspended mid-question (a backgrounded tab).
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(
        () => setPlaying(false),
        (questionSeconds(item) + 1) * 1000,
      );
    },
    [player],
  );

  const nextQuestion = useCallback(() => {
    const item = createQuestion({ mode, level, intervalStyle });
    setQuestion(item);
    setAnswered(null);
    play(item);
  }, [intervalStyle, level, mode, play]);

  /**
   * Changing the exercise puts the old question away rather than leaving a
   * stale one on screen with the wrong buttons under it.
   */
  const clearQuestion = useCallback(() => {
    window.clearTimeout(idleTimerRef.current);
    playerRef.current?.stop(true);
    setQuestion(null);
    setAnswered(null);
    setPlaying(false);
  }, []);

  const answer = useCallback(
    (choiceId: string) => {
      if (!question || answered) return;
      setAnswered(choiceId);
      setBoard((current) => ({
        ...current,
        [mode]: recordAnswer(current[mode], choiceId === question.answer),
      }));
    },
    [answered, mode, question],
  );

  const resetScore = useCallback(() => {
    setBoard((current) => ({ ...current, [mode]: EMPTY_STATS }));
  }, [mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+R, Cmd+R and Ctrl+1 belong to the browser, not to the trainer.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      // The account panel opens over a mounted tool, and its keystrokes bubble
      // up here too. A shortcut only counts when it came from the trainer
      // itself, or from a page with nothing focused at all — otherwise a digit
      // typed in the dialog would answer a question nobody can see.
      const insideTrainer =
        !target || target === document.body || Boolean(rootRef.current?.contains(target));
      if (!insideTrainer) return;
      // Enter belongs to whatever control has focus. Taking it here would stop
      // a keyboard user from pressing the very buttons on this page — the
      // exercise picker, "השמע שוב", "אפס ניקוד" — so the shortcut only
      // applies when focus is not sitting on something Enter already works on.
      const onControl = Boolean(target?.closest("button, a[href], summary"));
      if (event.key === "Enter" && !onControl && (answered || !question)) {
        event.preventDefault();
        nextQuestion();
        return;
      }
      if (event.key.toLowerCase() === "r" && question) {
        event.preventDefault();
        play(question);
        return;
      }
      const digit = Number(event.key);
      const keyed = Math.min(KEYED_CHOICES, question?.choices.length ?? 0);
      if (question && !answered && digit >= 1 && digit <= keyed) {
        event.preventDefault();
        answer(question.choices[digit - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, answered, nextQuestion, play, question]);

  const correctChoice = useMemo(
    () => question?.choices.find((choice) => choice.id === question.answer) ?? null,
    [question],
  );
  const isRight = answered !== null && answered === question?.answer;

  return (
    <section className="tool-body ear-training" ref={rootRef}>
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Ear size={26} />
        </span>
        <div>
          <h1>מאמן שמיעה</h1>
          <p>{MODE_HINTS[mode]}</p>
        </div>
      </div>

      <div className="settings-panel">
        <div className="settings-grid">
          <div className="setting-field">
            <span>תרגיל</span>
            <div className="segmented-control wrap">
              {MODES.map((item) => (
                <button
                  key={item}
                  className={mode === item ? "active" : ""}
                  onClick={() => {
                    clearQuestion();
                    setMode(item);
                  }}
                  type="button"
                  aria-pressed={mode === item}
                >
                  {MODE_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-field">
            <span>רמה</span>
            <div className="segmented-control wrap">
              {LEVELS.map((item) => (
                <button
                  key={item}
                  className={level === item ? "active" : ""}
                  onClick={() => {
                    clearQuestion();
                    setLevel(item);
                  }}
                  type="button"
                  aria-pressed={level === item}
                >
                  {LEVEL_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          {mode === "intervals" && (
            <div className="setting-field">
              <span>איך לנגן</span>
              <div className="segmented-control wrap">
                {STYLES.map((item) => (
                  <button
                    key={item.id}
                    className={intervalStyle === item.id ? "active" : ""}
                    onClick={() => {
                      clearQuestion();
                      setIntervalStyle(item.id);
                    }}
                    type="button"
                    aria-pressed={intervalStyle === item.id}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ear-stage" data-playing={playing}>
        {!question ? (
          <div className="ear-empty">
            <p>{MODE_HINTS[mode]}</p>
            <button className="primary-button" type="button" onClick={nextQuestion}>
              <Play size={20} /> התחל תרגול
            </button>
          </div>
        ) : (
          <>
            <div className="ear-playback">
              <button className="primary-button" type="button" onClick={() => play(question)}>
                <Play size={20} /> {playing ? "מנגן…" : "השמע שוב"}
              </button>
              <span className="ear-hint">
                מקשי 1–{Math.min(KEYED_CHOICES, question.choices.length)} עונים
                {question.choices.length > KEYED_CHOICES && " (השאר בלחיצה)"} · R משמיע שוב ·
                Enter לשאלה הבאה
              </span>
            </div>

            <div className="ear-choices" role="group" aria-label="מה נשמע">
              {question.choices.map((choice, index) => {
                const chosen = answered === choice.id;
                const right = answered !== null && choice.id === question.answer;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    className={`ear-choice ${right ? "is-right" : ""} ${chosen && !right ? "is-wrong" : ""}`}
                    aria-keyshortcuts={index < KEYED_CHOICES ? String(index + 1) : undefined}
                    onClick={() => answer(choice.id)}
                    disabled={answered !== null}
                  >
                    <b aria-hidden="true">{index < KEYED_CHOICES ? index + 1 : ""}</b>
                    <span>{choice.label}</span>
                    {right && <Check size={18} />}
                    {chosen && !right && <X size={18} />}
                  </button>
                );
              })}
            </div>

            <div className="ear-verdict" role="status" aria-live="polite">
              {answered === null ? (
                <span className="ear-waiting">בחר תשובה</span>
              ) : (
                <>
                  <strong className={isRight ? "is-right" : "is-wrong"}>
                    {isRight ? "נכון!" : `לא — ${correctChoice?.label ?? ""}`}
                  </strong>
                  <span>{question.detail}</span>
                  <button className="secondary-button" type="button" onClick={nextQuestion}>
                    <SkipForward size={18} /> השאלה הבאה
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="ear-score">
        <div>
          <strong>{stats.asked}</strong>
          <span>שאלות</span>
        </div>
        <div>
          <strong>{accuracy(stats)}%</strong>
          <span>דיוק</span>
        </div>
        <div>
          <strong>{stats.streak}</strong>
          <span>ברצף</span>
        </div>
        <div>
          <strong>{stats.best}</strong>
          <span>שיא</span>
        </div>
        <button
          className="link-button"
          type="button"
          onClick={resetScore}
          disabled={stats.asked === 0}
        >
          <RotateCcw size={15} /> אפס ניקוד
        </button>
      </div>
    </section>
  );
}
