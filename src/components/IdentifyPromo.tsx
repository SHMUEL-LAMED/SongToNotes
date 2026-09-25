import { ArrowLeft, Disc3, X } from "lucide-react";
import type { CSSProperties } from "react";
import { currentLang } from "../lib/i18n";
import { findAnyTool } from "../lib/tools";

/**
 * The invitation to the song identifier: one line about what it does, and the
 * whole card is the way in. Like the request to share, it never takes the
 * focus or dims the page. Its words are written in both languages here, since
 * switching the language reloads the page and this card is rarely on screen.
 */
export function IdentifyPromo({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  const hue = findAnyTool("identify")?.hue ?? 276;
  const english = currentLang() === "en";

  return (
    <div
      className="app-notice identify-promo"
      role="status"
      style={{ "--accent-hue": hue } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button type="button" className="identify-promo-open" onClick={onOpen}>
        <span className="app-notice-icon identify-promo-icon" aria-hidden="true">
          <Disc3 size={18} />
        </span>
        <span className="identify-promo-text">
          {english ? (
            <>
              <strong>Heard a song and can't name it?</strong> The song identifier listens for a few seconds — from
              the microphone or a file — and tells you the title and the artist.
            </>
          ) : (
            <>
              <strong>שמעתם שיר ולא יודעים מה שמו?</strong> מזהה השיר מקשיב כמה שניות — מהמיקרופון או מקובץ —
              ומגלה לכם את שם השיר והאמן.
            </>
          )}
        </span>
        <span className="identify-promo-go">
          {english ? "Try it now" : "לנסות עכשיו"} <ArrowLeft size={15} aria-hidden="true" />
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
