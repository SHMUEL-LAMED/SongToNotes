import { useRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import { useThumb } from "./useThumb";

export type SegmentedOption<T extends string> = {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type SegmentedProps<T extends string> = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the group for screen readers. */
  label: string;
  /** Let the options wrap onto more lines. */
  wrap?: boolean;
  size?: "sm" | "md";
  ref?: Ref<HTMLDivElement>;
};

/**
 * One choice among a few, as a row of buttons with aria-pressed. A thumb
 * slides under the pressed one, measured rather than computed.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  wrap = false,
  size = "md",
  className,
  ref,
  ...rest
}: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  useThumb(groupRef, thumbRef, ':scope > button[aria-pressed="true"]', "seg", `${value}|${options.length}|${wrap}`);

  return (
    <div
      ref={(node) => {
        groupRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      role="group"
      aria-label={label}
      {...rest}
      className={cx("segmented", wrap && "wrap", size === "sm" && "segmented-sm", className)}
    >
      <span ref={thumbRef} className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            className={on ? "active" : undefined}
            aria-pressed={on}
            disabled={option.disabled}
            onClick={() => {
              if (!on) onChange(option.id);
            }}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
