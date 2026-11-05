import {
  ArrowLeft,
  Check,
  ChevronLeft,
  Clock3,
  Cloud,
  Copy,
  Gift,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Star,
  WifiOff,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { memo, useEffect, useId, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "../lib/auth";
import { balanceOf, creditsLabel, referralLink } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";
import { markShared } from "../lib/siteShare";
import { clearRecentTools, useFavorites, useRecentTools } from "../lib/prefs";
import { MENU_TOOLS, findTool, type ToolDefinition } from "../lib/tools";
import { KIND_LABELS, KIND_TOOL, describeWork, listWorks, type SavedWork } from "../lib/works";
import { Button, Chip, SectionHead } from "../ui";
import { QuickStart } from "./QuickStart";
import { SiteFooter } from "./SiteFooter";
import { ToolMosaic } from "./ToolMosaic";
import { WorkThumb } from "./WorkThumb";
import { WorkflowStories } from "./WorkflowStories";

type Props = {
  onOpen: (id: string) => void;
  onOpenWork: (work: SavedWork) => void;
  /** Tools the admin area switched off; shown, but not openable. */
  disabledTools?: string[];
  /** Opens "משוב והצעות". */
  onFeedback: () => void;
  /** Opens the search, for "כלי אחר…" under a dropped file. */
  onOpenPalette?: () => void;
};

/** The promises at the foot of the page, each a short statement with its small print under it (see Pledge). */
const PROMISES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: "פרטי מהיסוד",
    text: "ברוב הכלים השמע מעובד בדפדפן ולא עולה לשום מקום. הכלים שנעזרים בשרת מסומנים ככאלה.",
  },
  { icon: WifiOff, title: "עובד גם בלי רשת", text: "אפשר להתקין את האתר כאפליקציה, ורוב הכלים ממשיכים לעבוד גם במצב טיסה." },
  { icon: Cloud, title: "הכול נשמר, אם תרצו", text: "מתחברים עם Google, וכל מה שיצרתם מחכה באזור האישי — מכל מכשיר." },
  { icon: Sparkles, title: "עוזר שעושה", text: "מבקשים בשפה חופשית, והעוזר פותח כלים, מכוון מטרונום, כותב לשירון ושומר." },
];

/** The three things the hero promises in a line each. */
const PILLARS: { icon: LucideIcon; text: string }[] = [
  { icon: LockKeyhole, text: "פרטי — העיבוד בדפדפן" },
  { icon: WifiOff, text: "עובד גם בלי רשת" },
  { icon: Cloud, text: "נשמר אם מתחברים" },
];

/** The default for `disabledTools`, one array for good, so the memoised parts of the page see the same prop every render. */
const NO_TOOLS: string[] = [];

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "לילה טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  if (hour < 21) return "ערב טוב";
  return "לילה טוב";
}

/**
 * The home page: the headline beside the quick start, the visitor's own
 * studio (when there is anything in it), every tool, the routes, the word
 * about credits and the promises.
 */
export function Home({ onOpen, onOpenWork, disabledTools = NO_TOOLS, onFeedback, onOpenPalette }: Props) {
  const { user, profile } = useAuth();
  const { favorites } = useFavorites();
  const recentTools = useRecentTools();
  const [works, setWorks] = useState<SavedWork[]>([]);
  const [now] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    void listWorks(user?.id ?? null)
      .then((list) => {
        if (alive) setWorks(list.slice(0, 4));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user]);

  const recent = recentTools.map(findTool).filter((tool): tool is ToolDefinition => Boolean(tool)).slice(0, 6);
  // The last tool opened gets a place of its own at the head of the studio; the rest line up after it.
  const [lastTool, ...earlier] = recent;
  // Favourites whose tool was hidden since drop out; a list of only those
  // used to leave the "your tools" heading over an empty shelf.
  const favoriteTools = favorites.map(findTool).filter((tool): tool is ToolDefinition => Boolean(tool));
  const firstName = user ? profile?.full_name?.split(" ")[0] : null;

  const scrollToCatalog = () => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="home">
      <section className="hub-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <Chip className="hero-kicker">{firstName ? `${greeting(now)}, ${firstName}` : "הסטודיו המוזיקלי שלך, בדפדפן"}</Chip>
          <h1 id="hero-title" className="hero-title">
            {/* One sentence for readers; the coloured words are for the eye. */}
            <span className="sr-only">הופכים כל שיר לתווים, לאקורדים, לקריוקי.</span>
            <span aria-hidden="true">
              הופכים כל שיר <em>לתווים</em>, <em>לאקורדים</em>, <em>לקריוקי</em>.
            </span>
          </h1>
          <span className="hero-bar" aria-hidden="true" />
          <p className="hero-lead">
            תווים מכל שיר, קריוקי, אקורדים, צלצולים, מכונת תופים, טיונר ועוד — {MENU_TOOLS.length} כלים, ורובם רצים
            אצלך במכשיר, בלי להעלות את הקובץ.
          </p>
          <div className="hero-actions">
            <Button variant="primary" size="lg" className="hero-cta" icon={<Wand2 size={18} aria-hidden="true" />} onClick={() => onOpen("notes")}>
              הפכו שיר לתווים
            </Button>
            <Button size="lg" onClick={scrollToCatalog}>
              לכל הכלים <ArrowLeft size={16} aria-hidden="true" />
            </Button>
          </div>
          <ul className="hero-pillars">
            {PILLARS.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Icon size={16} aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <QuickStart disabledTools={disabledTools} onOther={onOpenPalette} />
      </section>

      {(favoriteTools.length > 0 || recent.length > 0 || works.length > 0) && (
        <Studio
          lastTool={lastTool ?? null}
          favoriteTools={favoriteTools}
          recentTools={earlier.filter((tool) => !favorites.includes(tool.id))}
          canClear={recent.length > 0}
          works={works}
          disabledTools={disabledTools}
          onOpen={onOpen}
          onOpenWork={onOpenWork}
        />
      )}

      <ToolMosaic onOpen={onOpen} disabledTools={disabledTools} />

      <WorkflowStories onOpen={onOpen} disabledTools={disabledTools} />

      <CreditsBand onOpen={onOpen} />

      <Pledge />

      <SiteFooter onOpen={onOpen} onFeedback={onFeedback} />
    </div>
  );
}

/** The promises in four ruled columns: what the site does with your files, and what it does for you. */
const Pledge = memo(function Pledge() {
  return (
    <section className="pledge aura-pledge" aria-labelledby="promises-title">
      <h2 id="promises-title">ברוב הכלים, השיר שלך לא יוצא מהמכשיר.</h2>
      <ul className="pledge-list">
        {PROMISES.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <span className="pledge-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
});

/**
 * Credits in one quiet band: for a visitor, what signing in gives; for an
 * account, the balance and the private link, one tap from the clipboard.
 */
const CreditsBand = memo(function CreditsBand({ onOpen }: { onOpen: (id: string) => void }) {
  const { user } = useAuth();
  const { rules, status } = useCredits();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!rules.enabled) return null;
  const link = status ? referralLink(status.code) : null;
  const copy = () => {
    if (!link) return;
    void navigator.clipboard
      .writeText(link)
      .then(() => {
        markShared();
        setCopied(true);
      })
      // No clipboard here: the credits page shows the link to copy by hand.
      .catch(() => onOpen("credits"));
  };

  return (
    <section className="credits-band credits-promo" aria-labelledby="credits-promo-title">
      <span className="credits-promo-icon" aria-hidden="true">
        <Gift size={22} />
      </span>
      <div className="credits-promo-copy">
        <h2 id="credits-promo-title">
          {user && status
            ? `יש לך ${creditsLabel(balanceOf(status))} — וחברים מביאים עוד`
            : `${rules.daily} קרדיטים בכל יום, ועוד על כל חבר שמצטרף`}
        </h2>
        <p>
          {user
            ? `שלחו לחברים את הקישור האישי שלכם: על כל מי שמצטרף דרכו תקבלו ${rules.signupBonus} קרדיטים, והקצבה היומית שלכם תגדל.`
            : "הכלים שבדפדפן חינמיים תמיד. לפעולות שרצות בשרת — תמלול, העוזר, הפרדת שירה ב־AI — מתחברים ומקבלים קרדיטים חינם בכל יום, וקישור אישי להזמנת חברים."}
        </p>
      </div>
      <div className="credits-promo-actions">
        {link && (
          <Button variant="primary" icon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} onClick={copy}>
            {copied ? "הקישור הועתק" : "העתקת הקישור שלי"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => onOpen("credits")}>
          {user ? "לדף הקרדיטים" : "איך זה עובד"} <ArrowLeft size={15} aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
});

type StudioProps = {
  /** The tool opened last, shown on its own at the head of the studio. */
  lastTool: ToolDefinition | null;
  favoriteTools: ToolDefinition[];
  /** The ones opened before it, less the favourites already on the shelf. */
  recentTools: ToolDefinition[];
  canClear: boolean;
  works: SavedWork[];
  /** Tools the admin area switched off: still on the shelves, dimmed, but not openable. */
  disabledTools: string[];
  onOpen: (id: string) => void;
  onOpenWork: (work: SavedWork) => void;
};

/** The visitor's own corner: the last tool, their favourites and recent tools, and the work they saved. */
function Studio({ lastTool, favoriteTools, recentTools, canClear, works, disabledTools, onOpen, onOpenWork }: StudioProps) {
  const hasShelf = favoriteTools.length > 0 || recentTools.length > 0;

  // The button goes with the history it clears: focus moves to what is left
  // of the studio, or, when nothing is, on to the catalogue's search.
  const clear = (event: MouseEvent<HTMLButtonElement>) => {
    const hadFocus = document.activeElement === event.currentTarget;
    flushSync(clearRecentTools);
    if (!hadFocus) return;
    const next =
      document.getElementById("mine-title") ?? document.getElementById("works-title") ?? document.querySelector<HTMLElement>(".hub-search input");
    next?.focus();
  };

  return (
    <section className="studio aura-dock" aria-labelledby="studio-title">
      <SectionHead id="studio-title" title="הסטודיו שלך" />
      <div className="studio-grid">
        {lastTool && <LastOpened tool={lastTool} off={disabledTools.includes(lastTool.id)} onOpen={onOpen} />}

        {hasShelf && (
          <div className="studio-col panel">
            <div className="studio-col-head">
              <h3 id="mine-title" tabIndex={-1}>
                הכלים שלך
              </h3>
              {canClear && (
                <Button variant="ghost" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={clear}>
                  ניקוי ההיסטוריה
                </Button>
              )}
            </div>
            <ShelfGroup
              label="המועדפים שלי"
              icon={<Star size={12} fill="currentColor" aria-hidden="true" />}
              tools={favoriteTools}
              disabledTools={disabledTools}
              onOpen={onOpen}
            />
            <ShelfGroup label="נפתחו לאחרונה" icon={<Clock3 size={12} aria-hidden="true" />} tools={recentTools} disabledTools={disabledTools} onOpen={onOpen} />
          </div>
        )}

        {works.length > 0 && (
          <div className="studio-col panel">
            <div className="studio-col-head">
              <h3 id="works-title" tabIndex={-1}>
                להמשיך מאיפה שעצרת
              </h3>
              <Button variant="ghost" size="sm" onClick={() => onOpen("me")}>
                לכל העבודות <ArrowLeft size={14} aria-hidden="true" />
              </Button>
            </div>
            <ul className="studio-works">
              {works.map((work) => {
                const tool = findTool(KIND_TOOL[work.kind]);
                const summary = describeWork(work);
                return (
                  <li key={work.id}>
                    <button
                      type="button"
                      className="studio-work"
                      style={{ "--accent-hue": tool?.hue ?? 292 } as CSSProperties}
                      onClick={() => onOpenWork(work)}
                    >
                      <WorkThumb work={work} className="is-tiny" />
                      <span className="studio-work-text">
                        <b>{work.title}</b>
                        <small>
                          {KIND_LABELS[work.kind]}
                          {summary ? ` · ${summary}` : ""}
                        </small>
                      </span>
                      <ChevronLeft size={16} className="studio-go" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** The tool opened last, one tap from where the visitor left it — unless it has been switched off since. */
function LastOpened({ tool, off, onOpen }: { tool: ToolDefinition; off: boolean; onOpen: (id: string) => void }) {
  const Icon = tool.icon;
  return (
    <div className={`studio-last panel${off ? " is-off" : ""}`} style={{ "--accent-hue": tool.hue } as CSSProperties}>
      <p className="studio-last-kicker">
        <Clock3 size={12} aria-hidden="true" />
        נפתח לאחרונה
      </p>
      <div className="studio-last-tool">
        <span className="studio-last-icon" aria-hidden="true">
          <Icon size={24} />
        </span>
        <span className="studio-last-text">
          <b>{tool.title}</b>
          <span>{tool.tagline}</span>
        </span>
      </div>
      {off ? (
        <Button variant="primary" className="studio-last-go" disabled>
          מכובה זמנית
        </Button>
      ) : (
        <Button variant="primary" className="studio-last-go" onClick={() => onOpen(tool.id)} aria-label={`לפתוח שוב את ${tool.title}`}>
          לפתוח שוב <ArrowLeft size={15} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** One shelf of the studio — the favourites or the recently opened — named in words, not only by its mark. */
function ShelfGroup({
  label,
  icon,
  tools,
  disabledTools,
  onOpen,
}: {
  label: string;
  icon: ReactNode;
  tools: ToolDefinition[];
  disabledTools: string[];
  onOpen: (id: string) => void;
}) {
  const id = useId();
  if (tools.length === 0) return null;
  return (
    <div className="studio-shelf">
      <span className="studio-caption" id={id}>
        {icon}
        {label}
      </span>
      <ul aria-labelledby={id}>
        {tools.map((tool) => {
          const Icon = tool.icon;
          const off = disabledTools.includes(tool.id);
          return (
            <li key={tool.id}>
              <button
                type="button"
                className="studio-app"
                style={{ "--accent-hue": tool.hue } as CSSProperties}
                onClick={() => onOpen(tool.id)}
                disabled={off}
                title={off ? "מכובה זמנית" : tool.tagline}
              >
                <span className="led" aria-hidden="true" />
                <span className="studio-app-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="studio-app-name">{tool.title}</span>
                {off && <span className="sr-only">מכובה זמנית</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
