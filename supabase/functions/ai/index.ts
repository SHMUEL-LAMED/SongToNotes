/**
 * The site's language model, on the server.
 *
 * Four jobs through one OpenAI-compatible chat endpoint (Groq by default,
 * the same account as the transcription): tidying a transcript into
 * punctuated paragraphs, summarising it, translating it, and the assistant
 * that answers questions about the tools and about music. The key stays
 * here; a visitor has to be signed in and each account has a daily token
 * allowance.
 *
 * The assistant streams its reply when asked to (`stream: true`), and may
 * end a reply with [[open:tool]] markers that the site turns into buttons.
 *
 * Settings (secrets or private.stt_settings):
 *   AI_API_KEY       falls back to STT_API_KEY
 *   AI_BASE_URL      falls back to STT_BASE_URL, then https://api.openai.com/v1
 *   AI_MODEL         the model to try first; when the service no longer serves
 *                    it, the best one it lists is picked and remembered
 *   AI_DAILY_TOKENS  default 300000
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "./common.ts";

const DEFAULT_DAILY_TOKENS = 300_000;
const MAX_INPUT_CHARS = 60_000;
const DEFAULT_MODEL = "openai/gpt-oss-120b";
/** Tried in order after the configured model, before asking the service what it has. */
const FALLBACK_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
/** Every tool the assistant may point at; anything else in a marker is dropped. */
const TOOLS = [
  "notes", "ringtone", "vocals", "speed", "metronome", "tuner", "piano", "ear",
  "transcript", "analyze", "chords", "songbook", "convert", "video", "rhythm",
  "mixer", "lyrics", "tts", "identify",
];

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

const ASSISTANT_PROMPT = `אתה "העוזר" של האתר "כלי מוזיקה" (SongToNotes) — אתר עברי חינמי עם כלים למוזיקאים שעובד בדפדפן, בלי להתקין ובלי להוריד דבר. אתה חם, ענייני ומדויק. עונה בעברית (או בשפה שבה פנו אליך), במשפטים קצרים, ברשימות או בצעדים כשזה עוזר, ובלי מילים מיותרות. אל תמציא תכונות שאין באתר; אם אינך בטוח, אמור זאת. אין לך גישה לקבצים של הגולש או לתוצאות שלו — אתה מסביר ומדריך, והגולש מבצע בכלי.

הכלים באתר (מזהה בסוגריים) ואיך משתמשים בהם:
- שיר לתווים (notes): מעלים שיר, מזמזמים או שרים למיקרופון; האתר מזהה תווים, קצב וסולם ומייצא תווים, MIDI, MusicXML ו־ABC. אפשר לסמן קטע בגל הקול, לבחור כלי נגינה לניגון ולערוך את הקצב.
- יצירת צלצול (ringtone): בוחרים קטע בגל הקול (ברירת מחדל 30 שניות), כניסה ויציאה רכות, עוצמה; הורדה M4R לאייפון או MP3/WAV לאנדרואיד, עם הוראות התקנה.
- הסרת שירה (vocals): "ליווי בלבד (קריוקי)" או "שירה בלבד". הפרדה מהירה בדפדפן לפי תמונת הסטריאו (טובה כשהשירה במרכז), או "הפרדה מלאה עם AI" שרצה בשרת ונותנת תוצאה נקייה בהרבה, גם למונו. דורשת התחברות.
- מאט ומאיץ (speed): משנים מהירות בלי לשנות גובה, או גובה בלי לשנות מהירות; לולאה על קטע; ייצוא.
- מטרונום (metronome): BPM, משקל, חלוקות משנה, הדגשות, טאפ־טמפו; עובד גם כשהמסך כבוי.
- מכוון כלים / טיונר (tuner): כרומטי מהמיקרופון, מראה סנטים; לגיטרה, כינור, יוקללה וקול.
- פסנתר וירטואלי (piano): מנגנים בעכבר, במגע או במקלדת; הדגשת סולמות; הקלטה ושליחה לכלי התווים.
- מאמן שמיעה (ear): מרווחים, סוגי אקורדים ודרגות בסולם; רמות קושי, ניקוד ורצף.
- תמלול לטקסט (transcript): דיבור לטקסט עם חותמות זמן, בשרת, גם הקלטות של שעות; עריכה במקום; ייצוא TXT/SRT/VTT; כרטיס "עיבוד עם AI": פיסוק ופסקאות, סיכום, תרגום. דורש התחברות.
- מזהה קצב וסולם (analyze): BPM, סולם, Camelot לדי־ג'יי, עוצמה.
- מזהה אקורדים לגיטרה (chords): אקורדים לאורך השיר עם דיאגרמות אחיזה, טרנספוזיציה וקאפו, דף אקורדים להורדה, שליחה לשירון.
- שירון (songbook): מילים עם אקורדים מעליהן (כותבים [Am] לפני המילה), טרנספוזיציה, גלילה אוטומטית להופעה, הדפסה, שמירה.
האזור האישי: כפתור בראש כל עמוד; כל כלי שומר את העבודה ("שמור"), והקבצים עולים לענן אחרי התחברות עם Google וזמינים מכל מכשיר. ההתחברות חינמית.

כשמתאים להפנות לכלי, סיים את התשובה בשורה נפרדת עם סמן בפורמט [[open:מזהה]] — למשל [[open:transcript]] — והאתר יציג אותו ככפתור שפותח את הכלי. עד שני סמנים בתשובה, ורק לכלים שברשימה. כשהגולש מבקש "פתח לי" או "קח אותי" — ענה במשפט אחד והוסף את הסמן.

בנוסף אתה מורה למוזיקה: תיאוריה, אקורדים, סולמות, קצב, טכניקה, טיפים לתרגול — ענה בבהירות, עם דוגמאות קצרות. אפשר להשתמש ב־Markdown פשוט: כותרות קצרות, רשימות, הדגשה.`;

function prompts(action: string, language: string | null): Message[] {
  switch (action) {
    case "polish":
      return [{
        role: "system",
        content: "אתה עורך לשוני. קיבלת תמלול גולמי של דיבור. החזר את אותו טקסט עם פיסוק נכון, אותיות רישיות במקומות המתאימים, חלוקה לפסקאות הגיוניות, ותיקון מילים שברור שנשמעו לא נכון מההקשר. אל תוסיף, אל תסכם ואל תשמיט תוכן. שמור על שפת המקור. החזר את הטקסט בלבד, בלי הקדמות.",
      }];
    case "summarize":
      return [{
        role: "system",
        content: "אתה מסכם הקלטות. קיבלת תמלול. כתוב סיכום בעברית: פסקה קצרה של עיקרי הדברים, ואחריה עד שמונה נקודות עיקריות. אם יש החלטות או משימות שנאמרו — רשום אותן בנפרד תחת הכותרת 'משימות'. החזר את הסיכום בלבד.",
      }];
    case "translate":
      return [{
        role: "system",
        content: `אתה מתרגם מקצועי. תרגם את הטקסט הבא ל${language ?? "אנגלית"}, נאמן למקור, טבעי לקריאה, תוך שמירה על חלוקת הפסקאות. החזר את התרגום בלבד.`,
      }];
    case "speakers":
      return [{
        role: "system",
        content: "קיבלת תמלול של שיחה, שורה לכל משפט. זהה כמה דוברים שונים משתתפים לפי התוכן והסגנון, וסמן כל שורה בתחילתה בשם 'דובר 1:', 'דובר 2:' וכן הלאה (אם שם הדובר נאמר במפורש — השתמש בו). שמור בדיוק על אותו מספר שורות ואותו סדר, ואל תשנה את הטקסט עצמו. החזר את השורות בלבד.",
      }];
    default:
      return [{ role: "system", content: ASSISTANT_PROMPT }];
  }
}

/** The [[open:tool]] markers out of a reply: the text without them, and the tools. */
function extractTools(raw: string) {
  const tools: string[] = [];
  const text = raw
    .replace(/\[\[open:([a-z-]+)\]\]/gi, (_, id: string) => {
      const clean = id.toLowerCase();
      if (TOOLS.includes(clean) && !tools.includes(clean)) tools.push(clean);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, tools: tools.slice(0, 2) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const admin = adminClient();
  const setting = await settings(admin);
  const apiKey = setting("AI_API_KEY", "STT_API_KEY");
  if (!apiKey) return json(503, { error: "not_configured" });
  const base = (setting("AI_BASE_URL", "STT_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const configured = setting("AI_MODEL") ?? DEFAULT_MODEL;
  const limit = Number(setting("AI_DAILY_TOKENS")) || DEFAULT_DAILY_TOKENS;

  const user = await visitor(req);
  if (!user) return json(401, { error: "signed_out" });

  let body: {
    action?: string;
    text?: string;
    language?: string;
    messages?: Message[];
    tool?: string;
    stream?: boolean;
    detailed?: boolean;
  };
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
    const tool = typeof body.tool === "string" ? body.tool.replace(/[^a-z-]/g, "").slice(0, 30) : "";
    const context = [
      tool ? `הגולש נמצא כרגע בכלי "${tool}". אם שאלתו קשורה אליו, הסבר עליו ישירות.` : "הגולש בדף הבית של האתר.",
      body.detailed ? "הגולש ביקש הסברים מפורטים: צעדים, דוגמה, ומה לעשות אם משהו לא עובד." : "השב בקצרה; הרחב רק אם מבקשים.",
    ].join(" ");
    messages = [...messages, { role: "system", content: context }, ...clean];
  } else {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(400, { error: "bad_request" });
    if (text.length > MAX_INPUT_CHARS) return json(413, { error: "too_large" });
    messages = [...messages, { role: "user", content: text }];
  }

  const { used } = await usedToday(admin, user.id, "ai");
  if (used >= limit) return json(429, { error: "quota", used, limit });

  const wantStream = action === "chat" && body.stream === true;
  const ask = (chosen: string) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chosen,
        messages,
        temperature: action === "chat" ? 0.45 : 0.2,
        max_completion_tokens: action === "chat" ? 1400 : 2400,
        ...(wantStream ? { stream: true } : {}),
      }),
    });

  // The configured model first, then the known good ones, then whatever
  // the service says it serves. A model that answered is remembered.
  const candidates = [...new Set([configured, ...FALLBACK_MODELS])];
  let response: Response | null = null;
  let model = configured;
  const gone = (status: number) => status === 404 || status === 400;
  try {
    for (const candidate of candidates) {
      model = candidate;
      response = await ask(candidate);
      if (response.ok || !gone(response.status)) break;
    }
    if (response && gone(response.status)) {
      const found = await discoverModel(base, apiKey);
      if (found && !candidates.includes(found)) {
        model = found;
        response = await ask(found);
      }
    }
  } catch (caught) {
    console.error("language model unreachable", caught);
    return json(502, { error: "provider_unreachable" });
  }
  if (!response) return json(502, { error: "provider_unreachable" });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    console.error("language model refused", response.status, detail);
    if (response.status === 401 || response.status === 403) return json(502, { error: "provider_key" });
    if (response.status === 429) return json(502, { error: "provider_busy" });
    return json(502, { error: "provider_error", status: response.status });
  }
  if (model !== configured) {
    await admin.rpc("stt_set_setting", { setting_key: "AI_MODEL", setting_value: model }).catch(() => undefined);
  }

  if (wantStream && response.body) {
    // Tokens flow straight through as they arrive; the usage is counted
    // from what went by and recorded once the stream has closed.
    let characters = 0;
    const decoder = new TextDecoder();
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        characters += decoder.decode(chunk, { stream: true }).length;
        controller.enqueue(chunk);
      },
      async flush() {
        await recordUsage(admin, user.id, "ai", Math.ceil(characters / 4) + 300);
      },
    });
    return new Response(response.body.pipeThrough(counter), {
      headers: {
        ...CORS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Model": model,
      },
    });
  }

  const parsed = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  const raw = parsed.choices?.[0]?.message?.content?.trim() ?? "";
  const { text, tools } = action === "chat" ? extractTools(raw) : { text: raw, tools: [] };
  const tokens = Number(parsed.usage?.total_tokens) || Math.ceil(raw.length / 3);
  const total = await recordUsage(admin, user.id, "ai", tokens);
  return json(200, {
    text: text || (action === "chat" ? "לא הצלחתי להכין תשובה. נסה לנסח שוב." : ""),
    tools,
    action: tools[0] ? { type: "navigate", route: tools[0] } : null,
    model,
    tokens,
    used: total,
    limit,
  });
});
