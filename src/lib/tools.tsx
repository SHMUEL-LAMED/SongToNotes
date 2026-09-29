import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeftRight,
  AudioLines,
  AudioWaveform,
  BookOpen,
  Captions,
  Clapperboard,
  Compass,
  Disc3,
  Drum,
  Ear,
  FileMusic,
  Gauge,
  Grid3x3,
  Guitar,
  Layers,
  ListMusic,
  Mic2,
  Music4,
  MicVocal,
  Piano,
  Scissors,
  Share2,
  Shuffle,
  Smartphone,
  Snail,
  Speech,
  Timer,
  Wand2,
  WandSparkles,
  Voicemail,
} from "lucide-react";

export type ToolCategory = "create" | "practice" | "analyze";

export type ToolDefinition = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** OKLCH hue of the tool's accent — every tool has a colour of its own. */
  hue: number;
  category: ToolCategory;
  tags: string[];
  badge?: string;
  /**
   * What the tool does with a file dropped on the home page, when it takes
   * one — the label on the quick-start button that sends the file here.
   */
  quick?: string;
  /** Tools that naturally come next, offered at the foot of the page. */
  related: string[];
  /** True when a short how-to video sits in public/videos/<id>.mp4, shown under the tool. */
  video?: boolean;
  /** True when the tool sends audio or text to the site's server to do its work. */
  server?: boolean;
  /**
   * Kept out of sight without being removed: no menu, home page, search or
   * assistant lists it, and its address sends visitors to the home page. Only
   * the owner can still open it, by its address. Bringing it back is taking
   * this line out.
   */
  hidden?: boolean;
};

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  create: "יצירה והמרה",
  practice: "תרגול ונגינה",
  analyze: "ניתוח והאזנה",
};

export const CATEGORY_ORDER: ToolCategory[] = ["create", "practice", "analyze"];

/**
 * One list drives the sidebar, the home page, the routing and the page
 * titles, so adding a tool is a matter of one entry here and one component.
 * This is every tool, the hidden ones too — for the router and the admin area.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  {
    id: "recorder",
    title: "מקליט רב־ערוצי",
    tagline: "הקלטה בשכבות, ערוץ על ערוץ",
    description:
      "מקליטים מהמיקרופון ערוץ אחרי ערוץ, בזמן ששומעים את מה שכבר הוקלט ואת המטרונום — עם תיקון השהיה, עוצמה ופאן לכל ערוץ, ייצוא מיקס ל־WAV ושליחה למיקסר.",
    icon: Voicemail,
    hue: 12,
    category: "create",
    tags: ["הקלטה", "אוברדאב", "מולטיטראק", "אולפן", "מיקרופון", "שכבות"],
    badge: "חדש",
    related: ["mixer", "denoise", "metronome"],
  },
  {
    id: "denoise",
    title: "ניקוי רעשים",
    tagline: "רחש, זמזום וקליקים — החוצה",
    description:
      "מנקים הקלטה מרחש רקע, מזמזום חשמל (50/60 הרץ) ומקליקים: לומדים את הרעש מקטע שקט, משווים לפני ואחרי, ומורידים WAV נקי.",
    icon: AudioLines,
    hue: 190,
    category: "create",
    tags: ["ניקוי רעשים", "רחש", "זמזום", "הקלטה", "שיפור איכות", "פודקאסט"],
    badge: "חדש",
    quick: "ניקוי רעשים",
    related: ["transcript", "convert", "recorder"],
  },
  {
    id: "joiner",
    title: "חיבור וחיתוך קבצים",
    tagline: "כמה קבצים, קובץ אחד",
    description:
      "מחברים כמה קבצי שמע לאחד — מסדרים, חותכים כל אחד, מוסיפים מעבר רך או שקט ביניהם — ומורידים WAV או MP3.",
    icon: Scissors,
    hue: 96,
    category: "create",
    tags: ["חיבור קבצים", "מיזוג", "חיתוך", "עריכה", "קרוספייד", "mp3"],
    badge: "חדש",
    quick: "חיבור לקבצים אחרים",
    related: ["convert", "ringtone", "mixer"],
  },
  {
    id: "melody",
    title: "מחולל מנגינות",
    tagline: "מנגינה חדשה בלחיצה",
    description:
      "מנגינה מקורית לפי סולם, קצב ומהלך אקורדים, עם ליווי — משמיעים, משנים עד שמתאים, ומורידים MIDI או שולחים לפסנתר.",
    icon: WandSparkles,
    hue: 300,
    category: "create",
    tags: ["מנגינה", "לחן", "הלחנה", "midi", "השראה", "יצירה"],
    badge: "חדש",
    related: ["progressions", "piano", "songbook"],
  },
  {
    id: "visualizer",
    title: "סרטון ותמונה לשיתוף",
    tagline: "ויזואלייזר וכרטיס שיר לרשתות",
    description:
      "הופכים שיר לסרטון שזז עם המוזיקה, או לכרטיס תמונה מעוצב עם שם, סולם ואקורדים — בגודל פוסט או סטורי, תמיד עם הקישור לאתר.",
    icon: AudioWaveform,
    hue: 268,
    category: "create",
    tags: ["ויזואלייזר", "סרטון", "וידאו", "רשתות", "אינסטגרם", "ספקטרום"],
    badge: "חדש",
    quick: "סרטון מהשיר",
    related: ["songcard", "video", "convert"],
  },
  {
    id: "voice",
    title: "שינוי קול",
    tagline: "רובוט, צ׳יפמאנק, הד ועוד",
    description:
      "מקליטים או מעלים קול ומחילים אפקטים: רובוט, צ׳יפמאנק, קול עמוק, רדיו ישן, חייזר, הד ואולם — ומורידים את התוצאה.",
    icon: Wand2,
    hue: 48,
    category: "create",
    tags: ["שינוי קול", "אפקטים", "רובוט", "צ׳יפמאנק", "מצחיק", "קול"],
    badge: "חדש",
    quick: "שינוי קול",
    related: ["tts", "ringtone", "recorder"],
  },
  {
    id: "songcard",
    title: "כרטיס שיר לשיתוף",
    tagline: "תמונה מוכנה לרשתות",
    description:
      "כרטיס מעוצב לשיר — שם, אמן, סולם, קצב ואקורדים — בגודל פוסט או סטורי, עם קישור לאתר, להורדה או לשליחה בוואטסאפ.",
    icon: Share2,
    hue: 350,
    category: "create",
    tags: ["שיתוף", "כרטיס", "תמונה", "סטורי", "אינסטגרם", "וואטסאפ"],
    badge: "חדש",
    related: ["visualizer", "songbook", "analyze"],
  },
  {
    id: "drumkit",
    title: "תופים אלקטרוניים",
    tagline: "מערכת תופים בקצות האצבעות",
    description:
      "מערכת תופים שמנגנים בה חי — במגע, בעכבר או במקלדת, עם עוצמה לפי מקום הנגיעה — ומקליטים לולאה שחוזרת, או קובץ WAV.",
    icon: Drum,
    hue: 22,
    category: "practice",
    tags: ["תופים", "מערכת תופים", "נגינה", "מגע", "לופ", "הקלטה"],
    badge: "חדש",
    related: ["beats", "pads", "rhythm"],
  },
  {
    id: "setlist",
    title: "סט־ליסט להופעה",
    tagline: "רשימת השירים של הערב",
    description:
      "בונים רשימת שירים להופעה — מהשירון או ידנית — עם סולם, קצב ומשך, רואים כמה זמן הסט, ועוברים בין השירים על הבמה במסך מלא.",
    icon: ListMusic,
    hue: 210,
    category: "practice",
    tags: ["סט ליסט", "הופעה", "רשימת שירים", "במה", "להקה", "שירון"],
    badge: "חדש",
    related: ["songbook", "metronome", "songcard"],
  },
  {
    id: "pads",
    title: "פדים לדי־ג׳יי",
    tagline: "ביטים ואפקטים בלחיצה",
    description: "רשת פדים צבעונית לנגינת ביטים ואפקטים, עם מקשי קיצור והקלטת רצף.",
    icon: Grid3x3,
    hue: 330,
    category: "create",
    tags: ["פדים", "די־ג׳יי", "ביטים", "סמפלר", "אפקטים"],
    badge: "חדש",
    related: ["beats", "mixer", "ringtone"],
  },
  {
    id: "notes",
    title: "שיר לתווים",
    tagline: "תווים, קצב וסולם מכל שיר",
    description:
      "מעלים שיר או מזמזמים למיקרופון, והאתר מזהה תווים, קצב וסולם ומכין תווים, MIDI ו־MusicXML.",
    icon: FileMusic,
    hue: 292,
    category: "create",
    tags: ["תווים", "midi", "musicxml", "תמלול", "פסנתר"],
    badge: "הכלי הראשי",
    quick: "תווים ו־MIDI",
    related: ["piano", "speed", "analyze"],
  },
  {
    id: "ringtone",
    title: "יצירת צלצול",
    tagline: "חותכים, מעמעמים, מורידים",
    description:
      "בוחרים את הקטע הכי טוב בשיר, מוסיפים כניסה ויציאה רכות ומורידים צלצול מוכן לטלפון.",
    icon: Smartphone,
    hue: 2,
    category: "create",
    tags: ["צלצול", "חיתוך", "טלפון", "fade"],
    quick: "צלצול לטלפון",
    related: ["convert", "vocals", "video"],
    video: true,
  },
  {
    id: "beats",
    title: "תופים וביטים",
    tagline: "רשת צעדים, נגינה חיה ופדים",
    description:
      "מכונת תופים עם רשת של 16 צעדים, מערכת תופים לנגינה חיה במגע או במקלדת, ופדים לביטים ואפקטים — בכלי אחד, עם הקלטה ולולאה.",
    icon: Grid3x3,
    hue: 28,
    category: "create",
    tags: ["תופים", "ביט", "מקצב", "סיקוונסר", "drum machine", "לופ"],
    badge: "חדש",
    related: ["mixer", "metronome", "rhythm"],
    video: true,
  },
  {
    id: "convert",
    title: "המרה, חיתוך וחיבור",
    tagline: "קובץ אחד או כמה, לכל פורמט",
    description:
      "ממירים כל קובץ שמע ל־MP3 או WAV, חותכים, משנים עוצמה — או מחברים כמה קבצים לאחד עם מעבר רך ביניהם.",
    icon: ArrowLeftRight,
    hue: 238,
    category: "create",
    tags: ["המרה", "mp3", "wav", "פורמט", "קצב דגימה"],
    quick: "המרה ל־MP3 / WAV",
    related: ["ringtone", "mixer", "video"],
    video: true,
  },
  {
    id: "video",
    title: "וידאו לאודיו",
    tagline: "הצליל מתוך הסרטון",
    description:
      "מעלים סרטון ומקבלים את פס הקול כקובץ MP3 או WAV, או שולחים אותו ישר לתמלול, לצלצול, לתווים ולשאר הכלים.",
    icon: Clapperboard,
    hue: 40,
    category: "create",
    tags: ["וידאו", "mp4", "חילוץ שמע", "סרטון"],
    related: ["transcript", "ringtone", "convert"],
    video: true,
  },
  {
    id: "vocals",
    title: "הסרת שירה",
    tagline: "קריוקי מכל שיר",
    description:
      "מפרידים את השירה מהליווי ומורידים גרסה אינסטרומנטלית — או להפך, רק את הקול.",
    icon: MicVocal,
    hue: 52,
    category: "create",
    tags: ["קריוקי", "ווקאל", "אינסטרומנטלי", "פלייבק"],
    quick: "קריוקי בלי שירה",
    related: ["lyrics", "mixer", "speed"],
    video: true,
  },
  {
    id: "mixer",
    title: "אולפן: מיקסר ומקליט",
    tagline: "ערוצים מקבצים ומהמיקרופון",
    description:
      "מערבבים ערוצים מקבצים ומקליטים עליהם מהמיקרופון, ערוץ אחרי ערוץ, עם מטרונום — עוצמה, פאן, השתקה וסולו, לולאה ומיקס אחד ל־WAV.",
    icon: Layers,
    hue: 262,
    category: "create",
    tags: ["מיקס", "לופ", "ערוצים", "פאן", "עוצמה"],
    quick: "ערוץ במיקסר",
    related: ["beats", "vocals", "convert"],
    video: true,
  },
  {
    id: "lyrics",
    title: "מילים מסונכרנות",
    tagline: "קריוקי מילה אחר מילה",
    description:
      "האתר מזהה את מילות השיר עם הזמן של כל מילה, מציג קריוקי שנדלק תוך כדי שירה, ומייצא LRC ו־SRT.",
    icon: Mic2,
    hue: 340,
    category: "create",
    tags: ["מילים", "קריוקי", "lrc", "כתוביות", "סנכרון"],
    quick: "מילים מסונכרנות",
    related: ["vocals", "songbook", "transcript"],
    server: true,
  },
  {
    id: "tts",
    title: "טקסט לדיבור",
    tagline: "מקלידים, שומעים",
    description:
      "טקסט בעברית ובשפות נוספות מוקרא בקול של המכשיר, עם קצב וגובה לבחירה — וקובץ MP3 מהשרת לשמירה ולשיתוף.",
    icon: Speech,
    hue: 138,
    category: "create",
    tags: ["הקראה", "דיבור", "tts", "קול", "mp3"],
    related: ["transcript", "convert", "mixer"],
    video: true,
    server: true,
  },
  {
    id: "speed",
    title: "מאט ומאיץ",
    tagline: "לתרגל בקצב שלכם",
    description:
      "מאטים שיר בלי לשנות את הגובה, או משנים טון בלי לשנות את הקצב — מושלם ללמידת סולו.",
    icon: Snail,
    hue: 198,
    category: "practice",
    tags: ["תרגול", "מהירות", "טרנספוזיציה", "לולאה"],
    quick: "האטה לתרגול",
    related: ["notes", "chords", "metronome"],
    video: true,
  },
  {
    id: "metronome",
    title: "מטרונום",
    tagline: "דיוק של אולפן",
    description:
      "מטרונום מדויק עם הדגשות, חלוקות משנה, טאפ־טמפו ומשקלים — עובד גם כשהמסך כבוי.",
    icon: Timer,
    hue: 68,
    category: "practice",
    tags: ["קצב", "bpm", "תרגול", "מקצב"],
    related: ["rhythm", "beats", "tuner"],
    video: true,
  },
  {
    id: "tuner",
    title: "מכוון כלים",
    tagline: "כרומטי, מהמיקרופון",
    description:
      "מזהה את הצליל שמנגנים ומראה כמה סנטים הוא רחוק מהתו — לגיטרה, כינור, יוקללה ולקול.",
    icon: Gauge,
    hue: 220,
    category: "practice",
    tags: ["טיונר", "כיוון", "גיטרה", "כינור", "סנטים"],
    related: ["metronome", "chords", "ear"],
    video: true,
  },
  {
    id: "piano",
    title: "פסנתר וירטואלי",
    tagline: "מנגנים מהמקלדת",
    description:
      "פסנתר שמנגנים בעכבר, במגע או במקלדת המחשב, עם הדגשת סולמות והקלטה ל־MIDI.",
    icon: Piano,
    hue: 306,
    category: "practice",
    tags: ["פסנתר", "מקלדת", "סולמות", "midi"],
    related: ["theory", "notes", "ear"],
  },
  {
    id: "progressions",
    title: "מהלכים ומנגינות",
    tagline: "אקורדים ולחן בלחיצה",
    description:
      "מהלכי אקורדים לפי אווירה וסולם עם ליווי, ומנגינה מקורית מעליהם — משמיעים, משנים עד שמתאים, ומורידים MIDI.",
    icon: Music4,
    hue: 250,
    category: "create",
    tags: ["אקורדים", "מהלך", "הרמוניה", "כתיבת שירים", "ארפג׳יו", "בס", "midi"],
    badge: "חדש",
    related: ["songbook", "theory", "beats"],
    video: true,
  },
  {
    id: "theory",
    title: "סייר תאוריה",
    tagline: "סולמות, אקורדים ומעגל הקווינטות",
    description:
      "מעגל קווינטות אינטראקטיבי: בוחרים טוניקה ומודוס ורואים את הסולם על הפסנתר ועל צוואר הגיטרה, את האקורדים שלו — ושומעים הכול.",
    icon: Compass,
    hue: 158,
    category: "practice",
    tags: ["תאוריה", "סולמות", "מודוסים", "מעגל הקווינטות", "אקורדים", "הרמוניה"],
    badge: "חדש",
    related: ["piano", "ear", "songbook"],
  },
  {
    id: "changes",
    title: "מאמן מעברים",
    tagline: "מעברים בין אקורדים, על זמן",
    description:
      "שני אקורדים, דקה אחת: סופרים כמה פעמים עברתם ביניהם נקי. השיא לכל זוג נשמר, וגרף מראה את ההתקדמות.",
    icon: Shuffle,
    hue: 140,
    category: "practice",
    tags: ["גיטרה", "אקורדים", "מעברים", "תרגול", "מתחילים", "one minute changes"],
    badge: "חדש",
    related: ["chords", "songbook", "tuner"],
    video: true,
  },
  {
    id: "rhythm",
    title: "מאמן קצב ומעברים",
    tagline: "תבניות קצב ומעברים בין אקורדים",
    description:
      "מתרגלים תבניות קצב מול שעון האודיו, ומעברים בין שני אקורדים בגיטרה על זמן — עם ניקוד ושיאים.",
    icon: Drum,
    hue: 122,
    category: "practice",
    tags: ["קצב", "ריתמוס", "תרגול", "טיימינג", "תופים"],
    related: ["metronome", "beats", "ear"],
    video: true,
  },
  {
    id: "ear",
    title: "מאמן שמיעה",
    tagline: "לזהות מה שומעים",
    description:
      "תרגול שמיעה במשחק קצר: מרווחים, סוגי אקורדים ודרגות בסולם, עם רמות קושי, ניקוד ורצף הצלחות.",
    icon: Ear,
    hue: 322,
    category: "practice",
    tags: ["שמיעה", "מרווחים", "אקורדים", "סולפז׳", "תרגול"],
    related: ["theory", "piano", "rhythm"],
    video: true,
  },
  {
    id: "songbook",
    title: "שירון",
    tagline: "מילים ואקורדים על הבמה",
    description:
      "כותבים או מדביקים מילים עם אקורדים, מזיזים לסולם נוח, גוללים אוטומטית בהופעה, מדפיסים ושומרים באזור האישי.",
    icon: BookOpen,
    hue: 18,
    category: "practice",
    tags: ["שירון", "מילים", "אקורדים", "הופעה", "הדפסה"],
    related: ["chords", "tuner", "theory"],
  },
  {
    id: "transcript",
    title: "תמלול ומילים מסונכרנות",
    tagline: "דיבור לטקסט, מילים לקריוקי",
    description:
      "תמלול הקלטות לטקסט עם חותמות זמן (TXT, SRT, VTT), ומילים לשיר עם זמן לכל מילה לקריוקי ו־LRC.",
    icon: Captions,
    hue: 250,
    category: "analyze",
    tags: ["תמלול", "טקסט", "כתוביות", "srt", "דיבור", "כתוביות לסרטון"],
    quick: "תמלול לטקסט",
    related: ["tts", "lyrics", "video"],
    server: true,
  },
  {
    id: "chords",
    title: "מזהה אקורדים",
    tagline: "האקורדים של כל שיר",
    description:
      "מעלים שיר ומקבלים את האקורדים לאורך הזמן עם דיאגרמות אחיזה לגיטרה, טרנספוזיציה וקאפו — ודף אקורדים להורדה.",
    icon: Guitar,
    hue: 85,
    category: "analyze",
    tags: ["אקורדים", "גיטרה", "אחיזות", "קאפו", "טרנספוזיציה"],
    quick: "אקורדים לגיטרה",
    related: ["songbook", "speed", "tuner"],
    video: true,
  },
  {
    id: "identify",
    title: "מזהה שיר",
    tagline: "מה השיר הזה?",
    description:
      "מקליטים כמה שניות ממה שמתנגן, או מעלים קובץ, ומקבלים את שם השיר, האמן וקישורים להאזנה.",
    icon: Disc3,
    hue: 276,
    category: "analyze",
    tags: ["זיהוי שיר", "שאזאם", "מה השיר", "אמן"],
    related: ["chords", "lyrics", "analyze"],
    server: true,
  },
  {
    id: "analyze",
    title: "מזהה קצב וסולם",
    tagline: "BPM וסולם בשניות",
    description:
      "ניתוח מהיר של כל שיר: קצב, סולם, פרופיל הצלילים ועוצמה — בלי לחכות לניתוח התווים המלא.",
    icon: Activity,
    hue: 180,
    category: "analyze",
    tags: ["bpm", "סולם", "ניתוח", "די ג'יי"],
    quick: "קצב וסולם",
    related: ["chords", "notes", "theory"],
    video: true,
  },
];

/**
 * Tools that did nearly the same job, each with a small extra, now live
 * together as one tool with tabs. Each tab is still the tool it was, at the
 * address it always had (`#/drumkit` opens the drums on the live-kit tab), so
 * links, saved work and the assistant's actions keep working; the menu and
 * the home page show only the first tab's tool, which names the family.
 */
export const TOOL_FAMILIES: { parent: string; tabs: { id: string; label: string }[] }[] = [
  { parent: "notes", tabs: [{ id: "notes", label: "תווים מלאים" }, { id: "analyze", label: "קצב וסולם מהיר" }] },
  { parent: "convert", tabs: [{ id: "convert", label: "קובץ אחד" }, { id: "joiner", label: "כמה קבצים" }] },
  { parent: "mixer", tabs: [{ id: "mixer", label: "מיקסר" }, { id: "recorder", label: "הקלטה בשכבות" }] },
  { parent: "beats", tabs: [{ id: "beats", label: "רשת צעדים" }, { id: "drumkit", label: "נגינה חיה" }, { id: "pads", label: "פדים" }] },
  { parent: "progressions", tabs: [{ id: "progressions", label: "מהלך אקורדים" }, { id: "melody", label: "מנגינה" }] },
  { parent: "visualizer", tabs: [{ id: "visualizer", label: "סרטון" }, { id: "songcard", label: "תמונה" }] },
  { parent: "transcript", tabs: [{ id: "transcript", label: "תמלול" }, { id: "lyrics", label: "מילים לשיר" }] },
  { parent: "rhythm", tabs: [{ id: "rhythm", label: "תבניות קצב" }, { id: "changes", label: "מעברים בין אקורדים" }] },
];

/** The family a tool belongs to, when it shares a page with others. */
export function familyOf(id: string) {
  return TOOL_FAMILIES.find((family) => family.tabs.some((tab) => tab.id === id)) ?? null;
}

/** A tab that is not the first of its family: it has no place of its own in the menu. */
export function isTabOnly(id: string) {
  const family = familyOf(id);
  return Boolean(family && family.parent !== id);
}

// The family's tool is found by what any of its tabs does: searching the
// home page for "karaoke" or "drum kit" lands on the tool that has the tab.
for (const family of TOOL_FAMILIES) {
  const parent = ALL_TOOLS.find((tool) => tool.id === family.parent);
  if (!parent) continue;
  const words = new Set(parent.tags);
  for (const tab of family.tabs) {
    const member = ALL_TOOLS.find((tool) => tool.id === tab.id);
    if (!member || member === parent) continue;
    words.add(member.title);
    for (const tag of member.tags) words.add(tag);
  }
  parent.tags = [...words];
}

/**
 * How the side menu is laid out: small groups by what the visitor is trying
 * to do, and inside each the tools in the order people usually reach for
 * them. Every tool with a place of its own appears here exactly once
 * (tools.test.ts checks); the tabs of a family follow their first tab.
 */
export const MENU_GROUPS: { id: string; label: string; tools: string[] }[] = [
  { id: "notation", label: "מהשיר לתווים", tools: ["notes", "chords", "identify"] },
  { id: "edit", label: "עריכת שמע", tools: ["vocals", "ringtone", "speed", "convert", "denoise", "voice", "video"] },
  { id: "create", label: "יצירה והפקה", tools: ["mixer", "beats", "progressions", "songbook", "visualizer"] },
  { id: "words", label: "דיבור ומילים", tools: ["transcript", "tts"] },
  { id: "practice", label: "תרגול ונגינה", tools: ["tuner", "metronome", "piano", "ear", "rhythm", "theory", "setlist"] },
];

/** The menu group a tool sits in (a tab: its family's), for the location shown above the page. */
export function menuGroupLabel(id: string) {
  const own = familyOf(id)?.parent ?? id;
  return MENU_GROUPS.find((group) => group.tools.includes(own))?.label ?? null;
}

const MENU_ORDER = new Map(
  MENU_GROUPS.flatMap((group) => group.tools)
    .flatMap((id) => familyOf(id)?.tabs.map((tab) => tab.id) ?? [id])
    .map((id, index) => [id, index]),
);

/** The tools visitors see, in the menu's order, tabs included. */
export const TOOLS = ALL_TOOLS.filter((tool) => !tool.hidden).sort(
  (a, b) => (MENU_ORDER.get(a.id) ?? Infinity) - (MENU_ORDER.get(b.id) ?? Infinity),
);

/** The tools with a place of their own in the menu and on the home page. */
export const MENU_TOOLS = TOOLS.filter((tool) => !isTabOnly(tool.id));

/** The tool whose page a tool is shown on: its family's, or its own. */
export function pageToolOf(tool: ToolDefinition): ToolDefinition {
  const family = familyOf(tool.id);
  if (!family || family.parent === tool.id) return tool;
  return ALL_TOOLS.find((item) => item.id === family.parent) ?? tool;
}

/** A tool visitors can see; a hidden one is not found. */
export function findTool(id: string) {
  return TOOLS.find((tool) => tool.id === id) ?? null;
}

/** Any tool, a hidden one too. */
export function findAnyTool(id: string) {
  return ALL_TOOLS.find((tool) => tool.id === id) ?? null;
}
