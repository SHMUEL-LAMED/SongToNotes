import { describe, expect, it } from "vitest";
import { midiToVoice } from "./drums";
import { parseMidiMessage } from "./midiInput";

describe("parseMidiMessage", () => {
  it("reads note-on on any channel", () => {
    expect(parseMidiMessage([0x90, 60, 127])).toEqual({ type: "on", note: 60, velocity: 1 });
    expect(parseMidiMessage([0x99, 36, 64])).toMatchObject({ type: "on", note: 36 });
  });

  it("treats note-on with zero velocity as note-off", () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: "off", note: 60 });
    expect(parseMidiMessage([0x80, 61, 40])).toEqual({ type: "off", note: 61 });
  });

  it("reads the sustain pedal and ignores other controllers", () => {
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: "sustain", down: true });
    expect(parseMidiMessage([0xb0, 64, 0])).toEqual({ type: "sustain", down: false });
    expect(parseMidiMessage([0xb0, 7, 100])).toBeNull();
    expect(parseMidiMessage([0xf8])).toBeNull();
  });
});

describe("midiToVoice", () => {
  it("follows the General MIDI drum map", () => {
    expect(midiToVoice(36)).toBe("kick");
    expect(midiToVoice(38)).toBe("snare");
    expect(midiToVoice(42)).toBe("hat");
    expect(midiToVoice(46)).toBe("open");
  });

  it("maps any other note to some voice", () => {
    expect(typeof midiToVoice(0)).toBe("string");
    expect(typeof midiToVoice(127)).toBe("string");
  });
});
