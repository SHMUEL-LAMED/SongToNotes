import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "./common.ts";

const DAILY_LIMIT = 300000;
const MAX_INPUT = 60000;
const ROUTES = [
  "notes", "ringtone", "vocals", "speed", "metronome",
  "tuner", "piano", "ear", "transcript", "analyze",
];

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

const SITE_PROMPT = `אתה העוזר של האתר "כלי מוזיקה" (SongToNotes).
ענה בעברית ברורה, מדויקת ומעשית. התאם את ההסבר לרמת המשתמש ואל תמציא יכולות.
כלי האתר: notes שיר לתווים; ringtone יצירת צלצול; vocals הפרדת שירה;
speed האטה והאצה; metronome מטרונום; tuner מכוון כלים; piano פסנתר;
ear מאמן שמיעה; transcript תמלול; analyze זיהוי קצב וסולם.
אפשר לעזור גם בתיאוריה מוזיקלית, אקורדים, סולמות ותרגול.`;

const EXECUTE_PROMPT = `
המשתמש בחר מצב ביצוע. הפעולה היחידה שמותר לבצע היא פתיחת כלי באתר.
אם הבקשה מתאימה בבירור לכלי, הוסף בסוף התשובה תג אחד: [[OPEN:route]]
כאשר route הוא אחד מהנתיבים שברשימה. אל תטען שביצעת העלאה, מחיקה או עיבוד קובץ.
`;

function systemMessages(action: string, language: string | null, mode: string): Message[] {
  if (action === "polish") {
    return [{ role: "system", content: "ערוך את התמלול: תקן פיסוק וחלוקה לפסקאות בלי להוסיף, להשמיט או לסכם. החזר רק את הטקסט." }];
  }
  if (action === "summarize") {
    return [{ role: "system", content: "סכם בעברית את עיקרי התמלול בניסוח ברור, ואחר כך נקודות עיקריות ומשימות אם קיימות." }];
  }
  if (action === "translate") {
    return [{ role: "system", content: `תרגם את הטקסט ל${language || "אנגלית"} בנאמנות ובשפה טבעית. החזר רק את התרגום.` }];
  }
  return [{ role: "system", content: SITE_PROMPT + (mode === "execute" ? EXECUTE_PROMPT : "") }];
}

function extractAction(raw: string, enabled: boolean) {
  if (!enabled) return { text: raw.trim(), action: null };
  for (const route of ROUTES) {
    const tag = `[[OPEN:${route}]]`;
    if (raw.includes(tag)) {
      return {
        text: raw.split(tag).join(" ").trim() || "פותח את הכלי המתאים.",
        action: { type: "navigate", route },
      };
    }
  }
  return { text: raw.trim(), action: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  const admin = adminClient();
  const setting = await settings(admin);
  const apiKey = setting("AI_API_KEY", "STT_API_KEY");
  if (!apiKey) return json(503, { error: "not_configured" });
  const base = (setting("AI_BASE_URL", "STT_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, "");
  const configuredModel = setting("AI_MODEL") || "openai/gpt-oss-20b";
  const limit = Number(setting("AI_DAILY_TOKENS")) || DAILY_LIMIT;

  let body: {
    action?: string;
    text?: string;
    language?: string;
    messages?: Message[];
    mode?: "question" | "execute";
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }

  const action = typeof body.action === "string" ? body.action : "chat";
  const mode = body.mode === "execute" ? "execute" : "question";
  const language = typeof body.language === "string" ? body.language.slice(0, 40) : null;
  let messages = systemMessages(action, language, mode);

  if (action === "chat") {
    const history = Array.isArray(body.messages) ? body.messages : [];
    const clean = history
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-16)
      .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }));
    if (!clean.length) return json(400, { error: "bad_request" });
    messages = messages.concat(clean);
  } else {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(400, { error: "bad_request" });
    if (text.length > MAX_INPUT) return json(413, { error: "too_large" });
    messages.push({ role: "user", content: text });
  }

  const usage = await usedToday(admin, user.id, "ai");
  if (usage.used >= limit) return json(429, { error: "quota", used: usage.used, limit });

  const candidates = [...new Set([configuredModel, "openai/gpt-oss-20b", "llama-3.3-70b-versatile"])];
  let response: Response | null = null;
  let model = configuredModel;

  for (const candidate of candidates) {
    model = candidate;
    try {
      response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          temperature: action === "chat" ? 0.45 : 0.2,
          max_completion_tokens: action === "chat" ? 1200 : 2200,
        }),
      });
    } catch {
      response = null;
    }
    if (response?.ok) break;
    if (response && ![400, 404, 429].includes(response.status)) break;
  }

  if (!response) return json(502, { error: "provider_unreachable" });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return json(502, { error: "provider_key" });
    if (response.status === 429) return json(502, { error: "provider_busy" });
    return json(502, { error: "provider_error", status: response.status });
  }

  const parsed = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  const rawText = parsed.choices?.[0]?.message?.content || "";
  const result = extractAction(rawText, action === "chat" && mode === "execute");
  const text = result.text || "לא הצלחתי להכין תשובה. נסה לנסח שוב.";
  const tokens = Number(parsed.usage?.total_tokens) || Math.ceil(rawText.length / 3);
  const total = await recordUsage(admin, user.id, "ai", tokens);
  return json(200, { text, action: result.action, model, tokens, used: total, limit });
});
