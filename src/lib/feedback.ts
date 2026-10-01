/**
 * What visitors tell the site's owner — a problem, an idea, anything else —
 * sent straight into `site_feedback` (supabase/site_feedback.sql), which
 * anyone may add to and only the admin function reads. With the message go
 * the page it was sent from, the site's language and the kind of device and
 * browser, which is what a problem report needs, and — for a visitor who is
 * signed in — their account, so the owner can see who wrote and answer them.
 * Nothing else about the visitor, and an address only when they wrote one.
 */
import { browserName, classifyDevice, osName } from "./analytics";
import { currentLang } from "./i18n";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getSupabase } from "./supabase";

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

/** The signed-in visitor's account and token, or null; never blocks sending. */
async function currentAccount(): Promise<{ id: string; token: string } | null> {
  try {
    const supabase = await getSupabase();
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    return session?.access_token && session.user?.id ? { id: session.user.id, token: session.access_token } : null;
  } catch {
    return null;
  }
}

function post(row: object, token: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/site_feedback`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
}

/**
 * Sends it; throws when it did not arrive, so the dialog can say so. A
 * signed-in visitor's message goes with their account (the table checks it is
 * really theirs); if that is refused — an old token, or a table from before
 * the column — it goes again without one rather than not at all.
 */
export async function sendFeedback(input: FeedbackInput, signedIn = false) {
  const row = feedbackRow(input, {
    width: window.innerWidth,
    touch: navigator.maxTouchPoints > 0,
    agent: navigator.userAgent ?? "",
    language: currentLang(),
  });
  if (!row) throw new Error("empty");
  const account = signedIn ? await currentAccount() : null;
  if (account) {
    const response = await post({ ...row, user_id: account.id }, account.token);
    if (response.ok) return;
  }
  const response = await post(row, SUPABASE_PUBLISHABLE_KEY);
  if (!response.ok) throw new Error(`feedback ${response.status}`);
}
