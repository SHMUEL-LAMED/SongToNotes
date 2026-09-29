import { describe, expect, it } from "vitest";
import { ALL_TOOLS, MENU_GROUPS, MENU_TOOLS, TOOLS, TOOL_FAMILIES, familyOf, findAnyTool, findTool, isTabOnly, menuGroupLabel, pageToolOf } from "./tools";
import { WORKFLOWS } from "./workflows";

describe("hidden tools", () => {
  const hidden = ALL_TOOLS.filter((tool) => tool.hidden);

  it("are left out of what visitors see, but not deleted", () => {
    for (const tool of hidden) {
      expect(TOOLS).not.toContain(tool);
      expect(findTool(tool.id)).toBeNull();
      expect(findAnyTool(tool.id)).toBe(tool);
    }
    expect(TOOLS.length + hidden.length).toBe(ALL_TOOLS.length);
  });

  it("include the song identifier again", () => {
    expect(findTool("identify")?.title).toBe("מזהה שיר");
  });
});

describe("workflows", () => {
  it("name only tools the site has", () => {
    for (const flow of WORKFLOWS) {
      for (const step of flow.steps) expect(findAnyTool(step.tool), `${flow.id}: ${step.tool}`).not.toBeNull();
    }
  });

  it("keep at least one step once hidden tools drop out", () => {
    for (const flow of WORKFLOWS) expect(flow.steps.some((step) => findTool(step.tool)), flow.id).toBe(true);
  });
});

describe("side menu", () => {
  it("places every tool with a page of its own in exactly one group, and no tab", () => {
    const listed = MENU_GROUPS.flatMap((group) => group.tools);
    expect(new Set(listed).size).toBe(listed.length);
    const own = ALL_TOOLS.filter((tool) => !isTabOnly(tool.id)).map((tool) => tool.id).sort();
    expect([...listed].sort()).toEqual(own);
  });

  it("orders the visible tools the way the menu does, each family's tabs together", () => {
    const ids = TOOLS.map((tool) => tool.id);
    for (const family of TOOL_FAMILIES) {
      const at = family.tabs.map((tab) => ids.indexOf(tab.id));
      expect(at.every((index, i) => i === 0 || index === at[i - 1] + 1), family.parent).toBe(true);
    }
    expect(MENU_TOOLS.map((tool) => tool.id)).toEqual(MENU_GROUPS.flatMap((group) => group.tools).filter((id) => findTool(id)));
  });
});

describe("tool families", () => {
  it("name only real tools, each in one family, led by the family's own tool", () => {
    const seen = new Set<string>();
    for (const family of TOOL_FAMILIES) {
      expect(family.tabs[0].id).toBe(family.parent);
      for (const tab of family.tabs) {
        expect(findAnyTool(tab.id), tab.id).not.toBeNull();
        expect(seen.has(tab.id), tab.id).toBe(false);
        seen.add(tab.id);
      }
    }
  });

  it("show a tab on its family's page, and a lone tool on its own", () => {
    expect(pageToolOf(findTool("drumkit")!).id).toBe("beats");
    expect(pageToolOf(findTool("beats")!).id).toBe("beats");
    expect(pageToolOf(findTool("tuner")!).id).toBe("tuner");
    expect(familyOf("lyrics")?.parent).toBe("transcript");
    expect(menuGroupLabel("songcard")).toBe(menuGroupLabel("visualizer"));
  });

  it("let a tab's keywords find its family's tool", () => {
    expect(findTool("beats")!.tags).toContain("תופים אלקטרוניים");
    expect(findTool("convert")!.tags).toContain("חיבור קבצים");
  });
});
