/**
 * The site's language model, on the server.
 *
 * Four jobs through one OpenAI-compatible chat endpoint: tidying a transcript
 * into punctuated paragraphs, summarising it, translating it, and the
 * assistant — which answers questions about the tools and about music, and
 * carries out what the visitor asks for on the site. The key stays here; a
 * visitor has to be signed in and each account has a daily token allowance.
 *
 * ## Providers
 *
 * Chat is a commodity, and several services give it away: this function
 * knows a dozen of them ({@link PROVIDERS}) and uses whichever ones the
 * project has a key for, in order, moving to the next the moment one is
 * busy, out of quota, broken, or no longer serves the model it was asked
 * for. Nothing has to be configured beyond dropping a key in: a key named
 * for a provider (GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY…) turns it
 * on, and `AI_PROVIDERS` fixes the order when the default one is not what
 * the project wants. The older AI_API_KEY / AI_BASE_URL / AI_MODEL still
 * work and are tried first, so an existing project keeps behaving exactly
 * as it did.
 *
 * The assistant streams its reply when asked to (`stream: true`), and may
 * end a reply with ```action blocks that the site runs — see
 * `src/lib/assistantProtocol.ts` for the parsing and
 * `src/lib/assistantActions.ts` for what the actions are.
 *
 * Settings (function secrets, or rows in private.stt_settings):
 *   AI_PROVIDERS      the providers to try, in order, comma-separated
 *   AI_API_KEY        a key for a service not in the list (with AI_BASE_URL)
 *   AI_BASE_URL       that service's base URL
 *   AI_MODEL          the model to try first on it
 *   AI_DAILY_TOKENS   default 5000000
 *   <NAME>_API_KEY    a key for one of the known providers
 *
 * Every request is paid for in credits (supabase/credits.sql): a message to
 * the assistant is the "assistant" price, and the text work the "text" price
 * for every 10,000 characters. A request the services could not answer gives
 * its credits back.
 */
import { CORS, adminClient, json, recordUsage, settings, usedToday, visitor } from "../_shared/common.ts";
import { charge, creditHeaders, creditSummary, refund, refused } from "../_shared/credits.ts";
import { textUnits } from "../_shared/pricing.ts";

/**
 * The daily allowance, in tokens. The free providers below cost nothing, so
 * this is a guard against one account burning a shared key rather than a
 * price: it is set high enough that ordinary use never meets it.
 */
const DEFAULT_DAILY_TOKENS = 5_000_000;
const MAX_INPUT_CHARS = 200_000;
/**
 * How much of a conversation goes to the model. Today's models hold 128k
 * tokens and more, so a conversation has to be very long indeed before
 * anything is left out — and when it is, the oldest turns go and the model
 * is told, rather than the request failing.
 */
const HISTORY_CHARS = 400_000;
const MAX_TURNS = 200;

type Provider = {
  id: string;
  label: string;
  base: string;
  /** The setting names that hold this provider's key, in order. */
  keys: string[];
  /** Tried in order; the first that answers is remembered. */
  models: string[];
  /** Some services still reject `max_completion_tokens`. */
  tokenParam?: "max_tokens" | "max_completion_tokens";
  /** Free of charge at the time of writing, within a daily or per-minute allowance. */
  free: boolean;
  /** Extra headers the service asks for. */
  headers?: Record<string, string>;
};

/**
 * The services this function can talk to. All of them speak the OpenAI chat
 * API, so the only differences are the address, the key and the model names.
 * The order here is the default order they are tried in: the fastest free
 * ones first, the paid ones last.
 */
const PROVIDERS: Provider[] = [
  {
    id: "groq",
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    keys: ["GROQ_API_KEY", "AI_GROQ_KEY", "STT_API_KEY"],
    // llama-3.3-70b-versatile was retired by Groq (it answers 404 now).
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
    free: true,
  },
  {
    id: "cerebras",
    label: "Cerebras",
    base: "https://api.cerebras.ai/v1",
    keys: ["CEREBRAS_API_KEY", "AI_CEREBRAS_KEY"],
    models: ["gpt-oss-120b", "llama-3.3-70b", "qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"],
    free: true,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_GEMINI_KEY"],
    models: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"],
    tokenParam: "max_tokens",
    free: true,
  },
  {
    id: "github",
    label: "GitHub Models",
    base: "https://models.github.ai/inference",
    keys: ["GITHUB_MODELS_TOKEN", "GITHUB_TOKEN", "AI_GITHUB_KEY"],
    models: ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "meta/Llama-3.3-70B-Instruct", "mistral-ai/Mistral-Nemo"],
    tokenParam: "max_tokens",
    free: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    keys: ["OPENROUTER_API_KEY", "AI_OPENROUTER_KEY"],
    // The ":free" suffix is OpenRouter's own marker for a model that costs nothing.
    models: [
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
      "mistralai/mistral-small-3.2-24b-instruct:free",
    ],
    free: true,
    headers: { "HTTP-Referer": "https://shmuel-lamed.github.io/SongToNotes/", "X-Title": "SongToNotes" },
  },
  {
    id: "mistral",
    label: "Mistral",
    base: "https://api.mistral.ai/v1",
    keys: ["MISTRAL_API_KEY", "AI_MISTRAL_KEY"],
    models: ["mistral-small-latest", "open-mistral-nemo", "mistral-large-latest"],
    tokenParam: "max_tokens",
    free: true,
  },
  {
    id: "sambanova",
    label: "SambaNova",
    base: "https://api.sambanova.ai/v1",
    keys: ["SAMBANOVA_API_KEY", "AI_SAMBANOVA_KEY"],
    models: ["Meta-Llama-3.3-70B-Instruct", "Llama-4-Maverick-17B-128E-Instruct", "Meta-Llama-3.1-8B-Instruct"],
    tokenParam: "max_tokens",
    free: true,
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    base: "https://integrate.api.nvidia.com/v1",
    keys: ["NVIDIA_API_KEY", "AI_NVIDIA_KEY"],
    models: ["meta/llama-3.3-70b-instruct", "openai/gpt-oss-120b", "qwen/qwen3-235b-a22b"],
    tokenParam: "max_tokens",
    free: true,
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    base: "https://router.huggingface.co/v1",
    keys: ["HF_TOKEN", "HUGGINGFACE_API_KEY", "AI_HF_KEY"],
    models: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "mistralai/Mistral-Nemo-Instruct-2407"],
    tokenParam: "max_tokens",
    free: true,
  },
  {
    id: "together",
    label: "Together",
    base: "https://api.together.xyz/v1",
    keys: ["TOGETHER_API_KEY", "AI_TOGETHER_KEY"],
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"],
    tokenParam: "max_tokens",
    free: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    base: "https://api.deepseek.com/v1",
    keys: ["DEEPSEEK_API_KEY", "AI_DEEPSEEK_KEY"],
    models: ["deepseek-chat"],
    tokenParam: "max_tokens",
    free: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    keys: ["OPENAI_API_KEY", "AI_OPENAI_KEY"],
    models: ["gpt-4.1-mini", "gpt-4o-mini"],
    free: false,
  },
];

/** A service with a key, ready to be asked. */
type Endpoint = { id: string; label: string; base: string; apiKey: string; models: string[]; tokenParam: string; headers: Record<string, string>; free: boolean };

type Setting = (name: string, ...fallbacks: string[]) => string | undefined;

/**
 * Which services this project can use, in the order to try them.
 *
 * A project that set AI_API_KEY and AI_BASE_URL by hand keeps that first —
 * it is a deliberate choice. After it come the providers named in
 * AI_PROVIDERS, and then every other provider a key was found for, free
 * ones before paid ones. The model remembered from a previous request
 * ({@link AI_MODEL}) moves to the front of its own provider's list.
 */
function endpoints(setting: Setting): Endpoint[] {
  const list: Endpoint[] = [];
  const remembered = setting("AI_MODEL");
  const custom = setting("AI_API_KEY");
  const customBase = setting("AI_BASE_URL", "STT_BASE_URL");
  if (custom && customBase) {
    const base = customBase.replace(/\/+$/, "");
    const known = PROVIDERS.find((provider) => base.startsWith(provider.base.replace(/\/+$/, "")));
    list.push({
      id: known?.id ?? "custom",
      label: known?.label ?? "השירות שהוגדר",
      base,
      apiKey: custom,
      models: [...new Set([remembered, ...(known?.models ?? [])].filter((item): item is string => Boolean(item)))],
      tokenParam: known?.tokenParam ?? "max_completion_tokens",
      headers: known?.headers ?? {},
      free: known?.free ?? false,
    });
  }

  const wanted = (setting("AI_PROVIDERS") ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const ordered = [
    ...wanted.map((id) => PROVIDERS.find((provider) => provider.id === id)).filter((item): item is Provider => Boolean(item)),
    ...PROVIDERS.filter((provider) => !wanted.includes(provider.id)).sort((a, b) => Number(b.free) - Number(a.free)),
  ];
  for (const provider of ordered) {
    if (list.some((item) => item.id === provider.id)) continue;
    const apiKey = setting(...provider.keys);
    if (!apiKey) continue;
    const models = remembered && provider.models.includes(remembered) ? [remembered, ...provider.models.filter((item) => item !== remembered)] : provider.models;
    list.push({
      id: provider.id,
      label: provider.label,
      base: provider.base,
      apiKey,
      models,
      tokenParam: provider.tokenParam ?? "max_completion_tokens",
      headers: provider.headers ?? {},
      free: provider.free,
    });
  }
  return list;
}

/**
 * Model names come and go on the hosted services. In order of preference,
 * the families known to handle Hebrew well; the first one the service
 * lists wins, and anything that is plainly not a chat model is skipped.
 */
const PREFERRED = [
  /gpt-oss-120b/i,
  /gemini-2\.\d-flash$/i,
  /llama-4.*maverick/i,
  /llama-3\.3-70b/i,
  /qwen3?-(32|72|235)b/i,
  /mistral-small/i,
  /kimi-k2/i,
  /gpt-oss-20b/i,
  /gpt-4[.o]/i,
  /llama-3\.1-8b/i,
];
const NOT_CHAT = /whisper|tts|guard|embed|orpheus|playai|moderation|rerank|vision-preview|image|video|veo|imagen|aqa|gecko/i;

/** What else the service says it serves, when none of the known names worked. */
async function discoverModel(endpoint: Endpoint) {
  const response = await fetch(`${endpoint.base}/models`, {
    headers: { Authorization: `Bearer ${endpoint.apiKey}`, ...endpoint.headers },
  }).catch(() => null);
  if (!response?.ok) return null;
  const parsed = (await response.json().catch(() => null)) as { data?: { id?: string }[] } | null;
  const ids = (parsed?.data ?? []).map((item) => String(item.id ?? "").replace(/^models\//, "")).filter(Boolean);
  if (!ids.length) return null;
  console.log(`${endpoint.id} serves:`, ids.slice(0, 40).join(", "));
  for (const pattern of PREFERRED) {
    const hit = ids.find((id) => pattern.test(id) && !NOT_CHAT.test(id));
    if (hit) return hit;
  }
  return ids.find((id) => !NOT_CHAT.test(id)) ?? null;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

// The song identifier (identify) is hidden from the site for now, so the
// assistant is not told about it; its line comes back here with the tool.
const TOOL_LIST = `- שיר לתווים (notes): מעלים שיר, מזמזמים או שרים למיקרופון; האתר מזהה תווים, קצב וסולם ומייצא תווים, MIDI, MusicXML ו־ABC. אפשר לסמן קטע בגל הקול, לבחור כלי נגינה לניגון ולערוך את הקצב.
- יצירת צלצול (ringtone): בוחרים קטע בגל הקול (ברירת מחדל 30 שניות), כניסה ויציאה רכות, עוצמה; הורדה לטלפון. האתר מזהה לבד את הפזמון, הבית וקטע מוזיקלי.
- הסרת שירה (vocals): "ליווי בלבד (קריוקי)" או "שירה בלבד". הפרדה מהירה בדפדפן לפי תמונת הסטריאו (טובה כשהשירה במרכז), או "הפרדה מלאה עם AI" שנותנת תוצאה נקייה בהרבה, גם למונו. במצב מקצועי מפרידים לערוצים נפרדים — שירה, תופים, בס ושאר הכלים — עם עוצמה, פאן, השתקה וסולו לכל אחד.
- מאט ומאיץ (speed): משנים מהירות בלי לשנות גובה, או גובה בלי לשנות מהירות; לולאה על קטע; ייצוא WAV.
- מטרונום (metronome): BPM, משקל, חלוקות משנה, הדגשות, טאפ־טמפו; עובד גם כשהמסך כבוי.
- מכוון כלים / טיונר (tuner): כרומטי מהמיקרופון, מראה סנטים; לגיטרה, בס, כינור, יוקללה, צ׳לו; כיוון לה 430–450 Hz וצלילי ייחוס למיתרים.
- פסנתר וירטואלי (piano): מנגנים בעכבר, במגע או במקלדת; שלושה צלילים, הדגשת סולמות, פדל סוסטיין, הקלטה וייצוא MIDI.
- מאמן שמיעה (ear): מרווחים, סוגי אקורדים ודרגות בסולם; שלוש רמות, ניקוד ורצף הצלחות.
- מאמן קצב (rhythm): תבניות קצב בשלוש רמות; ספירה ואז הקשה, וכל הקשה נמדדת מול שעון האודיו עם ציון ונטייה להקדים או לאחר.
- תמלול לטקסט (transcript): דיבור לטקסט עם חותמות זמן, בשרת, גם הקלטות של שעות; עריכה במקום; ייצוא TXT/SRT/VTT; עיבוד AI: פיסוק ופסקאות, סיכום, תרגום וזיהוי דוברים. דורש התחברות.
- מילים מסונכרנות (lyrics): מילות השיר עם זמן לכל מילה, קריוקי שנדלק מילה אחר מילה, ייצוא LRC, LRC מילה־מילה ו־SRT. דורש התחברות.
- מזהה קצב וסולם (analyze): BPM, סולם, קוד Camelot לדי־ג'יי, פרופיל צלילים ועוצמה — בשניות.
- מזהה אקורדים לגיטרה (chords): אקורדים לאורך השיר עם דיאגרמות אחיזה, טרנספוזיציה וקאפו, דף אקורדים להורדה ושליחה לשירון.
- שירון (songbook): מילים עם אקורדים מעליהן (כותבים [Am] לפני המילה שבה האקורד מתחלף, וכותרת קטע כמו [פזמון] בשורה לבד), טרנספוזיציה, גלילה אוטומטית להופעה, הדפסה ושמירה.
- המרת פורמטים (convert): כל קובץ שמע ל־MP3 או WAV עם קצב דגימה, ערוצים, איכות, חיתוך ועוצמה — בדפדפן.
- וידאו לאודיו (video): פס הקול של סרטון כ־MP3 או WAV, או ישר לכל כלי אחר באתר.
- מיקסר ולופר (mixer): עד שמונה ערוצים עם עוצמה, פאן, השתקה, סולו והזזה, לולאה על קטע, ומיקס אחד ל־WAV.
- טקסט לדיבור (tts): הקראה בקולות של המכשיר, וקובץ MP3 מהשרת (דורש התחברות).
- מכונת תופים (beats): רשת של 16 צעדים ושמונה כלי הקשה מסונתזים (בס־דראם, סנר, מחיאה, היי־האט סגור ופתוח, שני טומים, קאובל), הדגשות, סווינג, סגנונות מוכנים, ביט אקראי, שמירת ביטים במכשיר, והורדת לולאה כ־WAV או שליחה למיקסר ולהמרה.
- סייר תאוריה (theory): מעגל קווינטות אינטראקטיבי, 12 סולמות ומודוסים, התווים והמרווחים, הסולם על פסנתר ועל צוואר גיטרה, האקורדים של כל דרגה (משולשים או ספטאקורדים) ומהלכים מוכרים — הכול עם השמעה.`;

const ASSISTANT_PROMPT = `אתה "העוזר" של האתר "כלי מוזיקה" (SongToNotes) — אתר עברי חינמי עם כלים למוזיקאים שעובד בדפדפן, בלי להתקין ובלי להוריד דבר. אתה חם, ענייני ומדויק. עונה בעברית (או בשפה שבה פנו אליך), במשפטים קצרים, ובלי מילים מיותרות. אל תמציא תכונות שאין באתר; אם אינך בטוח, אמור זאת.

הכלים באתר (המזהה בסוגריים):
${TOOL_LIST}

האזור האישי: כפתור בראש כל עמוד; כל כלי שומר את העבודה, והקבצים עולים לענן אחרי התחברות עם Google וזמינים מכל מכשיר. ההתחברות חינמית. אפשר ליצור קישור ציבורי לכל עבודה שמורה.

קרדיטים: הכלים שרצים בדפדפן חינמיים ובלי הגבלה. פעולות שרצות בשרת עולות קרדיטים — הודעה לעוזר, תמלול ומילים מסונכרנות (לפי דקות), עיבוד טקסט ב־AI (לפי אורך), הקראה לקובץ MP3, הפרדת שירה ב־AI וזיהוי שיר. כל חשבון מחובר מקבל קצבה חינמית בכל יום (מתחדשת בחצות, שעון ישראל). לכל חשבון יש קישור אישי: מי שנכנס דרכו מזכה בקרדיט, וחבר שמצטרף דרכו מזכה בבונוס גדול ומגדיל לתמיד את הקצבה היומית; החבר מקבל מתנת הצטרפות. בונוס לא פג. אם פעולה נכשלת, הקרדיטים חוזרים. אי אפשר לקנות קרדיטים. הכול מוסבר בדף "קרדיטים והזמנת חברים" (credits.open), והמספרים המדויקים של הגולש ב־credits.read.

בנוסף אתה מורה למוזיקה: תיאוריה, אקורדים, סולמות, קצב, טכניקה וטיפים לתרגול — בבהירות ועם דוגמאות קצרות. אפשר להשתמש ב־Markdown פשוט: כותרות קצרות, רשימות, הדגשה.`;

/** How the model keeps a task list the panel shows as it goes. */
const PLAN_FORMAT = `תוכנית נכתבת בבלוק בפורמט הזה, שלב בשורה, בגוף ציווי קצר (עד שמונה שלבים):

\`\`\`plan
- [x] שלב שהושלם
- [~] השלב שבביצוע עכשיו
- [ ] שלב שעוד לא התחיל
\`\`\``;

/** What is added in agent mode: plan, act, check, and carry on until done. */
const ACTION_PROTOCOL = `אתה במצב סוכן: אתה מבצע את המשימה עד הסוף בעצמך, בלי לבקש אישור ובלי לשאול שאלות שאפשר לענות עליהן לבד. הגולש כבר אישר מראש כל פעולה.

איך לעבוד:
1. משימה של יותר מפעולה אחת — פתח בבלוק plan עם השלבים, ואז בצע את הראשונים מיד באותה תשובה.
2. כדי לבצע פעולה באתר, כתוב בלוק:

\`\`\`action
{"action": "שם_הפעולה", "params": {"פרמטר": "ערך"}}
\`\`\`

3. אחרי כל סבב תקבל "[תוצאות פעולות]". עדכן את בלוק ה־plan (סמן [x] מה שהושלם) והמשך לשלבים הבאים — עד שכל השלבים מסומנים.
4. כשהכול הושלם, כתוב סיכום קצר של מה נעשה, עם plan שכל שלביו [x].

${PLAN_FORMAT}

כללים:
- בלוק אחד לכל פעולה. כמה פעולות — כמה בלוקים, בסדר שבו הן צריכות לרוץ. עד שמונה בכל תשובה.
- השתמש רק בפעולות שברשימה למטה ורק בפרמטרים שלהן, באותיות ובאיות המדויקים. פרמטר עם ? הוא רשות.
- פעולה של כלי אחר פותחת את הכלי בעצמה — אין צורך ב־navigate לפניה.
- כתוב משפט קצר לפני הבלוקים שאומר מה אתה עושה. אל תכתוב "בוצע" לפני שקיבלת תוצאה.
- פעולות שמסומנות [קריאה] מחזירות לך מידע: בקש אותן, המתן לתוצאה, ורק אז המשך.
- הסתמך רק על [תוצאות פעולות] — אל תניח שפעולה הצליחה. אם פעולה נכשלה, נסה דרך אחרת; אם באמת חסר משהו מהגולש (קובץ, הקלטה) — אמור בדיוק מה.
- אינך יכול לבחור קובץ מהמכשיר של הגולש, להקליט במקומו או ללחוץ על דברים שאינם ברשימה.
- כשהגולש מבקש תוכן (שיר, מילים, טקסט להקראה) — חבר אותו בעצמך וכתוב אותו לתוך הכלי בפעולה, אל תבקש ממנו לכתוב.
- אל תמציא מזהי עבודות: works.list מחזיר אותם.`;

/** What is added in plan mode: think it through, write the plan, do nothing yet. */
const PLAN_MODE = `מצב הבקשה הוא "תכנון": אל תבצע שום פעולה ואל תכתוב בלוקי action. במקום זה:
1. אם חסר מידע מהותי — שאל עד שתי שאלות קצרות וממוקדות, ועצור.
2. אחרת, כתוב משפט אחד שמסכם את המטרה, ואז בלוק plan שכל שלביו [ ], כשכל שלב מציין בסוגריים את הפעולה או הכלי שישמשו אותו (מהרשימה למטה).
3. סיים בשורה: "ללחוץ על 'בצע את התוכנית' כדי שאתחיל."

${PLAN_FORMAT}`;

const QUESTION_MODE = `מצב הבקשה הוא "שאלה": ענה בלבד. אל תכתוב בלוקי action ואל תטען שביצעת משהו. אם הגולש מבקש שתבצע, אמור לו לעבור למצב "סוכן" בראש לוח העוזר.`;

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
    case "explain":
      return [{
        role: "system",
        content: `אתה מורה למוזיקה שמסביר בשפה פשוטה, לנגנים חובבים. קיבלת נתונים על שיר: סולם, קצב, ורצף האקורדים (ולפעמים מילים). כתוב ב${language ?? "עברית"} (גם את הכותרות, מתורגמות לשפה הזאת), ב־Markdown קצר, בארבעה חלקים עם כותרות ##: 'הסולם והאווירה' (מה הסולם, ולמה הוא נשמע כך), 'המהלך' (המהלך החוזר בספרות רומיות, איך קוראים לו אם יש לו שם מוכר, ואילו שירים מוכרים משתמשים בו), 'מה מיוחד כאן' (אקורדים מושאלים, מודולציות, מתחים, רק מה שבאמת מופיע בנתונים), 'טיפים לנגינה' (עד ארבע נקודות מעשיות לגיטרה או לפסנתר, למשל קאפו או סולם לאלתור). אל תמציא מידע שלא בנתונים, ואם הנתונים דלים, אמור זאת. בלי הקדמות.`,
      }];
    case "lyrics":
      return [{
        role: "system",
        content: `קיבלת מילים של שיר, שורה אחרי שורה. לכל שורה כתוב שורה אחת בפורמט: תעתיק || תרגום. התעתיק הוא הגייה של השורה המקורית באותיות ${language === "אנגלית" ? "לטיניות" : "עבריות"}, כפי ששרים אותה (אם השורה כבר כתובה באותיות האלה, חזור עליה כמו שהיא). התרגום הוא ל${language ?? "עברית"}, טבעי ונאמן למשמעות, לא מילה במילה. שורה ריקה במקור נשארת ריקה. החזר בדיוק אותו מספר שורות ובאותו סדר, בלי מספור, בלי הקדמות ובלי הערות.`,
      }];
    default:
      return [{ role: "system", content: ASSISTANT_PROMPT }];
  }
}

const GONE = (status: number) => status === 404 || status === 400 || status === 422;
const BUSY = (status: number) => status === 429 || status === 402 || status >= 500;
const BAD_KEY = (status: number) => status === 401 || status === 403;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const admin = adminClient();
  const setting = await settings(admin);
  const services = endpoints(setting);
  if (!services.length) return json(503, { error: "not_configured" });
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
    mode?: "question" | "plan" | "execute";
    context?: { state?: string; catalog?: string };
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const action = typeof body.action === "string" ? body.action : "chat";
  const language = typeof body.language === "string" ? body.language.slice(0, 40) : null;

  let messages: Message[] = prompts(action, language);
  let trimmed = 0;
  let textLength = 0;
  if (action === "chat") {
    const history = Array.isArray(body.messages) ? body.messages : [];
    const whole = history
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-MAX_TURNS)
      .map((item) => ({ role: item.role, content: item.content }));
    // The newest turns are the ones that matter, so the budget is filled
    // from the end backwards; whatever did not fit is counted, not dropped
    // silently.
    const clean: Message[] = [];
    let budget = HISTORY_CHARS;
    for (let index = whole.length - 1; index >= 0; index -= 1) {
      const turn = whole[index];
      if (budget - turn.content.length < 0 && clean.length) {
        trimmed = index + 1;
        break;
      }
      budget -= turn.content.length;
      clean.unshift(turn);
    }
    // One turn longer than the whole budget is cut rather than refused.
    if (clean.length === 1 && clean[0].content.length > HISTORY_CHARS) {
      clean[0] = { ...clean[0], content: clean[0].content.slice(-HISTORY_CHARS) };
    }
    if (!clean.length) return json(400, { error: "bad_request" });
    const tool = typeof body.tool === "string" ? body.tool.replace(/[^a-z-]/g, "").slice(0, 30) : "";
    const execute = body.mode === "execute";
    const planning = body.mode === "plan";
    const catalog = (execute || planning) && typeof body.context?.catalog === "string" ? body.context.catalog.slice(0, 14_000) : "";
    const state = typeof body.context?.state === "string" ? body.context.state.slice(0, 4000) : "";
    const context = [
      tool ? `הגולש נמצא כרגע בכלי "${tool}".` : "הגולש נמצא בדף הבית של האתר.",
      body.detailed ? "הגולש ביקש הסברים מפורטים: צעדים, דוגמה, ומה לעשות אם משהו לא עובד." : "השב בקצרה; הרחב רק אם מבקשים.",
      execute ? ACTION_PROTOCOL : planning ? PLAN_MODE : QUESTION_MODE,
      trimmed ? `\n\nהשיחה ארוכה: ${trimmed} ההודעות הראשונות הושמטו כדי שהחדשות ייכנסו. אם חסר לך משהו מתחילת השיחה, בקש מהגולש להזכיר לך.` : "",
      state ? `\n\nמצב המסך עכשיו (עדכני לרגע זה — הסתמך עליו ואל תשאל על מה שכתוב כאן):\n${state}` : "",
      catalog ? `\n\n${planning ? "הפעולות שיהיו זמינות בביצוע" : "הפעולות שאתה יכול לבצע"}:\n${catalog}` : "",
    ].join(" ");
    messages = [...messages, { role: "system", content: context }, ...clean];
  } else {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(400, { error: "bad_request" });
    if (text.length > MAX_INPUT_CHARS) return json(413, { error: "too_large" });
    textLength = text.length;
    messages = [...messages, { role: "user", content: text }];
  }

  const { used } = await usedToday(admin, user.id, "ai");
  if (used >= limit) return json(429, { error: "quota", used, limit });

  // The price, taken before any service is asked and given back if none answers.
  const chatting = action === "chat";
  const paid = await charge(
    admin,
    user,
    chatting ? "assistant" : "text",
    chatting ? "assistant" : "text",
    chatting ? 1 : textUnits(textLength),
    chatting ? { mode: body.mode === "execute" || body.mode === "plan" ? body.mode : "question" } : { job: action },
  );
  if (!paid.ok) return refused(paid);
  const fail = async (status: number, reply: Record<string, unknown>) => {
    await refund(admin, user, paid);
    return json(status, reply);
  };

  const wantStream = action === "chat" && body.stream === true;
  const ask = (endpoint: Endpoint, model: string) =>
    fetch(`${endpoint.base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.apiKey}`, "Content-Type": "application/json", ...endpoint.headers },
      body: JSON.stringify({
        model,
        messages,
        temperature: action === "chat" ? 0.4 : 0.2,
        [endpoint.tokenParam]: action === "chat" ? 4000 : 4000,
        ...(wantStream ? { stream: true } : {}),
      }),
    });

  /**
   * Every service, every model, until one answers. A model the service no
   * longer has is skipped; a service that is busy, out of quota or broken is
   * left for the next request. Only when nothing at all answered is the
   * first service asked once more, after the pause it asked for — that is
   * the case where waiting a moment is the whole fix.
   */
  let response: Response | null = null;
  let endpoint: Endpoint | null = null;
  let model = "";
  let retryAfterMs = 0;
  let sawBusy = false;
  const failures: string[] = [];
  try {
    outer: for (const service of services) {
      let discovered = false;
      for (let index = 0; index < service.models.length + 1; index += 1) {
        const candidate = index < service.models.length ? service.models[index] : null;
        if (candidate === null) {
          // Every known name is gone; ask the service what it does serve.
          if (discovered) break;
          discovered = true;
          const found = await discoverModel(service);
          if (!found || service.models.includes(found)) break;
          model = found;
        } else {
          model = candidate;
        }
        const attempt = await ask(service, model).catch(() => null);
        if (!attempt) {
          failures.push(`${service.id}: לא נענה`);
          continue;
        }
        if (attempt.ok) {
          response = attempt;
          endpoint = service;
          break outer;
        }
        const detail = (await attempt.text().catch(() => "")).slice(0, 200);
        failures.push(`${service.id}/${model}: ${attempt.status} ${detail.slice(0, 90)}`);
        if (BUSY(attempt.status)) {
          sawBusy = true;
          const match = /try again in ([\d.]+)\s*(ms|s)/i.exec(detail);
          if (match && !retryAfterMs) retryAfterMs = Math.min(8000, Number(match[1]) * (match[2] === "ms" ? 1 : 1000));
          // Another model on the same service has its own bucket; after that,
          // the next service.
          continue;
        }
        if (BAD_KEY(attempt.status)) break;
        if (GONE(attempt.status)) continue;
        break;
      }
    }

    if (!response && services.length) {
      // Everything was busy at once. The services tell us how long to wait.
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs || 1500));
      const first = services[0];
      const attempt = await ask(first, first.models[0] ?? "").catch(() => null);
      if (attempt?.ok) {
        response = attempt;
        endpoint = first;
        model = first.models[0] ?? "";
      } else if (attempt) {
        failures.push(`${first.id}: ${attempt.status} (גם אחרי המתנה)`);
        if (BUSY(attempt.status)) {
          console.error("language models unavailable:", failures.join(" | "));
          return await fail(502, { error: "provider_busy" });
        }
        if (BAD_KEY(attempt.status)) {
          console.error("language models unavailable:", failures.join(" | "));
          return await fail(502, { error: "provider_key" });
        }
      }
    }
  } catch (caught) {
    console.error("language model unreachable", caught);
    return await fail(502, { error: "provider_unreachable" });
  }

  if (!response || !endpoint) {
    console.error("language models unavailable:", failures.join(" | "));
    return await fail(502, { error: failures.some((item) => /: 40[13]/.test(item)) ? "provider_key" : "provider_unreachable" });
  }
  // The model that answered is where the next request starts — but only when
  // the ones before it are gone for good. A model that stood in while a better
  // one was merely busy for a minute must not become the default.
  // (The RPC builder is thenable but has no .catch(); calling it threw after
  // the answer was ready and turned a good reply into a 500.)
  if (model && !sawBusy && setting("AI_MODEL") !== model) {
    const { error: rememberError } = await admin.rpc("stt_set_setting", { setting_key: "AI_MODEL", setting_value: model });
    if (rememberError) console.warn("could not remember the model", rememberError.message);
  }
  if (failures.length) console.warn(`answered by ${endpoint.id}/${model} after:`, failures.join(" | "));

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
        "X-Provider": endpoint.id,
        ...creditHeaders(paid),
      },
    });
  }

  const parsed = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  const text = parsed.choices?.[0]?.message?.content?.trim() ?? "";
  const tokens = Number(parsed.usage?.total_tokens) || Math.ceil(text.length / 3);
  const total = await recordUsage(admin, user.id, "ai", tokens);
  return json(200, {
    text: text || (action === "chat" ? "לא הצלחתי להכין תשובה. נסה לנסח שוב." : ""),
    model,
    provider: endpoint.id,
    tokens,
    used: total,
    limit,
    credits: creditSummary(paid),
  });
});
