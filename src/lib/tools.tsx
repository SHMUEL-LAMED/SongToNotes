import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeftRight,
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
  Mic2,
  Music4,
  MicVocal,
  Piano,
  Smartphone,
  Snail,
  Speech,
  Timer,
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
  /** True when the tool sends audio or text to the site's server to do its work. */
  server?: boolean;
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
 */
export const TOOLS: ToolDefinition[] = [
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
    tagline: "מנגינה נכנסת, תווים יוצאים",
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
  },
  {
    id: "beats",
    title: "מכונת תופים",
    tagline: "ביט משלכם, צעד אחרי צעד",
    description:
      "רשת של שישה עשר צעדים ושמונה כלי הקשה מסונתזים: בונים מקצב, מוסיפים סווינג, ומורידים לולאה כקובץ או שולחים למיקסר.",
    icon: Grid3x3,
    hue: 28,
    category: "create",
    tags: ["תופים", "ביט", "מקצב", "סיקוונסר", "drum machine", "לופ"],
    badge: "חדש",
    related: ["mixer", "metronome", "rhythm"],
  },
  {
    id: "convert",
    title: "המרת פורמטים",
    tagline: "MP3 או WAV, באיכות שתבחרו",
    description:
      "ממירים כל קובץ שמע ל־MP3 או WAV עם שליטה בקצב הדגימה, בערוצים ובאיכות, חיתוך ועוצמה — בדפדפן, בלי להעלות.",
    icon: ArrowLeftRight,
    hue: 238,
    category: "create",
    tags: ["המרה", "mp3", "wav", "פורמט", "קצב דגימה"],
    quick: "המרה ל־MP3 / WAV",
    related: ["ringtone", "mixer", "video"],
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
  },
  {
    id: "mixer",
    title: "מיקסר ולופר",
    tagline: "כמה ערוצים, מיקס אחד",
    description:
      "מעלים כמה קבצים — למשל השירה והליווי שהופרדו — מאזנים עוצמה ופאן, מנגנים בלולאה על קטע, ומורידים מיקס אחד.",
    icon: Layers,
    hue: 262,
    category: "create",
    tags: ["מיקס", "לופ", "ערוצים", "פאן", "עוצמה"],
    quick: "ערוץ במיקסר",
    related: ["beats", "vocals", "convert"],
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
    title: "מחולל מהלכים",
    tagline: "מהלך אקורדים לפי אווירה",
    description:
      "בוחרים סולם ואווירה — פופ, עצוב, מזרחי, ג׳אז — ומקבלים מהלך אקורדים שמתנגן בלולאה עם ארפג׳יו ובס. מחליפים אקורד בלחיצה ושולחים לשירון או כ־MIDI.",
    icon: Music4,
    hue: 250,
    category: "create",
    tags: ["אקורדים", "מהלך", "הרמוניה", "כתיבת שירים", "ארפג׳יו", "בס", "midi"],
    badge: "חדש",
    related: ["songbook", "theory", "beats"],
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
    id: "rhythm",
    title: "מאמן קצב",
    tagline: "לתופף בזמן",
    description:
      "תבניות קצב מקל לקשה: ספירה, נגינה, ואתם מתופפים על המקלדת או על המסך — האתר מודד כל הקשה ומראה אם אתם מקדימים או מאחרים.",
    icon: Drum,
    hue: 122,
    category: "practice",
    tags: ["קצב", "ריתמוס", "תרגול", "טיימינג", "תופים"],
    related: ["metronome", "beats", "ear"],
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
    title: "תמלול לטקסט",
    tagline: "דיבור נכנס, טקסט יוצא",
    description:
      "מעלים הקלטה או שיר והדפדפן מתמלל את הדיבור לטקסט עם חותמות זמן — עברית, אנגלית ועוד — להורדה כטקסט או ככתוביות.",
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
  },
];

export function findTool(id: string) {
  return TOOLS.find((tool) => tool.id === id) ?? null;
}
