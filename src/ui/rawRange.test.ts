import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every component outside src/ui, by its path relative to src.
const SRC = fileURLToPath(new URL("..", import.meta.url));
function components(dir: string, rel = ""): [string, string][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): [string, string][] => {
    const path = `${rel}${entry.name}`;
    if (entry.isDirectory()) return path === "ui" ? [] : components(`${dir}/${entry.name}`, `${path}/`);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [[path, readFileSync(`${dir}/${entry.name}`, "utf8")]] : [];
  });
}

// The hue pickers paint their own rainbow track and show no trail.
const OWN_TRACK = /className="songcard-hue"/;

describe("sliders", () => {
  it("draw their travelled part: <Fader>, or a raw range that sets --range-fill itself", () => {
    const bare: string[] = [];
    for (const [path, source] of components(SRC)) {
      for (const match of source.matchAll(/<input\b[^>]*?type="range"[\s\S]*?\/>/g)) {
        const tag = match[0];
        if (OWN_TRACK.test(tag) || /--range-fill|rangeFill\(/.test(tag)) continue;
        bare.push(`${path}:${source.slice(0, match.index).split("\n").length}`);
      }
    }
    expect(bare, "use <Fader> from src/ui (it sets --range-fill), or set it inline").toEqual([]);
  });
});
