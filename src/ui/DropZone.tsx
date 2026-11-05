import { Upload } from "lucide-react";
import { forwardRef, useRef, useState, type DragEvent, type LabelHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type DropZoneProps = Omit<LabelHTMLAttributes<HTMLLabelElement>, "onDrop"> & {
  /** What the file input takes, e.g. "audio/*,video/*". */
  accept: string;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  /** Working on a file already: the zone waits. */
  busy?: boolean;
  /** The small line under the main one (formats, size). */
  hint?: ReactNode;
  icon?: ReactNode;
  /** The main line; a default invitation otherwise. */
  children?: ReactNode;
};

/**
 * Where a file comes in: drop it, or click to choose. A real native file
 * control sits over the visible label. That avoids the blocked
 * programmatic-click behaviour of mobile Safari, embedded browsers and
 * stricter content filters.
 */
export const DropZone = forwardRef<HTMLLabelElement, DropZoneProps>(function DropZone(
  { accept, onFiles, multiple = false, disabled = false, busy = false, hint, icon, className, children, ...rest },
  ref,
) {
  const [dragging, setDragging] = useState(false);
  // Entering a child fires dragleave on the parent; count the ins and outs
  // so the highlight does not flicker while the file moves across the text.
  const depth = useRef(0);
  const blocked = disabled || busy;

  const take = (list: FileList | null) => {
    if (!list || list.length === 0 || blocked) return;
    const files = Array.from(list);
    onFiles(multiple ? files : files.slice(0, 1));
  };

  const onDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (blocked) return;
    depth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };

  return (
    <label
      ref={ref}
      {...rest}
      className={cx("drop-zone", dragging && "is-dragging", className)}
      aria-disabled={blocked || undefined}
      aria-busy={busy || undefined}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = blocked ? "none" : "copy";
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        take(event.dataTransfer?.files ?? null);
      }}
    >
      <span className="upload-icon" aria-hidden="true">
        {icon ?? <Upload size={22} />}
      </span>
      {children ?? <strong>גררו קובץ לכאן או לחצו לבחירה</strong>}
      {hint != null && <span className="drop-zone-hint">{hint}</span>}
      <input
        className="native-file-input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={blocked}
        onChange={(event) => {
          take(event.target.files);
          // The same file chosen again should still count as a choice.
          event.target.value = "";
        }}
      />
    </label>
  );
});
