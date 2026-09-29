import { describe, expect, it } from "vitest";
import { rankCommands, type CommandItem } from "./CommandPalette";

const item = (id: string, label: string, group: string, extra: Partial<CommandItem> = {}): CommandItem => ({ id, label, group, run: () => undefined, ...extra });

const ITEMS = [
  item("page:home", "דף הבית", "דפים"),
  item("tool:tuner", "מכוון כלים", "כלים", { hint: "כרומטי, מהמיקרופון", keywords: "גיטרה בס כינור טיונר" }),
  item("tool:notes", "שיר לתווים", "כלים", { keywords: "תווים midi" }),
  item("tool:ear", "מאמן שמיעה", "כלים", { hint: "מרווחים ואקורדים" }),
  item("tool:chords", "מזהה אקורדים לגיטרה", "כלים"),
];

describe("rankCommands", () => {
  it("finds an item by words spread over its name and keywords", () => {
    expect(rankCommands(ITEMS, "מכוון גיטרה").map((entry) => entry.id)).toEqual(["tool:tuner"]);
  });

  it("puts a name match before a hint match, and a name start first", () => {
    expect(rankCommands(ITEMS, "אקורדים").map((entry) => entry.id)).toEqual(["tool:chords", "tool:ear"]);
    expect(rankCommands(ITEMS, "מ")[0].id).toBe("tool:tuner");
  });

  it("ranks a word that starts with the query above a match inside a word", () => {
    expect(rankCommands([item("x", "סט־ליסט", "כלים"), item("y", "אנליסט", "כלים")], "ליסט")[0].id).toBe("x");
    const list = [item("a", "אנליסט", "כלים"), item("b", "ליסטים", "כלים"), item("c", "רשימה ליסט", "כלים")];
    expect(rankCommands(list, "ליסט").map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  it("shows everything, capped, for an empty query", () => {
    expect(rankCommands(ITEMS, "  ")).toHaveLength(ITEMS.length);
  });
});
