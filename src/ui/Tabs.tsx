import { useRef, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import { useThumb } from "./useThumb";

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  /** A tab with an address of its own is a link. */
  href?: string;
  /** The tab's own hue, shown on hover. */
  hue?: number;
};

export type TabsProps<T extends string> = Omit<HTMLAttributes<HTMLElement>, "onChange"> & {
  items: TabItem<T>[];
  value: T;
  onChange?: (id: T) => void;
  /** Names the navigation for screen readers. */
  label: string;
  ref?: Ref<HTMLElement>;
};

/**
 * Underline tabs: the current one in ink, with a 2px line in the accent that
 * slides to it (measured). A tab with `href` is a link — a plain click still
 * goes through `onChange` when there is one, a modified click opens it
 * elsewhere as links do.
 */
export function Tabs<T extends string>({ items, value, onChange, label, className, ref, ...rest }: TabsProps<T>) {
  const navRef = useRef<HTMLElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  useThumb(navRef, thumbRef, ':scope > [aria-current]:not([aria-current="false"])', "tab", `${value}|${items.length}`);

  return (
    <nav
      ref={(node) => {
        navRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      aria-label={label}
      {...rest}
      className={cx("tabs", className)}
    >
      <span ref={thumbRef} className="tabs-thumb" aria-hidden="true" />
      {items.map((item) => {
        const active = item.id === value;
        const style = item.hue != null ? ({ "--accent-hue": item.hue } as CSSProperties) : undefined;
        if (item.href) {
          return (
            <a
              key={item.id}
              href={item.href}
              className={cx("tab", active && "is-active")}
              aria-current={active ? "page" : undefined}
              style={style}
              onClick={(event) => {
                if (!onChange) return;
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                onChange(item.id);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            className={cx("tab", active && "is-active")}
            aria-current={active ? "true" : undefined}
            style={style}
            onClick={() => onChange?.(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
