import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type StatProps = HTMLAttributes<HTMLDListElement> & {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
};

/** One figure: the number in mono, its unit, and what it counts. */
export const Stat = forwardRef<HTMLDListElement, StatProps>(function Stat(
  { label, value, unit, hint, className, ...rest },
  ref,
) {
  return (
    <dl ref={ref} {...rest} className={cx("stat", className)}>
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">
        <span className="stat-number" dir="ltr">
          {value}
        </span>
        {unit != null && <span className="stat-unit">{unit}</span>}
      </dd>
      {hint != null && <dd className="stat-hint">{hint}</dd>}
    </dl>
  );
});

export type StatGridProps = HTMLAttributes<HTMLDivElement> & {
  /** The narrowest a figure may get before the grid wraps (default 140px). */
  min?: number | string;
};

/** Figures side by side. */
export const StatGrid = forwardRef<HTMLDivElement, StatGridProps>(function StatGrid(
  { min, className, style, children, ...rest },
  ref,
) {
  const width = min == null ? undefined : typeof min === "number" ? `${min}px` : min;
  return (
    <div
      ref={ref}
      {...rest}
      className={cx("stat-grid", className)}
      style={width ? ({ ...style, "--stat-min": width } as CSSProperties) : style}
    >
      {children}
    </div>
  );
});
