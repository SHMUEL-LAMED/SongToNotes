import { useEffect, useEffectEvent, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** The open modals, innermost last: only the top one answers keys. */
const stack: object[] = [];
/** How many modals hold the page still, and the overflow they found. */
let locks = 0;
let savedOverflow = "";

function focusables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * What every dialog and sheet does while it is open: remembers what had
 * focus, holds the page still behind it, moves focus inside (to
 * `initialFocus`, else the first control, else the panel), keeps Tab cycling
 * inside, closes on Esc, and on closing puts focus back where it was. Keys
 * are taken at the capture phase and stopped, so a page shortcut (Space on
 * the metronome, Esc elsewhere) does not also fire; a modal opened over
 * another one takes the keys until it closes.
 */
export function useModal(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const token = {};
    stack.push(token);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (locks === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    locks += 1;

    const first = initialFocus?.current ?? focusables(panel)[0] ?? panel;
    first.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const start = items[0];
      const end = items[items.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !panel.contains(active);
      if (event.shiftKey && (active === start || outside)) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && (active === end || outside)) {
        event.preventDefault();
        start.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      const at = stack.indexOf(token);
      if (at >= 0) stack.splice(at, 1);
      locks -= 1;
      if (locks === 0) document.body.style.overflow = savedOverflow;
      // Back to the control that opened it, if it is still on the page.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, panelRef, initialFocus]);
}
