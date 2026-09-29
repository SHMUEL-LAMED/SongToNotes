import { describe, expect, it } from "vitest";
import { scoreToAbc } from "./abc";
import { scoreToMusicXml } from "./musicxml";
import { buildScore } from "./score";
import type { DetectedNote } from "./types";

/** Notes on a 60 BPM grid, so one beat is one second. */
function score(notes: DetectedNote[], stepsPerBeat: number) {
  return buildScore(notes, {
    title: "t",
    tempo: { bpm: 60, offset: 0, fit: 1 },
    meter: { beats: 4, beatType: 4 },
    stepsPerBeat,
    mode: "melody",
    transpose: 0,
    key: { fifths: 0, mode: "major", tonicPitchClass: 0, fit: 1 },
  });
}

const note = (midi: number, start: number, duration: number): DetectedNote => ({ midi, start, duration, confidence: 0.9 });

describe("triplet grid", () => {
  // Three triplet eighths on beat one, then a quarter, a half.
  const notes = [note(60, 0, 0.3), note(62, 1 / 3, 0.3), note(64, 2 / 3, 0.3), note(65, 1, 0.95), note(67, 2, 1.95)];

  it("writes triplet eighths as (3 groups over an eighth-note unit", () => {
    const abc = scoreToAbc(score(notes, 3));
    // L:1/12 is not something ABC readers turn into triplets.
    expect(abc).toContain("L:1/8");
    const body = abc.split("\n").pop()!;
    expect(body).toMatch(/^\(3C D E F2 G4/);
  });

  it("leaves other grids as they were", () => {
    const abc = scoreToAbc(score([note(60, 0, 0.25), note(62, 0.25, 0.7)], 4));
    expect(abc).toContain("L:1/16");
    expect(abc).not.toContain("(3");
  });

  it("marks triplet eighths in MusicXML with their ratio and bracket", () => {
    const xml = scoreToMusicXml(score(notes, 3));
    const first = xml.match(/<note>.*?<\/note>/)![0];
    expect(first).toContain("<type>eighth</type>");
    expect(first).toContain("<actual-notes>3</actual-notes><normal-notes>2</normal-notes>");
    expect(first).toContain('<tuplet type="start" bracket="yes"/>');
    expect(xml.match(/<tuplet type="stop"\/>/g)).toHaveLength(1);
    // The quarter after the group is an ordinary quarter.
    expect(xml).toMatch(/<step>F<\/step><octave>4<\/octave><\/pitch><duration>3<\/duration><voice>1<\/voice><type>quarter<\/type>/);
  });
});
