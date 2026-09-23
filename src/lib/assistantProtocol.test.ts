import { describe, expect, it } from "vitest";
import { parseAssistantReply } from "./assistantProtocol";

describe("parseAssistantReply", () => {
  it("pulls a fenced action out of the prose", () => {
    const reply = "מגדיר 120.\n\n```action\n{\"action\":\"metronome.set\",\"params\":{\"bpm\":120}}\n```\n\nמוכן.";
    const parsed = parseAssistantReply(reply);
    expect(parsed.actions).toEqual([{ id: "metronome.set", params: { bpm: 120 } }]);
    expect(parsed.text).toBe("מגדיר 120.\n\nמוכן.");
    expect(parsed.pending).toBe(false);
  });

  it("keeps several blocks in order and accepts json fences and arrays", () => {
    const reply = [
      "```json",
      '{"action":"navigate","tool":"songbook"}',
      "```",
      "```actions",
      '[{"action":"songbook.write","params":{"body":"[Am]שיר"}},{"name":"songbook.save","arguments":{}}]',
      "```",
    ].join("\n");
    const parsed = parseAssistantReply(reply);
    expect(parsed.actions.map((call) => call.id)).toEqual(["navigate", "songbook.write", "songbook.save"]);
    expect(parsed.actions[0].params).toEqual({ tool: "songbook" });
    expect(parsed.actions[1].params).toEqual({ body: "[Am]שיר" });
    expect(parsed.text).toBe("");
  });

  it("takes parameters spread at the top level", () => {
    const parsed = parseAssistantReply('```action\n{"action":"tts.write","text":"שלום"}\n```');
    expect(parsed.actions).toEqual([{ id: "tts.write", params: { text: "שלום" } }]);
  });

  it("leaves an ordinary code block alone", () => {
    const reply = "כך כותבים:\n```\n[Am]היה [G]פעם\n```";
    const parsed = parseAssistantReply(reply);
    expect(parsed.actions).toEqual([]);
    expect(parsed.text).toContain("[Am]היה [G]פעם");
  });

  it("marks a broken action block so the model hears about it", () => {
    const parsed = parseAssistantReply("```action\n{not json\n```");
    expect(parsed.actions[0].id).toBe("invalid");
    expect(parsed.text).toBe("");
  });

  it("reads the older open marker as navigation", () => {
    const parsed = parseAssistantReply("פותח.\n[[open:transcript]]");
    expect(parsed.actions).toEqual([{ id: "navigate", params: { tool: "transcript" } }]);
    expect(parsed.text).toBe("פותח.");
  });

  it("reads a bare json line without a fence", () => {
    const parsed = parseAssistantReply('מפעיל.\n{"action":"metronome.start","params":{}}\nזהו.');
    expect(parsed.actions).toEqual([{ id: "metronome.start", params: {} }]);
    expect(parsed.text).toBe("מפעיל.\nזהו.");
  });

  it("hides an unfinished fence while the reply streams", () => {
    const parsed = parseAssistantReply('כותב לשירון…\n```action\n{"action":"songbook.write","params":{"body":"[Am]');
    expect(parsed.pending).toBe(true);
    expect(parsed.text).toBe("כותב לשירון…");
    expect(parsed.actions).toEqual([]);
  });

  it("forgives a trailing comma between objects", () => {
    const parsed = parseAssistantReply('```action\n{"action":"a.b","params":{}},\n{"action":"c.d","params":{}}\n```');
    expect(parsed.actions.map((call) => call.id)).toEqual(["a.b", "c.d"]);
  });
});

describe("plans", () => {
  it("reads a plan block into steps and keeps it out of the prose", () => {
    const parsed = parseAssistantReply("מתחיל.\n```plan\n- [x] לפתוח את המטרונום\n- [~] לקבוע 100 BPM\n- [ ] להפעיל\n```\n```action\n{\"action\":\"metronome.start\"}\n```");
    expect(parsed.text).toBe("מתחיל.");
    expect(parsed.plan).toEqual([
      { text: "לפתוח את המטרונום", status: "done" },
      { text: "לקבוע 100 BPM", status: "active" },
      { text: "להפעיל", status: "pending" },
    ]);
    expect(parsed.actions).toHaveLength(1);
  });
  it("accepts numbered steps without boxes", () => {
    expect(parseAssistantReply("```plan\n1. אחד\n2. שניים\n```").plan).toEqual([
      { text: "אחד", status: "pending" },
      { text: "שניים", status: "pending" },
    ]);
  });
  it("has no plan when none was written", () => {
    expect(parseAssistantReply("שלום").plan).toBeNull();
  });
});
