import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type DeckProps = HTMLAttributes<HTMLElement> & {
  /** Whether the instrument is playing; lights the deck's LED. */
  running?: boolean;
  /** The small line at the head, e.g. "מטרונום · 4/4". */
  kicker?: ReactNode;
  /** The word beside the LED; defaults to "פועל" / "עצור". */
  liveLabel?: ReactNode;
  /** Controls at the end of the head. */
  actions?: ReactNode;
  as?: ElementType;
};

/**
 * An instrument's surface: a near-black plate in both themes whose children
 * read LED-coloured tokens. The head carries a kicker and, when `running` is
 * given, an LED with the word for its state.
 */
export const Deck = forwardRef<HTMLElement, DeckProps>(function Deck(
  { running, kicker, liveLabel, actions, as, className, children, ...rest },
  ref,
) {
  const Tag: ElementType = as ?? "section";
  const hasHead = kicker != null || running !== undefined || actions != null;
  return (
    <Tag
      ref={ref}
      {...rest}
      className={cx("deck", className)}
      data-running={running === undefined ? undefined : running ? "true" : "false"}
    >
      {hasHead && (
        <div className="deck-head">
          {kicker != null && <span className="deck-kicker">{kicker}</span>}
          <span className="deck-status">
            {running !== undefined && (
              <>
                <span className="deck-led" aria-hidden="true" />
                <span className="deck-live">{liveLabel ?? (running ? "פועל" : "עצור")}</span>
              </>
            )}
            {actions != null && <span className="deck-actions">{actions}</span>}
          </span>
        </div>
      )}
      <div className="deck-body">{children}</div>
    </Tag>
  );
});
