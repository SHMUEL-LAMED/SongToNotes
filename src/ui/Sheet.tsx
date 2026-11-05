import { X } from "lucide-react";
import { useId, useRef, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { useModal } from "./useModal";

export type SheetProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  labelledBy?: string;
  /** Where it slides in from: the bottom (a phone's sheet) or a side. */
  side?: "bottom" | "inline-start" | "inline-end";
  /** The bottom sheet's height, or a side sheet's width (a number is px). */
  height?: number | string;
};

/**
 * A panel that slides over the page from an edge, with everything a dialog
 * does: focus moves in and stays in, Esc and the scrim close it, the page
 * holds still, focus goes back where it was.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  footer,
  initialFocus,
  labelledBy,
  side = "bottom",
  height,
  className,
  style,
  children,
  ...rest
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModal(open, panelRef, onClose, initialFocus);

  if (!open || typeof document === "undefined") return null;
  const size = height == null ? undefined : typeof height === "number" ? `${height}px` : height;

  return createPortal(
    <div
      className="sheet-overlay"
      role="presentation"
      onMouseDown={(event) => {
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
        data-side={side}
        className={cx("sheet", className)}
        style={size ? ({ ...style, "--sheet-h": size } as CSSProperties) : style}
      >
        {side === "bottom" && <span className="sheet-handle" aria-hidden="true" />}
        <div className="sheet-head">
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-icon icon-button dialog-close" onClick={onClose} aria-label="סגירה" title="סגירה">
            <X size={18} />
          </button>
        </div>
        <div className="sheet-body">
          {description != null && (
            <p className="dialog-description" id={descriptionId}>
              {description}
            </p>
          )}
          {children}
        </div>
        {footer != null && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
