import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { forwardRef, type AriaRole, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type NoticeTone = "info" | "success" | "warning" | "danger";

export type NoticeProps = HTMLAttributes<HTMLDivElement> & {
  tone?: NoticeTone;
  /** Replaces the tone's icon; `null` shows none. */
  icon?: ReactNode;
  /** A button (or two) at the end. */
  action?: ReactNode;
  /** Shows a close button. */
  onClose?: () => void;
  /** Defaults to "alert" for danger, "status" otherwise. */
  role?: AriaRole;
};

const ICONS: Record<NoticeTone, ReactNode> = {
  info: <Info size={16} />,
  success: <CircleCheck size={16} />,
  warning: <TriangleAlert size={16} />,
  danger: <CircleAlert size={16} />,
};

/** A message in a panel: a 3px bar in the tone's colour, its icon, the text. */
export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  { tone = "info", icon, action, onClose, role, className, children, ...rest },
  ref,
) {
  const mark = icon === undefined ? ICONS[tone] : icon;
  return (
    <div
      ref={ref}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      {...rest}
      className={cx("notice", `notice-${tone}`, className)}
    >
      {mark != null && mark !== false && (
        <span className="notice-icon" aria-hidden="true">
          {mark}
        </span>
      )}
      <div className="notice-body">{children}</div>
      {action != null && <div className="notice-action">{action}</div>}
      {onClose && (
        <button type="button" className="notice-close" onClick={onClose} aria-label="סגירת ההודעה">
          <X size={16} />
        </button>
      )}
    </div>
  );
});
