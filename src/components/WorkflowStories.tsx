import { ArrowLeft } from "lucide-react";
import { memo, type CSSProperties, type FocusEvent } from "react";
import { findTool } from "../lib/tools";
import { WORKFLOWS } from "../lib/workflows";
import { SectionHead } from "./SectionHead";

/**
 * The routes: one panel per job, in a row that scrolls sideways and snaps —
 * what the route is for, its steps (each opening its tool, numbered in
 * order) and a button that starts at the first.
 */
export const WorkflowStories = memo(function WorkflowStories({
  onOpen,
  disabledTools,
}: {
  onOpen: (id: string) => void;
  /** Tools the admin area switched off: their steps stay in the route, but do not open. */
  disabledTools: string[];
}) {
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
    <section className="routes aura-flows" aria-labelledby="flows-title">
      <SectionHead id="flows-title" kicker="מסלולים" title="מסלולי עבודה">
        <p>כמה כלים ברצף למשימה אחת. כל שלב פותח את הכלי שלו.</p>
      </SectionHead>

      <ul className="routes-row" onFocus={bringIntoRow}>
        {flows.map((flow) => {
          const first = flow.steps[0].tool;
          const firstOff = disabledTools.includes(first.id);
          return (
            <li key={flow.id} className="route panel" style={{ "--accent-hue": flow.hue } as CSSProperties}>
              <h3>{flow.title}</h3>
              <p>{flow.description}</p>
              <ol className="route-steps">
                {flow.steps.map((step, stepIndex) => {
                  const off = disabledTools.includes(step.tool.id);
                  const Icon = step.tool.icon;
                  return (
                    <li key={step.tool.id} style={{ "--accent-hue": step.tool.hue } as CSSProperties}>
                      <button type="button" className="route-step" disabled={off} onClick={() => onOpen(step.tool.id)}>
                        <span className="route-step-num" aria-hidden="true">
                          {String(stepIndex + 1).padStart(2, "0")}
                        </span>
                        <span className="led" aria-hidden="true" />
                        <span className="route-step-icon" aria-hidden="true">
                          <Icon size={18} />
                        </span>
                        <span className="route-step-text">
                          <b>{step.label}</b>
                          <small>{off ? `${step.tool.title} · מכובה זמנית` : step.tool.title}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <button
                type="button"
                className="btn btn-primary btn-md route-start"
                disabled={firstOff}
                onClick={() => onOpen(first.id)}
                aria-label={`להתחיל את „${flow.title}”`}
              >
                להתחיל <ArrowLeft size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

/**
 * The routes are a row that scrolls sideways, and the browser counts the
 * next panel's peek as in sight: a step tabbed to there would stay off
 * screen, so its panel is brought in whole.
 */
function bringIntoRow(event: FocusEvent<HTMLUListElement>) {
  const row = event.currentTarget;
  if (row.scrollWidth <= row.clientWidth) return;
  (event.target as HTMLElement).closest(".route")?.scrollIntoView({ block: "nearest", inline: "start" });
}
