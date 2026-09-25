import { describe, expect, it } from "vitest";
import { youtubeEmbedUrl, youtubeStillUrl, youtubeVideoId } from "./youtube";

describe("youtubeVideoId", () => {
  it("reads the id of the watch address the server sends", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=aGCdLKXNF3w")).toBe("aGCdLKXNF3w");
  });

  it("takes nothing else", () => {
    expect(youtubeVideoId(null)).toBeNull();
    expect(youtubeVideoId(undefined)).toBeNull();
    expect(youtubeVideoId("")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/results?search_query=a+b")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com.example.net/watch?v=aGCdLKXNF3w")).toBeNull();
    expect(youtubeVideoId("http://www.youtube.com/watch?v=aGCdLKXNF3w")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/watch?v=aGCdLKXNF3w%22")).toBeNull();
    expect(youtubeVideoId("not an address")).toBeNull();
  });
});

describe("the player and its still", () => {
  it("embeds YouTube's own player, playing inline", () => {
    // YouTube's own address: filtered connections such as NetFree block the nocookie mirror.
    expect(youtubeEmbedUrl("aGCdLKXNF3w")).toBe("https://www.youtube.com/embed/aGCdLKXNF3w?autoplay=1&rel=0&playsinline=1");
    expect(youtubeStillUrl("aGCdLKXNF3w")).toBe("https://i.ytimg.com/vi/aGCdLKXNF3w/hqdefault.jpg");
  });
});
