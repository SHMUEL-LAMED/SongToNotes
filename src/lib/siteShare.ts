/**
 * Passing the site itself on — not a saved work (that is share.ts), but the
 * address of the whole studio, for a friend who plays, sings or teaches.
 *
 * Two doors lead here: the share button in the top bar, and a small request
 * that rises from the bottom of the screen after every ten minutes the site
 * spends on screen. Only visible time counts, so a tab left in the background
 * never greets its owner with a request on return; and once somebody has
 * shared, the request leaves them alone for a week.
 */
import { useCallback, useEffect, useState } from "react";
import { ownReferralCode, withReferral } from "./credits";
import type { ShareOutcome } from "./export";
import { currentLang } from "./i18n";

/** Time on screen between two requests. */
export const PROMPT_EVERY_MS = 10 * 60_000;
/** How long the request rests on a device that has just shared the site. */
export const REST_AFTER_SHARE_MS = 7 * 24 * 60 * 60_000;
const TICK_MS = 15_000;
/**
 * The most one tick may add. Timers stall while a laptop sleeps or a tab sits
 * in the background, and a longer gap than this was not time on the site.
 */
const MAX_STEP_MS = 2 * TICK_MS;

/** Time on screen since the last request — per tab, so a reload keeps it. */
const SPENT_KEY = "musictools.share-prompt.v1";
/** When this device last shared the site. */
const SHARED_KEY = "musictools.shared-site.v1";

export type ShareTargetId = "whatsapp" | "telegram" | "facebook" | "x" | "email";
export type ShareTarget = { id: ShareTargetId; label: string; href: string };

/** The front door of the site, wherever it is served from. */
export function siteUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

/**
 * The address to pass on: the signed-in account's private link, so every
 * friend it brings is counted to them (see credits.ts), or the plain one.
 */
export function shareSiteUrl() {
  return withReferral(siteUrl(), ownReferralCode());
}

/**
 * What travels with a private link: the plain message, and the gift that
 * waits for whoever opens an account through it.
 */
export function inviteMessage(welcome: number) {
  const base = shareMessage();
  if (welcome <= 0) return base;
  return currentLang() === "en"
    ? { ...base, text: `${base.text} Join through my link and get ${welcome} free credits.` }
    : { ...base, text: `${base.text} מצטרפים דרך הקישור שלי ומקבלים ${welcome} קרדיטים מתנה.` };
}

/**
 * What travels with the link. It leaves the page, so the translation that
 * works on the page never sees it: it is written in both languages here.
 */
export function shareMessage() {
  return currentLang() === "en"
    ? {
        title: "Music Tools — your music studio in the browser",
        text: "Free music tools in the browser: sheet music from any song, karaoke, guitar chords, a tuner, a metronome and more. No sign-up, nothing to install.",
      }
    : {
        title: "כלי מוזיקה — הסטודיו המוזיקלי שלך בדפדפן",
        text: "כלי מוזיקה חינמיים בדפדפן: תווים מכל שיר, קריוקי, אקורדים לגיטרה, טיונר, מטרונום ועוד. בלי הרשמה ובלי התקנה.",
      };
}

/** A link per app that opens it with the message and the address filled in. */
export function shareTargets(url: string, text: string, title: string): ShareTarget[] {
  const q = encodeURIComponent;
  const both = `${text}\n${url}`;
  return [
    { id: "whatsapp", label: "וואטסאפ", href: `https://wa.me/?text=${q(both)}` },
    { id: "telegram", label: "טלגרם", href: `https://t.me/share/url?url=${q(url)}&text=${q(text)}` },
    // Facebook takes the address alone; the title and picture come from the page's own tags.
    { id: "facebook", label: "פייסבוק", href: `https://www.facebook.com/sharer/sharer.php?u=${q(url)}` },
    { id: "x", label: "X", href: `https://x.com/intent/tweet?text=${q(text)}&url=${q(url)}` },
    { id: "email", label: "מייל", href: `mailto:?subject=${q(title)}&body=${q(both)}` },
  ];
}

/** Whether the system has a share sheet of its own — phones, mostly. */
export function canShareNatively() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function shareNatively(url: string, text: string, title: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ url, text, title });
    return "shared";
  } catch (error) {
    // Closing the sheet without picking an app is not a failure.
    if (error instanceof Error && error.name === "AbortError") return "dismissed";
    return "failed";
  }
}

/* ---- the request's clock: pure, so the timing is testable ---- */

export type PromptClock = { spent: number; at: number };

/** Moves the clock to `now`, counting the step only while the page is on screen. */
export function advanceClock(clock: PromptClock, now: number, visible: boolean): PromptClock {
  const step = now - clock.at;
  return { spent: clock.spent + (visible && step > 0 ? Math.min(step, MAX_STEP_MS) : 0), at: now };
}

/** Time to ask: ten minutes on screen, and no share from this device this past week. */
export function promptDue(spent: number, sharedAt: number | null, now: number) {
  if (sharedAt !== null && now - sharedAt < REST_AFTER_SHARE_MS) return false;
  return spent >= PROMPT_EVERY_MS;
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

/** Kept for the visit too, for a browser that will not store it. */
let sharedThisVisit: number | null = null;

function readSharedAt() {
  try {
    const value = Number(localStorage.getItem(SHARED_KEY));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // This visit's memory, then.
  }
  return sharedThisVisit;
}

/** Remembers that this device passed the site on, so the request rests. */
export function markShared() {
  sharedThisVisit = Date.now();
  try {
    localStorage.setItem(SHARED_KEY, String(sharedThisVisit));
  } catch {
    // Remembered for this visit only.
  }
}

/**
 * Whether the request is up. It rises after ten minutes on screen, and the
 * count starts again from nothing whenever a share window closes — the request
 * itself, or the one the top bar opens (`sharing`). While `paused` (another
 * dialog is open, the site is closed) the minutes still count, but the request
 * waits its turn.
 */
export function useSharePrompt({ paused, sharing }: { paused: boolean; sharing: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open || sharing) {
      writeSpent(0);
      return;
    }
    let clock: PromptClock = { spent: readSpent(), at: Date.now() };
    const timer = window.setInterval(() => {
      const now = Date.now();
      clock = advanceClock(clock, now, document.visibilityState === "visible");
      writeSpent(clock.spent);
      if (!paused && promptDue(clock.spent, readSharedAt(), now)) setOpen(true);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [open, paused, sharing]);

  const close = useCallback(() => setOpen(false), []);
  return { open, close };
}
