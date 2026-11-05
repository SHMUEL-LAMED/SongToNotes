import { X } from "lucide-react";
import { useId, useRef, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { useModal } from "./useModal";

export type DialogProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** 420 / 560 / 760px wide. */
  size?: "sm" | "md" | "lg";
  /** Buttons at the foot, end-aligned. */
  footer?: ReactNode;
  /** What takes focus on opening; the first control otherwise (the close button). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** The id of an element that names the dialog, instead of the title. */
  labelledBy?: string;
};

/**
 * A modal dialog, rendered into document.body: a scrim, a flat surface, the
 * title and a close button. Focus moves in and stays in (Tab cycles), Esc
 * and a press on the scrim close it, the page behind holds still, and focus
 * goes back to whatever opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = "md",
  footer,
  initialFocus,
  labelledBy,
  className,
  children,
  ...rest
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModal(open, panelRef, onClose, initialFocus);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        // A press that starts on the scrim closes; one that starts inside
        // and is dragged out (selecting text) does not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        aria-describedby={description != null ? descriptionId : undefined}
        tabIndex={-1}
        {...rest}
        className={cx("dialog", `dialog-${size}`, className)}
      >
        <div className="dialog-head">
          <h2 className="dialog-title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-icon icon-button dialog-close" onClick={onClose} aria-label="סגירה" title="סגירה">
            <X size={18} />
          </button>
        </div>
        {description != null && (
          <p className="dialog-description" id={descriptionId}>
            {description}
          </p>
        )}
        <div className="dialog-body">{children}</div>
        {footer != null && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
