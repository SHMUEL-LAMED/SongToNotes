/**
 * Guided routes through the site: a few tools in a row for one job. The
 * home page lists them, and each step opens its tool.
 */
export type Workflow = {
  id: string;
  title: string;
  description: string;
  /** The hue the card wears — the colour of the job's main tool. */
  hue: number;
  steps: { tool: string; label: string }[];
};

export const WORKFLOWS: Workflow[] = [
  {
    id: "learn-guitar",
    title: "ללמוד שיר בגיטרה",
    description: "מוציאים מהשיר את האקורדים, ושומרים דף מסודר בשירון עם גלילה אוטומטית.",
    hue: 85,
    steps: [
      { tool: "identify", label: "מה השיר?" },
      { tool: "chords", label: "האקורדים" },
      { tool: "songbook", label: "דף לשירון" },
    ],
  },
  {
    id: "karaoke",
    title: "ערב קריוקי",
    description: "מסירים את השירה מהשיר, ומקבלים מילים שנדלקות מילה אחר מילה בזמן שהמוזיקה מתנגנת.",
    hue: 340,
    steps: [
      { tool: "vocals", label: "בלי שירה" },
      { tool: "lyrics", label: "מילים מסונכרנות" },
    ],
  },
  {
    id: "solo",
    title: "לפצח סולו",
    description: "מאטים את הקטע בלי לשנות גובה, הופכים אותו לתווים ומנגנים אותו בעצמכם על הפסנתר.",
    hue: 198,
    steps: [
      { tool: "speed", label: "האטה" },
      { tool: "notes", label: "תווים" },
      { tool: "piano", label: "נגינה" },
    ],
  },
  {
    id: "beat",
    title: "להפיק ביט משלכם",
    description: "בונים מקצב במכונת התופים, מוסיפים לו ערוצים במיקסר ומורידים קובץ MP3 מוכן.",
    hue: 28,
    steps: [
      { tool: "beats", label: "מקצב" },
      { tool: "mixer", label: "מיקס" },
      { tool: "convert", label: "MP3" },
    ],
  },
  {
    id: "video-ringtone",
    title: "צלצול מסרטון",
    description: "מוציאים את הצליל מסרטון, חותכים את הרגע הכי טוב, ומורידים צלצול לטלפון.",
    hue: 2,
    steps: [
      { tool: "video", label: "הצליל מהסרטון" },
      { tool: "ringtone", label: "חיתוך לצלצול" },
    ],
  },
  {
    id: "musician",
    title: "אימון יומי למוזיקאים",
    description: "עשר דקות ביום: כיוון הכלי, שמיעה, קצב, ותאוריה שנשארת בראש.",
    hue: 322,
    steps: [
      { tool: "tuner", label: "כיוון" },
      { tool: "ear", label: "שמיעה" },
      { tool: "rhythm", label: "קצב" },
      { tool: "theory", label: "תאוריה" },
    ],
  },
];
