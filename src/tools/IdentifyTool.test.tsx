import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { YouTubeLink } from "./IdentifyTool";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: null, signInWithGoogle: vi.fn() }) }));
vi.mock("../lib/aiApi", () => ({ AiError: class extends Error {}, identifyAvailability: vi.fn(), identifySong: vi.fn() }));

describe("the YouTube link of an identified song", () => {
  it("opens a search for the artist and the title in a new tab", () => {
    const html = renderToStaticMarkup(<YouTubeLink artist="שם האמן" title="שם השיר" />);
    expect(html).toContain(
      'href="https://www.youtube.com/results?search_query=%D7%A9%D7%9D+%D7%94%D7%90%D7%9E%D7%9F+%D7%A9%D7%9D+%D7%94%D7%A9%D7%99%D7%A8"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html.replace(/<[^>]*>/g, "")).toBe("▶ YouTube");
  });

  it("is left out without both the artist and the title", () => {
    expect(renderToStaticMarkup(<YouTubeLink artist={null} title="שם השיר" />)).toBe("");
    expect(renderToStaticMarkup(<YouTubeLink artist="שם האמן" title={null} />)).toBe("");
    expect(renderToStaticMarkup(<YouTubeLink artist=" " title="שם השיר" />)).toBe("");
  });
});
