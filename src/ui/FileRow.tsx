import { FileAudio, X } from "lucide-react";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { IconButton } from "./IconButton";

export type FileRowProps = HTMLAttributes<HTMLDivElement> & {
  name: ReactNode;
  /** Length, size, format — one line under the name. */
  meta?: ReactNode;
  icon?: ReactNode;
  onReplace?: () => void;
  onClear?: () => void;
  /** More at the end of the row (a player, a note). */
  children?: ReactNode;
};

/** The chosen file: its mark, its name and details, and what to do with it. */
export const FileRow = forwardRef<HTMLDivElement, FileRowProps>(function FileRow(
  { name, meta, icon, onReplace, onClear, className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx("file-row", "selected-file", className)}>
      <span className="file-icon" aria-hidden="true">
        {icon ?? <FileAudio size={20} />}
      </span>
      <div className="file-details">
        <strong title={typeof name === "string" ? name : undefined}>{name}</strong>
        {meta != null && <span>{meta}</span>}
      </div>
      {children}
      {(onReplace || onClear) && (
        <div className="file-actions">
          {onReplace && (
            <Button size="sm" onClick={onReplace}>
              החלפה
            </Button>
          )}
          {onClear && (
            <IconButton label="הסר קובץ" onClick={onClear}>
              <X size={18} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
});
