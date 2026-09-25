import { describe, expect, it } from "vitest";
import { HISTORY_SIZE, historyFromWorks, pushSong, songOfWork, workForSong, type FoundSong } from "./identifyHistory";
import type { SavedWork } from "./works";

const song = (title: string, artist = "עומר אדם", extra: Partial<FoundSong> = {}): FoundSong => ({
  found: true,
  artist,
  title,
  album: "אלבום",
  releaseDate: "2015-05-01",
  label: null,
  timecode: "01:02",
  links: { song: "https://lis.tn/x", appleMusic: null, spotify: "https://open.spotify.com/track/1", deezer: null, youtube: "https://www.youtube.com/watch?v=aGCdLKXNF3w" },
  artwork: null,
  used: 3,
  limit: 30,
  ...extra,
});

/** A saved work the way the personal area lists it. */
const saved = (entry: ReturnType<typeof workForSong>, createdAt: string, id = createdAt): SavedWork => ({
  id,
  kind: entry.kind,
  title: entry.title,
  sourceName: entry.sourceName ?? null,
  summary: entry.summary ?? {},
  payload: entry.payload ?? {},
  fileName: null,
  deviceId: null,
  filePath: null,
  createdAt,
  updatedAt: createdAt,
  origin: "works",
  rowId: null,
  localOnly: false,
});

describe("workForSong", () => {
  it("names the work after the song and keeps the identification without the allowance", () => {
    const work = workForSong(song("תל אביב"), "demo.wav");
    expect(work).toMatchObject({ kind: "identify", title: "תל אביב — עומר אדם", sourceName: "demo.wav", summary: { artist: "עומר אדם", album: "אלבום", year: "2015" } });
    const kept = work.payload?.identification as Record<string, unknown>;
    expect(kept.links).toEqual(song("x").links);
    expect("used" in kept || "limit" in kept).toBe(false);
  });
});

describe("songOfWork", () => {
  it("brings the identification back, with the allowance unknown", () => {
    const back = songOfWork(saved(workForSong(song("תל אביב"), null), "2026-09-25T10:00:00.000Z"));
    expect(back).toEqual({ ...song("תל אביב"), used: 0, limit: 0 });
  });

  it("refuses other kinds and damaged payloads", () => {
    const work = saved(workForSong(song("תל אביב"), null), "2026-09-25T10:00:00.000Z");
    expect(songOfWork({ ...work, kind: "chords" })).toBeNull();
    expect(songOfWork({ ...work, payload: {} })).toBeNull();
    expect(songOfWork({ ...work, payload: { identification: { found: false } } })).toBeNull();
  });

  it("drops fields that are not text", () => {
    const work = saved(workForSong(song("תל אביב"), null), "2026-09-25T10:00:00.000Z");
    const damaged = { ...work, payload: { identification: { found: true, title: 42, artist: "  ", links: { youtube: { evil: true } } } } };
    expect(songOfWork(damaged)).toMatchObject({ title: null, artist: null, links: { youtube: null, spotify: null } });
  });
});

describe("historyFromWorks", () => {
  it("lists songs newest first, each once", () => {
    const works = [
      saved(workForSong(song("א"), null), "2026-09-25T08:00:00.000Z"),
      saved(workForSong(song("ב"), null), "2026-09-25T10:00:00.000Z"),
      saved(workForSong(song("א"), null), "2026-09-25T12:00:00.000Z"),
      { ...saved(workForSong(song("ג"), null), "2026-09-25T13:00:00.000Z"), kind: "chords" as const },
    ];
    expect(historyFromWorks(works).map((item) => item.title)).toEqual(["א", "ב"]);
  });

  it("keeps at most the history's size", () => {
    const works = Array.from({ length: HISTORY_SIZE + 3 }, (_, index) => saved(workForSong(song(`שיר ${index}`), null), `2026-09-25T${String(index).padStart(2, "0")}:00:00.000Z`));
    const history = historyFromWorks(works);
    expect(history).toHaveLength(HISTORY_SIZE);
    expect(history[0].title).toBe(`שיר ${HISTORY_SIZE + 2}`);
  });
});

describe("pushSong", () => {
  it("puts the new song on top and drops its older copy", () => {
    const history = [song("א"), song("ב"), song("ג")];
    expect(pushSong(history, song("ב")).map((item) => item.title)).toEqual(["ב", "א", "ג"]);
    expect(pushSong(history, song("ב", "אמן אחר")).map((item) => item.title)).toEqual(["ב", "א", "ב", "ג"]);
  });
});
