import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  icon: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  actions?: ReactNode;
};

/** What a place says while it has nothing in it, and how to fill it. */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, text, actions, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx("empty", className)}>
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="empty-title">{title}</p>
      {text != null && <p className="empty-text">{text}</p>}
      {actions != null && <div className="empty-actions">{actions}</div>}
    </div>
  );
});
