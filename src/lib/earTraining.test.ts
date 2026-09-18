import { describe, expect, it } from "vitest";
import {
  CHORDS,
  DEGREES,
  EMPTY_STATS,
  INTERVALS,
  accuracy,
  choicesFor,
  createQuestion,
  noteName,
  normalizeStats,
  questionSeconds,
  recordAnswer,
  type ExerciseMode,
  type Level,
  type QuestionOptions,
} from "./earTraining";

const MODES: ExerciseMode[] = ["intervals", "chords", "degrees"];
const LEVELS: Level[] = ["easy", "medium", "hard"];

function options(overrides: Partial<QuestionOptions> = {}): QuestionOptions {
  return { mode: "intervals", level: "hard", intervalStyle: "melodic", ...overrides };
}

/**
 * Walks the answer pool one entry at a time: the first draw picks the answer,
 * and the rest of the draws (the root) come back mid-range.
 */
function pickNth(index: number, size: number) {
  let call = 0;
  return () => {
    call += 1;
    return call === 1 ? (index + 0.5) / size : 0.5;
  };
}

describe("choicesFor", () => {
  it("offers more answers as the level rises", () => {
    for (const mode of MODES) {
      const easy = choicesFor(mode, "easy");
      const medium = choicesFor(mode, "medium");
      const hard = choicesFor(mode, "hard");
      expect(easy.length).toBeGreaterThan(1);
      expect(medium.length).toBeGreaterThan(easy.length);
      expect(hard.length).toBeGreaterThan(medium.length);
    }
  });

  it("keeps every level a subset of the one above it", () => {
    for (const mode of MODES) {
      const medium = choicesFor(mode, "medium").map((choice) => choice.id);
      const hard = choicesFor(mode, "hard").map((choice) => choice.id);
      for (const id of choicesFor(mode, "easy").map((choice) => choice.id)) {
        expect(medium).toContain(id);
      }
      for (const id of medium) expect(hard).toContain(id);
    }
  });

  it("never offers an answer the tables cannot explain", () => {
    for (const level of LEVELS) {
      for (const choice of choicesFor("intervals", level)) {
        expect(INTERVALS.some((item) => String(item.semitones) === choice.id)).toBe(true);
      }
      for (const choice of choicesFor("chords", level)) {
        expect(CHORDS.some((item) => item.id === choice.id)).toBe(true);
      }
      for (const choice of choicesFor("degrees", level)) {
        expect(DEGREES.some((item) => item.id === choice.id)).toBe(true);
      }
    }
  });
});

describe("createQuestion", () => {
  it("always picks an answer that is on the buttons", () => {
    for (const mode of MODES) {
      for (const level of LEVELS) {
        for (let seed = 0; seed < 40; seed += 1) {
          const question = createQuestion(options({ mode, level }), () => seed / 40);
          expect(question.choices.map((choice) => choice.id)).toContain(question.answer);
        }
      }
    }
  });

  it("keeps every note inside a singable range", () => {
    for (const mode of MODES) {
      for (let seed = 0; seed < 60; seed += 1) {
        const question = createQuestion(options({ mode, level: "hard" }), () => (seed % 40) / 40);
        for (const note of question.notes) {
          expect(note.midi).toBeGreaterThanOrEqual(48);
          expect(note.midi).toBeLessThanOrEqual(84);
          expect(note.duration).toBeGreaterThan(0);
        }
      }
    }
  });

  it("plays exactly the interval it asks about", () => {
    const pool = choicesFor("intervals", "hard");
    pool.forEach((choice, index) => {
      const question = createQuestion(
        options({ mode: "intervals" }),
        pickNth(index, pool.length),
      );
      expect(question.answer).toBe(choice.id);
      const [low, high] = question.notes.map((note) => note.midi);
      expect(high - low).toBe(Number(choice.id));
    });
  });

  it("sounds a melodic interval one note after the other", () => {
    const question = createQuestion(options({ intervalStyle: "melodic" }), () => 0.5);
    expect(question.notes[1].start).toBeGreaterThanOrEqual(
      question.notes[0].start + question.notes[0].duration,
    );
  });

  it("sounds a harmonic interval as one chord", () => {
    const question = createQuestion(options({ intervalStyle: "harmonic" }), () => 0.5);
    expect(question.notes.every((note) => note.start === 0)).toBe(true);
  });

  it("builds each chord from its own recipe", () => {
    const pool = choicesFor("chords", "hard");
    pool.forEach((choice, index) => {
      const question = createQuestion(
        options({ mode: "chords" }),
        pickNth(index, pool.length),
      );
      const recipe = CHORDS.find((chord) => chord.id === choice.id);
      const root = Math.min(...question.notes.map((note) => note.midi));
      expect(question.answer).toBe(choice.id);
      expect(question.notes.map((note) => note.midi - root)).toEqual(recipe?.intervals);
      expect(question.notes.every((note) => note.start === 0)).toBe(true);
    });
  });

  it("gives a degree question its tonic reference before the answer note", () => {
    const pool = choicesFor("degrees", "hard");
    pool.forEach((choice, index) => {
      const question = createQuestion(
        options({ mode: "degrees" }),
        pickNth(index, pool.length),
      );
      const reference = question.notes.filter((note) => note.start === 0);
      const target = question.notes[question.notes.length - 1];
      expect(question.answer).toBe(choice.id);
      expect(reference).toHaveLength(4);
      const tonic = Math.min(...reference.map((note) => note.midi));
      expect(reference.map((note) => note.midi - tonic)).toEqual([0, 4, 7, 12]);
      expect(target.midi - tonic).toBe(
        DEGREES.find((degree) => degree.id === choice.id)?.semitones,
      );
      expect(target.start).toBeGreaterThan(0);
    });
  });

  it("reports how long the question takes to play", () => {
    const question = createQuestion(options({ mode: "degrees" }), () => 0.5);
    const last = question.notes[question.notes.length - 1];
    expect(questionSeconds(question)).toBeCloseTo(last.start + last.duration, 5);
  });
});

describe("noteName", () => {
  it("names middle C and the A above it", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
  });
});

describe("recordAnswer", () => {
  it("counts a right answer and lengthens the streak", () => {
    const stats = recordAnswer(recordAnswer(EMPTY_STATS, true), true);
    expect(stats).toEqual({ asked: 2, correct: 2, streak: 2, best: 2 });
  });

  it("breaks the streak on a miss but keeps the best one", () => {
    const after = recordAnswer(recordAnswer(recordAnswer(EMPTY_STATS, true), true), false);
    expect(after.streak).toBe(0);
    expect(after.best).toBe(2);
    expect(after.asked).toBe(3);
    expect(after.correct).toBe(2);
  });
});

describe("accuracy", () => {
  it("is zero before anything is asked", () => {
    expect(accuracy(EMPTY_STATS)).toBe(0);
  });

  it("rounds to whole percent", () => {
    expect(accuracy({ asked: 3, correct: 2, streak: 0, best: 1 })).toBe(67);
  });
});

describe("normalizeStats", () => {
  it("falls back to an empty card for anything unusable", () => {
    expect(normalizeStats(null)).toEqual(EMPTY_STATS);
    expect(normalizeStats("nope")).toEqual(EMPTY_STATS);
    expect(normalizeStats({})).toEqual(EMPTY_STATS);
  });

  it("refuses to believe more right answers than questions", () => {
    expect(normalizeStats({ asked: 4, correct: 99, streak: 99, best: 99 })).toEqual({
      asked: 4,
      correct: 4,
      streak: 4,
      best: 4,
    });
  });

  it("drops negative and broken numbers", () => {
    expect(normalizeStats({ asked: -5, correct: Number.NaN, streak: "x", best: 3 })).toEqual(
      EMPTY_STATS,
    );
  });

  it("keeps a sane card as it is", () => {
    const stats = { asked: 10, correct: 7, streak: 2, best: 5 };
    expect(normalizeStats(stats)).toEqual(stats);
  });
});
