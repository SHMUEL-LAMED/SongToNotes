import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type ReadoutProps = HTMLAttributes<HTMLDivElement> & {
  value: ReactNode;
  unit?: ReactNode;
  /** 56 / 30 / 18 / 12.5px. */
  size?: "xl" | "lg" | "md" | "sm";
  label?: ReactNode;
  /** Announce changes (aria-live) and set the value in the accent. */
  live?: boolean;
};

/** A number to read at a glance: mono, tabular, left to right. */
export const Readout = forwardRef<HTMLDivElement, ReadoutProps>(function Readout(
  { value, unit, size = "lg", label, live = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-live={live ? "polite" : undefined}
      {...rest}
      className={cx("readout", `readout-${size}`, live && "is-live", className)}
    >
      {label != null && <span className="readout-label">{label}</span>}
      <span className="readout-line">
        <span className="readout-value" dir="ltr">
          {value}
        </span>
        {unit != null && <span className="readout-unit">{unit}</span>}
      </span>
    </div>
  );
});
