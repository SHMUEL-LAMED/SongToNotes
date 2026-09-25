/**
 * What the site's server functions share: CORS, JSON replies, the signed-in
 * visitor, the site's owner, the settings (function secrets first, then
 * private.stt_settings), and the per-account daily allowances kept in
 * public.ai_usage.
 */
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-model, x-provider, x-credits",
};

export function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

/** The signed-in visitor behind the request, or null. */
export async function visitor(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}

const DEFAULT_OWNERS = ["0534169095@xn--4dbjbascrao3i.com", "0534169095@שמואלליווי.com"];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase().normalize("NFC");
}

/** The site's owner: `ADMIN_EMAILS`, or the built-in address when that is not set. */
function owners() {
  const configured = (Deno.env.get("ADMIN_EMAILS") ?? "")
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set((configured.length ? configured : DEFAULT_OWNERS).map(normalizeEmail));
}

/** An unverified address never counts: anybody may type the owner's address. */
export function isOwner(user: User | null) {
  if (!user?.email) return false;
  const verified = Boolean(user.email_confirmed_at) || user.user_metadata?.email_verified === true;
  return verified && owners().has(normalizeEmail(user.email));
}

/** A secret wins; the private table is the fallback for a project set up from the database. */
export async function settings(admin: SupabaseClient) {
  const { data } = await admin.rpc("stt_settings");
  const stored = new Map((data ?? []).map((row: { key: string; value: string }) => [row.key, row.value]));
  return (name: string, ...fallbacks: string[]) => {
    for (const key of [name, ...fallbacks]) {
      const value = Deno.env.get(key)?.trim() || stored.get(key)?.trim();
      if (value) return value;
    }
    return undefined;
  };
}

/** Today's tally of one kind of work for one account. */
export async function usedToday(admin: SupabaseClient, userId: string, kind: string) {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("ai_usage")
    .select("amount")
    .eq("user_id", userId)
    .eq("day", day)
    .eq("kind", kind)
    .maybeSingle();
  return { day, used: Number(data?.amount ?? 0) };
}

export async function recordUsage(admin: SupabaseClient, userId: string, kind: string, amount: number) {
  const { day, used } = await usedToday(admin, userId, kind);
  await admin
    .from("ai_usage")
    .upsert({ user_id: userId, day, kind, amount: used + amount }, { onConflict: "user_id,day,kind" });
  return used + amount;
}
