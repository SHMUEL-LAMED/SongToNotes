import { describe, expect, it } from "vitest";
import { PATTERNS, describeTendency, hitTimes, judgeTap, scoreRound } from "./rhythm";

describe("rhythm patterns", () => {
  it("are all one bar of sixteenths", () => {
    for (const pattern of PATTERNS) expect(pattern.steps).toHaveLength(16);
  });
  it("places quarter hits on the beats at 120 BPM", () => {
    const quarters = PATTERNS.find((item) => item.id === "quarters")!;
    expect(hitTimes(quarters, 120)).toEqual([0, 0.5, 1, 1.5]);
    expect(hitTimes(quarters, 120, 2)).toHaveLength(8);
  });
});

describe("tap judging", () => {
  const hits = [0, 0.5, 1, 1.5];
  it("grades by distance from the nearest hit", () => {
    expect(judgeTap(0.51, hits).verdict).toBe("perfect");
    expect(judgeTap(0.56, hits).verdict).toBe("good");
    expect(judgeTap(0.38, hits).verdict).toBe("early");
    expect(judgeTap(1.12, hits).verdict).toBe("late");
    expect(judgeTap(0.25, hits).verdict).toBe("miss");
  });
  it("scores a round: one tap per hit, extras and misses cost", () => {
    const perfect = hits.map((hit) => judgeTap(hit + 0.01, hits));
    expect(scoreRound(perfect, hits).accuracy).toBe(100);
    const sloppy = [judgeTap(0.02, hits), judgeTap(0.53, hits), judgeTap(0.55, hits)];
    const score = scoreRound(sloppy, hits);
    expect(score.missed).toBe(2);
    expect(score.extra).toBe(1);
    expect(score.accuracy).toBeLessThan(60);
    expect(score.tendency).toBeGreaterThan(0);
    expect(describeTendency(-40)).toMatch(/להקדים/);
  });
});
