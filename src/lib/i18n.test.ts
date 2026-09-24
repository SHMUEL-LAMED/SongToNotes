import { describe, expect, it } from "vitest";
import { createTranslator, normalize } from "./i18n";
import yi from "../i18n/yi.json";

describe("createTranslator", () => {
  const translate = createTranslator({
    "דף הבית": "Home",
    "{0} כלים": "{0} tools",
    "{0} כלים · חינם · בלי הרשמה": "{0} tools · free · no sign-up",
    "חינם": "Free",
    "„{0}” נפתח ב{1}": "“{0}” opened in {1}",
    "מטרונום": "Metronome",
    "יום {0}, {1}": "{0}, {1}",
    "ראשון": "Sunday",
    "{0}, צעד {1}{2}": "{0}, step {1}{2}",
    "סנר": "Snare",
    "השתקה": "Mute",
    ", מודגש": ", accented",
    "מכונת תופים": "Drum machine",
    "ביט משלכם, צעד אחרי צעד": "Your own beat, step by step",
  });

  it("translates whole phrases", () => {
    expect(translate("דף הבית")).toBe("Home");
    expect(translate("משהו אחר")).toBeNull();
  });

  it("fills templates, translating Hebrew inside them", () => {
    expect(translate("22 כלים")).toBe("22 tools");
    expect(translate("24 כלים · חינם · בלי הרשמה")).toBe("24 tools · free · no sign-up");
    expect(translate("„השיר שלי” נפתח במטרונום")).toBe("“השיר שלי” opened in Metronome");
    expect(translate("יום ראשון, 14:00")).toBe("Sunday, 14:00");
  });

  it("matches short values in slots that sit side by side", () => {
    expect(translate("סנר, צעד 2")).toBe("Snare, step 2");
    expect(translate("סנר, צעד 1, מודגש")).toBe("Snare, step 1, accented");
  });

  it("translates labels glued together in code, piece by piece", () => {
    expect(translate("השתקה: סנר")).toBe("Mute: Snare");
    expect(translate("סנר — משהו")).toBe("Snare — משהו");
    expect(translate("משהו: אחר")).toBeNull();
    expect(translate("מכונת תופים — ביט משלכם, צעד אחרי צעד")).toBe("Drum machine — Your own beat, step by step");
  });

  it("normalises whitespace the way the page does", () => {
    expect(normalize("  דף\n  הבית ")).toBe("דף הבית");
  });
});

describe("the Yiddish dictionary", () => {
  it("keeps every placeholder of every template", () => {
    for (const [source, target] of Object.entries(yi as Record<string, string>)) {
      const slots = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort().join();
      expect(slots(target), source).toBe(slots(source));
      expect(target.trim().length || source.trim().length === 0, source).toBeTruthy();
    }
  });
});
