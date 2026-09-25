import { describe, expect, it } from "vitest";
import { youtubeSearchUrl } from "./youtube";

describe("youtubeSearchUrl", () => {
  it("searches YouTube for the artist, then the title", () => {
    const url = youtubeSearchUrl("שם האמן", "שם השיר");
    expect(url).toBe(
      "https://www.youtube.com/results?search_query=%D7%A9%D7%9D+%D7%94%D7%90%D7%9E%D7%9F+%D7%A9%D7%9D+%D7%94%D7%A9%D7%99%D7%A8",
    );
    // As the address bar shows it.
    expect(decodeURIComponent(url ?? "")).toBe("https://www.youtube.com/results?search_query=שם+האמן+שם+השיר");
    expect(new URL(url ?? "").searchParams.get("search_query")).toBe("שם האמן שם השיר");
  });

  it("encodes what would otherwise end or bend the query", () => {
    const url = youtubeSearchUrl("Florence + The Machine", "Dog Days / Are Over? #1 & more") ?? "";
    expect(url).toBe("https://www.youtube.com/results?search_query=Florence+%2B+The+Machine+Dog+Days+%2F+Are+Over%3F+%231+%26+more");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("search_query")).toBe("Florence + The Machine Dog Days / Are Over? #1 & more");
    expect([...parsed.searchParams.keys()]).toEqual(["search_query"]);
    expect(parsed.hash).toBe("");
  });

  it("trims the names and folds the spaces inside them", () => {
    expect(youtubeSearchUrl("  Queen ", "Bohemian \n Rhapsody ")).toBe("https://www.youtube.com/results?search_query=Queen+Bohemian+Rhapsody");
  });

  it("needs both the artist and the title", () => {
    expect(youtubeSearchUrl(null, "Yesterday")).toBeNull();
    expect(youtubeSearchUrl("The Beatles", null)).toBeNull();
    expect(youtubeSearchUrl("   ", "Yesterday")).toBeNull();
    expect(youtubeSearchUrl("The Beatles", "")).toBeNull();
    expect(youtubeSearchUrl(undefined, undefined)).toBeNull();
  });
});
