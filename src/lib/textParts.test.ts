import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBase64, downloadParts, readPartsManifest } from "./textParts";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("text parts", () => {
  it("decodes base64 back to the original bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    expect([...decodeBase64(Buffer.from(bytes).toString("base64"))]).toEqual([...bytes]);
  });

  it("joins the parts in order, whatever order they arrive in", async () => {
    const whole = Uint8Array.from({ length: 10 }, (_, index) => index);
    const parts = { "h-0.json": whole.subarray(0, 4), "h-1.json": whole.subarray(4, 8), "h-2.json": whole.subarray(8) };
    vi.stubGlobal("fetch", async (url: string) => {
      const name = url.split("/").pop() as keyof typeof parts;
      // The first part is the slowest, so a naive join would put it last.
      if (name === "h-0.json") await new Promise((resolve) => setTimeout(resolve, 20));
      return json(Buffer.from(parts[name]).toString("base64"));
    });
    const seen: number[] = [];
    const blob = await downloadParts("model", { bytes: 10, parts: Object.keys(parts) }, (loaded) => seen.push(loaded));
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...whole]);
    expect(seen.at(-1)).toBe(10);
  });

  it("rejects a set of parts that does not add up", async () => {
    vi.stubGlobal("fetch", async () => json(Buffer.from([1, 2]).toString("base64")));
    await expect(downloadParts("model", { bytes: 5, parts: ["h-0.json"] })).rejects.toThrow(/Assembled/);
  });

  it("treats a page served in place of the manifest as no manifest", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    expect(await readPartsManifest("model")).toBeNull();
  });
});
