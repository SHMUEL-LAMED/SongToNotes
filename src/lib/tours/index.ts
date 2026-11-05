import { familyOf, type ToolDefinition } from "../tools";
import { ANALYSIS_TOURS } from "./analysis";
import { EDITING_TOURS } from "./editing";
import { PAGE_TOURS } from "./pages";
import { PRACTICE_TOURS } from "./practice";
import { STUDIO_TOURS } from "./studio";
import type { TourStep } from "./types";
import { WORDS_TOURS } from "./words";

export type { TourStep } from "./types";

/** What happens inside each tool, by tool id; the frame around it is added below. */
export const TOOL_TOURS: Record<string, TourStep[]> = {
  ...ANALYSIS_TOURS,
  ...EDITING_TOURS,
  ...STUDIO_TOURS,
  ...WORDS_TOURS,
  ...PRACTICE_TOURS,
};

export { PAGE_TOURS };

/** The assistant and the way back to the tour: the last stops of every tour. */
const CLOSING: TourStep[] = [
  {
    target: ".assistant-launcher",
    title: "העוזר",
    text: "נתקעתם? העוזר עונה על שאלות, וגם מבצע באתר את מה שמבקשים ממנו — בכלי הזה ובכל כלי אחר. נפתח גם ב־Ctrl+J.",
    optional: true,
  },
  {
    target: ".tour-button",
    title: "הסיור תמיד כאן",
    text: "הכפתור „הסבר” מפעיל סיור כזה בכל עמוד ובכל כלי, מתי שרוצים.",
  },
];

/** The frame of the site, for a page that has no tour of its own. */
const FRAME: TourStep[] = [
  {
    target: ".sidebar-nav, .tabbar",
    title: "כל הכלים",
    text: "התפריט מחזיק את כל הכלים, בקבוצות לפי מה שרוצים לעשות. בטלפון הוא נפתח מ„כלים” בשורה שבתחתית.",
  },
  {
    target: ".sidebar-search, .topbar-search",
    title: "חיפוש",
    text: "מחפשים כלי, עבודה שמורה או פעולה — גם ב־Ctrl+K מכל מקום.",
    optional: true,
  },
  {
    target: ".account-button",
    title: "האזור האישי",
    text: "התחברות, העבודות ששמרתם וההגדרות שלכם.",
  },
];

function toolTour(tool: ToolDefinition): TourStep[] {
  const family = familyOf(tool.id);
  const opening: TourStep[] = [
    { target: ".tool-intro, .tool-hero", title: tool.title, text: tool.description },
  ];
  if (family) {
    const labels = family.tabs.map((tab) => `„${tab.label}”`).join(", ");
    opening.push({
      target: ".tool-tabs",
      title: "כמה חלקים בכלי אחד",
      text: `הכלי בנוי מלשוניות: ${labels}. לכל לשונית סיור משלה, והקובץ הפתוח עובר איתכם כשמחליפים.`,
      optional: true,
    });
  }
  const after: TourStep[] = [
    {
      target: ".tool-video",
      title: "סרטון הדרכה",
      text: "מעדיפים לראות? סרטון קצר, פחות מדקה, מראה את הכלי בפעולה.",
      optional: true,
    },
    {
      target: ".send-file",
      title: "ממשיכים עם הקובץ",
      text: "הקובץ שפתוח כאן — או התוצאה, כשיש כבר תוצאה — עובר בלחיצה לכלי אחר, בלי לבחור אותו שוב.",
      optional: true,
    },
    {
      target: ".next-steps",
      title: "ממשיכים מכאן",
      text: "הכלים שבדרך כלל באים אחרי הכלי הזה, כדי להמשיך לשלב הבא.",
      optional: true,
    },
    {
      target: ".fav-toggle",
      title: "למועדפים",
      text: "הכוכב מצמיד את הכלי לראש התפריט ולדף הבית, כדי לחזור אליו בלחיצה.",
      optional: true,
    },
  ];
  return [...opening, ...(TOOL_TOURS[tool.id] ?? []), ...after, ...CLOSING];
}

/**
 * The tour of the page on screen: a tool gets its own stops inside the frame
 * every tool shares; the home page, the personal area and the credits page
 * have tours of their own; anything else is shown the frame of the site.
 */
export function tourFor(route: string, tool: ToolDefinition | null): TourStep[] {
  if (tool) return toolTour(tool);
  const page = route === "home" ? "home" : route === "me" || route.startsWith("me/") ? "me" : route;
  return [...(PAGE_TOURS[page] ?? FRAME), ...CLOSING];
}
