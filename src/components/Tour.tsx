import { ArrowLeft, ArrowRight, Route, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { TourStep } from "../lib/tours";

const GAP = 14;
const MARGIN = 12;
const PAD = 8;

type Box = { top: number; left: number; width: number; height: number };

/** The first element on screen that a step's selector names. */
function findTarget(selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  let found: NodeListOf<HTMLElement>;
  try {
    found = document.querySelectorAll<HTMLElement>(selector);
  } catch {
    return null;
  }
  for (const element of found) {
    if (element.closest(".tour")) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    if (typeof element.checkVisibility === "function" && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    return element;
  }
  return null;
}

function boxOf(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  Boolean(a && b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

/**
 * A guided tour of the page on screen. The page dims, a lit window moves from
 * one part of it to the next, and a bubble beside it says what the part is
 * for. A step whose part is not on screen yet — nothing picked, a panel that
 * opens later — is told in the middle of the screen, and one marked optional
 * is left out. Arrows, Enter and Esc work, and focus returns to where it was.
 */
export function Tour({ steps: given, onClose }: { steps: TourStep[]; onClose: () => void }) {
  // Optional stops whose part is missing are dropped once, when the tour
  // opens, so the count shown is the count walked.
  const [steps] = useState(() => given.filter((step) => !step.optional || findTarget(step.target)));
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [bubble, setBubble] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [view, setView] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const bubbleRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  const next = useCallback(() => {
    if (last) onClose();
    else setIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [last, onClose, steps.length]);
  const back = useCallback(() => setIndex((current) => Math.max(current - 1, 0)), []);

  // Focus comes to the tour and goes back where it was once it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    nextRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  // While the tour is open the page's own shortcuts rest — a space bar
  // would start the metronome under it — and Tab stays inside the bubble.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.type !== "keydown") return;
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
        event.preventDefault();
        next();
      } else if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
        event.preventDefault();
        back();
      } else if (event.key === "Tab") {
        const buttons = Array.from(bubbleRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
        if (!buttons.length) return;
        const at = buttons.indexOf(document.activeElement as HTMLElement);
        const to = at < 0 ? 0 : (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[to].focus();
      }
    };
    const onResize = () => setView({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, [back, next, onClose]);

  // Each step brings its part into view, then follows it as long as it is
  // shown: the page scrolls, a panel opens above it, the window resizes.
  useEffect(() => {
    if (!step) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = findTarget(step.target);
    if (target) {
      const tall = target.getBoundingClientRect().height > window.innerHeight * 0.6;
      target.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
    }
    let frame = 0;
    // Undefined until the first measure, so a step with nothing to light up
    // still clears the window the step before it left.
    let current: Box | null | undefined;
    const follow = () => {
      const element = target?.isConnected ? target : findTarget(step.target);
      const measured = element ? boxOf(element) : null;
      if (current === undefined || !sameBox(measured, current)) {
        current = measured;
        setBox(measured);
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // The bubble's size decides where it fits; the observer reports it before
  // the first paint, and again whenever a step's words change it.
  useEffect(() => {
    const element = bubbleRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      setBubble((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!step) return null;

  const viewWidth = view.width;
  const viewHeight = view.height;
  const hole = box
    ? {
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
      }
    : null;

  // Below the part when there is room, above it otherwise, and failing both
  // (a part taller than the screen) along the bottom edge, over it.
  let placement: "below" | "above" | "over" | "center" = "center";
  let top = (viewHeight - bubble.height) / 2;
  let left = (viewWidth - bubble.width) / 2;
  if (hole) {
    const below = viewHeight - (hole.top + hole.height) - MARGIN;
    const above = hole.top - MARGIN;
    if (below >= bubble.height + GAP) {
      placement = "below";
      top = hole.top + hole.height + GAP;
    } else if (above >= bubble.height + GAP) {
      placement = "above";
      top = hole.top - GAP - bubble.height;
    } else {
      placement = "over";
      top = viewHeight - bubble.height - MARGIN;
    }
    left = hole.left + hole.width / 2 - bubble.width / 2;
  }
  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, viewWidth - bubble.width - MARGIN));
  top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, viewHeight - bubble.height - MARGIN));
  const arrow = hole ? Math.min(Math.max(hole.left + hole.width / 2 - left, 22), bubble.width - 22) : 0;

  // On the body, so nothing in the page column — its clipping, its stacking —
  // can hold the dimming in.
  return createPortal(
    <div className="tour" data-placement={placement}>
      {/* Clicks on the dimmed page go nowhere: the tour is left with its own buttons or Esc. */}
      <div className="tour-shield" aria-hidden="true" />
      {/* The dimming, with the lit part cut out of it by a mask; a shadow
          spread over the whole screen was drawn too faintly to read as dim. */}
      <svg className="tour-dim" aria-hidden="true" width="100%" height="100%">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={14} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask="url(#tour-mask)" />
      </svg>
      {hole && (
        <div className="tour-hole" aria-hidden="true" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
      )}
      <div
        ref={bubbleRef}
        className="tour-bubble"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        style={{ top, left, "--tour-arrow": `${arrow}px`, visibility: bubble.width ? undefined : "hidden" } as CSSProperties}
      >
        <div className="tour-head">
          <span className="tour-badge" aria-hidden="true">
            <Route size={15} />
          </span>
          <small className="tour-count">
            שלב {index + 1} מתוך {steps.length}
          </small>
          <button type="button" className="icon-button tour-close" onClick={onClose} aria-label="סגירת הסיור" title="סגירת הסיור (Esc)">
            <X size={16} />
          </button>
        </div>
        <div className="tour-progress" aria-hidden="true">
          <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <div aria-live="polite">
          <h2 id="tour-title" className="tour-title">
            {step.title}
          </h2>
          <p id="tour-text" className="tour-text">
            {step.text}
          </p>
        </div>
        <div className="tour-actions">
          <button type="button" className="ghost-button tour-skip" onClick={onClose}>
            {last ? "סגירה" : "דילוג על הסיור"}
          </button>
          <span className="tour-nav">
            {index > 0 && (
              <button type="button" className="secondary-button tour-back" onClick={back}>
                <ArrowRight size={15} aria-hidden="true" /> הקודם
              </button>
            )}
            <button ref={nextRef} type="button" className="primary-button tour-next" onClick={next}>
              {last ? "סיום" : "הבא"} {!last && <ArrowLeft size={15} aria-hidden="true" />}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
