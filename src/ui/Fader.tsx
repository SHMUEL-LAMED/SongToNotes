import { forwardRef, type CSSProperties, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

export type FaderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max" | "step"> & {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** What the fader sets, for screen readers. */
  label: string;
  /** A mixer channel: standing up, its bottom the minimum. */
  vertical?: boolean;
  /** How the value is read out (aria-valuetext), e.g. `${v} BPM`. */
  format?: (value: number) => string;
};

/**
 * A range input in the fader's look. It hands its own share to the
 * stylesheet as `--range-fill`, which draws the travelled part (Firefox
 * draws it itself).
 */
export const Fader = forwardRef<HTMLInputElement, FaderProps>(function Fader(
  { min, max, step = 1, value, onChange, label, vertical = false, format, className, style, ...rest },
  ref,
) {
  const span = max - min;
  const share = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  return (
    <input
      ref={ref}
      type="range"
      {...rest}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      aria-label={rest["aria-label"] ?? label}
      aria-valuetext={format ? format(value) : rest["aria-valuetext"]}
      aria-orientation={vertical ? "vertical" : undefined}
      className={cx("fader", vertical && "is-vertical", className)}
      style={{ ...style, "--range-fill": `${(share * 100).toFixed(2)}%` } as CSSProperties}
    />
  );
});
