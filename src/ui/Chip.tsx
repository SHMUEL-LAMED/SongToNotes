import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type ChipTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
  icon?: ReactNode;
  /** A number after the text, in mono. */
  count?: ReactNode;
};

/** A small label: a status, a format, a badge. */
export const Chip = forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { tone = "neutral", icon, count, className, children, ...rest },
  ref,
) {
  return (
    <span ref={ref} {...rest} className={cx("chip", tone !== "neutral" && `chip-${tone}`, className)}>
      {icon}
      {children}
      {count != null && <span className="chip-count">{count}</span>}
    </span>
  );
});

export type ChipToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  tone?: ChipTone;
  icon?: ReactNode;
  count?: ReactNode;
  pressed: boolean;
  onChange?: (pressed: boolean) => void;
};

/** A chip that is a toggle (aria-pressed): a filter, a preset, an answer. */
export const ChipToggle = forwardRef<HTMLButtonElement, ChipToggleProps>(function ChipToggle(
  { tone = "neutral", icon, count, pressed, onChange, onClick, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cx("chip", "chip-toggle", tone !== "neutral" && `chip-${tone}`, pressed && "active", className)}
      aria-pressed={pressed}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange?.(!pressed);
      }}
    >
      {icon}
      {children}
      {count != null && <span className="chip-count">{count}</span>}
    </button>
  );
});
