import { forwardRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { cx } from "./cx";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "checked"> & {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function Row({
  kind,
  label,
  hint,
  checked,
  onChange,
  className,
  inputRef,
  rest,
}: Omit<CheckboxProps, "ref"> & {
  kind: "checkbox" | "switch";
  inputRef: Ref<HTMLInputElement>;
  rest: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "checked">;
}) {
  return (
    <label className={cx("check-row", kind === "switch" && "switch-row", className)}>
      <input
        ref={inputRef}
        type="checkbox"
        role={kind === "switch" ? "switch" : undefined}
        {...rest}
        className={kind === "switch" ? "switch" : undefined}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="check-text">
        <span className="check-label">{label}</span>
        {hint != null && <small className="check-hint">{hint}</small>}
      </span>
    </label>
  );
}

/** A checkbox with its label (and an optional hint) as one 44px row. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, checked, onChange, className, ...rest },
  ref,
) {
  return (
    <Row
      kind="checkbox"
      label={label}
      hint={hint}
      checked={checked}
      onChange={onChange}
      className={className}
      inputRef={ref}
      rest={rest}
    />
  );
});

/** An on/off switch (36×20): a checkbox with role="switch", drawn. */
export const Switch = forwardRef<HTMLInputElement, CheckboxProps>(function Switch(
  { label, hint, checked, onChange, className, ...rest },
  ref,
) {
  return (
    <Row
      kind="switch"
      label={label}
      hint={hint}
      checked={checked}
      onChange={onChange}
      className={className}
      inputRef={ref}
      rest={rest}
    />
  );
});
