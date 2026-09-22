import { describe, expect, it } from "vitest";
import { allTags, cleanTags, parseMarks, tagsOf, withStar, withTags } from "./marks";

describe("reading the stored marks", () => {
  it("keeps only stars and tags", () => {
    const marks = parseMarks(
      JSON.stringify({ a: { star: true }, b: { tags: ["חתונה", "חתונה", " "] }, c: { junk: 1 } }),
    );
    expect(marks).toEqual({ a: { star: true }, b: { tags: ["חתונה"] } });
  });

  it("survives nonsense", () => {
    expect(parseMarks(null)).toEqual({});
    expect(parseMarks("not json")).toEqual({});
    expect(parseMarks("[1,2]")).toEqual({});
  });
});

describe("tags", () => {
  it("are trimmed, deduplicated and capped", () => {
    expect(cleanTags([" א ", "א", "ב", 7, ""])).toEqual(["א", "ב"]);
    expect(cleanTags(["1", "2", "3", "4", "5", "6", "7", "8"])).toHaveLength(6);
  });

  it("are counted for the filter row, most used first", () => {
    const marks = { a: { tags: ["ערב"] }, b: { tags: ["ערב", "בוקר"] } };
    expect(allTags(marks)).toEqual([
      { tag: "ערב", count: 2 },
      { tag: "בוקר", count: 1 },
    ]);
  });
});

describe("changing a mark", () => {
  it("adds and removes a star without leaving an empty entry", () => {
    const starred = withStar({}, "w1", true);
    expect(starred.w1.star).toBe(true);
    expect(withStar(starred, "w1", false)).toEqual({});
  });

  it("keeps the tags when the star goes away", () => {
    const both = withTags(withStar({}, "w1", true), "w1", ["ערב"]);
    const left = withStar(both, "w1", false);
    expect(tagsOf(left, "w1")).toEqual(["ערב"]);
  });

  it("drops the entry when the last tag is removed", () => {
    expect(withTags(withTags({}, "w1", ["ערב"]), "w1", [])).toEqual({});
  });
});
