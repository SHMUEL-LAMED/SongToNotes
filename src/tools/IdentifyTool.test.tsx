import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { YouTubeLink, YouTubePlayer } from "./IdentifyTool";

vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: null, signInWithGoogle: vi.fn() }) }));
vi.mock("../lib/aiApi", () => ({ AiError: class extends Error {}, identifyAvailability: vi.fn(), identifySong: vi.fn() }));

describe("the YouTube link of an identified song", () => {
  it("opens the song's video in a new tab", () => {
    const html = renderToStaticMarkup(<YouTubeLink href="https://www.youtube.com/watch?v=aGCdLKXNF3w" />);
    expect(html).toContain('href="https://www.youtube.com/watch?v=aGCdLKXNF3w"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html.replace(/<[^>]*>/g, "")).toBe("▶ YouTube");
  });

  it("is left out when the server found no video", () => {
    expect(renderToStaticMarkup(<YouTubeLink href={null} />)).toBe("");
    expect(renderToStaticMarkup(<YouTubeLink />)).toBe("");
  });
});

describe("the video player in the result", () => {
  it("shows the video's still with a play button, and no player yet", () => {
    const html = renderToStaticMarkup(<YouTubePlayer href="https://www.youtube.com/watch?v=aGCdLKXNF3w" title="שם השיר — שם האמן" />);
    expect(html).toContain('aria-label="נגן כאן: שם השיר — שם האמן"');
    expect(html).toContain('src="https://i.ytimg.com/vi/aGCdLKXNF3w/hqdefault.jpg"');
    expect(html).not.toContain("<iframe");
  });

  it("is left out without a video", () => {
    expect(renderToStaticMarkup(<YouTubePlayer href={null} title="שם השיר" />)).toBe("");
    expect(renderToStaticMarkup(<YouTubePlayer href="https://www.youtube.com/results?search_query=x" title="שם השיר" />)).toBe("");
  });
});
