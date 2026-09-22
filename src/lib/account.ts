/**
 * What the visitor may do with their own account, without asking anybody:
 * take everything, or take it all away. Both go through
 * `supabase/functions/account`, which acts on the caller and only the caller.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";

const ACCOUNT_URL = `${SUPABASE_URL}/functions/v1/account`;

export class AccountError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  signed_out: "צריך להתחבר לחשבון קודם.",
  network: "החיבור לשרת נכשל. בדוק את האינטרנט ונסה שוב.",
  not_deployed: "פונקציית החשבון עדיין לא הועלתה לפרויקט (supabase/functions/account).",
  storage: "השרת לא הצליח לבצע את הפעולה. נסה שוב.",
};

async function call<T>(init: RequestInit & { query?: string }): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new AccountError("signed_out", MESSAGES.signed_out);
  let response: Response;
  try {
    response = await fetch(`${ACCOUNT_URL}${init.query ?? ""}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${access}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
    });
  } catch {
    throw new AccountError("network", MESSAGES.network);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body || body.error) {
    const code = body?.error ?? (response.status === 404 ? "not_deployed" : "storage");
    throw new AccountError(code, MESSAGES[code] ?? "הבקשה נכשלה. נסה שוב בעוד רגע.");
  }
  return body;
}

/** Every row the account owns, as one JSON document. */
export function exportAccount() {
  return call<Record<string, unknown>>({ method: "GET", query: "?view=export" });
}

/** Removes the account, its rows and its files. There is no way back. */
export function deleteAccount() {
  return call<{ deleted: boolean }>({ method: "POST", body: JSON.stringify({ action: "delete" }) });
}
