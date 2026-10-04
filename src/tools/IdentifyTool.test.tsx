import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { YouTubeHere, YouTubeLink, YouTubePlayer } from "./IdentifyTool";

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

describe("the YouTube button of a recent song", () => {
  it("opens the video on the page itself, not on YouTube", () => {
    const html = renderToStaticMarkup(<YouTubeHere href="https://www.youtube.com/watch?v=aGCdLKXNF3w" open={false} onToggle={() => undefined} />);
    expect(html).toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('title="לנגן כאן"');
    expect(html.replace(/<[^>]*>/g, "")).toBe("▶ YouTube");
  });

  it("is pressed while the video is open, and offers to close it", () => {
    const html = renderToStaticMarkup(<YouTubeHere href="https://www.youtube.com/watch?v=aGCdLKXNF3w" open onToggle={() => undefined} />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="chip-toggle identify-youtube active"');
    expect(html).toContain('title="לסגור את הסרטון"');
  });

  it("is left out when the song has no video", () => {
    expect(renderToStaticMarkup(<YouTubeHere href={null} open={false} onToggle={() => undefined} />)).toBe("");
  });
});

describe("the video player in the result", () => {
  it("shows the video's still with a play button, and no player yet", () => {
    const html = renderToStaticMarkup(<YouTubePlayer href="https://www.youtube.com/watch?v=aGCdLKXNF3w" title="שם השיר — שם האמן" />);
    expect(html).toContain('aria-label="נגן כאן: שם השיר — שם האמן"');
    expect(html).toContain('src="https://i.ytimg.com/vi/aGCdLKXNF3w/hqdefault.jpg"');
    expect(html).not.toContain("<iframe");
  });

  it("starts playing at once when opened by a press, as under a recent song", () => {
    const html = renderToStaticMarkup(<YouTubePlayer href="https://www.youtube.com/watch?v=aGCdLKXNF3w" title="שם השיר — שם האמן" autoplay />);
    expect(html).toContain("<iframe");
    expect(html).toContain('src="https://www.youtube.com/embed/aGCdLKXNF3w?autoplay=1');
    expect(html).toContain('title="שם השיר — שם האמן"');
    expect(html).not.toContain("i.ytimg.com");
  });

  it("is left out without a video", () => {
    expect(renderToStaticMarkup(<YouTubePlayer href={null} title="שם השיר" />)).toBe("");
    expect(renderToStaticMarkup(<YouTubePlayer href="https://www.youtube.com/results?search_query=x" title="שם השיר" />)).toBe("");
  });
});
