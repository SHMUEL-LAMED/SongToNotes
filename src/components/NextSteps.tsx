import { ArrowLeft, Compass } from "lucide-react";
import type { CSSProperties } from "react";
import { familyOf, findTool, type ToolDefinition } from "../lib/tools";
import { SendFileSection } from "./SendFile";

/**
 * The foot of a tool's page: carrying the file on, then the tools that
 * usually come next, so finishing one job leads straight into the one after
 * it.
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
      {next.length > 0 && <RelatedTools next={next.slice(0, 3)} onOpen={onOpen} />}
    </>
  );
}

/** Up to three related tools, as ruled columns: what each one is, one tap away. */
function RelatedTools({ next, onOpen }: { next: ToolDefinition[]; onOpen: (id: string) => void }) {
  return (
    <section className="panel next-steps" aria-labelledby="next-steps-title">
      <header className="panel-head next-steps-head">
        <span className="panel-num" aria-hidden="true" />
        <span className="panel-icon" aria-hidden="true">
          <Compass size={16} />
        </span>
        <div className="panel-heading">
          <h2 className="panel-title" id="next-steps-title">
            ממשיכים מכאן
          </h2>
          <p className="panel-hint">הכלים שבדרך כלל באים אחרי הכלי הזה.</p>
        </div>
        <div className="panel-actions">
          <button type="button" className="ghost-button" onClick={() => onOpen("home")}>
            כל הכלים <ArrowLeft size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
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
              <span className="next-step-icon" aria-hidden="true">
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
