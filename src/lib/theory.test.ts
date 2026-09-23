import { describe, expect, it } from "vitest";
import { CIRCLE, circleIndex, diatonicChords, findScale, scaleNotes, stepPattern } from "./theory";

const names = (root: number, scale: string) => scaleNotes(root, findScale(scale)).map((note) => note.name);

describe("spelling a scale", () => {
  it("uses one letter per degree", () => {
    expect(names(0, "major")).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
    expect(names(3, "major")).toEqual(["E♭", "F", "G", "A♭", "B♭", "C", "D"]);
    expect(names(6, "major")).toEqual(["F♯", "G♯", "A♯", "B", "C♯", "D♯", "E♯"]);
    expect(names(9, "minor")).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });

  it("writes minor keys the way they are usually read", () => {
    expect(names(1, "minor")[0]).toBe("C♯");
    expect(names(8, "harmonicMinor")).toEqual(["G♯", "A♯", "B", "C♯", "D♯", "E", "F𝄪"]);
  });

  it("spells the short scales from their parents, with the blue note as a flat fifth", () => {
    expect(names(9, "minorPentatonic")).toEqual(["A", "C", "D", "E", "G"]);
    expect(names(9, "blues")).toEqual(["A", "C", "D", "E♭", "E", "G"]);
    expect(names(7, "majorPentatonic")).toEqual(["G", "A", "B", "D", "E"]);
  });

  it("counts the steps up to the octave", () => {
    expect(stepPattern(findScale("major"))).toEqual([2, 2, 1, 2, 2, 2, 1]);
    expect(stepPattern(findScale("minorPentatonic"))).toEqual([3, 2, 2, 3, 2]);
  });
});

describe("the chords of a scale", () => {
  it("builds the triads of the major scale", () => {
    const chords = diatonicChords(0, findScale("major"), false);
    expect(chords.map((chord) => chord.name)).toEqual(["C", "Dm", "Em", "F", "G", "Am", "B°"]);
    expect(chords.map((chord) => chord.roman)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
  });

  it("builds the seventh chords", () => {
    const chords = diatonicChords(0, findScale("major"), true);
    expect(chords.map((chord) => chord.name)).toEqual(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7♭5"]);
    expect(chords[6].roman).toBe("viiø7");
    expect(chords[4].midi).toEqual([55, 59, 62, 65]);
  });

  it("has none for scales that are not seven notes", () => {
    expect(diatonicChords(0, findScale("blues"), false)).toEqual([]);
  });
});

describe("the circle of fifths", () => {
  it("places each mode on its parent key", () => {
    expect(CIRCLE[circleIndex(0, findScale("major"))].major).toBe("C");
    expect(CIRCLE[circleIndex(9, findScale("minor"))].major).toBe("C");
    expect(CIRCLE[circleIndex(2, findScale("dorian"))].major).toBe("C");
    expect(CIRCLE[circleIndex(7, findScale("mixolydian"))].major).toBe("C");
    expect(CIRCLE[circleIndex(4, findScale("minor"))].major).toBe("G");
  });
});
