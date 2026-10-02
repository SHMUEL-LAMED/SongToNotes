/**
 * The invitation to open an account: a window that greets a visitor who is
 * not signed in, once in every visit to the site.
 *
 * It waits a few seconds — so the page is there before anything covers it —
 * and those seconds are counted only while the tab is on screen, as the
 * request to share the site counts its minutes (`siteShare.ts`). A reload
 * inside the same visit does not bring it back, and a visitor who is signed
 * in never meets it: signing in, or arriving signed in, settles the visit, so
 * signing out does not summon it a moment later.
 *
 * Nothing on the site waits for an account — the tools all run in the browser
 * — so the window is a door, never a gate: one button signs in, the other
 * carries on without it.
 */
import { useCallback, useEffect, useState } from "react";
import { advanceClock, type PromptClock } from "./siteShare";

/** Time on screen before the invitation comes up. */
export const SIGN_IN_AFTER_MS = 6_000;
const TICK_MS = 2_000;

/** Whether the invitation already came up in this visit — per tab, so a reload keeps it. */
const SHOWN_KEY = "musictools.sign-in-prompt.shown.v1";
/** Time on screen in this visit — per tab, for the same reason. */
const SPENT_KEY = "musictools.sign-in-prompt.spent.v1";

/* ---- when: pure, so the timing is testable ---- */

/**
 * Time to ask: a few seconds on screen, nobody signed in, and no invitation
 * yet in this visit.
 */
export function signInDue({
  spent,
  signedIn,
  shownThisVisit,
}: {
  spent: number;
  signedIn: boolean;
  shownThisVisit: boolean;
}) {
  if (signedIn || shownThisVisit) return false;
  return spent >= SIGN_IN_AFTER_MS;
}

/* ---- what this visit remembers ---- */

/** Kept for the visit too, for a browser that will not store anything. */
let shownThisVisit = false;

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
 * Whether the invitation is up. `paused` holds it back while the seconds
 * still count (another window is open, a tour is running, the site is
 * closed), and `loading` while the browser's own session is still being
 * confirmed — including the moment of return from Google, when a visitor who
 * is about to be signed in would otherwise be asked to sign in.
 */
export function useSignInPrompt({
  paused,
  signedIn,
  loading,
}: {
  paused: boolean;
  signedIn: boolean;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Signed in: this visit has its answer, and the window — up only if the
    // account was opened without leaving the page — goes with it.
    if (signedIn) {
      markShown();
      const done = window.setTimeout(() => setOpen(false), 0);
      return () => window.clearTimeout(done);
    }
    if (open) return;
    let clock: PromptClock = { spent: readSpent(), at: Date.now() };
    const timer = window.setInterval(() => {
      const now = Date.now();
      clock = advanceClock(clock, now, document.visibilityState === "visible");
      writeSpent(clock.spent);
      if (loading || paused) return;
      if (!signInDue({ spent: clock.spent, signedIn, shownThisVisit: readShown() })) return;
      // Marked before it opens: a reload while it is up is still this visit.
      markShown();
      setOpen(true);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [loading, open, paused, signedIn]);

  const close = useCallback(() => setOpen(false), []);
  return { open, close };
}
