import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "./cx";

/** A key on the keyboard, as a keycap (always left to right). */
export const Kbd = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function Kbd({ className, ...rest }, ref) {
  return <kbd ref={ref} {...rest} className={cx("kbd", className)} />;
});
