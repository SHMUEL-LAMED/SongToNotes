import type { ReactNode } from "react";

/**
 * The head of a section on the home page: a small label, the title, a line
 * under it and, at the end, what the section offers to do. The title carries
 * the id the section is labelled by.
 */
export function SectionHead({
  id,
  kicker,
  title,
  children,
  actions,
}: {
  id: string;
  kicker?: string;
  title: string;
  /** The lead: a short paragraph under the title. */
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="section-head aura-head">
      <div className="section-head-copy">
        {kicker && <p className="section-kicker">{kicker}</p>}
        <h2 id={id}>{title}</h2>
        {children && <div className="section-lead">{children}</div>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </header>
  );
}
