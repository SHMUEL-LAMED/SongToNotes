/**
 * The Supabase project behind accounts, saving and the server tools.
 *
 * The client library weighs some 200KB and nothing on the first screen needs
 * it, so it is not part of the page: getSupabase() loads it on first use and
 * every later call shares that one client. The address and the public key are
 * plain constants, for the places that talk to the project without the
 * library (the anonymous analytics, the feedback dialog).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://ydcfafijktzasrkkxyux.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_hmcfter-RriY3pKrbZnJqg_2228WwCM";

/** Where supabase-js keeps the session in this browser (its default key). */
export const SESSION_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

let client: Promise<SupabaseClient> | null = null;

/** The client, loaded and created on first use; a failed load is tried again next time. */
export function getSupabase(): Promise<SupabaseClient> {
  client ??= import("@supabase/supabase-js")
    .then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }),
    )
    .catch((error: unknown) => {
      client = null;
      throw error;
    });
  return client;
}

/**
 * The address is a sign-in coming back from Google, with its tokens (or its
 * error) still in it. The page reads them before the router sees the address
 * and sends it home; see main.tsx.
 */
export function authCallbackPending(location: Pick<Location, "hash" | "search"> = window.location) {
  return /(?:^|[#&])(?:access_token|error_description)=/.test(location.hash) || /[?&]code=/.test(location.search);
}
