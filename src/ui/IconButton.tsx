import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import type { ButtonSize } from "./Button";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** What the button does, said to screen readers and shown as its tooltip. */
  label: string;
  size?: ButtonSize;
  /** A toggle that is on: sets aria-pressed and the accent tint. */
  active?: boolean;
  tone?: "accent" | "warning" | "danger";
  /** The icon. */
  children: ReactNode;
};

/** A square button that is only an icon; the label is its name and title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active, tone, className, children, title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx("btn", "btn-ghost", "btn-icon", "icon-button", `btn-${size}`, tone && `btn-tone-${tone}`, active && "is-on", className)}
      aria-label={label}
      title={title ?? label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
});
