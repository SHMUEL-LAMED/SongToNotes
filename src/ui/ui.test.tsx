import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Deck, Dialog, Fader, Field, Ledger, Notice, Panel, Progress, Segmented, Stat, Tabs } from "./index";

const noop = () => undefined;

describe("ui primitives (server markup)", () => {
  it("renders a button that never submits a form by accident", () => {
    const html = renderToStaticMarkup(<Button variant="primary">שמירה</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain("btn btn-primary btn-md");
  });

  it("renders a link button when asked", () => {
    const html = renderToStaticMarkup(
      <Button as="a" href="#/notes">
        לכלי
      </Button>,
    );
    expect(html).toMatch(/^<a [^>]*href="#\/notes"/);
  });

  it("marks the pressed segment", () => {
    const html = renderToStaticMarkup(
      <Segmented
        label="מצב"
        value="b"
        onChange={noop}
        options={[
          { id: "a", label: "א" },
          { id: "b", label: "ב" },
        ]}
      />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="מצב"');
    expect(html).toMatch(/aria-pressed="true">ב</);
    expect(html).toMatch(/aria-pressed="false">א</);
  });

  it("names a panel by its title and leaves a slot for its numeral", () => {
    const html = renderToStaticMarkup(<Panel title="הגדרות">תוכן</Panel>);
    const id = /<h2 class="panel-title" id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${id}"`);
    expect(html).toContain('class="panel-num"');
  });

  it("wraps the control in a label unless it is a group or has an id", () => {
    expect(renderToStaticMarkup(<Field label="קצב" value="120">x</Field>)).toMatch(/^<label class="field-row"/);
    expect(renderToStaticMarkup(<Field label="קצב" group>x</Field>)).toMatch(/^<div class="field-row"/);
    expect(renderToStaticMarkup(<Field label="קצב" htmlFor="bpm">x</Field>)).toContain('<label class="field-label" for="bpm">');
  });

  it("shows the percentage, or runs indeterminate without a value", () => {
    expect(renderToStaticMarkup(<Progress value={0.42} label="מעבד" />)).toContain('aria-valuenow="42"');
    const running = renderToStaticMarkup(<Progress label="מעבד" />);
    expect(running).toContain("is-indeterminate");
    expect(running).not.toContain("aria-valuenow");
  });

  it("hands the fader's share to the stylesheet", () => {
    const html = renderToStaticMarkup(<Fader min={30} max={260} value={145} onChange={noop} label="קצב" />);
    expect(html).toContain("--range-fill:50.00%");
    expect(html).toContain('aria-label="קצב"');
  });

  it("lights the deck while it runs, and says so", () => {
    const html = renderToStaticMarkup(<Deck running kicker="מטרונום">x</Deck>);
    expect(html).toContain('data-running="true"');
    expect(html).toContain("פועל");
    expect(renderToStaticMarkup(<Deck running={false}>x</Deck>)).toContain("עצור");
  });

  it("lists one ledger row per format", () => {
    const html = renderToStaticMarkup(
      <Ledger
        rows={[
          { id: "wav", format: "WAV", label: "הקלטה", size: "3.1MB", onClick: noop },
          { id: "mid", format: "MIDI", onClick: noop, disabled: true },
        ]}
      />,
    );
    expect(html).toContain("ledger downloads-card");
    expect(html.match(/class="ledger-row"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="הורדות"');
  });

  it("speaks a danger notice as an alert", () => {
    expect(renderToStaticMarkup(<Notice tone="danger">שגיאה</Notice>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Notice>הודעה</Notice>)).toContain('role="status"');
  });

  it("marks the current tab", () => {
    const html = renderToStaticMarkup(
      <Tabs
        label="תצוגות"
        value="sheet"
        items={[
          { id: "sheet", label: "תווים" },
          { id: "roll", label: "פסנתר" },
        ]}
      />,
    );
    expect(html).toContain('aria-current="true"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it("renders the figure left to right", () => {
    expect(renderToStaticMarkup(<Stat label="תווים" value={128} />)).toContain('<span class="stat-number" dir="ltr">128</span>');
  });

  it("renders nothing while a dialog is closed", () => {
    expect(renderToStaticMarkup(<Dialog open={false} onClose={noop} title="כותרת" />)).toBe("");
  });
});
