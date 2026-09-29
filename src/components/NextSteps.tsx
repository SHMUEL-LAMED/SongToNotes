import { ArrowLeft } from "lucide-react";
import type { CSSProperties } from "react";
import { familyOf, findTool, type ToolDefinition } from "../lib/tools";
import { SendFileSection } from "./SendFile";

/**
 * The foot of a tool's page: the tools that usually come next, so finishing
 * one job leads straight into the one after it.
 */
export function NextSteps({
  tool,
  onOpen,
  disabledTools = [],
}: {
  tool: ToolDefinition;
  onOpen: (id: string) => void;
  disabledTools?: readonly string[];
}) {
  // The other tabs of this tool are already one click away at the top.
  const family = familyOf(tool.id);
  const next = tool.related
    .map(findTool)
    .filter((item): item is ToolDefinition => Boolean(item) && !family?.tabs.some((tab) => tab.id === item!.id));
  return (
    <>
      <SendFileSection disabledTools={disabledTools} />
      {next.length > 0 && <RelatedTools next={next} onOpen={onOpen} />}
    </>
  );
}

function RelatedTools({ next, onOpen }: { next: ToolDefinition[]; onOpen: (id: string) => void }) {
  return (
    <section className="next-steps" aria-labelledby="next-steps-title">
      <div className="next-steps-head">
        <h2 id="next-steps-title">ממשיכים מכאן</h2>
        <button type="button" className="ghost-button" onClick={() => onOpen("home")}>
          כל הכלים <ArrowLeft size={14} />
        </button>
      </div>
      <div className="next-steps-grid">
        {next.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className="next-step"
              style={{ "--accent-hue": item.hue } as CSSProperties}
              onClick={() => onOpen(item.id)}
            >
              <span className="next-step-icon">
                <Icon size={18} />
              </span>
              <span className="next-step-text">
                <b>{item.title}</b>
                <small>{item.tagline}</small>
              </span>
              <ArrowLeft size={16} className="next-step-go" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
