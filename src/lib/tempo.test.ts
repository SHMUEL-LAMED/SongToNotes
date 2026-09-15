import { describe, expect, it } from "vitest";
import { alignOffset, collectOnsets, estimateTempo } from "./tempo";
import type { DetectedNote } from "./types";

/** A steady pulse: one note per beat at `bpm`, starting at `offset` seconds. */
function pulse(bpm: number, beats: number, offset = 0): DetectedNote[] {
  const period = 60 / bpm;
  return Array.from({ length: beats }, (_, index) => ({
    midi: 60,
    start: offset + index * period,
    duration: period * 0.8,
    confidence: 0.9,
  }));
}

describe("collectOnsets", () => {
  it("collapses a chord into a single accent", () => {
    const chord: DetectedNote[] = [60, 64, 67].map((midi) => ({
      midi,
      start: 1,
      duration: 0.5,
      confidence: 0.9,
    }));
    const onsets = collectOnsets(chord);
    expect(onsets).toHaveLength(1);
    expect(onsets[0].time).toBe(1);
  });

  it("gives a three-note chord less weight than three separate notes", () => {
    const chord: DetectedNote[] = [60, 64, 67].map((midi) => ({
      midi,
      start: 1,
      duration: 0.5,
      confidence: 0.9,
    }));
    const spread: DetectedNote[] = [60, 64, 67].map((midi, index) => ({
      midi,
      start: 1 + index * 0.5,
      duration: 0.4,
      confidence: 0.9,
    }));
    const chordWeight = collectOnsets(chord).reduce((sum, o) => sum + o.strength, 0);
    const spreadWeight = collectOnsets(spread).reduce((sum, o) => sum + o.strength, 0);
    expect(chordWeight).toBeLessThan(spreadWeight);
  });

  it("returns nothing for no notes", () => {
    expect(collectOnsets([])).toEqual([]);
  });
});

describe("estimateTempo", () => {
  it("falls back to 120 when there is too little to measure", () => {
    expect(estimateTempo(pulse(90, 3))).toEqual({ bpm: 120, offset: 0, fit: 0 });
  });

  it.each([90, 120, 144])("recovers a steady %i BPM pulse", (bpm) => {
    const tempo = estimateTempo(pulse(bpm, 32));
    // A grid at half or double the tempo also explains the onsets, so the
    // answer counts as correct if it lands on the pulse or an octave of it.
    const ratio = Math.log2(tempo.bpm / bpm);
    expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(0.03);
  });

  it("reports a strong fit for a perfectly regular pulse", () => {
    expect(estimateTempo(pulse(120, 32)).fit).toBeGreaterThan(0.8);
  });

  it("places the first barline at or before the first note", () => {
    const notes = pulse(120, 32, 4.37);
    const tempo = estimateTempo(notes);
    expect(tempo.offset).toBeLessThanOrEqual(notes[0].start + 1e-6);
    expect(tempo.offset).toBeGreaterThan(notes[0].start - 60 / tempo.bpm);
  });
});

describe("alignOffset", () => {
  it("locks a manual tempo onto the real accents", () => {
    const notes = pulse(100, 24, 2.5);
    const offset = alignOffset(notes, 100);
    const period = 60 / 100;
    const position = (notes[0].start - offset) / period;
    expect(Math.abs(position - Math.round(position))).toBeLessThan(0.05);
  });

  it("returns zero when there is nothing to align to", () => {
    expect(alignOffset([], 120)).toBe(0);
  });
});
