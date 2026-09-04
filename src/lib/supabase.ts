import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ydcfafijktzasrkkxyux.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_hmcfter-RriY3pKrbZnJqg_2228WwCM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
