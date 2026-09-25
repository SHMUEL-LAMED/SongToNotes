/**
 * Invitations to the tools that are not only for musicians: a ringtone from a
 * favourite song, karaoke without the singer, a recording turned into text,
 * the name of the song on the radio. One rises from the bottom of the screen
 * once a visit, after a little while the site has spent on screen — a tab left
 * in the background does not count — and the tools take turns from one visit
 * to the next.
 *
 * Tools the visitor already knows take their turn too — a reminder of a tool
 * one used once is as welcome as a first look. It never rises over a dialog,
 * beside the request to share the site, in the admin area or on a closed site,
 * and it never suggests the tool on screen or a tool that is switched off.
 * "Not now" rests that tool for two weeks, and every invitation for a day.
 */
import { useCallback, useEffect, useState } from "react";
import { advanceClock, type PromptClock } from "./siteShare";
import { findTool } from "./tools";

type Words = { title: string; text: string; cta: string };

export type ToolPromoSpec = { tool: string; he: Words; en: Words };

/** The tools worth an invitation, in the order they take turns. */
export const PROMOS: ToolPromoSpec[] = [
  {
    tool: "identify",
    he: {
      title: "שמעתם שיר ולא יודעים מה שמו?",
      text: "מזהה השיר מקשיב כמה שניות — מהמיקרופון או מקובץ — ומגלה לכם את שם השיר והאמן.",
      cta: "לזהות שיר",
    },
    en: {
      title: "Heard a song and can't name it?",
      text: "The song identifier listens for a few seconds — from the microphone or a file — and tells you the title and the artist.",
      cta: "Identify a song",
    },
  },
  {
    tool: "ringtone",
    he: {
      title: "רוצים צלצול משיר שאתם אוהבים?",
      text: "בוחרים את הקטע הכי טוב, מוסיפים כניסה ויציאה רכות, ומורידים צלצול מוכן לטלפון — בחינם, בלי אפליקציה.",
      cta: "ליצור צלצול",
    },
    en: {
      title: "Want a ringtone from a song you love?",
      text: "Pick the best part, add a soft fade in and out, and download a ringtone ready for your phone — free, no app.",
      cta: "Make a ringtone",
    },
  },
  {
    tool: "vocals",
    he: {
      title: "רוצים לשיר קריוקי על כל שיר?",
      text: "הסרת השירה מפרידה את הקול מהמוזיקה ומשאירה לכם פלייבק נקי — או להפך, רק את השירה.",
      cta: "להסיר את השירה",
    },
    en: {
      title: "Want to sing karaoke to any song?",
      text: "The vocal remover takes the voice out of the music and leaves you a clean backing track — or just the voice.",
      cta: "Remove the vocals",
    },
  },
  {
    tool: "transcript",
    he: {
      title: "יש לכם הקלטה שצריך להפוך לטקסט?",
      text: "התמלול כותב את כל מה שנאמר, בעברית ובעוד שפות, עם זמנים — גם ככתוביות לסרטון.",
      cta: "לתמלל הקלטה",
    },
    en: {
      title: "Got a recording to turn into text?",
      text: "The transcriber writes down everything that was said, in Hebrew and more, with timestamps — as subtitles too.",
      cta: "Transcribe a recording",
    },
  },
  {
    tool: "lyrics",
    he: {
      title: "קריוקי עם המילים על המסך?",
      text: "מעלים שיר, והמילים שלו נדלקות מילה אחר מילה בזמן שהוא מתנגן.",
      cta: "לקריוקי עם מילים",
    },
    en: {
      title: "Karaoke with the words on screen?",
      text: "Upload a song, and its words light up one by one as it plays.",
      cta: "Karaoke with lyrics",
    },
  },
  {
    tool: "video",
    he: {
      title: "צריכים רק את הצליל מתוך סרטון?",
      text: "מעלים סרטון ומקבלים את פס הקול כקובץ MP3 — שיר, הרצאה או כל הקלטה.",
      cta: "לחלץ את הצליל",
    },
    en: {
      title: "Need just the sound from a video?",
      text: "Upload a video and get its soundtrack as an MP3 — a song, a lecture or any recording.",
      cta: "Get the sound",
    },
  },
  {
    tool: "tts",
    he: {
      title: "רוצים לשמוע טקסט בקול?",
      text: "מקלידים או מדביקים טקסט ושומעים אותו מוקרא — וגם מקבלים קובץ MP3 לשמירה ולשיתוף.",
      cta: "להקריא טקסט",
    },
    en: {
      title: "Want to hear a text read aloud?",
      text: "Type or paste a text and hear it read — and get an MP3 to keep and share.",
      cta: "Read a text aloud",
    },
  },
  {
    tool: "convert",
    he: {
      title: "צריכים את הקובץ ב־MP3 או ב־WAV?",
      text: "ממירים כל קובץ שמע בכמה שניות, ישר בדפדפן — בלי להעלות אותו לשום מקום.",
      cta: "להמיר קובץ",
    },
    en: {
      title: "Need the file as an MP3 or a WAV?",
      text: "Convert any audio file in seconds, right in the browser — without uploading it anywhere.",
      cta: "Convert a file",
    },
  },
];

const DAY_MS = 24 * 60 * 60_000;
/** Time on screen, within one visit, before an invitation rises. */
export const PROMO_AFTER_MS = 40_000;
/** How long a tool's invitation rests after "not now". */
export const REST_TOOL_AFTER_DISMISS_MS = 14 * DAY_MS;
/** How long every invitation rests after "not now". */
export const REST_ALL_AFTER_DISMISS_MS = DAY_MS;
const TICK_MS = 5_000;

/**
 * What this device remembers: the turns, and what rests until when. (v1 also
 * rested the tools a visitor had opened; v2 starts afresh without that.)
 */
const STATE_KEY = "musictools.tool-promos.v2";
/** Time on screen in this visit — per tab, so a reload keeps it. */
const SPENT_KEY = "musictools.tool-promos.spent.v1";
/** Whether an invitation already rose in this visit. */
const SHOWN_KEY = "musictools.tool-promos.shown.v1";

export type PromoState = {
  /** Until when each tool's invitation rests, after "not now". */
  rest: Record<string, number>;
  /** Until when every invitation rests. */
  pauseAll: number;
  /** The place in the turns: the next invitation to try. */
  next: number;
};

/* ---- when and which: pure, so the timing and the turns are testable ---- */

/** A stored state, whatever the storage held; what cannot be read is forgotten. */
export function parseState(raw: string | null): PromoState {
  try {
    const value = JSON.parse(raw ?? "") as Partial<PromoState> | null;
    const rest: Record<string, number> = {};
    if (value && typeof value.rest === "object" && value.rest) {
      for (const [tool, until] of Object.entries(value.rest)) {
        if (Number.isFinite(Number(until))) rest[tool] = Number(until);
      }
    }
    const pauseAll = Number(value?.pauseAll);
    const next = Number(value?.next);
    return {
      rest,
      pauseAll: Number.isFinite(pauseAll) ? pauseAll : 0,
      next: Number.isInteger(next) && next >= 0 ? next % PROMOS.length : 0,
    };
  } catch {
    return { rest: {}, pauseAll: 0, next: 0 };
  }
}

/** Time for an invitation: long enough on screen, none yet this visit, and no pause. */
export function promoDue({
  spent,
  state,
  shownThisVisit,
  now,
}: {
  spent: number;
  state: PromoState;
  shownThisVisit: boolean;
  now: number;
}) {
  if (shownThisVisit) return false;
  if (now < state.pauseAll) return false;
  return spent >= PROMO_AFTER_MS;
}

/**
 * The next invitation in turn, as its place in PROMOS: the first from the
 * current turn on whose tool is not skipped (on screen, off) and not resting.
 */
export function pickPromo(state: PromoState, now: number, skip: (tool: string) => boolean): number | null {
  for (let step = 0; step < PROMOS.length; step += 1) {
    const index = (state.next + step) % PROMOS.length;
    const { tool } = PROMOS[index];
    if (skip(tool) || now < (state.rest[tool] ?? 0)) continue;
    return index;
  }
  return null;
}

/** An invitation rose: the next visit starts from the one after it. */
export function afterShown(state: PromoState, index: number): PromoState {
  return { ...state, next: (index + 1) % PROMOS.length };
}

/**
 * "Not now": that tool rests two weeks, and every invitation a day. It is the
 * only thing that rests an invitation — opening a tool, from its invitation or
 * any other way, leaves it in the turns.
 */
export function afterDismiss(state: PromoState, tool: string, now: number): PromoState {
  return {
    ...state,
    rest: { ...state.rest, [tool]: Math.max(state.rest[tool] ?? 0, now + REST_TOOL_AFTER_DISMISS_MS) },
    pauseAll: Math.max(state.pauseAll, now + REST_ALL_AFTER_DISMISS_MS),
  };
}

/* ---- what this device remembers ---- */

/** Kept for the visit too, for a browser that will not store anything. */
let stateThisVisit: PromoState | null = null;
let shownThisVisit = false;

function readState(): PromoState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw !== null) return parseState(raw);
  } catch {
    // This visit's memory, then.
  }
  return stateThisVisit ?? parseState(null);
}

function writeState(state: PromoState) {
  stateThisVisit = state;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Remembered for this visit only.
  }
}

function recordDismiss(tool: string) {
  writeState(afterDismiss(readState(), tool, Date.now()));
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
 * The invitation that is up, if any. `paused` holds it back (another dialog,
 * the request to share, a closed site) while the seconds still count;
 * `current` is the tool on screen, and `disabledTools` those switched off.
 */
export function useToolPromo({
  paused,
  current,
  disabledTools,
}: {
  paused: boolean;
  current: string | null;
  disabledTools: readonly string[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const off = disabledTools.join(",");

  useEffect(() => {
    const disabled = new Set(off ? off.split(",") : []);
    const unavailable = (tool: string) => !findTool(tool) || disabled.has(tool);
    let clock: PromptClock = { spent: readSpent(), at: Date.now() };
    const timer = window.setInterval(() => {
      const now = Date.now();
      clock = advanceClock(clock, now, document.visibilityState === "visible");
      writeSpent(clock.spent);
      if (openIndex !== null) {
        const { tool } = PROMOS[openIndex];
        if (tool === current || unavailable(tool)) setOpenIndex(null);
        return;
      }
      if (paused) return;
      const state = readState();
      if (!promoDue({ spent: clock.spent, state, shownThisVisit: readShown(), now })) return;
      const index = pickPromo(state, now, (tool) => tool === current || unavailable(tool));
      if (index === null) return;
      writeState(afterShown(state, index));
      markShown();
      setOpenIndex(index);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [current, off, openIndex, paused]);

  const promo = openIndex === null ? null : PROMOS[openIndex];

  /** The visitor took the invitation. Returns the tool to open; it keeps its turn. */
  const accept = useCallback(() => {
    setOpenIndex(null);
    return promo?.tool ?? null;
  }, [promo]);

  /** "Not now": this tool rests two weeks, and every invitation a day. */
  const dismiss = useCallback(() => {
    if (promo) recordDismiss(promo.tool);
    setOpenIndex(null);
  }, [promo]);

  const visible = promo && promo.tool !== current && findTool(promo.tool) && !disabledTools.includes(promo.tool);
  return { promo: visible ? promo : null, accept, dismiss };
}
