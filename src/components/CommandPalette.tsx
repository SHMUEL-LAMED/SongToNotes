import { Command, CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Ctrl+K: one box that reaches everything — a tool, a saved work, a page —
 * for the visitor who would rather type than hunt. The list is handed in by
 * whoever opens it, so the palette knows nothing about the site; it only
 * filters and picks.
 */

export type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: ReactNode;
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? items.filter((item) =>
          `${item.label} ${item.hint ?? ""} ${item.group} ${item.keywords ?? ""}`.toLowerCase().includes(needle),
        )
      : items;
    return list.slice(0, 40);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const pick = (item: CommandItem) => {
    onClose();
    setQuery("");
    setCursor(0);
    item.run();
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(shown.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = shown[Math.min(cursor, shown.length - 1)];
      if (item) pick(item);
    }
  };

  return (
    <div className="palette-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="חיפוש מהיר"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKey}
      >
        <label className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="כלי, עבודה שמורה או פעולה…"
            aria-label="חיפוש"
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" role="listbox">
          {shown.length === 0 && <li className="palette-empty">לא נמצא כלום.</li>}
          {shown.map((item, index) => {
            const heading = index === 0 || shown[index - 1].group !== item.group ? item.group : null;
            return (
              <li key={item.id} role="presentation">
                {heading && <p className="palette-group">{heading}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={`palette-item ${index === cursor ? "is-active" : ""}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => pick(item)}
                >
                  <span className="palette-icon">{item.icon ?? <Command size={15} />}</span>
                  <span className="palette-text">
                    <span>{item.label}</span>
                    {item.hint && <small>{item.hint}</small>}
                  </span>
                  {index === cursor && <CornerDownLeft size={14} className="palette-enter" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="palette-foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd> ניווט · <kbd>Enter</kbd> בחירה · <kbd>Ctrl</kbd>+<kbd>K</kbd> פתיחה מכל מקום
        </p>
      </div>
    </div>
  );
}
