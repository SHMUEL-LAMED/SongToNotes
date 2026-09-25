import { ArrowLeft, X } from "lucide-react";
import type { CSSProperties } from "react";
import { currentLang } from "../lib/i18n";
import type { ToolPromoSpec } from "../lib/toolPromo";
import { findAnyTool } from "../lib/tools";

/**
 * An invitation to one tool: a line about what it does, in the tool's own
 * colour and icon, and the whole card is the way in. Like the request to
 * share, it never takes the focus or dims the page. Its words are written in
 * both languages, since switching the language reloads the page anyway.
 */
export function ToolPromo({
  promo,
  onOpen,
  onClose,
}: {
  promo: ToolPromoSpec;
  onOpen: () => void;
  onClose: () => void;
}) {
  const tool = findAnyTool(promo.tool);
  const english = currentLang() === "en";
  const words = english ? promo.en : promo.he;
  const Icon = tool?.icon;

  return (
    <div
      className="app-notice tool-promo"
      role="status"
      style={{ "--accent-hue": tool?.hue ?? 292 } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button type="button" className="tool-promo-open" onClick={onOpen}>
        <span className="app-notice-icon tool-promo-icon" aria-hidden="true">
          {Icon && <Icon size={18} />}
        </span>
        <span className="tool-promo-text">
          <strong>{words.title}</strong> {words.text}
        </span>
        <span className="tool-promo-go">
          {words.cta} <ArrowLeft size={15} aria-hidden="true" />
        </span>
      </button>
      <button
        type="button"
        className="app-notice-close"
        onClick={onClose}
        aria-label={english ? "Not now" : "לא עכשיו"}
        title={english ? "Not now" : "לא עכשיו"}
      >
        <X size={15} />
      </button>
    </div>
  );
}
