import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

type Look = {
  /** 32 / 40 / 48px tall. */
  size?: "sm" | "md" | "lg";
  /** Set in the mono face (times, numbers, codes). */
  mono?: boolean;
};

function look(size: Look["size"], mono: boolean | undefined, className: string | undefined) {
  return cx("field", size && size !== "md" && `field-${size}`, mono && "field-mono", className);
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & Look;

/** A text, number or search box. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size, mono, className, ...rest },
  ref,
) {
  return <input ref={ref} {...rest} className={look(size, mono, className)} />;
});

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & Look;

/** A native select, in the field's look. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size, mono, className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} {...rest} className={look(size, mono, className)}>
      {children}
    </select>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Look;

/** A multi-line box. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size, mono, className, ...rest },
  ref,
) {
  return <textarea ref={ref} {...rest} className={look(size, mono, className)} />;
});
