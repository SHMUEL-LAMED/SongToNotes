import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  Captions,
  Guitar,
  Ear,
  FileMusic,
  Gauge,
  MicVocal,
  Piano,
  Smartphone,
  Snail,
  Timer,
} from "lucide-react";

export type ToolCategory = "create" | "practice" | "analyze";

export type ToolDefinition = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** CSS hue used for the tool's accent — every tool gets its own colour. */
  hue: number;
  category: ToolCategory;
  tags: string[];
  badge?: string;
};

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  create: "יצירה והמרה",
  practice: "תרגול ונגינה",
  analyze: "ניתוח והאזנה",
};

/**
 * One list drives the hub, the routing and the page titles, so adding a
 * tool is a matter of adding one entry here and one component.
 */
export const TOOLS: ToolDefinition[] = [
  {
    id: "notes",
    title: "שיר לתווים",
    tagline: "מנגינה נכנסת, תווים יוצאים",
    description:
      "מעלים שיר או מזמזמים למיקרופון, והאתר מזהה תווים, קצב וסולם ומכין תווים, MIDI ו־MusicXML.",
    icon: FileMusic,
    hue: 258,
    category: "create",
    tags: ["תווים", "midi", "musicxml", "תמלול", "פסנתר"],
    badge: "הכלי הראשי",
  },
  {
    id: "ringtone",
    title: "יצירת צלצול",
    tagline: "חותכים, מעמעמים, מורידים",
    description:
      "בוחרים את הקטע הכי טוב בשיר, מוסיפים כניסה ויציאה רכות ומורידים צלצול מוכן לטלפון.",
    icon: Smartphone,
    hue: 335,
    category: "create",
    tags: ["צלצול", "חיתוך", "טלפון", "fade"],
  },
  {
    id: "vocals",
    title: "הסרת שירה",
    tagline: "קריוקי מכל שיר",
    description:
      "מפרידים את השירה מהליווי ומורידים גרסה אינסטרומנטלית — או להפך, רק את הקול.",
    icon: MicVocal,
    hue: 20,
    category: "create",
    tags: ["קריוקי", "ווקאל", "אינסטרומנטלי", "פלייבק"],
    badge: "חדש",
  },
  {
    id: "speed",
    title: "מאט ומאיץ",
    tagline: "לתרגל בקצב שלך",
    description:
      "מאטים שיר בלי לשנות את הגובה, או משנים טון בלי לשנות את הקצב — מושלם ללמידת סולו.",
    icon: Snail,
    hue: 168,
    category: "practice",
    tags: ["תרגול", "מהירות", "טרנספוזיציה", "לולאה"],
    badge: "חדש",
  },
  {
    id: "metronome",
    title: "מטרונום",
    tagline: "דיוק של אולפן",
    description:
      "מטרונום מדויק עם הדגשות, חלוקות משנה, טאפ־טמפו ומשקלים — עובד גם כשהמסך כבוי.",
    icon: Timer,
    hue: 28,
    category: "practice",
    tags: ["קצב", "bpm", "תרגול", "מקצב"],
  },
  {
    id: "tuner",
    title: "מכוון כלים",
    tagline: "כרומטי, מהמיקרופון",
    description:
      "מזהה את הצליל שמנגנים ומראה כמה סנטים הוא רחוק מהתו — לגיטרה, כינור, יוקללה ולקול.",
    icon: Gauge,
    hue: 190,
    category: "practice",
    tags: ["טיונר", "כיוון", "גיטרה", "כינור", "סנטים"],
  },
  {
    id: "piano",
    title: "פסנתר וירטואלי",
    tagline: "מנגנים מהמקלדת",
    description:
      "פסנתר שמנגנים בעכבר, במגע או במקלדת המחשב, עם הדגשת סולמות והקלטה ל־MIDI.",
    icon: Piano,
    hue: 280,
    category: "practice",
    tags: ["פסנתר", "מקלדת", "סולמות", "midi"],
  },
  {
    id: "ear",
    title: "מאמן שמיעה",
    tagline: "לזהות מה שומעים",
    description:
      "תרגול שמיעה במשחק קצר: מרווחים, סוגי אקורדים ודרגות בסולם, עם רמות קושי, ניקוד ורצף הצלחות.",
    icon: Ear,
    hue: 300,
    category: "practice",
    tags: ["שמיעה", "מרווחים", "אקורדים", "סולפז׳", "תרגול"],
    badge: "חדש",
  },
  {
    id: "transcript",
    title: "תמלול לטקסט",
    tagline: "דיבור נכנס, טקסט יוצא",
    description:
      "מעלים הקלטה או שיר והדפדפן מתמלל את הדיבור לטקסט עם חותמות זמן — עברית, אנגלית ועוד — להורדה כטקסט או ככתוביות.",
    icon: Captions,
    hue: 210,
    category: "analyze",
    tags: ["תמלול", "טקסט", "כתוביות", "srt", "דיבור", "כתוביות לסרטון"],
    badge: "חדש",
  },
  {
    id: "chords",
    title: "מזהה אקורדים לגיטרה",
    tagline: "האקורדים של כל שיר",
    description:
      "מעלים שיר ומקבלים את האקורדים לאורך הזמן עם דיאגרמות אחיזה לגיטרה, טרנספוזיציה וקאפו — ודף אקורדים להורדה.",
    icon: Guitar,
    hue: 40,
    category: "analyze",
    tags: ["אקורדים", "גיטרה", "אחיזות", "קאפו", "טרנספוזיציה"],
    badge: "חדש",
  },
  {
    id: "songbook",
    title: "שירון",
    tagline: "מילים ואקורדים על הבמה",
    description:
      "כותבים או מדביקים מילים עם אקורדים, מזיזים לסולם נוח, גוללים אוטומטית בהופעה, מדפיסים ושומרים באזור האישי.",
    icon: BookOpen,
    hue: 350,
    category: "practice",
    tags: ["שירון", "מילים", "אקורדים", "הופעה", "הדפסה"],
    badge: "חדש",
  },
  {
    id: "analyze",
    title: "מזהה קצב וסולם",
    tagline: "BPM וסולם בשניות",
    description:
      "ניתוח מהיר של כל שיר: קצב, סולם, פרופיל הצלילים ועוצמה — בלי לחכות לניתוח התווים המלא.",
    icon: Activity,
    hue: 158,
    category: "analyze",
    tags: ["bpm", "סולם", "ניתוח", "די ג'יי"],
    badge: "חדש",
  },
];

export function findTool(id: string) {
  return TOOLS.find((tool) => tool.id === id) ?? null;
}
