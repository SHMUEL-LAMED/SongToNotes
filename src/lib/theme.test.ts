import { describe, expect, it } from "vitest";
import { normalizeAccent } from "./theme";

describe("normalizeAccent", () => {
  it("keeps a valid hue and wraps it onto the wheel", () => {
    expect(normalizeAccent({ hue: 140, everywhere: true })).toEqual({ hue: 140, everywhere: true });
    expect(normalizeAccent({ hue: 400 })).toEqual({ hue: 40, everywhere: false });
  });

  it("falls back to the brand colour for anything else", () => {
    expect(normalizeAccent(null)).toEqual({ hue: null, everywhere: false });
    expect(normalizeAccent({ hue: "red", everywhere: true })).toEqual({ hue: null, everywhere: false });
  });
});
