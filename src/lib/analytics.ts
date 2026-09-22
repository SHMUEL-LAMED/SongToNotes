/**
 * What the site counts about itself.
 *
 * The rule this module exists to keep: the numbers say *what happened on the
 * site*, never *who did it*. An event carries a tool, a kind, how long it
 * took, and the shape of the device — no account, no name, no title, no file,
 * nothing anybody typed. The only durable thing is `visitor`: a random number
 * this browser keeps for a month so "new or returning" can be counted, tied to
 * nothing and nobody, thrown away and redrawn on its own. A visitor who would
 * rather not be counted at all switches it off in the personal area, and then
 * nothing is sent.
 *
 * Events are queued and sent in one small batch, after a pause or when the page
 * goes away, so the measuring never costs the visitor a moment.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase";

const ENDPOINT = `${SUPABASE_URL}/rest/v1/site_events`;

export const ANALYTICS_KEY = "music-tools.analytics.v1";
export const VISITOR_KEY = "music-tools.visitor.v1";

/** A month: long enough to tell a returning visitor, short enough to forget. */
const VISITOR_DAYS = 30;

export type EventKind = "view" | "input" | "result" | "error" | "leave";

export type SiteEvent = {
  day: string;
  hour: number;
  weekday: number;
  kind: EventKind;
  tool: string;
  seconds: number;
  detail: string | null;
  device: "phone" | "tablet" | "desktop";
  browser: string;
  os: string;
  language: string;
  referrer: string | null;
  visitor: string | null;
  signed_in: boolean;
};

/* ---- the pure parts, so the shape of an event is testable ---- */

export function classifyDevice(width: number, touch: boolean): SiteEvent["device"] {
  if (width < 600) return "phone";
  if (width < 1024 && touch) return "tablet";
  return "desktop";
}

/** The browser family, from the parts of the agent string that still mean it. */
export function browserName(agent: string) {
  if (/Edg\//.test(agent)) return "Edge";
  if (/OPR\/|Opera/.test(agent)) return "Opera";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/SamsungBrowser/.test(agent)) return "Samsung";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent)) return "Safari";
  return "אחר";
}

export function osName(agent: string) {
  if (/Android/.test(agent)) return "Android";
  if (/iPhone|iPad|iPod/.test(agent)) return "iOS";
  if (/Mac OS X/.test(agent)) return "macOS";
  if (/Windows/.test(agent)) return "Windows";
  if (/Linux/.test(agent)) return "Linux";
  return "אחר";
}

/** Only the host a visitor came from — never the page they were reading. */
export function hostOf(referrer: string, self: string) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname;
    return host && host !== new URL(self).hostname ? host.slice(0, 60) : null;
  } catch {
    return null;
  }
}

export type VisitorRecord = { id: string; since: number };

/** The month-old number is dropped and a new one drawn in its place. */
export function rotateVisitor(
  stored: VisitorRecord | null,
  now: number,
  draw: () => string,
): VisitorRecord {
  const age = stored ? now - stored.since : Infinity;
  if (stored?.id && age >= 0 && age < VISITOR_DAYS * 86_400_000) return stored;
  return { id: draw(), since: now };
}

/* ---- the browser side ---- */

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** False when the visitor asked not to be counted, here or in the browser. */
export function analyticsEnabled() {
  if (typeof window === "undefined") return false;
  if (navigator.doNotTrack === "1" || (window as { doNotTrack?: string }).doNotTrack === "1") {
    return false;
  }
  return storage()?.getItem(ANALYTICS_KEY) !== "off";
}

export function setAnalyticsEnabled(on: boolean) {
  const store = storage();
  if (!store) return;
  if (on) store.removeItem(ANALYTICS_KEY);
  else {
    store.setItem(ANALYTICS_KEY, "off");
    store.removeItem(VISITOR_KEY);
    queue.length = 0;
  }
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function visitorId(): string | null {
  const store = storage();
  if (!store) return null;
  let stored: VisitorRecord | null = null;
  try {
    stored = JSON.parse(store.getItem(VISITOR_KEY) ?? "null") as VisitorRecord | null;
  } catch {
    stored = null;
  }
  const next = rotateVisitor(stored, Date.now(), randomId);
  if (next !== stored) store.setItem(VISITOR_KEY, JSON.stringify(next));
  return next.id;
}

let signedIn = false;

/** The site tells the counter only whether *somebody* is signed in, never who. */
export function setSignedIn(value: boolean) {
  signedIn = value;
}

const queue: SiteEvent[] = [];
let timer = 0;

function describe() {
  const agent = navigator.userAgent ?? "";
  const now = new Date();
  return {
    day: new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10),
    hour: now.getHours(),
    weekday: now.getDay(),
    device: classifyDevice(window.innerWidth, navigator.maxTouchPoints > 0),
    browser: browserName(agent),
    os: osName(agent),
    language: (navigator.language ?? "").slice(0, 12),
    referrer: hostOf(document.referrer ?? "", window.location.href),
  };
}

export function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(batch),
    }).catch(() => undefined);
  } catch {
    // Counting is never worth an error in front of the visitor.
  }
}

function record(kind: EventKind, tool: string, seconds = 0, detail?: string) {
  if (!analyticsEnabled() || !tool) return;
  queue.push({
    ...describe(),
    kind,
    tool: tool.slice(0, 40),
    seconds: Math.max(0, Math.min(86_400, Math.round(seconds))),
    detail: detail ? detail.slice(0, 60) : null,
    visitor: visitorId(),
    signed_in: signedIn,
  });
  // A batch is small and a page is often left in a hurry; 20 is a safe ceiling.
  if (queue.length >= 20) {
    flush();
    return;
  }
  if (!timer) {
    timer = window.setTimeout(() => {
      timer = 0;
      flush();
    }, 4000);
  }
}

/** The tool was opened. */
export const trackView = (tool: string) => record("view", tool);
/** Something was handed to the tool — a file, a recording, a text. */
export const trackInput = (tool: string, detail?: string) => record("input", tool, 0, detail);
/** The tool produced what it was asked for, after `seconds` of work. */
export const trackResult = (tool: string, seconds = 0) => record("result", tool, seconds);
/** The tool failed; `code` is the short reason, never a message with content. */
export const trackError = (tool: string, code: string) => record("error", tool, 0, code);
/** The visit to the tool ended after `seconds`. */
export const trackLeave = (tool: string, seconds: number) => record("leave", tool, seconds);

/** Sends what is queued when the page is about to disappear. */
export function startAnalytics() {
  if (typeof window === "undefined") return () => undefined;
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  return () => {
    window.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
    flush();
  };
}
