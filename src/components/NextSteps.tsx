import { ArrowLeft } from "lucide-react";
import type { CSSProperties } from "react";
import { findTool, type ToolDefinition } from "../lib/tools";

/**
 * The foot of a tool's page: the tools that usually come next, so finishing
 * one job leads straight into the one after it.
 */
export function NextSteps({ tool, onOpen }: { tool: ToolDefinition; onOpen: (id: string) => void }) {
  const next = tool.related.map(findTool).filter((item): item is ToolDefinition => Boolean(item));
  if (!next.length) return null;
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
