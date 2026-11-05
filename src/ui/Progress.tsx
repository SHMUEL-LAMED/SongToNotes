import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  /** 0–1; left out, the bar is indeterminate (a segment that keeps running). */
  value?: number;
  label?: ReactNode;
  /** A line under the bar: what is happening, how long it may take. */
  detail?: ReactNode;
};

/** A 4px bar with its label above and the percentage, in mono, at the end. */
export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { value, label, detail, className, ...rest },
  ref,
) {
  const known = typeof value === "number" && Number.isFinite(value);
  const percent = known ? Math.round(Math.min(1, Math.max(0, value)) * 100) : undefined;
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={typeof label === "string" ? label : undefined}
      {...rest}
      className={cx("progress", !known && "is-indeterminate", className)}
    >
      {(label != null || known) && (
        <div className="progress-label">
          <span>{label}</span>
          {known && (
            <span className="progress-value" dir="ltr">
              {percent}%
            </span>
          )}
        </div>
      )}
      <div className={cx("progress-track", !known && "indeterminate")}>
        <div className="progress-bar" style={known ? { width: `${percent}%` } : undefined} />
      </div>
      {detail != null && <p className="progress-detail">{detail}</p>}
    </div>
  );
});
