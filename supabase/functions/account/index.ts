/**
 * What a visitor may do with their own account, without asking anybody.
 *
 * GET  ?view=export   every row this account owns, as one JSON document
 * POST {action:"delete"}  removes the account, its rows and its files
 *
 * Both act on the caller and only on the caller: the id comes from the token,
 * never from the request, so there is nothing to tamper with. The service role
 * is used because deleting an account is not something the row policies allow
 * anybody to do to themselves — the work here is to make sure it is themselves.
 */
import { CORS, adminClient, json, visitor } from "../_shared/common.ts";

const BUCKET = "works";
const PREVIEW = { ...CORS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: PREVIEW });

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });
  const admin = adminClient();

  try {
    if (req.method === "GET") {
      const mine = (table: string, column = "user_id") =>
        admin.from(table).select("*").eq(column, user.id);

      const [profile, works, transcriptions, ringtones, shares, chats, files, credits, creditHistory] = await Promise.all([
        admin.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        mine("works"),
        mine("transcriptions"),
        mine("ringtones"),
        mine("shares"),
        mine("assistant_chats"),
        admin.storage.from(BUCKET).list(user.id, { limit: 1000 }),
        // The addresses are kept only as salted hashes, and are of no use to anybody outside the site.
        admin.from("credit_accounts").select("code, bonus, friends, referred_at, created_at").eq("user_id", user.id).maybeSingle(),
        admin.from("credit_ledger").select("at, kind, action, delta, refunded").eq("user_id", user.id).order("at", { ascending: false }).limit(5000),
      ]);

      return json(200, {
        exportedAt: new Date().toISOString(),
        account: {
          id: user.id,
          email: user.email,
          createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at ?? null,
        },
        profile: profile.data ?? null,
        works: works.data ?? [],
        transcriptions: transcriptions.data ?? [],
        ringtones: ringtones.data ?? [],
        shares: shares.data ?? [],
        chats: chats.data ?? [],
        credits: credits.data ?? null,
        creditHistory: creditHistory.data ?? [],
        files: (files.data ?? []).map((file) => ({
          name: file.name,
          size: (file.metadata as { size?: number } | null)?.size ?? 0,
          updatedAt: file.updated_at ?? null,
        })),
      });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { action?: string };
      if (body.action !== "delete") return json(400, { error: "bad_request" });

      // The files first: deleting the account cascades the rows, and an
      // orphaned folder in the bucket would outlive everything else.
      const { data: files } = await admin.storage.from(BUCKET).list(user.id, { limit: 1000 });
      const paths = (files ?? []).map((file) => `${user.id}/${file.name}`);
      if (paths.length) await admin.storage.from(BUCKET).remove(paths);

      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) {
        console.error("account delete failed", error);
        return json(502, { error: "storage" });
      }
      return json(200, { deleted: true, files: paths.length });
    }
  } catch (error) {
    console.error("account failed", error);
    return json(502, { error: "storage" });
  }

  return json(405, { error: "method" });
});
