import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DRUMS,
  DRUM_IDS,
  KEY_MAP,
  KITS,
  KIT_VOICES,
  clicksInWindow,
  drumForCode,
  drumForMidiNote,
  freeLoopBeats,
  loopEventsInWindow,
  normalizeSettings,
  placeHit,
  quantizeBeat,
  serializeSettings,
  velocityFromPosition,
  voiceLength,
  wrapBeat,
  type DrumId,
  type LoopEvent,
} from "./drumKit";

describe("velocity from where the drum is hit", () => {
  it("is loudest in the centre of a drum and softer toward the rim", () => {
    const centre = velocityFromPosition(0, 0, "drum");
    const middle = velocityFromPosition(0.5, 0, "drum");
    const edge = velocityFromPosition(0, 0.95, "drum");
    expect(centre.velocity).toBe(1);
    expect(middle.velocity).toBeLessThan(centre.velocity);
    expect(edge.velocity).toBeLessThan(middle.velocity);
    expect(edge.velocity).toBeGreaterThanOrEqual(0.3);
    expect(centre.zone).toBe("normal");
    expect(edge.zone).toBe("edge");
  });

  it("depends only on the distance, not the direction", () => {
    expect(velocityFromPosition(0.6, 0, "drum")).toEqual(velocityFromPosition(0, -0.6, "drum"));
    expect(velocityFromPosition(0.3, 0.4, "drum")).toEqual(velocityFromPosition(-0.5, 0, "drum"));
  });

  it("treats a hit outside the circle as a hit on the edge", () => {
    expect(velocityFromPosition(3, 3, "drum")).toEqual(velocityFromPosition(1, 0, "drum"));
    expect(velocityFromPosition(Number.NaN, 0, "drum").velocity).toBe(1);
  });

  it("has no rim on the kick or the clap pad", () => {
    expect(velocityFromPosition(0.95, 0, "kick").zone).toBe("normal");
    expect(velocityFromPosition(0.95, 0, "pad").zone).toBe("normal");
  });

  it("finds the bell in the middle of a cymbal and the loud edge outside", () => {
    expect(velocityFromPosition(0.1, 0, "cymbal").zone).toBe("bell");
    const bow = velocityFromPosition(0.5, 0, "cymbal");
    const edge = velocityFromPosition(0.95, 0, "cymbal");
    expect(bow.zone).toBe("normal");
    expect(edge.zone).toBe("edge");
    expect(edge.velocity).toBeGreaterThan(bow.velocity);
  });

  it("always stays between 0.3 and 1", () => {
    for (const shape of ["kick", "drum", "cymbal", "pad"] as const) {
      for (let r = 0; r <= 1.5; r += 0.05) {
        const { velocity } = velocityFromPosition(r, 0, shape);
        expect(velocity).toBeGreaterThanOrEqual(0.3);
        expect(velocity).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("quantize", () => {
  it("snaps to the nearest sixteenth", () => {
    expect(quantizeBeat(0.1)).toBe(0);
    expect(quantizeBeat(0.13)).toBe(0.25);
    expect(quantizeBeat(1.49)).toBe(1.5);
    expect(quantizeBeat(3.9)).toBe(4);
    expect(quantizeBeat(-0.05)).toBe(0);
    expect(Object.is(quantizeBeat(-0.05), -0)).toBe(false);
  });

  it("snaps to other divisions", () => {
    expect(quantizeBeat(0.3, 2)).toBe(0.5);
    expect(quantizeBeat(0.3, 1)).toBe(0);
  });

  it("wraps into the loop, a hit just before the end snapping onto the downbeat", () => {
    expect(wrapBeat(9, 8)).toBe(1);
    expect(wrapBeat(-0.5, 8)).toBe(7.5);
    expect(wrapBeat(8 - 1e-12, 8)).toBe(0);
    const late = placeHit(7.95, 0, 8, true);
    expect(late.snapped).toBe(8);
    expect(late.beat).toBe(0);
    const free = placeHit(5.3, 4, 8, false);
    expect(free.beat).toBeCloseTo(1.3);
  });

  it("measures a free loop to whole beats only when the grid is on", () => {
    expect(freeLoopBeats(7.6, true)).toBe(8);
    expect(freeLoopBeats(0.2, true)).toBe(1);
    expect(freeLoopBeats(7.6, false)).toBe(7.6);
    expect(freeLoopBeats(0.01, false)).toBe(0.25);
  });
});

describe("loop scheduling", () => {
  const events = [
    { drum: "kick", beat: 0 },
    { drum: "snare", beat: 1 },
    { drum: "hat", beat: 3.75 },
  ] as const;

  it("returns the hits inside a window of the first pass", () => {
    const hits = loopEventsInWindow(events, 4, 0, 0, 1.5);
    expect(hits.map((hit) => [hit.event.drum, hit.beat])).toEqual([
      ["kick", 0],
      ["snare", 1],
    ]);
  });

  it("carries on across the loop boundary without dropping or doubling a hit", () => {
    const hits = loopEventsInWindow(events, 4, 0, 3.5, 4.5);
    expect(hits.map((hit) => [hit.event.drum, hit.beat])).toEqual([
      ["hat", 3.75],
      ["kick", 4],
    ]);
    // Consecutive windows cover every hit exactly once.
    const all: number[] = [];
    for (let slice = 0; slice < 40; slice += 1) {
      all.push(...loopEventsInWindow(events, 4, 0, slice * 0.3, (slice + 1) * 0.3).map((hit) => hit.beat));
    }
    expect(all.map((beat) => Math.round(beat * 100) / 100)).toEqual([0, 1, 3.75, 4, 5, 7.75, 8, 9, 11.75]);
  });

  it("spans several passes in one window, and starts where the loop starts", () => {
    const hits = loopEventsInWindow(events, 4, 2, 0, 11);
    expect(hits.map((hit) => hit.beat)).toEqual([2, 3, 5.75, 6, 7, 9.75, 10]);
  });

  it("plays nothing before the loop's first pass or past its length", () => {
    expect(loopEventsInWindow(events, 4, 8, 0, 8)).toEqual([]);
    expect(loopEventsInWindow([{ beat: 5 }], 4, 0, 0, 16)).toEqual([]);
    expect(loopEventsInWindow(events, 0, 0, 0, 16)).toEqual([]);
    expect(loopEventsInWindow(events, 4, 0, 2, 2)).toEqual([]);
  });

  it("clicks on each beat with the downbeat accented, count-in included", () => {
    expect(clicksInWindow(-4, 1.5)).toEqual([
      { beat: -4, accent: true },
      { beat: -3, accent: false },
      { beat: -2, accent: false },
      { beat: -1, accent: false },
      { beat: 0, accent: true },
      { beat: 1, accent: false },
    ]);
    expect(clicksInWindow(3.2, 4.1)).toEqual([{ beat: 4, accent: true }]);
  });
});

describe("the keyboard and MIDI", () => {
  it("has no key assigned to two drums", () => {
    const codes = Object.values(KEY_MAP).flatMap((keys) => keys.map((key) => key.code));
    expect(new Set(codes).size).toBe(codes.length);
    const labels = Object.values(KEY_MAP).flatMap((keys) => keys.map((key) => key.label));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives every drum a key, and every key finds its drum", () => {
    for (const drum of DRUM_IDS) {
      expect(KEY_MAP[drum].length).toBeGreaterThan(0);
      for (const key of KEY_MAP[drum]) expect(drumForCode(key.code)).toBe(drum);
    }
    expect(drumForCode("KeyQ")).toBeNull();
    expect(drumForCode("Space")).toBe("kick");
  });

  it("follows the General MIDI drum map", () => {
    expect(drumForMidiNote(36)).toEqual({ drum: "kick", zone: "normal" });
    expect(drumForMidiNote(38).drum).toBe("snare");
    expect(drumForMidiNote(37)).toEqual({ drum: "snare", zone: "edge" });
    expect(drumForMidiNote(42).drum).toBe("hat");
    expect(drumForMidiNote(46).drum).toBe("open");
    expect(drumForMidiNote(49).drum).toBe("crash");
    expect(drumForMidiNote(53)).toEqual({ drum: "ride", zone: "bell" });
    expect(drumForMidiNote(43).drum).toBe("floor");
    expect(DRUM_IDS).toContain(drumForMidiNote(100).drum);
    expect(DRUM_IDS).toContain(drumForMidiNote(0).drum);
  });
});

describe("the kits", () => {
  it("has ten drums, each placed on the board", () => {
    expect(DRUM_IDS).toHaveLength(10);
    expect(new Set(DRUM_IDS).size).toBe(10);
    for (const drum of DRUMS) {
      expect(drum.x).toBeGreaterThan(0);
      expect(drum.x).toBeLessThan(100);
      expect(drum.y).toBeGreaterThan(0);
      expect(drum.y).toBeLessThan(100);
      expect(drum.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every drum synthesis parameters in every kit", () => {
    for (const kit of KITS) {
      for (const drum of DRUM_IDS) {
        const params = KIT_VOICES[kit.id][drum as DrumId];
        expect(params, `${kit.id}/${drum}`).toBeDefined();
        expect(params.layers.length, `${kit.id}/${drum}`).toBeGreaterThan(0);
        for (const layer of [...params.layers, ...(params.edge ?? []), ...(params.bell ?? [])]) {
          expect(layer.peak).toBeGreaterThan(0);
          expect(layer.decay).toBeGreaterThan(0);
          if (layer.type === "metal") expect(layer.frequencies.length).toBeGreaterThan(0);
        }
        expect(voiceLength(params)).toBeLessThan(2.5);
      }
    }
  });

  it("gives every cymbal a bell sound, and lets the closed hi-hat stop the open one", () => {
    for (const kit of KITS) {
      for (const drum of DRUMS.filter((item) => item.shape === "cymbal" && (item.id === "crash" || item.id === "ride"))) {
        expect(KIT_VOICES[kit.id][drum.id].bell?.length, `${kit.id}/${drum.id}`).toBeGreaterThan(0);
      }
      expect(KIT_VOICES[kit.id].hat.chokes).toContain("open");
    }
  });
});

describe("saved settings", () => {
  it("falls back to the defaults on junk", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ kit: "tabla", bpm: 9000, volume: -1, length: 3 })).toEqual({
      ...DEFAULT_SETTINGS,
      bpm: 240,
      volume: 0,
    });
  });

  it("keeps the loop, drops the live-only fields and malformed hits", () => {
    const event: LoopEvent = { drum: "snare", beat: 1, velocity: 0.7, zone: "edge", notBefore: 12 };
    const text = serializeSettings({ ...DEFAULT_SETTINGS, kit: "808", loopBeats: 8, takes: [{ id: "a", events: [event] }] });
    expect(text).not.toContain("notBefore");
    const parsed = JSON.parse(text);
    parsed.takes[0].events.push({ drum: "gong", beat: 1 }, { drum: "kick", beat: 99 });
    const restored = normalizeSettings(parsed);
    expect(restored.kit).toBe("808");
    expect(restored.loopBeats).toBe(8);
    expect(restored.takes).toEqual([{ id: "a", events: [{ drum: "snare", beat: 1, velocity: 0.7, zone: "edge" }] }]);
  });
});
