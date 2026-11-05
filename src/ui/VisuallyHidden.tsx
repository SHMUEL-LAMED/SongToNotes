import { forwardRef, type ElementType, type HTMLAttributes } from "react";
import { cx } from "./cx";

export type VisuallyHiddenProps = HTMLAttributes<HTMLElement> & { as?: ElementType };

/** Text for screen readers only (a live region, a label for an icon). */
export const VisuallyHidden = forwardRef<HTMLElement, VisuallyHiddenProps>(function VisuallyHidden(
  { as, className, ...rest },
  ref,
) {
  const Tag: ElementType = as ?? "span";
  return <Tag ref={ref} {...rest} className={cx("sr-only", className)} />;
});
