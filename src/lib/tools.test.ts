import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS, TOOLS, findAnyTool, findTool } from "./tools";
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

describe("how-to videos", () => {
  it("exist, with a still, for every tool that shows one, and every video belongs to a tool", () => {
    const files = readdirSync(new URL("../../public/videos/", import.meta.url));
    const withVideo = ALL_TOOLS.filter((tool) => tool.video).map((tool) => tool.id).sort();
    for (const extension of [".mp4", ".webp"]) {
      const ids = files.filter((name) => name.endsWith(extension)).map((name) => name.slice(0, -extension.length));
      expect(ids.sort(), extension).toEqual(withVideo);
    }
  });
});
