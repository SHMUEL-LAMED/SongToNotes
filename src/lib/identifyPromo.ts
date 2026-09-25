/**
 * An invitation to the song identifier, for visitors who have not met it yet.
 *
 * It rises from the bottom of the screen once a visit, after a little while
 * the site has spent on screen — a tab left in the background does not count
 * — and never over a dialog, beside the request to share the site, on the
 * identifier itself or while the tool is switched off. Closing it rests it for
 * a few days; opening the identifier, from the invitation or any other way,
 * rests it for a month: whoever already uses the tool needs no reminder.
 */
import { useCallback, useEffect, useState } from "react";
import { advanceClock, type PromptClock } from "./siteShare";

/** Time on screen, within one visit, before the invitation rises. */
export const PROMO_AFTER_MS = 40_000;
/** How long it rests after "not now". */
export const REST_AFTER_DISMISS_MS = 3 * 24 * 60 * 60_000;
/** How long it rests once the identifier has been opened. */
export const REST_AFTER_USE_MS = 30 * 24 * 60 * 60_000;
const TICK_MS = 5_000;

/** Until when the invitation rests on this device. */
const REST_KEY = "musictools.identify-promo.rest.v1";
/** Time on screen in this visit — per tab, so a reload keeps it. */
const SPENT_KEY = "musictools.identify-promo.spent.v1";
/** Whether it already rose in this visit. */
const SHOWN_KEY = "musictools.identify-promo.shown.v1";

export type PromoOutcome = "dismissed" | "used";

/* ---- when: pure, so the timing is testable ---- */

/** Until when the invitation rests after it was closed, or the tool was opened. */
export function restUntil(outcome: PromoOutcome, now: number) {
  return now + (outcome === "used" ? REST_AFTER_USE_MS : REST_AFTER_DISMISS_MS);
}

/** Time to invite: long enough on screen, not yet this visit, and not resting. */
export function promoDue({
  spent,
  restingUntil,
  shownThisVisit,
  now,
}: {
  spent: number;
  restingUntil: number | null;
  shownThisVisit: boolean;
  now: number;
}) {
  if (shownThisVisit) return false;
  if (restingUntil !== null && now < restingUntil) return false;
  return spent >= PROMO_AFTER_MS;
}

/* ---- what this device remembers ---- */

/** Kept for the visit too, for a browser that will not store anything. */
let restThisVisit: number | null = null;
let shownThisVisit = false;

function readRest() {
  try {
    const value = Number(localStorage.getItem(REST_KEY));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // This visit's memory, then.
  }
  return restThisVisit;
}

function rest(outcome: PromoOutcome) {
  const until = Math.max(readRest() ?? 0, restUntil(outcome, Date.now()));
  restThisVisit = until;
  try {
    localStorage.setItem(REST_KEY, String(until));
  } catch {
    // Remembered for this visit only.
  }
}

function readShown() {
  try {
    if (sessionStorage.getItem(SHOWN_KEY) === "1") return true;
  } catch {
    // This visit's memory, then.
  }
  return shownThisVisit;
}

function markShown() {
  shownThisVisit = true;
  try {
    sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    // Remembered until the page reloads.
  }
}

function readSpent() {
  try {
    const value = Number(sessionStorage.getItem(SPENT_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeSpent(value: number) {
  try {
    sessionStorage.setItem(SPENT_KEY, String(Math.round(value)));
  } catch {
    // Without storage a reload starts the count again; nothing worse.
  }
}

/**
 * Whether the invitation is up. `paused` holds it back (another dialog, the
 * request to share, a closed site) while the seconds still count; `available`
 * is false when the tool is off or hidden; `here` is true on the identifier.
 */
export function useIdentifyPromo({ paused, available, here }: { paused: boolean; available: boolean; here: boolean }) {
  const [open, setOpen] = useState(false);

  // Opening the identifier, whichever way, is what the invitation was for.
  useEffect(() => {
    if (here) rest("used");
  }, [here]);

  useEffect(() => {
    let clock: PromptClock = { spent: readSpent(), at: Date.now() };
    const timer = window.setInterval(() => {
      const now = Date.now();
      clock = advanceClock(clock, now, document.visibilityState === "visible");
      writeSpent(clock.spent);
      if (here || !available) {
        setOpen(false);
        return;
      }
      if (open || paused) return;
      if (promoDue({ spent: clock.spent, restingUntil: readRest(), shownThisVisit: readShown(), now })) {
        markShown();
        setOpen(true);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [available, here, open, paused]);

  /** The visitor took the invitation: the tool opens, and it rests a month. */
  const accept = useCallback(() => {
    rest("used");
    setOpen(false);
  }, []);

  /** "Not now": it rests a few days. */
  const dismiss = useCallback(() => {
    rest("dismissed");
    setOpen(false);
  }, []);

  return { open: open && available && !here, accept, dismiss };
}
