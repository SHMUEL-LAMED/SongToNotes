/**
 * What visitors tell the site's owner — a problem, an idea, anything else —
 * sent straight into `site_feedback` (supabase/site_feedback.sql), which
 * anyone may add to and only the admin function reads. With the message go
 * the page it was sent from, the site's language and the kind of device and
 * browser, which is what a problem report needs; nothing else about the
 * visitor, and an address only when they wrote one.
 */
import { browserName, classifyDevice, osName } from "./analytics";
import { currentLang } from "./i18n";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase";

export type FeedbackKind = "problem" | "idea" | "other";

export const FEEDBACK_KINDS: { id: FeedbackKind; label: string }[] = [
  { id: "problem", label: "בעיה" },
  { id: "idea", label: "רעיון" },
  { id: "other", label: "אחר" },
];

export const FEEDBACK_MAX = 2000;

export type FeedbackInput = { kind: FeedbackKind; message: string; contact?: string; page: string };

/** The row as the table takes it, or null when there is nothing to send. */
export function feedbackRow(input: FeedbackInput, environment: { width: number; touch: boolean; agent: string; language: string }) {
  const message = input.message.trim().slice(0, FEEDBACK_MAX);
  if (!message || !FEEDBACK_KINDS.some((kind) => kind.id === input.kind)) return null;
  const contact = (input.contact ?? "").trim().slice(0, 200);
  return {
    kind: input.kind,
    message,
    contact: contact || null,
    page: input.page.slice(0, 40) || null,
    language: environment.language.slice(0, 12) || null,
    device: classifyDevice(environment.width, environment.touch),
    browser: browserName(environment.agent).slice(0, 40) || null,
    os: osName(environment.agent).slice(0, 40) || null,
  };
}

/** Sends it; throws when it did not arrive, so the dialog can say so. */
export async function sendFeedback(input: FeedbackInput) {
  const row = feedbackRow(input, {
    width: window.innerWidth,
    touch: navigator.maxTouchPoints > 0,
    agent: navigator.userAgent ?? "",
    language: currentLang(),
  });
  if (!row) throw new Error("empty");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/site_feedback`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`feedback ${response.status}`);
}
