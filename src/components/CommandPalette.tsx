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

/** The most the list shows at once. */
const LIMIT = 40;

/**
 * Orders the items for a query: a match in the name beats one in the hint or
 * the keywords, and a name that starts with the query — or has a word that
 * does — beats one that only contains it. Every word of the query has to be
 * found somewhere, so "מכוון גיטרה" finds the tuner by its name and its
 * keywords together. The group's own heading is not searched, or "פים"
 * would find every page.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function rankCommands(items: CommandItem[], query: string): CommandItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, LIMIT);
  const needle = words.join(" ");
  const rank = (item: CommandItem) => {
    const label = item.label.toLowerCase();
    const rest = `${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase();
    if (!words.every((word) => label.includes(word) || rest.includes(word))) return -1;
    if (label.startsWith(needle)) return 0;
    if (label.split(/[\s\-־–—/·,]+/).some((part) => part.startsWith(needle))) return 1;
    if (label.includes(needle)) return 2;
    // Every word in the name, if not side by side.
    if (words.every((word) => label.includes(word))) return 3;
    return words.some((word) => label.includes(word)) ? 4 : 5;
  };
  const groups = [...new Set(items.map((item) => item.group))];
  return items
    .map((item, index) => ({ item, index, score: rank(item) }))
    .filter((entry) => entry.score >= 0)
    .sort(
      (a, b) =>
        a.score - b.score ||
        groups.indexOf(a.item.group) - groups.indexOf(b.item.group) ||
        a.index - b.index,
    )
    .map((entry) => entry.item)
    .slice(0, LIMIT);
}

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
  const listRef = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => rankCommands(items, query), [items, query]);

  // Every opening starts afresh: closing with Esc or a click outside used to
  // leave the last query and a cursor past the end of a shorter list.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }

  // Focus goes back where it was — the search button, a tool's control —
  // when the palette closes, instead of falling to the top of the page.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (before && before.isConnected && document.activeElement === document.body) before.focus({ preventScroll: true });
    };
  }, [open]);

  // The arrow keys can walk past the bottom of the visible list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(".palette-item.is-active")?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, shown]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const pick = (item: CommandItem) => {
    onClose();
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
        <ul className="palette-list" role="listbox" ref={listRef} aria-label="תוצאות">
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
