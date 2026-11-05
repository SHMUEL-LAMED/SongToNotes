import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type FieldProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  label: ReactNode;
  hint?: ReactNode;
  /** The current value, shown in mono at the end of the label row. */
  value?: ReactNode;
  error?: ReactNode;
  /** Label at the start and the control at the end, on one line. */
  inline?: boolean;
  /** The id of the control; without it the field wraps the control in a <label>. */
  htmlFor?: string;
  /**
   * The control is a group of buttons (a Segmented, chips): the field is a
   * <div>, since a <label> around buttons would press the first one when
   * its text is clicked. The group names itself.
   */
  group?: boolean;
};

/** A labelled control: the label with its value, the control, a hint or an error. */
export const Field = forwardRef<HTMLElement, FieldProps>(function Field(
  { label, hint, value, error, inline = false, htmlFor, group = false, className, children, ...rest },
  ref,
) {
  const wraps = !htmlFor && !group;
  const Root = wraps ? "label" : "div";
  return (
    <Root
      ref={ref as never}
      {...rest}
      className={cx("field-row", inline && "is-inline", error != null && "has-error", className)}
    >
      <span className="field-head">
        {htmlFor ? (
          <label className="field-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="field-label">{label}</span>
        )}
        {value != null && (
          <b className="field-value" dir="ltr">
            {value}
          </b>
        )}
      </span>
      <span className="field-control">{children}</span>
      {error != null ? (
        <small className="field-error" role="alert">
          {error}
        </small>
      ) : (
        hint != null && <small className="field-hint">{hint}</small>
      )}
    </Root>
  );
});

export type FieldGridProps = HTMLAttributes<HTMLDivElement> & {
  /** The narrowest a column may get before the grid wraps (default 220px). */
  min?: number | string;
};

/** Fields side by side, as many columns as fit. */
export const FieldGrid = forwardRef<HTMLDivElement, FieldGridProps>(function FieldGrid(
  { min, className, style, children, ...rest },
  ref,
) {
  const width = min == null ? undefined : typeof min === "number" ? `${min}px` : min;
  return (
    <div
      ref={ref}
      {...rest}
      className={cx("field-grid", className)}
      style={width ? ({ ...style, "--field-min": width } as CSSProperties) : style}
    >
      {children}
    </div>
  );
});
