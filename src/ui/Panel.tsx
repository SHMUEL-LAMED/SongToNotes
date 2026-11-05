import { forwardRef, useId, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type PanelProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** inset: a well, no lip; result: the accent's 2px edge on top. */
  tone?: "default" | "inset" | "result";
  padding?: "md" | "sm" | "none";
  title?: ReactNode;
  hint?: ReactNode;
  /** The panel's mark, on a 28px tile in the tool's colour. */
  icon?: ReactNode;
  /** Controls at the end of the head. */
  actions?: ReactNode;
  /** Whether the panel takes a numeral in the page's margin (default true). */
  step?: boolean;
  as?: ElementType;
};

/**
 * A working area of a page: a flat surface with a hairline and a head (mark,
 * title, hint, actions). Panels do not nest; subdivide one with
 * PanelSection.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { tone = "default", padding = "md", title, hint, icon, actions, step = true, as, className, children, ...rest },
  ref,
) {
  const Tag: ElementType = as ?? "section";
  const titleId = useId();
  const named = title != null && rest["aria-label"] == null && rest["aria-labelledby"] == null;
  const hasHead = title != null || hint != null || icon != null || actions != null;
  return (
    <Tag
      ref={ref}
      {...rest}
      aria-labelledby={named ? titleId : rest["aria-labelledby"]}
      className={cx(
        "panel",
        tone === "inset" && "panel-inset",
        tone === "result" && "panel-result",
        padding !== "md" && `panel-pad-${padding}`,
        className,
      )}
    >
      {step && <span className="panel-num" aria-hidden="true" />}
      {hasHead && (
        <div className="panel-head">
          {icon != null && (
            <span className="panel-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          {(title != null || hint != null) && (
            <div className="panel-heading">
              {title != null && (
                <h2 className="panel-title" id={titleId}>
                  {title}
                </h2>
              )}
              {hint != null && <p className="panel-hint">{hint}</p>}
            </div>
          )}
          {actions != null && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </Tag>
  );
});

export type PanelSectionProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title?: ReactNode;
  hint?: ReactNode;
};

/** A hairline subdivision of a panel, with an optional small head. */
export const PanelSection = forwardRef<HTMLDivElement, PanelSectionProps>(function PanelSection(
  { title, hint, className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx("panel-section", className)}>
      {(title != null || hint != null) && (
        <div className="panel-section-head">
          {title != null && <h3 className="panel-section-title">{title}</h3>}
          {hint != null && <p className="panel-section-hint">{hint}</p>}
        </div>
      )}
      {children}
    </div>
  );
});
