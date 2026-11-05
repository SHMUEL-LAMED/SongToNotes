import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type SectionHeadProps = Omit<HTMLAttributes<HTMLElement>, "title" | "id"> & {
  /** The heading's id, for the section's aria-labelledby. */
  id: string;
  /** A small label above the title. */
  kicker?: ReactNode;
  title: ReactNode;
  /** The lead under the title. */
  children?: ReactNode;
  /** Controls at the end (a link to all, a clear button). */
  actions?: ReactNode;
};

/** The head of a page section: kicker, title, a line of lead, actions. */
export const SectionHead = forwardRef<HTMLElement, SectionHeadProps>(function SectionHead(
  { id, kicker, title, actions, className, children, ...rest },
  ref,
) {
  return (
    <header ref={ref} {...rest} className={cx("section-head", "aura-head", className)}>
      <div className="section-head-text">
        {kicker != null && <p className="section-kicker">{kicker}</p>}
        <h2 id={id}>{title}</h2>
        {children != null && <div className="section-lead">{children}</div>}
      </div>
      {actions != null && <div className="section-actions">{actions}</div>}
    </header>
  );
});
