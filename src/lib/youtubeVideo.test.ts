/**
 * The server half of the song identifier's YouTube button
 * (supabase/functions/identify/youtube.ts), run with the site's tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { videoFromLyricsMedia, videoFromSongLink, videoFromSongPage, youtubeId } from "../../supabase/functions/identify/youtube";

const VIDEO = "https://www.youtube.com/watch?v=aGCdLKXNF3w";

// As AudD returns it for its sample song, in the lyrics block of return=lyrics.
const MEDIA =
  '[{"provider":"youtube","type":"video","url":"http://www.youtube.com/watch?v=aGCdLKXNF3w"},' +
  '{"provider":"spotify","type":"audio","url":"https://open.spotify.com/track/4RvWPyQ5RL0ao9LPZeSouE","native_uri":"spotify:track:4RvWPyQ5RL0ao9LPZeSouE"},' +
  '{"provider":"soundcloud","type":"audio","url":"https://soundcloud.com/tearsforfearsmusic/everybody-wants-to-rule-the-8"}]';

/** A button of AudD's page for a song (lis.tn), marked up the way the page is. */
const button = (player: string, href: string) => `
  <div class="service">
    <a class="img-btn redirect"
       href="${href}"
       data-uri="#ZgotmplZ"
       data-player="${player}"
       data-apptype="manual"
    >
      <img style="display:inline-block;" src="/images/${player}.svg"/>
      <span class="play">Play</span>
    </a>
  </div>`;

describe("youtubeId", () => {
  it("reads the id from watch, YouTube Music and short addresses", () => {
    expect(youtubeId("http://www.youtube.com/watch?v=aGCdLKXNF3w")).toBe("aGCdLKXNF3w");
    expect(youtubeId("https://youtube.com/watch?v=aGCdLKXNF3w&t=42s")).toBe("aGCdLKXNF3w");
    expect(youtubeId("https://m.youtube.com/watch?v=aGCdLKXNF3w")).toBe("aGCdLKXNF3w");
    expect(youtubeId("https://music.youtube.com/watch?v=aGCdLKXNF3w")).toBe("aGCdLKXNF3w");
    expect(youtubeId("https://youtu.be/aGCdLKXNF3w?si=abc")).toBe("aGCdLKXNF3w");
    expect(youtubeId("https://www.youtube.com/watch?list=PL1&amp;v=aGCdLKXNF3w")).toBe("aGCdLKXNF3w");
  });

  it("refuses searches, other sites and anything that is not a video id", () => {
    expect(youtubeId("https://www.youtube.com/results?search_query=a+b")).toBeNull();
    expect(youtubeId("https://youtube.com.example.net/watch?v=aGCdLKXNF3w")).toBeNull();
    expect(youtubeId("https://example.net/watch?v=aGCdLKXNF3w")).toBeNull();
    expect(youtubeId("javascript:alert(1)//youtube.com/watch?v=aGCdLKXNF3w")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=aGCdLKXNF3w%22%3E")).toBeNull();
    expect(youtubeId("not an address")).toBeNull();
  });
});

describe("videoFromLyricsMedia", () => {
  it("finds the video in AudD's media list and writes it out afresh", () => {
    expect(videoFromLyricsMedia(MEDIA)).toBe(VIDEO);
  });

  it("skips entries that are not a YouTube video", () => {
    const media = JSON.stringify([null, { provider: "youtube", url: "https://example.net/v" }, { provider: "youtube", url: "https://youtu.be/aGCdLKXNF3w" }]);
    expect(videoFromLyricsMedia(media)).toBe(VIDEO);
  });

  it("gives nothing without a video", () => {
    expect(videoFromLyricsMedia('[{"provider":"spotify","url":"https://open.spotify.com/track/1"}]')).toBeNull();
    expect(videoFromLyricsMedia('{"provider":"youtube"}')).toBeNull();
    expect(videoFromLyricsMedia("not json")).toBeNull();
    expect(videoFromLyricsMedia(null)).toBeNull();
    expect(videoFromLyricsMedia(undefined)).toBeNull();
  });
});

describe("videoFromSongPage", () => {
  it("takes the YouTube button over the YouTube Music one", () => {
    const page = button("youtubemusic", "https://music.youtube.com/watch?v=MUSICid0001") + button("youtube", "https://youtube.com/watch?v=VIDEOid0001");
    expect(videoFromSongPage(page)).toBe("https://www.youtube.com/watch?v=VIDEOid0001");
  });

  it("falls back to YouTube Music, whose video plays on YouTube too", () => {
    expect(videoFromSongPage(button("spotify", "https://open.spotify.com/track/1") + button("youtubemusic", "https://music.youtube.com/watch?v=MUSICid0001"))).toBe(
      "https://www.youtube.com/watch?v=MUSICid0001",
    );
  });

  it("gives nothing when the page has no YouTube button", () => {
    expect(videoFromSongPage(button("spotify", "https://open.spotify.com/track/1"))).toBeNull();
    expect(videoFromSongPage(button("youtube", "https://example.net/watch?v=VIDEOid0001"))).toBeNull();
    expect(videoFromSongPage("")).toBeNull();
  });
});

describe("videoFromSongLink", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the YouTube button of the song's page on lis.tn", async () => {
    const fetch = vi.fn(async () => new Response(button("youtube", "https://youtube.com/watch?v=aGCdLKXNF3w")));
    vi.stubGlobal("fetch", fetch);
    expect(await videoFromSongLink("https://lis.tn/NbkVb")).toBe(VIDEO);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://lis.tn/NbkVb");
  });

  it("fetches nothing but lis.tn", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await videoFromSongLink("https://example.net/NbkVb")).toBeNull();
    expect(await videoFromSongLink("http://lis.tn/NbkVb")).toBeNull();
    expect(await videoFromSongLink(null)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives nothing when the page is missing or out of reach", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    expect(await videoFromSongLink("https://lis.tn/NbkVb")).toBeNull();
    vi.stubGlobal("console", { ...console, error: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network"))));
    expect(await videoFromSongLink("https://lis.tn/NbkVb")).toBeNull();
  });
});
