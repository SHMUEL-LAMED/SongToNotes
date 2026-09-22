/**
 * Public links to a saved work. The link points at this site with a token;
 * the page behind it asks the share function for the snapshot and shows it
 * to anyone, signed in or not, with a player and a download.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";
import type { SavedWork, WorkKind, WorkOrigin } from "./works";

const SHARE_URL = `${SUPABASE_URL}/functions/v1/share`;

export type SharedWork = {
  kind: WorkKind;
  title: string;
  summary: Record<string, unknown>;
  payload: Record<string, unknown>;
  fileName: string | null;
  fileUrl: string | null;
  createdAt: string;
  views: number;
};

export class ShareError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  signed_out: "כדי ליצור קישור לשיתוף צריך להתחבר לחשבון.",
  not_synced: "העבודה עדיין לא עלתה לענן. התחבר והמתן רגע לסנכרון, ואז נסה שוב.",
  not_found: "הקישור הזה כבר לא פעיל.",
  network: "החיבור לשרת נכשל. נסה שוב.",
};

function describe(code: string) {
  return MESSAGES[code] ?? "השיתוף נכשל. נסה שוב בעוד רגע.";
}

/** The page a token opens on this site. */
export function shareLink(token: string) {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
  return `${base}#/s/${token}`;
}

async function authed(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new ShareError("signed_out", MESSAGES.signed_out);
  return { Authorization: `Bearer ${access}`, apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" };
}

/** Makes (or reuses) the public link for a work the visitor owns. */
export async function createShare(work: Pick<SavedWork, "id" | "origin" | "rowId" | "localOnly">): Promise<string> {
  if (work.localOnly) throw new ShareError("not_synced", MESSAGES.not_synced);
  const origin: WorkOrigin = work.origin;
  const workId = origin === "transcriptions" ? (work.rowId ?? work.id) : work.id;
  const headers = await authed();
  let response: Response;
  try {
    response = await fetch(SHARE_URL, { method: "POST", headers, body: JSON.stringify({ origin, workId }) });
  } catch {
    throw new ShareError("network", MESSAGES.network);
  }
  const body = (await response.json().catch(() => null)) as { token?: string; error?: string } | null;
  if (!response.ok || !body?.token) throw new ShareError(body?.error ?? "http", describe(body?.error ?? "http"));
  return shareLink(body.token);
}

/** One of the visitor's own links, as the personal area lists it. */
export type MyShare = {
  token: string;
  origin: WorkOrigin;
  workId: string;
  kind: WorkKind;
  title: string;
  views: number;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

/** Every link the visitor made, newest first — through RLS, so only theirs. */
export async function listShares(): Promise<MyShare[]> {
  const { data, error } = await supabase
    .from("shares")
    .select("token, origin, work_id, kind, title, views, created_at, expires_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw new ShareError("network", MESSAGES.network);
  return (data ?? []).map((row) => ({
    token: row.token,
    origin: row.origin as WorkOrigin,
    workId: row.work_id,
    kind: row.kind as WorkKind,
    title: row.title,
    views: Number(row.views ?? 0),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
  }));
}

/** Moves the link's expiry `days` from now, or removes it with `null`. */
export async function setShareExpiry(token: string, days: number | null) {
  const headers = await authed();
  let response: Response;
  try {
    response = await fetch(SHARE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ token, expiresInDays: days }),
    });
  } catch {
    throw new ShareError("network", MESSAGES.network);
  }
  const body = (await response.json().catch(() => null)) as { expiresAt?: string | null; error?: string } | null;
  if (!response.ok || !body) throw new ShareError(body?.error ?? "http", describe(body?.error ?? "http"));
  return body.expiresAt ?? null;
}

export async function revokeShare(token: string) {
  const headers = await authed();
  let response: Response;
  try {
    response = await fetch(`${SHARE_URL}?${new URLSearchParams({ token })}`, { method: "DELETE", headers });
  } catch {
    throw new ShareError("network", MESSAGES.network);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ShareError(body?.error ?? "http", describe(body?.error ?? "http"));
  }
}

/** What a token shows: no account needed. */
export async function fetchShare(token: string): Promise<SharedWork> {
  let response: Response;
  try {
    response = await fetch(`${SHARE_URL}?${new URLSearchParams({ token })}`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
  } catch {
    throw new ShareError("network", MESSAGES.network);
  }
  const body = (await response.json().catch(() => null)) as (SharedWork & { error?: string }) | null;
  if (!response.ok || !body || body.error) throw new ShareError(body?.error ?? "not_found", describe(body?.error ?? "not_found"));
  return body;
}

/** The token in the current hash, when the page is a share page. */
export function shareTokenFromRoute(route: string) {
  const match = route.match(/^s\/([a-f0-9]{8,32})$/);
  return match ? match[1] : null;
}
