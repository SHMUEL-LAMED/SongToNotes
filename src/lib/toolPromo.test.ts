import { describe, expect, it } from "vitest";
import {
  PROMOS,
  PROMO_AFTER_MS,
  REST_ALL_AFTER_DISMISS_MS,
  REST_TOOL_AFTER_DISMISS_MS,
  REST_TOOL_AFTER_USE_MS,
  afterOutcome,
  afterShown,
  parseState,
  pickPromo,
  promoDue,
  type PromoState,
} from "./toolPromo";
import { findTool } from "./tools";

const now = 1_800_000_000_000;
const fresh = (): PromoState => ({ rest: {}, pauseAll: 0, next: 0 });
const none = () => false;

describe("the invitations", () => {
  it("name only tools the site shows, each once, with words in both languages", () => {
    const tools = PROMOS.map((promo) => promo.tool);
    expect(new Set(tools).size).toBe(tools.length);
    for (const promo of PROMOS) {
      expect(findTool(promo.tool), promo.tool).not.toBeNull();
      for (const words of [promo.he, promo.en]) {
        expect(words.title && words.text && words.cta, promo.tool).toBeTruthy();
      }
    }
  });

  it("leave the musicians' tools to the musicians", () => {
    const tools = PROMOS.map((promo) => promo.tool);
    for (const tool of ["metronome", "tuner", "theory", "ear", "chords", "progressions"]) expect(tools).not.toContain(tool);
    expect(tools).toContain("ringtone");
    expect(tools).toContain("identify");
  });
});

describe("when one rises", () => {
  it("after a little while on screen, once a visit", () => {
    expect(promoDue({ spent: PROMO_AFTER_MS - 1, state: fresh(), shownThisVisit: false, now })).toBe(false);
    expect(promoDue({ spent: PROMO_AFTER_MS, state: fresh(), shownThisVisit: false, now })).toBe(true);
    expect(promoDue({ spent: PROMO_AFTER_MS * 20, state: fresh(), shownThisVisit: true, now })).toBe(false);
  });

  it("not for a day after 'not now'", () => {
    const state = afterOutcome(fresh(), "ringtone", "dismissed", now);
    expect(state.pauseAll - now).toBe(REST_ALL_AFTER_DISMISS_MS);
    expect(promoDue({ spent: PROMO_AFTER_MS, state, shownThisVisit: false, now: state.pauseAll - 1 })).toBe(false);
    expect(promoDue({ spent: PROMO_AFTER_MS, state, shownThisVisit: false, now: state.pauseAll })).toBe(true);
  });
});

describe("which one", () => {
  it("takes turns from one visit to the next", () => {
    let state = fresh();
    const seen: string[] = [];
    for (let visit = 0; visit < PROMOS.length; visit += 1) {
      const index = pickPromo(state, now, none)!;
      seen.push(PROMOS[index].tool);
      state = afterShown(state, index);
    }
    expect(seen).toEqual(PROMOS.map((promo) => promo.tool));
    expect(PROMOS[pickPromo(state, now, none)!].tool).toBe(PROMOS[0].tool);
  });

  it("skips the tool on screen and the tools that are off", () => {
    const first = PROMOS[0].tool;
    const second = PROMOS[1].tool;
    expect(PROMOS[pickPromo(fresh(), now, (tool) => tool === first)!].tool).toBe(second);
    expect(pickPromo(fresh(), now, () => true)).toBeNull();
  });

  it("skips a tool that was opened this past month, or closed these two weeks", () => {
    const used = afterOutcome(fresh(), PROMOS[0].tool, "used", now);
    expect(used.rest[PROMOS[0].tool] - now).toBe(REST_TOOL_AFTER_USE_MS);
    expect(used.pauseAll).toBe(0);
    expect(PROMOS[pickPromo(used, now, none)!].tool).toBe(PROMOS[1].tool);
    expect(PROMOS[pickPromo(used, now + REST_TOOL_AFTER_USE_MS, none)!].tool).toBe(PROMOS[0].tool);

    const closed = afterOutcome(fresh(), PROMOS[0].tool, "dismissed", now);
    expect(closed.rest[PROMOS[0].tool] - now).toBe(REST_TOOL_AFTER_DISMISS_MS);
    expect(PROMOS[pickPromo(closed, now, none)!].tool).toBe(PROMOS[1].tool);
  });

  it("has nothing to offer to a visitor who uses them all", () => {
    let state = fresh();
    for (const promo of PROMOS) state = afterOutcome(state, promo.tool, "used", now);
    expect(pickPromo(state, now, none)).toBeNull();
  });
});

describe("what the device remembers", () => {
  it("reads back what it wrote, and forgets what it cannot read", () => {
    const state = afterShown(afterOutcome(fresh(), "vocals", "dismissed", now), 2);
    expect(parseState(JSON.stringify(state))).toEqual(state);
    expect(parseState(null)).toEqual(fresh());
    expect(parseState("not json")).toEqual(fresh());
    expect(parseState(JSON.stringify({ rest: { tts: "x", video: now }, next: -3, pauseAll: "soon" }))).toEqual({
      rest: { video: now },
      pauseAll: 0,
      next: 0,
    });
  });
});
