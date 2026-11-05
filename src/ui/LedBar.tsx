import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import { cx } from "./cx";

export type LedBarProps = HTMLAttributes<HTMLSpanElement> & {
  /** The hue to light in; the surrounding accent otherwise. */
  hue?: number;
  /** Lit: full strength, with the glow. */
  on?: boolean;
};

/** A 3×14 LED bar: marks a tool in its own hue (navigation, lists). */
export const LedBar = forwardRef<HTMLSpanElement, LedBarProps>(function LedBar(
  { hue, on = false, className, style, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      aria-hidden="true"
      {...rest}
      className={cx("led", on && "is-on", className)}
      style={hue != null ? ({ ...style, "--accent-hue": hue } as CSSProperties) : style}
    />
  );
});
