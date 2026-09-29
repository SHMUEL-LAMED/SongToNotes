import { useEffect } from "react";

/** Whether a key press is Ctrl+K (or ⌘K). */
export function isCommandKey(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "key" | "code">) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  // On a Hebrew layout the K key types "ל", so the physical key is what
  // counts. `key` can also be missing altogether: Chrome's autofill fires
  // keydown events without one, and reading it blindly threw.
  return event.code === "KeyK" || (typeof event.key === "string" && event.key.toLowerCase() === "k");
}

/** Ctrl+K (or ⌘K) anywhere on the page opens whatever is handed in. */
export function useCommandKey(onOpen: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isCommandKey(event)) {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
