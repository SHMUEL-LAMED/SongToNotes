import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIONS,
  TOOL_IDS,
  coerceParams,
  describeCatalog,
  describeState,
  findAction,
  formatActionResults,
  registerAssistantBinding,
  resetAssistantBindings,
  runAssistantAction,
  signature,
} from "./assistantActions";
import { findTool } from "./tools";

beforeEach(() => {
  resetAssistantBindings();
  vi.stubGlobal("window", { location: { hash: "#/", assign: vi.fn() }, setTimeout, clearTimeout });
});
afterEach(() => vi.unstubAllGlobals());

describe("the catalogue", () => {
  it("has unique ids that name their tool", () => {
    const ids = ACTIONS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of ACTIONS) {
      if (spec.tool) expect(spec.id.startsWith(`${spec.tool}.`)).toBe(true);
      else expect(spec.id.includes(".") ? spec.id.split(".")[0] : spec.id).not.toBe("");
    }
  });

  it("covers every tool on the site", () => {
    for (const tool of TOOL_IDS) expect(ACTIONS.some((spec) => spec.tool === tool)).toBe(true);
  });

  it("never offers a hidden tool", () => {
    for (const tool of TOOL_IDS) expect(findTool(tool), tool).not.toBeNull();
    expect(TOOL_IDS).not.toContain("identify");
    expect(describeCatalog(null)).not.toContain("identify");
  });

  it("writes a signature the model can copy", () => {
    expect(signature(findAction("metronome.set")!)).toBe(
      "metronome.set(bpm?: number, meter?: 2/4|3/4|4/4|5/4|6/8|7/8, subdivision?: number, sound?: click|wood|beep, volume?: number)",
    );
  });

  it("describes the open tool in full and the others in brief", () => {
    const text = describeCatalog("songbook");
    expect(text).toContain("פעולות של הכלי הפתוח (songbook)");
    expect(text).toContain("songbook.write(title?: string, body: string)");
    expect(text).toContain("- metronome: set(bpm?,meter?,subdivision?,sound?,volume?), start(), stop(), save()");
    expect(text).not.toContain("- songbook: write(");
    expect(text).toContain("navigate(tool:");
  });
});

describe("coerceParams", () => {
  it("turns strings into the types the handler wants", () => {
    const spec = findAction("metronome.set")!;
    expect(coerceParams(spec, { bpm: "120", sound: "WOOD", volume: 80 })).toEqual({
      params: { bpm: 120, sound: "wood", volume: 80 },
      problems: [],
    });
  });

  it("reports what is missing or wrong instead of guessing", () => {
    const write = findAction("songbook.write")!;
    expect(coerceParams(write, {}).problems).toEqual(["חסר הפרמטר body"]);
    const set = findAction("metronome.set")!;
    expect(coerceParams(set, { meter: "9/8", bpm: "fast" }).problems).toEqual(["bpm צריך להיות מספר", "meter חייב להיות אחד מ: 2/4, 3/4, 4/4, 5/4, 6/8, 7/8"]);
  });

  it("reads lists and booleans written loosely", () => {
    const play = findAction("piano.play")!;
    expect(coerceParams(play, { notes: "C4 E4, G4", mode: "chord" }).params).toEqual({ notes: ["C4", "E4", "G4"], mode: "chord" });
    const listen = findAction("tuner.listen")!;
    expect(coerceParams(listen, { on: "כן" }).params).toEqual({ on: true });
    expect(coerceParams(listen, { on: "off" }).params).toEqual({ on: false });
  });
});

describe("running actions", () => {
  it("rejects an action that is not in the catalogue", async () => {
    const record = await runAssistantAction({ id: "site.explode", params: {} });
    expect(record.ok).toBe(false);
    expect(record.message).toContain("site.explode");
  });

  it("calls the handler of the mounted page with clean parameters", async () => {
    const set = vi.fn(async (params: Record<string, unknown>) => ({ ok: true, message: `קצב ${params.bpm}` }));
    registerAssistantBinding({ tool: "metronome", handlers: { "metronome.set": set } });
    const record = await runAssistantAction({ id: "metronome.set", params: { bpm: "100", extra: "x" } });
    expect(set).toHaveBeenCalledWith({ bpm: 100 });
    expect(record).toEqual({ id: "metronome.set", params: { bpm: 100 }, ok: true, message: "קצב 100" });
  });

  it("opens the tool that handles an action and waits for it", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { hash: "#/", assign }, setTimeout, clearTimeout });
    const pending = runAssistantAction({ id: "songbook.write", params: { body: "[Am]שיר" } });
    expect(assign).toHaveBeenCalledWith("#/songbook");
    const write = vi.fn(async () => ({ ok: true, message: "נכתב" }));
    registerAssistantBinding({ tool: "songbook", handlers: { "songbook.write": write } });
    const record = await pending;
    expect(write).toHaveBeenCalledWith({ body: "[Am]שיר" });
    expect(record.ok).toBe(true);
  });

  it("never throws when a handler does", async () => {
    registerAssistantBinding({
      tool: "tts",
      handlers: {
        "tts.speak": () => {
          throw new Error("אין קול");
        },
      },
    });
    const record = await runAssistantAction({ id: "tts.speak", params: { command: "play" } });
    expect(record).toMatchObject({ ok: false, message: "אין קול" });
  });

  it("prefers the page mounted last and forgets one that unmounted", async () => {
    const first = vi.fn(async () => ({ ok: true, message: "ראשון" }));
    const second = vi.fn(async () => ({ ok: true, message: "שני" }));
    registerAssistantBinding({ tool: "metronome", handlers: { "metronome.start": first } });
    const unregister = registerAssistantBinding({ tool: "metronome", handlers: { "metronome.start": second } });
    expect((await runAssistantAction({ id: "metronome.start", params: {} })).message).toBe("שני");
    unregister();
    expect((await runAssistantAction({ id: "metronome.start", params: {} })).message).toBe("ראשון");
  });

  it("gathers what the pages say about themselves", () => {
    registerAssistantBinding({ tool: "metronome", handlers: {}, state: () => "מטרונום: 100 BPM" });
    registerAssistantBinding({ tool: "site", handlers: {}, state: () => "" });
    expect(describeState()).toBe("מטרונום: 100 BPM");
  });
});

describe("formatActionResults", () => {
  it("reports each action and the data a read brought back", () => {
    const text = formatActionResults([
      { id: "songbook.write", params: {}, ok: true, message: "נכתבו 3 שורות" },
      { id: "works.list", params: {}, ok: true, message: "", data: { items: [{ id: "a", title: "שיר" }] } },
      { id: "works.delete", params: { id: "a" }, ok: false, cancelled: true, message: "בוטל" },
      { id: "metronome.set", params: {}, ok: false, message: "bpm מחוץ לטווח" },
    ]);
    expect(text.split("\n")).toEqual([
      "[תוצאות פעולות]",
      "1. songbook.write — הצליח: נכתבו 3 שורות",
      "2. works.list — הצליח",
      '{"items":[{"id":"a","title":"שיר"}]}',
      "3. works.delete — בוטל על ידי הגולש: בוטל",
      "4. metronome.set — נכשל: bpm מחוץ לטווח",
    ]);
  });
});
