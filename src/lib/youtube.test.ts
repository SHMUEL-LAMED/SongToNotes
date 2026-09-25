import { describe, expect, it } from "vitest";
import { LISTENING, PLAYER_HOSTS, isVideoError, playerMessage, youtubeEmbedUrl, youtubeStillUrl, youtubeVideoId } from "./youtube";

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
  it("embeds YouTube's own player first, reporting to the page, playing inline", () => {
    // YouTube's own address first: filtered connections such as NetFree block the nocookie mirror.
    expect(PLAYER_HOSTS).toEqual(["www.youtube.com", "www.youtube-nocookie.com"]);
    expect(youtubeEmbedUrl("aGCdLKXNF3w", { origin: "https://shmuel-lamed.github.io" })).toBe(
      "https://www.youtube.com/embed/aGCdLKXNF3w?autoplay=1&rel=0&playsinline=1&enablejsapi=1&origin=https%3A%2F%2Fshmuel-lamed.github.io",
    );
    expect(youtubeEmbedUrl("aGCdLKXNF3w", { host: "www.youtube-nocookie.com" })).toBe(
      "https://www.youtube-nocookie.com/embed/aGCdLKXNF3w?autoplay=1&rel=0&playsinline=1&enablejsapi=1",
    );
    expect(youtubeStillUrl("aGCdLKXNF3w")).toBe("https://i.ytimg.com/vi/aGCdLKXNF3w/hqdefault.jpg");
  });
});

describe("what the player reports", () => {
  it("reads the player's messages, as text or as objects", () => {
    expect(playerMessage('{"event":"onReady","info":null,"id":1,"channel":"widget"}')).toEqual({ event: "onReady", info: null });
    expect(playerMessage({ event: "onError", info: 150 })).toEqual({ event: "onError", info: 150 });
    expect(JSON.parse(LISTENING)).toEqual({ event: "listening", id: 1, channel: "widget" });
  });

  it("ignores anything else", () => {
    expect(playerMessage("not json")).toBeNull();
    expect(playerMessage('{"type":"other"}')).toBeNull();
    expect(playerMessage(null)).toBeNull();
    expect(playerMessage(42)).toBeNull();
  });

  it("tells a video that cannot play anywhere from a player that did not load", () => {
    expect([100, 101, 150].every(isVideoError)).toBe(true);
    expect([2, 5, 153, "150", null].some(isVideoError)).toBe(false);
  });
});
