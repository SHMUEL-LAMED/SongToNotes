import type { KeyboardEvent } from "react";

/**
 * Arrow-key movement inside a `role="tablist"`, as the ARIA pattern expects.
 * The site is right-to-left, so which arrow means "next" is read off the
 * element's resolved direction rather than assumed.
 */
export function moveTabFocus(event: KeyboardEvent<HTMLElement>) {
  const { key } = event;
  if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") {
    return;
  }
  const list = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
  if (!list) return;
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
  const current = tabs.indexOf(event.currentTarget);
  if (current < 0) return;

  event.preventDefault();
  if (key === "Home" || key === "End") {
    tabs[key === "Home" ? 0 : tabs.length - 1].focus();
    return;
  }
  const rtl = getComputedStyle(list).direction === "rtl";
  const forward = rtl ? key === "ArrowLeft" : key === "ArrowRight";
  const next = (current + (forward ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
}
