import { describe, expect, it } from "vitest";
import { browserName, classifyDevice, hostOf, osName, rotateVisitor } from "./analytics";

describe("the shape of the device", () => {
  it("is read from the width and whether it is touched", () => {
    expect(classifyDevice(390, true)).toBe("phone");
    expect(classifyDevice(820, true)).toBe("tablet");
    expect(classifyDevice(820, false)).toBe("desktop");
    expect(classifyDevice(1440, false)).toBe("desktop");
  });

  it("names the browser by what still identifies it", () => {
    expect(browserName("Mozilla/5.0 ... Chrome/120 Safari/537.36 Edg/120")).toBe("Edge");
    expect(browserName("Mozilla/5.0 ... Chrome/120 Safari/537.36")).toBe("Chrome");
    expect(browserName("Mozilla/5.0 (iPhone) ... Version/17 Safari/605")).toBe("Safari");
    expect(browserName("Mozilla/5.0 ... Firefox/122")).toBe("Firefox");
    expect(browserName("something else")).toBe("אחר");
  });

  it("names the system", () => {
    expect(osName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("iOS");
    expect(osName("Mozilla/5.0 (Linux; Android 14)")).toBe("Android");
    expect(osName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)")).toBe("macOS");
    expect(osName("Mozilla/5.0 (Windows NT 10.0)")).toBe("Windows");
  });
});

describe("where a visitor came from", () => {
  it("keeps the host and nothing else", () => {
    expect(hostOf("https://www.google.com/search?q=secret", "https://site.example/")).toBe(
      "www.google.com",
    );
  });

  it("ignores the site itself and an empty referrer", () => {
    expect(hostOf("https://site.example/page", "https://site.example/")).toBeNull();
    expect(hostOf("", "https://site.example/")).toBeNull();
    expect(hostOf("not a url", "https://site.example/")).toBeNull();
  });
});

describe("the anonymous visitor number", () => {
  const draw = () => "newnumber";

  it("is kept while it is young", () => {
    const stored = { id: "old", since: Date.now() - 5 * 86_400_000 };
    expect(rotateVisitor(stored, Date.now(), draw)).toBe(stored);
  });

  it("is redrawn after a month, and when there is none", () => {
    const stale = { id: "old", since: Date.now() - 40 * 86_400_000 };
    expect(rotateVisitor(stale, Date.now(), draw).id).toBe("newnumber");
    expect(rotateVisitor(null, Date.now(), draw).id).toBe("newnumber");
  });
});
