/**
 * The site's language model, on the server.
 *
 * Four jobs, all through one OpenAI-compatible chat endpoint (Groq by
 * default, the same account as the transcription): tidying a transcript
 * into punctuated paragraphs, summarising it, translating it, and the
 * assistant that answers questions about the tools. The key stays here; a
 * visitor has to be signed in and each account has a daily token allowance.
 *
 * Settings (secrets or private.stt_settings):
 *   AI_API_KEY       falls back to STT_API_KEY
 *   AI_BASE_URL      falls back to STT_BASE_URL, then https://api.openai.com/v1
 *   AI_MODEL         default llama-3.3-70b-versatile; when the service no longer
 *                    serves it, the best model it does list is picked and kept
 *   AI_DAILY_TOKENS  default 300000
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";

const DEFAULT_DAILY_TOKENS = 300_000;
const MAX_INPUT_CHARS = 60_000;
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

/**
 * Model names come and go on the hosted services. In order of preference,
 * the families known to handle Hebrew well; the first one the service
 * lists wins, and anything that is plainly not a chat model is skipped.
 */
const PREFERRED = [
  /gpt-oss-120b/i,
  /llama-4.*maverick/i,
  /llama-4.*scout/i,
  /llama-3\.3-70b/i,
  /qwen3-(32|235)b/i,
  /kimi-k2/i,
  /gpt-oss-20b/i,
  /llama-3\.1-8b/i,
];
const NOT_CHAT = /whisper|tts|guard|embed|orpheus|playai|moderation|rerank|vision-preview/i;

/** Asks the service what it serves and picks the best of it, or null. */
async function discoverModel(base: string, apiKey: string) {
  const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => null);
  if (!response?.ok) return null;
  const parsed = (await response.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  const ids = (parsed?.data ?? []).map((item) => String(item.id ?? "")).filter(Boolean);
  console.log("models served:", ids.join(", "));
  for (const pattern of PREFERRED) {
    const hit = ids.find((id) => pattern.test(id));
    if (hit) return hit;
  }
  return ids.find((id) => !NOT_CHAT.test(id)) ?? null;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

const ASSISTANT_PROMPT = `אתה העוזר של האתר "כלי מוזיקה" (SongToNotes) — אתר עברי חינמי עם כלים למוזיקאים, שעובד בדפדפן בלי להתקין דבר.
הכלים באתר: שיר לתווים (מזהה תווים, קצב וסולם מהקלטה ומייצא תווים, MIDI ו־MusicXML); יצירת צלצול (חיתוך קטע עם כניסה ויציאה רכות והורדה לטלפון); הסרת שירה (קריוקי או שירה בלבד, כולל הפרדת AI); מאט ומאיץ (שינוי קצב בלי לשנות גובה, לתרגול); מטרונום; טיונר (כיוון כלי במיקרופון); פסנתר וירטואלי עם הקלטה; מאמן שמיעה (מרווחים ואקורדים); ניתוח שיר (BPM, סולם ואקורדים); תמלול לטקסט (דיבור לטקסט עם חותמות זמן, עריכה וייצוא TXT/SRT/VTT, וגם סיכום ותרגום עם AI).
יש אזור אישי: כל כלי שומר את העבודה, והקבצים עולים לענן אחרי התחברות עם Google.
ענה בעברית, קצר וברור, בגובה העיניים. אם שואלים על מוזיקה (תיאוריה, אקורדים, סולמות, תרגול) — עזור ברצון. אם שואלים איך לעשות משהו באתר — הסבר איזה כלי לפתוח ומה ללחוץ. אל תמציא תכונות שאין באתר.`;

function prompts(action: string, language: string | null): Message[] {
  switch (action) {
    case "polish":
      return [
        {
          role: "system",
          content:
            "אתה עורך לשוני. קיבלת תמלול גולמי של דיבור. החזר את אותו טקסט עם פיסוק נכון, אותיות רישיות במקומות המתאימים, חלוקה לפסקאות הגיוניות, ותיקון מילים שברור שנשמעו לא נכון מההקשר. אל תוסיף, אל תסכם ואל תשמיט תוכן. שמור על שפת המקור. החזר את הטקסט בלבד, בלי הקדמות.",
        },
      ];
    case "summarize":
      return [
        {
          role: "system",
          content:
            "אתה מסכם הקלטות. קיבלת תמלול. כתוב סיכום בעברית: פסקה קצרה של עיקרי הדברים, ואחריה עד שמונה נקודות עיקריות. אם יש החלטות או משימות שנאמרו — רשום אותן בנפרד תחת הכותרת 'משימות'. החזר את הסיכום בלבד.",
        },
      ];
    case "translate":
      return [
        {
          role: "system",
          content: `אתה מתרגם מקצועי. תרגם את הטקסט הבא ל${language ?? "אנגלית"}, נאמן למקור, טבעי לקריאה, תוך שמירה על חלוקת הפסקאות. החזר את התרגום בלבד.`,
        },
      ];
    default:
      return [{ role: "system", content: ASSISTANT_PROMPT }];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const admin = adminClient();
  const setting = await settings(admin);
  const apiKey = setting("AI_API_KEY", "STT_API_KEY");
  if (!apiKey) return json(503, { error: "not_configured" });
  const base = (setting("AI_BASE_URL", "STT_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  let model = setting("AI_MODEL") ?? DEFAULT_MODEL;
  const limit = Number(setting("AI_DAILY_TOKENS")) || DEFAULT_DAILY_TOKENS;

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  let body: { action?: string; text?: string; language?: string; messages?: Message[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const action = typeof body.action === "string" ? body.action : "chat";
  const language = typeof body.language === "string" ? body.language.slice(0, 40) : null;

  let messages: Message[] = prompts(action, language);
  if (action === "chat") {
    const history = Array.isArray(body.messages) ? body.messages : [];
    const clean = history
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-16)
      .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }));
    if (!clean.length) return json(400, { error: "bad_request" });
    messages = [...messages, ...clean];
  } else {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(400, { error: "bad_request" });
    if (text.length > MAX_INPUT_CHARS) return json(413, { error: "too_large" });
    messages = [...messages, { role: "user", content: text }];
  }

  const { used } = await usedToday(admin, user.id, "ai");
  if (used >= limit) return json(429, { error: "quota", used, limit });

  const ask = (chosen: string) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: chosen, messages, temperature: action === "chat" ? 0.5 : 0.2 }),
    });
  let response: Response;
  try {
    response = await ask(model);
    // The configured model is gone: find what the service serves now, and
    // remember it so the next call does not pay for the lookup.
    if (response.status === 404 || response.status === 400) {
      const detail = await response.clone().text().catch(() => "");
      if (/model|not exist|decommission/i.test(detail)) {
        const found = await discoverModel(base, apiKey);
        if (found && found !== model) {
          console.log("model", model, "unavailable; switching to", found);
          model = found;
          response = await ask(model);
          if (response.ok) {
            await admin.rpc("stt_set_setting", { setting_key: "AI_MODEL", setting_value: model });
          }
        }
      }
    }
  } catch (caught) {
    console.error("language model unreachable", caught);
    return json(502, { error: "provider_unreachable" });
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    console.error("language model refused", response.status, detail);
    if (response.status === 401 || response.status === 403) return json(502, { error: "provider_key" });
    if (response.status === 429) return json(502, { error: "provider_busy" });
    return json(502, { error: "provider_error", status: response.status });
  }
  const parsed = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  const text = parsed.choices?.[0]?.message?.content?.trim() ?? "";
  const tokens = Number(parsed.usage?.total_tokens) || Math.ceil(text.length / 3);
  const total = await recordUsage(admin, user.id, "ai", tokens);
  return json(200, { text, model, tokens, used: total, limit });
});
