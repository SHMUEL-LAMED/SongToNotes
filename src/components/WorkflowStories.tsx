import { ArrowLeft } from "lucide-react";
import { memo, type CSSProperties, type FocusEvent } from "react";
import { findTool, type ToolDefinition } from "../lib/tools";
import { useIdleOffscreen } from "../lib/useIdleOffscreen";
import { WORKFLOWS } from "../lib/workflows";
import { SectionHead } from "./SectionHead";

/**
 * The guided routes, one card per job: a cover with its number and its
 * tools' marks, what it is for, and its steps, each opening its tool. A grid
 * where there is room; on a phone a row that scrolls sideways and snaps.
 */
export const WorkflowStories = memo(function WorkflowStories({
  onOpen,
  disabledTools,
}: {
  onOpen: (id: string) => void;
  /** Tools the admin area switched off: their steps stay in the route, but do not open. */
  disabledTools: string[];
}) {
  const idle = useIdleOffscreen<HTMLUListElement>();
  // A step whose tool is hidden drops out and the rest are numbered without
  // it; a route with no step left drops out the same way.
  const flows = WORKFLOWS.map((flow) => ({
    ...flow,
    steps: flow.steps.flatMap((step) => {
      const tool = findTool(step.tool);
      return tool ? [{ ...step, tool }] : [];
    }),
  })).filter((flow) => flow.steps.length > 0);
  if (flows.length === 0) return null;

  return (
    <section className="aura-section" aria-labelledby="flows-title">
      <SectionHead id="flows-title" eyebrow="מסלולים" title="מסלולי עבודה">
        <p>כמה כלים ברצף למשימה אחת. כל שלב פותח את הכלי שלו.</p>
      </SectionHead>

      <ul className="aura-flows" ref={idle} onFocus={bringIntoRow}>
        {flows.map((flow, index) => (
          <li key={flow.id} className="aura-flow" style={{ "--accent-hue": flow.hue, "--i": index } as CSSProperties}>
            <div className="aura-flow-cover" aria-hidden="true">
              <span className="aura-flow-num">{String(index + 1).padStart(2, "0")}</span>
              <Collage tools={flow.steps.map((step) => step.tool)} />
            </div>
            <h3>{flow.title}</h3>
            <p>{flow.description}</p>
            <ol className="aura-flow-steps">
              {flow.steps.map((step, stepIndex) => {
                const off = disabledTools.includes(step.tool.id);
                return (
                  <li key={step.tool.id} style={{ "--accent-hue": step.tool.hue } as CSSProperties}>
                    <button type="button" disabled={off} onClick={() => onOpen(step.tool.id)}>
                      <span className="aura-step-mark" aria-hidden="true">
                        <span className="aura-step-num">{stepIndex + 1}</span>
                        <span className="aura-step-arrow">
                          <ArrowLeft size={16} />
                        </span>
                      </span>
                      <span className="aura-step-text">
                        <b>{step.label}</b>
                        <small>{off ? `${step.tool.title} · מכובה זמנית` : step.tool.title}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
});

/**
 * On a phone the routes are a row that scrolls sideways, and the browser
 * counts the next card's peek as in sight: a step tabbed to there would
 * stay off screen, so its card is brought in whole.
 */
function bringIntoRow(event: FocusEvent<HTMLUListElement>) {
  const row = event.currentTarget;
  if (row.scrollWidth <= row.clientWidth) return;
  (event.target as HTMLElement).closest(".aura-flow")?.scrollIntoView({ block: "nearest", inline: "start" });
}

/**
 * The route's tools as a folder of four marks, each in its own colour. Two
 * sit across the diagonal; the slots nobody fills stay as faint glass.
 */
function Collage({ tools }: { tools: ToolDefinition[] }) {
  const slots = tools.length === 2 ? [tools[0], null, null, tools[1]] : [0, 1, 2, 3].map((at) => tools[at] ?? null);
  return (
    <span className="aura-flow-collage">
      {slots.map((tool, at) => {
        if (!tool) return <span key={at} className="is-empty" />;
        const Icon = tool.icon;
        return (
          <span key={at} style={{ "--accent-hue": tool.hue } as CSSProperties}>
            <Icon size={17} />
          </span>
        );
      })}
    </span>
  );
}
