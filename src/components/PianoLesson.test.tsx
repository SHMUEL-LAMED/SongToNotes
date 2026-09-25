import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PianoLesson } from "./PianoLesson";

const notes = [
  { midi: 64, start: 2, duration: 0.5 },
  { midi: 67, start: 2.5, duration: 1 },
];

function render(title: string) {
  return renderToStaticMarkup(
    <PianoLesson
      title={title}
      notes={notes}
      keysRef={{ current: null }}
      layout="60-2"
      play={() => undefined}
      release={() => undefined}
      pressRef={{ current: null }}
      onGuide={() => undefined}
      onClose={() => undefined}
    />,
  );
}

describe("PianoLesson", () => {
  it("opens watching, ready to start, with the song's length", () => {
    const html = render("שיר השמחה");
    expect(html).toContain('aria-pressed="true"><svg');
    expect(html).toMatch(/aria-pressed="true">.*צפייה/);
    expect(html).toContain("התחל");
    // The clock reads left to right, in Hebrew too; 3.5 s of song plus a breath.
    expect(html).toContain('<span dir="ltr">0:00 / 0:03</span>');
  });

  it("keeps the song's own title out of the translation", () => {
    expect(render("Yesterday")).toContain('<span class="piano-lesson-song" dir="auto" translate="no">Yesterday</span>');
    expect(render("")).toContain('translate="no">שיר</span>');
  });
});
