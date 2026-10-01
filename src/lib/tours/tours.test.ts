import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS, TOOL_FAMILIES } from "../tools";
import { PAGE_TOURS, TOOL_TOURS, tourFor, type TourStep } from "./index";

// Every component the pages are drawn from, as one text to look selectors up in.
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [readFileSync(path, "utf8")] : [];
  });
}
const SOURCE = sources(fileURLToPath(new URL("../..", import.meta.url))).join("\n");
// Marks written as templates — data-tour={`me-tab-${item.id}`} — by their fixed start.
const MARK_PREFIXES = [...SOURCE.matchAll(/data-tour=\{`([^`$]+)\$\{/g)].map((match) => match[1]);
const hasMark = (mark: string) => SOURCE.includes(`data-tour="${mark}"`) || MARK_PREFIXES.some((prefix) => mark.startsWith(prefix));

const everyStep: [string, TourStep][] = [
  ...Object.entries(TOOL_TOURS).flatMap(([id, steps]) => steps.map((step): [string, TourStep] => [id, step])),
  ...Object.entries(PAGE_TOURS).flatMap(([id, steps]) => steps.map((step): [string, TourStep] => [id, step])),
  ...ALL_TOOLS.flatMap((tool) => tourFor(tool.id, tool).map((step): [string, TourStep] => [tool.id, step])),
];

describe("tours", () => {
  it("cover every tool, its tabs included, and the pages that are not tools", () => {
    for (const tool of ALL_TOOLS) expect(TOOL_TOURS[tool.id]?.length ?? 0, tool.id).toBeGreaterThan(1);
    for (const family of TOOL_FAMILIES) for (const tab of family.tabs) expect(TOOL_TOURS[tab.id], tab.id).toBeDefined();
    for (const page of ["home", "me", "credits"]) expect(PAGE_TOURS[page]?.length ?? 0, page).toBeGreaterThan(2);
  });

  it("name only tools the site has", () => {
    const ids = new Set(ALL_TOOLS.map((tool) => tool.id));
    for (const id of Object.keys(TOOL_TOURS)) expect(ids.has(id), id).toBe(true);
  });

  it("say something in every step", () => {
    for (const [id, step] of everyStep) {
      expect(step.title.trim(), id).not.toBe("");
      expect(step.text.trim().length, `${id}: ${step.title}`).toBeGreaterThan(10);
    }
  });

  it("point at selectors that parse, and at classes and marks the components really have", () => {
    for (const [id, step] of everyStep) {
      if (!step.target) continue;
      // No DOM here to parse with: every alternative is non-empty, and brackets and quotes pair up.
      for (const part of step.target.split(",")) expect(part.trim(), `${id}: ${step.target}`).not.toBe("");
      expect(step.target.split("[").length, step.target).toBe(step.target.split("]").length);
      expect(step.target.split('"').length % 2, step.target).toBe(1);
      for (const [, mark] of step.target.matchAll(/\[data-tour="([^"]+)"\]/g)) {
        expect(hasMark(mark), `${id}: data-tour="${mark}"`).toBe(true);
      }
      for (const [, name] of step.target.replace(/\[[^\]]*\]/g, "").matchAll(/\.([A-Za-z][\w-]*)/g)) {
        expect(SOURCE.includes(name), `${id}: .${name}`).toBe(true);
      }
    }
  });

  it("open a tool with what it is, and end every page on the way back to the tour", () => {
    for (const tool of ALL_TOOLS) {
      const steps = tourFor(tool.id, tool);
      expect(steps[0].title).toBe(tool.title);
      expect(steps.at(-1)?.target).toBe(".tour-button");
    }
    expect(tourFor("home", null).at(-1)?.target).toBe(".tour-button");
    expect(tourFor("admin", null).length).toBeGreaterThan(2);
  });
});
