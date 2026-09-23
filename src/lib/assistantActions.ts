/**
 * What the assistant can do inside the site, and how a tool lends it hands.
 *
 * The catalogue below is the assistant's whole vocabulary: every action it may
 * ask for, with its parameters, in one place, so the model sees the same list
 * on every page and the site can check a call before running it. A tool that
 * is on screen registers handlers for its own actions
 * ({@link ./useAssistantTool}); an action for a tool that is not open opens
 * the tool first and waits for it to mount. The assistant never reaches into
 * a tool's state — it only calls what the tool chose to offer, and a tool
 * says in its own words what happened.
 */

export type ParamType = "string" | "number" | "boolean" | "string[]";

export type ActionParam = {
  name: string;
  type: ParamType;
  required: boolean;
  /** The only values accepted, when the parameter is a choice. */
  values?: string[];
  /** A few words for the model. */
  hint?: string;
};

export type ActionSpec = {
  id: string;
  /** The tool whose page runs it; null for the site itself. */
  tool: string | null;
  /** What the chip in the conversation says. */
  label: string;
  /** What the model is told. */
  description: string;
  params: ActionParam[];
  /** A read hands its data back to the model, which then carries on. */
  kind: "read" | "write";
  /** Asked of the visitor before it runs. */
  confirm?: boolean;
};

export type ActionParams = Record<string, unknown>;
export type ActionOutcome = { ok: boolean; message: string; data?: unknown };
export type ActionHandler = (params: ActionParams) => ActionOutcome | Promise<ActionOutcome>;
export type ActionCall = { id: string; params: ActionParams };
export type ActionRecord = ActionCall & {
  ok: boolean;
  message: string;
  data?: unknown;
  /** The visitor declined it at the confirmation. */
  cancelled?: boolean;
};

/** `"bpm?:number"`, `"meter?:2/4|3/4"`, `"text"`, `"notes:string[]"`. */
function param(spec: string, hint?: string): ActionParam {
  const at = spec.indexOf(":");
  const rawName = at < 0 ? spec : spec.slice(0, at);
  const rawType = at < 0 ? "string" : spec.slice(at + 1);
  const required = !rawName.endsWith("?");
  const name = rawName.replace(/\?$/, "");
  if (rawType === "number" || rawType === "boolean" || rawType === "string[]" || rawType === "string") {
    return { name, type: rawType, required, hint };
  }
  return { name, type: "string", required, hint, values: rawType.split("|") };
}

type ParamInput = string | [spec: string, hint: string];

function define(
  tool: string | null,
  kind: "read" | "write",
  id: string,
  label: string,
  description: string,
  params: ParamInput[] = [],
  confirm = false,
): ActionSpec {
  return {
    id,
    tool,
    label,
    description,
    kind,
    params: params.map((item) => (typeof item === "string" ? param(item) : param(item[0], item[1]))),
    ...(confirm ? { confirm } : {}),
  };
}

export const TOOL_IDS = [
  "notes", "ringtone", "convert", "video", "vocals", "speed", "metronome", "tuner", "piano",
  "rhythm", "mixer", "ear", "lyrics", "transcript", "chords", "songbook", "tts", "identify", "analyze",
  "beats", "theory", "progressions", "changes",
];

const LANGUAGE = "auto|he|en|ar|ru|fr|es|de|it|pt|yi|tr|uk|zh|ja|ko|hi|nl|pl";

const NOTE_NAMES = "C|C#|D|D#|E|F|F#|G|G#|A|A#|B";

/** Every action, grouped by the page that runs it. */
export const ACTIONS: ActionSpec[] = [
  // ---- the site ----
  define(null, "write", "navigate", "פתיחת כלי", "פותח כלי, או את דף הבית. פעולה של כלי פותחת אותו לבד; זה רק כשרוצים לעבור בלי לעשות דבר.", [`tool:home|${TOOL_IDS.join("|")}`]),
  define(null, "write", "account.open", "פתיחת האזור האישי", "פותח את האזור האישי (ההיסטוריה והקבצים השמורים)."),
  define(null, "write", "account.close", "סגירת האזור האישי", "סוגר את האזור האישי."),
  define(null, "write", "theme.set", "ערכת נושא", "מחליף בין ערכת נושא בהירה, כהה או לפי המערכת.", ["theme:light|dark|system"]),
  define(null, "read", "works.list", "רשימת העבודות השמורות", "העבודות השמורות של הגולש (כותרת, סוג, תיאור, מזהה), החדשות קודם.", ["kind?:notes|ringtone|vocals|speed|piano|analysis|ear|metronome|tuner|transcript|chords|song|convert|rhythm|mix|lyrics|tts", ["query?", "סינון לפי טקסט בכותרת"], "limit?:number"]),
  define(null, "write", "works.open", "פתיחת עבודה שמורה", "פותח עבודה שמורה בכלי שיצר אותה.", [["id", "מזהה מתוך works.list"]]),
  define(null, "write", "works.rename", "שינוי שם לעבודה", "משנה את הכותרת של עבודה שמורה.", ["id", "title"]),
  define(null, "write", "works.delete", "מחיקת עבודה", "מוחק עבודה מהאזור האישי (הגולש מאשר קודם).", ["id"], true),
  define(null, "read", "works.link", "קישור ציבורי", "יוצר קישור ציבורי לעבודה שמורה ומחזיר אותו.", ["id"]),

  // ---- songbook ----
  define("songbook", "write", "songbook.write", "כתיבה לשירון", "מחליף את הטקסט בשירון. body: מילים עם אקורדים בסוגריים לפני המילה, למשל [Am]היה [G]פעם; כותרת קטע בשורה לבד כמו [פזמון]. עובר לתצוגה.", ["title?", "body"]),
  define("songbook", "write", "songbook.append", "הוספה לשירון", "מוסיף שורות בסוף הטקסט בשירון, באותו פורמט.", ["body"]),
  define("songbook", "read", "songbook.read", "קריאת השירון", "הכותרת, הטקסט, הטרנספוזיציה והאקורדים שבשירון."),
  define("songbook", "write", "songbook.set", "הגדרות השירון", "טרנספוזיציה בחצאי טונים (-11..11), גודל טקסט (14..32), שמות עם במול, הצגת אחיזות, ומעבר בין עריכה לתצוגה.", ["transpose?:number", "fontSize?:number", "flats?:boolean", "diagrams?:boolean", "view?:edit|view"]),
  define("songbook", "write", "songbook.scroll", "גלילה אוטומטית", "מפעיל או עוצר גלילה אוטומטית להופעה; speed בפיקסלים לשנייה (5..120), או bpm (40..220) ו־beatsPerLine (2, 4, 8, 12, 16) לגלילה לפי קצב, שורה אחרי שורה.", ["on:boolean", "speed?:number", "bpm?:number", "beatsPerLine?:number"]),
  define("songbook", "write", "songbook.save", "שמירת השיר", "שומר את השיר באזור האישי."),
  define("songbook", "write", "songbook.download", "הורדת השיר", "מוריד את השיר כקובץ טקסט עם האקורדים מעל המילים."),
  define("songbook", "write", "songbook.print", "הדפסה", "פותח את חלון ההדפסה של הדף."),

  // ---- text to speech ----
  define("tts", "write", "tts.write", "כתיבת טקסט להקראה", "מחליף את הטקסט להקראה (עד 4000 תווים).", ["text"]),
  define("tts", "write", "tts.speak", "הקראה", "מקריא בקול של המכשיר, משהה, ממשיך או עוצר.", ["command:play|pause|resume|stop"]),
  define("tts", "write", "tts.set", "הגדרות הקראה", "מהירות (0.5..2), גובה (0.5..2) ושם קול (חלקי מספיק).", ["rate?:number", "pitch?:number", "voice?"]),
  define("tts", "write", "tts.makeFile", "יצירת MP3", "מקליט את הטקסט בשרת לקובץ MP3 (לוקח כמה שניות)."),
  define("tts", "write", "tts.download", "הורדת ההקראה", "מוריד את קובץ ה־MP3 שנוצר."),
  define("tts", "write", "tts.save", "שמירת ההקראה", "שומר את ההקראה באזור האישי."),
  define("tts", "read", "tts.read", "קריאת הטקסט", "הטקסט שבתיבה, הקול והמהירות."),

  // ---- drum machine ----
  define("beats", "write", "beats.play", "ניגון הביט", "מפעיל את מכונת התופים."),
  define("beats", "write", "beats.stop", "עצירת הביט", "עוצר את מכונת התופים."),
  define("beats", "write", "beats.set", "הגדרות הביט", "קצב (50..220), סווינג באחוזים (0..60) ועוצמה ראשית (0..100).", ["bpm?:number", "swing?:number", "volume?:number"]),
  define("beats", "write", "beats.preset", "סגנון מוכן", "טוען תבנית מוכנה עם הקצב שלה.", ["style:house|boombap|rock|trap|reggaeton|funk|empty"]),
  define("beats", "write", "beats.random", "ביט אקראי", "ממלא את הרשת בגרוב אקראי שנשמע טוב."),
  define("beats", "write", "beats.clear", "ניקוי הרשת", "מוחק את כל המכות."),
  define("beats", "write", "beats.steps", "תכנות צעדים", "מסמן מכות לכלי אחד בצעדים 1..16 (למשל \"1,5,9,13\" או \"1-16\"); clear מנקה את השורה קודם, accent מדגיש.", ["voice:kick|snare|clap|hat|open|lowTom|highTom|cowbell", ["steps", "מספרי צעדים 1..16"], "accent?:boolean", "clear?:boolean"]),
  define("beats", "write", "beats.export", "הורדת הביט", "מוריד את הלולאה כקובץ WAV באורך מספר תיבות (1..16).", ["bars?:number"]),

  // ---- progression generator ----
  define("progressions", "write", "progressions.generate", "מהלך אקורדים חדש", "יוצר מהלך אקורדים לפי אווירה ובסולם (אם ניתן).", ["mood?:pop|happy|sad|dramatic|rock|dreamy|jazz|epic", ["key?", "טוניקה, למשל C או F♯"]]),
  define("progressions", "write", "progressions.set", "הגדרות הליווי", "קצב (50..200), פעמות לאקורד (2, 4 או 8), דפוס ליווי, סגנון בס ואקורדי ספטימה.", ["bpm?:number", "beats?:number", "pattern?:block|pulse|arpUp|arpUpDown|broken|offbeat", "bass?:none|root|rootFifth|octaves|walking", "sevenths?:boolean"]),
  define("progressions", "write", "progressions.play", "ניגון המהלך", "מנגן את המהלך בלולאה."),
  define("progressions", "write", "progressions.stop", "עצירת המהלך", "עוצר את הניגון."),
  define("progressions", "write", "progressions.songbook", "המהלך לשירון", "שולח את המהלך לשירון ופותח אותו."),

  // ---- chord changes trainer ----
  define("changes", "write", "changes.set", "זוג אקורדים לתרגול", "בוחר שני אקורדים (Em, Am, D, A, E, G, C, Dm, E7, A7, D7, G7, C7, Fmaj7, F) ומשך סבב בשניות (30, 60 או 120).", ["first?", "second?", "seconds?:number"]),
  define("changes", "write", "changes.start", "התחלת סבב", "מתחיל סבב מעברים עם ספירה לאחור; הגולש לוחץ בכל מעבר."),
  define("changes", "read", "changes.stats", "התוצאות בזוג", "השיא, מספר הסבבים והתוצאות האחרונות (מעברים לדקה) בזוג שנבחר."),

  // ---- theory explorer ----
  define("theory", "write", "theory.set", "סולם בסייר התאוריה", "בוחר טוניקה (C, D♭, D, E♭, E, F, F♯, G, A♭, A, B♭, B), סולם או מודוס, משולשים או ספטאקורדים ותצוגה.", [["root?", "שם התו, למשל C או F♯"], "scale?:major|minor|dorian|phrygian|lydian|mixolydian|locrian|harmonicMinor|melodicMinor|majorPentatonic|minorPentatonic|blues", "sevenths?:boolean", "view?:piano|guitar"]),
  define("theory", "write", "theory.play", "השמעה בסייר התאוריה", "משמיע את הסולם, או אקורד על דרגה (1..7).", ["what?:scale|chord", "degree?:number"]),

  // ---- metronome ----
  define("metronome", "write", "metronome.set", "הגדרות מטרונום", "קצב (30..260), משקל, חלוקת משנה (1 רבעים, 2 שמיניות, 3 טריולות, 4 שש־עשריות), צליל ועוצמה (0..100).", ["bpm?:number", "meter?:2/4|3/4|4/4|5/4|6/8|7/8", "subdivision?:number", "sound?:click|wood|beep", "volume?:number"]),
  define("metronome", "write", "metronome.start", "הפעלת המטרונום", "מתחיל לתקתק."),
  define("metronome", "write", "metronome.stop", "עצירת המטרונום", "עוצר."),
  define("metronome", "write", "metronome.save", "שמירת הקצב", "שומר את הקצב באזור האישי."),

  // ---- tuner ----
  define("tuner", "write", "tuner.set", "הגדרות המכוון", "הכלי לכיוון וכיוון לה (430..450 Hz).", ["instrument?:chromatic|guitar|bass|ukulele|violin|cello", "referenceA4?:number"]),
  define("tuner", "write", "tuner.listen", "האזנה", "מתחיל או מפסיק להאזין למיקרופון.", ["on:boolean"]),
  define("tuner", "write", "tuner.tone", "צליל ייחוס", "משמיע צליל ייחוס, למשל E2 או A4; אותו תו שוב מפסיק.", ["note"]),
  define("tuner", "write", "tuner.save", "שמירת הכיוון", "שומר את הכיוון באזור האישי."),
  define("tuner", "read", "tuner.read", "מה נשמע", "התו שנקלט עכשיו וכמה סנטים הוא רחוק."),

  // ---- piano ----
  define("piano", "write", "piano.play", "נגינה בפסנתר", "מנגן תווים, למשל [\"C4\",\"E4\",\"G4\"] — יחד (chord) או בזה אחר זה (sequence); seconds לכל תו (0.2..4).", ["notes:string[]", "mode?:chord|sequence", "seconds?:number"]),
  define("piano", "write", "piano.set", "הגדרות הפסנתר", "אוקטבה תחתונה (0..7), צליל, הדגשת סולם ושורשו, סוסטיין, שמות תווים, עוצמה (0..100), ומספר אוקטבות (2 או 3).", ["octave?:number", "timbre?:piano|organ|synth", "scale?:none|major|minor|harmonic|pent-major|pent-minor|blues|dorian|mixolydian|freygish", `root?:${NOTE_NAMES}`, "sustain?:boolean", "names?:boolean", "volume?:number", "octaves?:number"]),
  define("piano", "write", "piano.record", "הקלטה", "מתחיל או עוצר הקלטה של הנגינה.", ["on:boolean"]),
  define("piano", "write", "piano.downloadMidi", "הורדת MIDI", "מוריד את ההקלטה כ־MIDI."),
  define("piano", "write", "piano.save", "שמירת ההקלטה", "שומר את ההקלטה באזור האישי."),
  define("piano", "read", "piano.read", "ההקלטה", "התווים שהוקלטו וההגדרות."),

  // ---- speed ----
  define("speed", "write", "speed.set", "מהירות וטון", "מהירות באחוזים (40..160) וטון בחצאי טונים (-12..12).", ["speed?:number", "semitones?:number"]),
  define("speed", "write", "speed.loop", "לולאה", "לולאה על קטע בשניות; בלי פרמטרים — מבטל את הלולאה.", ["start?:number", "end?:number"]),
  define("speed", "write", "speed.download", "הורדת הגרסה", "מוריד את הגרסה המעובדת כ־WAV."),
  define("speed", "write", "speed.save", "שמירת הגרסה", "שומר את הגרסה באזור האישי."),
  define("speed", "read", "speed.read", "מצב הכלי", "הקובץ, המהירות, הטון והלולאה."),

  // ---- transcript ----
  define("transcript", "read", "transcript.read", "קריאת התמלול", "הטקסט של התמלול (from: תו התחלה, chars: כמה תווים, ברירת מחדל 6000).", ["from?:number", "chars?:number"]),
  define("transcript", "write", "transcript.language", "שפת הדיבור", "קובע את שפת הדיבור לזיהוי.", [`language:${LANGUAGE}`]),
  define("transcript", "write", "transcript.run", "תמלול", "מתחיל לתמלל את ההקלטה שנבחרה (או הקטע המסומן). ממשיך ברקע; הגולש רואה התקדמות."),
  define("transcript", "write", "transcript.stop", "עצירת התמלול", "עוצר את התמלול; מה שתומלל נשמר."),
  define("transcript", "write", "transcript.write", "החלפת הטקסט", "מחליף את כל טקסט התמלול (שורה לכל משפט; הזמנים נשמרים לפי סדר השורות).", ["text"]),
  define("transcript", "write", "transcript.replace", "החלפה בטקסט", "מחליף מילה או ביטוי בתמלול (all: כל המופעים).", ["find", "replaceWith", "all?:boolean"]),
  define("transcript", "write", "transcript.ai", "עיבוד AI", "פיסוק ופסקאות, סיכום או תרגום של התמלול; התוצאה מוצגת בכרטיס ה־AI.", ["job:polish|summarize|translate", ["language?", "שפת היעד לתרגום, למשל אנגלית"]]),
  define("transcript", "write", "transcript.applyPolish", "החלת הנוסח הערוך", "מחליף את הטקסט בנוסח הערוך שה־AI הכין."),
  define("transcript", "write", "transcript.speakers", "זיהוי דוברים", "מסמן מי אמר מה."),
  define("transcript", "write", "transcript.search", "חיפוש בתמלול", "מסנן את המשפטים לפי טקסט (ריק — מבטל).", ["query?"]),
  define("transcript", "write", "transcript.download", "הורדת התמלול", "מוריד טקסט או כתוביות.", ["format:txt|srt|vtt"]),
  define("transcript", "write", "transcript.save", "שמירת התמלול", "שומר את התמלול באזור האישי."),

  // ---- song to notes ----
  define("notes", "read", "notes.read", "קריאת התווים", "סטטיסטיקה של הניתוח (תווים, קצב, סולם, משך) והתווים הראשונים (limit, ברירת מחדל 60).", ["limit?:number"]),
  define("notes", "write", "notes.demo", "מנגינת דוגמה", "טוען את מנגינת הדוגמה."),
  define("notes", "write", "notes.run", "ניתוח לתווים", "מתחיל את זיהוי התווים בקובץ שנבחר. ממשיך ברקע."),
  define("notes", "write", "notes.set", "הגדרות הזיהוי", "מנגינה או כל התווים, מנוע, רגישות (20..90), ניקוי הרמוניות (0..1), אורך תו מזערי בשניות (0.02..0.3), חלוקה (1,2,3,4,8), משקל (2,3,4,6), טרנספוזיציה (-12..12), אקורדים, וקצב ידני (40..240; 0 חוזר לאוטומטי).", ["mode?:melody|full", "engine?:fast|deep", "sensitivity?:number", "harmonicCleanup?:number", "minDuration?:number", "stepsPerBeat?:number", "beatsPerMeasure?:number", "transpose?:number", "withChords?:boolean", "bpm?:number"]),
  define("notes", "write", "notes.transport", "נגינת התוצאה", "מנגן, משהה או עוצר את התווים שזוהו.", ["command:play|pause|stop"]),
  define("notes", "write", "notes.playback", "הגדרות נגינה", "כלי נגינה, מהירות (0.5..1.5), עוצמה (0..100), מטרונום ולולאה על הקטע המסומן.", ["instrument?:piano|strings|organ|synth|marimba", "rate?:number", "volume?:number", "click?:boolean", "loop?:boolean"]),
  define("notes", "write", "notes.tab", "תצוגה", "תווים, Piano Roll או רשימת תווים.", ["tab:sheet|piano|notes"]),
  define("notes", "write", "notes.download", "הורדת התוצאה", "מוריד את התוצאה בפורמט המבוקש, או מדפיס.", ["format:musicxml|midi|abc|csv|svg|print"]),
  define("notes", "write", "notes.reset", "שיר חדש", "מנקה את הקובץ והתוצאה (הגולש מאשר קודם).", [], true),

  // ---- chords ----
  define("chords", "read", "chords.read", "קריאת האקורדים", "האקורדים שזוהו לאורך השיר עם הזמנים, אחרי טרנספוזיציה וקאפו."),
  define("chords", "write", "chords.set", "הגדרות האקורדים", "טרנספוזיציה (-6..6), קאפו (0..7), שמות עם במול.", ["transpose?:number", "capo?:number", "flats?:boolean"]),
  define("chords", "write", "chords.toSongbook", "לשירון", "שולח את האקורדים לשירון כדי להוסיף מילים."),
  define("chords", "write", "chords.download", "הורדת דף אקורדים", "מוריד את דף האקורדים כטקסט."),
  define("chords", "write", "chords.save", "שמירת האקורדים", "שומר את האקורדים באזור האישי."),

  // ---- lyrics ----
  define("lyrics", "read", "lyrics.read", "קריאת המילים", "שורות המילים עם הזמנים."),
  define("lyrics", "write", "lyrics.language", "שפת השירה", "קובע את שפת השירה לזיהוי.", [`language:${LANGUAGE}`]),
  define("lyrics", "write", "lyrics.run", "זיהוי המילים", "מתחיל לזהות את המילים והזמנים בשיר שנבחר. ממשיך ברקע."),
  define("lyrics", "write", "lyrics.stop", "עצירה", "עוצר את הזיהוי."),
  define("lyrics", "write", "lyrics.write", "עריכת המילים", "מחליף את המילים, שורה לכל משפט; הזמנים של השורות נשמרים.", ["text"]),
  define("lyrics", "write", "lyrics.download", "הורדת המילים", "LRC, LRC מילה־מילה, SRT או טקסט.", ["format:lrc|elrc|srt|txt"]),
  define("lyrics", "write", "lyrics.save", "שמירת המילים", "שומר את המילים באזור האישי."),

  // ---- ear training ----
  define("ear", "write", "ear.set", "הגדרות התרגול", "תרגיל, רמה, ואיך לנגן מרווחים.", ["mode?:intervals|chords|degrees", "level?:easy|medium|hard", "style?:melodic|harmonic"]),
  define("ear", "write", "ear.start", "שאלה", "מתחיל תרגול או עובר לשאלה הבאה (משמיע אותה)."),
  define("ear", "write", "ear.replay", "השמעה חוזרת", "משמיע שוב את השאלה."),
  define("ear", "write", "ear.answer", "תשובה", "עונה על השאלה הנוכחית — מספר התשובה או הטקסט שלה.", ["choice"]),
  define("ear", "read", "ear.read", "מצב התרגול", "הניקוד, והשאלה הנוכחית עם התשובות האפשריות."),
  define("ear", "write", "ear.resetScore", "איפוס ניקוד", "מאפס את הניקוד של התרגיל הנוכחי."),
  define("ear", "write", "ear.save", "שמירת האימון", "שומר את האימון באזור האישי."),

  // ---- rhythm ----
  define("rhythm", "write", "rhythm.set", "הגדרות מאמן הקצב", "רמה, קצב (40..200), תבנית (שם או מזהה), והאם להשתיק את התבנית.", ["level?:easy|medium|hard", "bpm?:number", "pattern?", "mute?:boolean"]),
  define("rhythm", "write", "rhythm.start", "התחלת סיבוב", "מתחיל סיבוב: ספירה של תיבה ואז שתי תיבות להקשה."),
  define("rhythm", "write", "rhythm.stop", "עצירה", "עוצר את הסיבוב."),
  define("rhythm", "read", "rhythm.read", "התוצאה", "ההגדרות, התבניות הזמינות והתוצאה של הסיבוב האחרון."),
  define("rhythm", "write", "rhythm.save", "שמירת התוצאה", "שומר את התוצאה באזור האישי."),

  // ---- analyze ----
  define("analyze", "read", "analyze.read", "קריאת הניתוח", "הקצב, הסולם, קוד Camelot והעוצמה של השיר שנבחר."),
  define("analyze", "write", "analyze.save", "שמירת הניתוח", "שומר את הניתוח באזור האישי."),

  // ---- vocals ----
  define("vocals", "read", "vocals.read", "מצב ההפרדה", "הקובץ, המצב, ההגדרות והאם יש תוצאה."),
  define("vocals", "write", "vocals.set", "הגדרות ההפרדה", "מצב פשוט או מקצועי; מה להשאיר; עוצמת הפרדה (0..100); שמירת בס; השוואה למקור.", ["mode?:simple|pro", "target?:instrumental|vocals", "strength?:number", "keepBass?:boolean", "compare?:boolean"]),
  define("vocals", "write", "vocals.ai", "הפרדה מלאה עם AI", "מריץ הפרדה מלאה בשרת למה שנבחר להשאיר. לוקח כדקה, ברקע."),
  define("vocals", "write", "vocals.stems", "הפרדה לערוצים", "במצב מקצועי: מפריד לשירה, תופים, בס ושאר הכלים. לוקח כדקה, ברקע."),
  define("vocals", "write", "vocals.stem", "ערוץ", "עוצמה (0..150), פאן (-100..100), השתקה וסולו לערוץ במצב מקצועי.", ["name:vocals|drums|bass|other|guitar|piano", "gain?:number", "pan?:number", "muted?:boolean", "solo?:boolean"]),
  define("vocals", "write", "vocals.download", "הורדת התוצאה", "מוריד את התוצאה כ־WAV."),
  define("vocals", "write", "vocals.save", "שמירת התוצאה", "שומר את התוצאה באזור האישי."),
  define("vocals", "write", "vocals.toMixer", "למיקסר", "שולח את הערוצים למיקסר."),

  // ---- convert ----
  define("convert", "read", "convert.read", "מצב ההמרה", "הקובץ וההגדרות."),
  define("convert", "write", "convert.set", "הגדרות ההמרה", "פורמט, קצב דגימה (8000..48000), ערוצים, איכות MP3 (64..320), עוצמה באחוזים (20..300), נרמול.", ["format?:mp3|wav", "sampleRate?:number", "channels?:keep|1|2", "kbps?:number", "gain?:number", "normalise?:boolean"]),
  define("convert", "write", "convert.run", "המרה", "ממיר את הקובץ שנבחר. ממשיך ברקע."),
  define("convert", "write", "convert.download", "הורדת הקובץ", "מוריד את הקובץ המומר."),
  define("convert", "write", "convert.save", "שמירת הקובץ", "שומר את הקובץ המומר באזור האישי."),
  define("convert", "write", "convert.sendTo", "שליחה לכלי", "שולח את הקובץ המומר לכלי אחר.", ["tool:ringtone|notes|transcript"]),

  // ---- mixer ----
  define("mixer", "read", "mixer.read", "מצב המיקסר", "הערוצים עם ההגדרות שלהם, הלולאה והמשך."),
  define("mixer", "write", "mixer.track", "הגדרות ערוץ", "ערוץ לפי שם או מספר (1 הראשון): עוצמה (0..150), פאן (-100..100), השתקה, סולו, התחלה בשניות, ושם חדש.", ["track", "gain?:number", "pan?:number", "muted?:boolean", "solo?:boolean", "offset?:number", "name?"]),
  define("mixer", "write", "mixer.remove", "הסרת ערוץ", "מסיר ערוץ מהמיקס.", ["track"]),
  define("mixer", "write", "mixer.transport", "נגינה", "מנגן, משהה או עוצר את המיקס.", ["command:play|pause|stop"]),
  define("mixer", "write", "mixer.loop", "לולאה", "לולאה על קטע בשניות; בלי פרמטרים — מבטל.", ["start?:number", "end?:number"]),
  define("mixer", "write", "mixer.render", "יצירת המיקס", "מרנדר את המיקס לקובץ WAV."),
  define("mixer", "write", "mixer.download", "הורדת המיקס", "מוריד את המיקס."),
  define("mixer", "write", "mixer.save", "שמירת המיקס", "שומר את המיקס באזור האישי."),
  define("mixer", "write", "mixer.toConvert", "להמרה", "שולח את המיקס להמרה ל־MP3."),

  // ---- video ----
  define("video", "read", "video.read", "מצב הכלי", "הסרטון שנבחר והתוצאה."),
  define("video", "write", "video.set", "פורמט השמע", "MP3 או WAV.", ["format:mp3|wav"]),
  define("video", "write", "video.run", "חילוץ השמע", "מחלץ את השמע מהסרטון שנבחר. ממשיך ברקע."),
  define("video", "write", "video.download", "הורדת השמע", "מוריד את קובץ השמע."),
  define("video", "write", "video.save", "שמירת הקובץ", "שומר את הקובץ באזור האישי."),
  define("video", "write", "video.sendTo", "שליחה לכלי", "שולח את השמע לכלי אחר.", ["tool:transcript|ringtone|notes|vocals|chords|convert"]),

  // ---- identify ----
  define("identify", "write", "identify.listen", "האזנה לזיהוי", "מתחיל להאזין למיקרופון כדי לזהות שיר (כ־12 שניות), או עוצר מוקדם.", ["on:boolean"]),
  define("identify", "read", "identify.read", "התוצאה", "השיר שזוהה לאחרונה, אם יש."),

  // ---- ringtone ----
  define("ringtone", "read", "ringtone.read", "מצב הצלצול", "הקובץ, הקטע שנבחר והקטעים שזוהו."),
  define("ringtone", "write", "ringtone.set", "הגדרות הצלצול", "התחלה וסיום בשניות, או אורך (3..60); כניסה ויציאה רכות בשניות (0..5); עוצמה (20..200); איזון עוצמה.", ["start?:number", "end?:number", "length?:number", "fadeIn?:number", "fadeOut?:number", "gain?:number", "normalize?:boolean"]),
  define("ringtone", "write", "ringtone.section", "בחירת קטע", "בוחר את הפזמון, הבית או הקטע המוזיקלי שזוהו.", ["section:chorus|verse|instrumental"]),
  define("ringtone", "write", "ringtone.snap", "התאמה להפסקות", "מתאים את הקטע להתחלה ולסיום טבעיים."),
  define("ringtone", "write", "ringtone.instrumental", "גרסה אינסטרומנטלית", "מפיק גרסה בלי שירה (בדפדפן; בפעם הראשונה לוקח זמן) וחותך ממנה."),
  define("ringtone", "write", "ringtone.download", "הורדת הצלצול", "מוריד את הצלצול כ־WAV ושומר אותו."),
  define("ringtone", "write", "ringtone.save", "שמירת הצלצול", "שומר את הצלצול באזור האישי."),
];

const BY_ID = new Map(ACTIONS.map((spec) => [spec.id, spec]));

export function findAction(id: string): ActionSpec | null {
  return BY_ID.get(id) ?? null;
}

/** `songbook.write(title?: string, body: string)` */
export function signature(spec: ActionSpec, withTypes = true) {
  const params = spec.params
    .map((item) => {
      const name = `${item.name}${item.required ? "" : "?"}`;
      if (!withTypes) return name;
      return `${name}: ${item.values ? item.values.join("|") : item.type}`;
    })
    .join(", ");
  return `${spec.id}(${params})`;
}

/** One line per action, for the model. */
function describeLine(spec: ActionSpec) {
  const hints = spec.params.filter((item) => item.hint).map((item) => `${item.name}: ${item.hint}`);
  return `- ${signature(spec)} — ${spec.description}${hints.length ? ` (${hints.join("; ")})` : ""}${spec.kind === "read" ? " [קריאה]" : ""}${spec.confirm ? " [דורש אישור]" : ""}`;
}

/**
 * The catalogue as the model reads it: the site's own actions and the open
 * tool's in full, every other tool's as a compact index. An action of a tool
 * that is not open still works — the site opens the tool first.
 */
export function describeCatalog(currentTool: string | null) {
  const general = ACTIONS.filter((spec) => spec.tool === null);
  const current = currentTool ? ACTIONS.filter((spec) => spec.tool === currentTool) : [];
  const others = TOOL_IDS.filter((tool) => tool !== currentTool).map((tool) => {
    const list = ACTIONS.filter((spec) => spec.tool === tool);
    const names = list.map((spec) => `${spec.id.slice(tool.length + 1)}(${spec.params.map((item) => `${item.name}${item.required ? "" : "?"}`).join(",")})`);
    return `- ${tool}: ${names.join(", ")}`;
  });
  const parts = [
    "פעולות כלליות (בכל עמוד):",
    ...general.map(describeLine),
  ];
  if (current.length) {
    parts.push("", `פעולות של הכלי הפתוח (${currentTool}):`, ...current.map(describeLine));
  }
  parts.push(
    "",
    "פעולות של שאר הכלים (פעולה כזאת פותחת את הכלי לבד; הפרמטרים לפי שם; מה שמסתיים ב־? הוא רשות; פעולות read מחזירות מידע):",
    ...others,
  );
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Checking a call
// ---------------------------------------------------------------------------

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (["true", "on", "yes", "1", "כן", "הפעל", "פתוח"].includes(clean)) return true;
    if (["false", "off", "no", "0", "לא", "כבה", "סגור"].includes(clean)) return false;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    // "120 BPM", "75%", "+2" — the first number in the text is the value.
    const match = value.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The parameters the model sent, in the types the handler expects; anything
 * the spec does not mention is dropped. A wrong or missing value is a
 * problem the model is told about instead of a handler guessing.
 */
export function coerceParams(spec: ActionSpec, raw: unknown): { params: ActionParams; problems: string[] } {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const params: ActionParams = {};
  const problems: string[] = [];
  for (const item of spec.params) {
    let value = source[item.name];
    if (value === undefined || value === null || value === "") {
      if (item.required) problems.push(`חסר הפרמטר ${item.name}`);
      continue;
    }
    if (item.type === "number") {
      const parsed = asNumber(value);
      if (parsed === null) {
        problems.push(`${item.name} צריך להיות מספר`);
        continue;
      }
      value = parsed;
    } else if (item.type === "boolean") {
      const parsed = asBoolean(value);
      if (parsed === null) {
        problems.push(`${item.name} צריך להיות true או false`);
        continue;
      }
      value = parsed;
    } else if (item.type === "string[]") {
      const list = Array.isArray(value) ? value.map(String) : String(value).split(/[\s,]+/);
      value = list.map((entry) => entry.trim()).filter(Boolean);
    } else {
      value = typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join("\n") : String(value);
      if (item.values) {
        const text = (value as string).trim();
        const match = item.values.find((option) => option.toLowerCase() === text.toLowerCase());
        if (!match) {
          problems.push(`${item.name} חייב להיות אחד מ: ${item.values.join(", ")}`);
          continue;
        }
        value = match;
      }
    }
    params[item.name] = value;
  }
  return { params, problems };
}

// ---------------------------------------------------------------------------
// The registry: which page is offering which handlers right now
// ---------------------------------------------------------------------------

export type AssistantBinding = {
  tool: string;
  handlers: Partial<Record<string, ActionHandler>>;
  /** A few lines about what is on screen, for the model. */
  state?: () => string | null | undefined;
};

const bindings = new Map<number, AssistantBinding>();
let nextBinding = 0;
const listeners = new Set<() => void>();

export function registerAssistantBinding(binding: AssistantBinding): () => void {
  const id = (nextBinding += 1);
  bindings.set(id, binding);
  listeners.forEach((listener) => listener());
  return () => {
    bindings.delete(id);
  };
}

/** The handler of the most recently mounted page that offers the action. */
export function findHandler(id: string): ActionHandler | null {
  const list = Array.from(bindings.values()).reverse();
  for (const binding of list) {
    const handler = binding.handlers[id];
    if (handler) return handler;
  }
  return null;
}

/** Everything the mounted pages say about themselves, for the model. */
export function describeState(): string {
  const parts: string[] = [];
  for (const binding of bindings.values()) {
    const text = binding.state?.();
    if (text && text.trim()) parts.push(text.trim());
  }
  return parts.join("\n");
}

export function waitForHandler(id: string, timeoutMs: number): Promise<ActionHandler | null> {
  const found = findHandler(id);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const finish = (handler: ActionHandler | null) => {
      listeners.delete(check);
      window.clearTimeout(timer);
      resolve(handler);
    };
    const check = () => {
      const handler = findHandler(id);
      if (handler) finish(handler);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    listeners.add(check);
  });
}

/** For tests: forget every page. */
export function resetAssistantBindings() {
  bindings.clear();
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Running a call
// ---------------------------------------------------------------------------

function currentToolRoute() {
  return window.location.hash.replace(/^#\/?/, "").trim();
}

/** The notes engine is a separate chunk, so its page takes longer to appear. */
function mountWait(tool: string) {
  // Tools load on first use, so a slow connection needs a moment to fetch one.
  return tool === "notes" ? 15_000 : 10_000;
}

/**
 * Runs one action the model asked for: checks it against the catalogue,
 * opens the tool that handles it when that tool is not on screen, and
 * reports what the handler said. Never throws.
 */
export async function runAssistantAction(call: ActionCall): Promise<ActionRecord> {
  const spec = findAction(call.id);
  if (!spec) {
    return { ...call, ok: false, message: `אין פעולה בשם "${call.id}". השתמש רק בפעולות שברשימה.` };
  }
  const { params, problems } = coerceParams(spec, call.params);
  if (problems.length) {
    return { id: spec.id, params, ok: false, message: `${problems.join("; ")}. החתימה: ${signature(spec)}` };
  }
  let handler = findHandler(spec.id);
  if (!handler && spec.tool) {
    if (currentToolRoute() !== spec.tool) window.location.assign(`#/${spec.tool}`);
    handler = await waitForHandler(spec.id, mountWait(spec.tool));
  }
  if (!handler) {
    return {
      id: spec.id,
      params,
      ok: false,
      message: spec.tool ? `הכלי ${spec.tool} לא נפתח, והפעולה לא בוצעה.` : "הפעולה אינה זמינה כרגע.",
    };
  }
  try {
    const outcome = await handler(params);
    return { id: spec.id, params, ok: outcome.ok, message: outcome.message, ...(outcome.data !== undefined ? { data: outcome.data } : {}) };
  } catch (caught) {
    return { id: spec.id, params, ok: false, message: caught instanceof Error && caught.message ? caught.message : "הפעולה נכשלה." };
  }
}

const MAX_DATA_CHARS = 7000;

/**
 * What the site tells the model after running its actions, as the next
 * message of the conversation: one line per action, and the data a read
 * brought back.
 */
export function formatActionResults(records: ActionRecord[]) {
  const lines = ["[תוצאות פעולות]"];
  records.forEach((record, index) => {
    const status = record.cancelled ? "בוטל על ידי הגולש" : record.ok ? "הצליח" : "נכשל";
    lines.push(`${index + 1}. ${record.id} — ${status}${record.message ? `: ${record.message}` : ""}`);
    if (record.ok && record.data !== undefined) {
      const text = typeof record.data === "string" ? record.data : JSON.stringify(record.data);
      lines.push(text.length > MAX_DATA_CHARS ? `${text.slice(0, MAX_DATA_CHARS)}… (נחתך)` : text);
    }
  });
  return lines.join("\n");
}

/** A record as the conversation keeps it: without the data, which can be large. */
export function trimRecord(record: ActionRecord): ActionRecord {
  const { data: _data, ...rest } = record;
  void _data;
  return rest;
}
