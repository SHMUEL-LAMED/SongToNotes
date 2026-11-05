import { LoaderCircle } from "lucide-react";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type Common = {
  /** primary: the one accent fill in a panel; secondary (default): outlined. */
  variant?: ButtonVariant;
  /** 32 / 40 / 48px tall. */
  size?: ButtonSize;
  icon?: ReactNode;
  /** A square button with only the icon; it needs an `aria-label`. */
  iconOnly?: boolean;
  /** Shows a spinner in place of the icon and blocks the button. */
  loading?: boolean;
  /** A toggle: sets aria-pressed. */
  pressed?: boolean;
  className?: string;
  children?: ReactNode;
};

type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof Common> & { as?: "button" };
type AsAnchor = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof Common> & { as: "a" };
export type ButtonProps = AsButton | AsAnchor;

/**
 * The button. `type="button"` unless told otherwise, so one inside a form
 * never submits it by accident; `as="a"` renders a link that looks the same.
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  const {
    variant = "secondary",
    size = "md",
    icon,
    iconOnly = false,
    loading = false,
    pressed,
    className,
    children,
    as,
    ...rest
  } = props;

  const classes = cx(
    "btn",
    `btn-${variant}`,
    `btn-${size}`,
    iconOnly && "btn-icon",
    loading && "is-loading",
    className,
  );
  const mark = loading ? <LoaderCircle size={size === "lg" ? 20 : size === "sm" ? 16 : 18} className="spin" aria-hidden="true" /> : icon;
  const content = (
    <>
      {mark}
      {iconOnly ? children != null && <span className="sr-only">{children}</span> : children}
    </>
  );

  if (as === "a") {
    const anchor = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a
        ref={ref as Ref<HTMLAnchorElement>}
        {...anchor}
        className={classes}
        aria-pressed={pressed}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
      >
        {content}
      </a>
    );
  }

  const button = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      {...button}
      className={classes}
      disabled={button.disabled || loading}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
    >
      {content}
    </button>
  );
});
