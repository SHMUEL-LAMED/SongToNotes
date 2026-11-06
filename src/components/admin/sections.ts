import {
  Activity,
  ChartNoAxesColumn,
  Clock,
  MessageSquareText,
  Power,
  ScrollText,
  Server,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The parts of the admin area, each on an address of its own
 * (`#/admin/feedback`), in three groups: what is happening on the site, the
 * people, and the switches.
 */
export type SectionId =
  | "overview"
  | "tools"
  | "audience"
  | "accounts"
  | "feedback"
  | "control"
  | "credits"
  | "server"
  | "audit";

export type Section = {
  id: SectionId;
  /** The name in the navigation. */
  label: string;
  /** The heading of the page while it is open. */
  title: string;
  /** One line under the heading: what this part is for. */
  lead: string;
  icon: LucideIcon;
  /** Whether the range (7, 30 or 90 days) changes what it shows. */
  ranged: boolean;
};

export const SECTIONS: Section[] = [
  {
    id: "overview",
    label: "סקירה",
    title: "מצב האתר",
    lead: "מה דורש תשומת לב, ואיך האתר עובר בטווח שנבחר.",
    icon: ChartNoAxesColumn,
    ranged: true,
  },
  {
    id: "tools",
    label: "כלים",
    title: "הכלים",
    lead: "כל כלי: כמה נכנסו, כמה יצאו עם תוצאה, ומה נשבר באמצע.",
    icon: Activity,
    ranged: true,
  },
  {
    id: "audience",
    label: "זמנים וקהל",
    title: "זמנים וקהל",
    lead: "מתי נכנסים, מאיזה מכשיר ודפדפן, ומאיפה מגיעים.",
    icon: Clock,
    ranged: true,
  },
  {
    id: "accounts",
    label: "חשבונות",
    title: "החשבונות",
    lead: "מי פתח חשבון, מתי נכנס לאחרונה ומה שמר. כל פתיחה של הרשימה נרשמת ביומן.",
    icon: UserRound,
    ranged: false,
  },
  {
    id: "feedback",
    label: "משוב",
    title: "משוב מהגולשים",
    lead: "מה שנשלח מ„משוב והצעות”: בעיות, רעיונות, ומי שלח.",
    icon: MessageSquareText,
    ranged: false,
  },
  {
    id: "control",
    label: "שליטה באתר",
    title: "שליטה באתר",
    lead: "מצב תחזוקה, הודעה לכל הגולשים, וכיבוי של כלי בודד.",
    icon: Power,
    ranged: false,
  },
  {
    id: "credits",
    label: "קרדיטים",
    title: "קרדיטים והזמנת חברים",
    lead: "כמה עולה כל פעולת שרת, כמה מקבלים, ואיך הקרדיטים זזים באתר.",
    icon: Zap,
    ranged: true,
  },
  {
    id: "server",
    label: "שרת ומפתחות",
    title: "שרת ומפתחות",
    lead: "בריאות השירותים, מכסות, מפתחות, וניקוי של מה שכבר לא צריך.",
    icon: Server,
    ranged: false,
  },
  {
    id: "audit",
    label: "יומן פעולות",
    title: "יומן פעולות",
    lead: "כל שינוי שנעשה מאזור הניהול, ומי עשה אותו.",
    icon: ScrollText,
    ranged: false,
  },
];

export const SECTION_GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: "מה קורה באתר", ids: ["overview", "tools", "audience"] },
  { label: "אנשים", ids: ["accounts", "feedback"] },
  { label: "הגדרות", ids: ["control", "credits", "server", "audit"] },
];

/** The section an address names; the overview for anything else. */
export function sectionFrom(value: string | null | undefined): SectionId {
  // The old "זמנים וקהל" tab was called "times", and "system" held what is
  // now split in four; an old bookmark lands on the nearest part.
  if (value === "times") return "audience";
  if (value === "system") return "control";
  return SECTIONS.find((section) => section.id === value)?.id ?? "overview";
}

export function sectionById(id: SectionId): Section {
  return SECTIONS.find((section) => section.id === id) ?? SECTIONS[0];
}
