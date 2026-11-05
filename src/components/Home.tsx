import {
  ArrowLeft,
  Check,
  Cloud,
  Clock3,
  Copy,
  Gift,
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
import { useIdleOffscreen } from "../lib/useIdleOffscreen";
import { KIND_LABELS, KIND_TOOL, describeWork, listWorks, type SavedWork } from "../lib/works";
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
};

/** The spectrum behind the hero: a fixed shape, not live audio. */
const SPECTRUM = [22, 38, 30, 56, 44, 72, 60, 88, 70, 96, 82, 64, 90, 74, 52, 68, 46, 58, 36, 48, 28, 40, 24, 32];

/** What the hero's headline turns a song into, one word at a time. */
const WORDS = ["לתווים.", "לאקורדים.", "לקריוקי.", "לצלצול.", "ל־MIDI.", "לשירון."];

/** Notes drifting up through the hero; fixed spots, so every visit looks the same. */
const GLYPHS: { char: string; style: CSSProperties }[] = [
  { char: "♪", style: { "--x": "8%", "--s": "26px", "--t": "13s", "--d": "-2s" } as CSSProperties },
  { char: "♫", style: { "--x": "22%", "--s": "34px", "--t": "17s", "--d": "-9s" } as CSSProperties },
  { char: "♩", style: { "--x": "41%", "--s": "22px", "--t": "15s", "--d": "-5s" } as CSSProperties },
  { char: "♬", style: { "--x": "57%", "--s": "30px", "--t": "19s", "--d": "-12s" } as CSSProperties },
  { char: "♪", style: { "--x": "73%", "--s": "20px", "--t": "14s", "--d": "-7s" } as CSSProperties },
  { char: "𝄞", style: { "--x": "88%", "--s": "40px", "--t": "21s", "--d": "-15s" } as CSSProperties },
];

/** Steps through `count` values every `ms`; stays on the first for reduced motion. */
function useRotatingIndex(count: number, ms: number) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), ms);
    return () => window.clearInterval(timer);
  }, [count, ms]);
  return index;
}

/** The promises at the foot of the page, each a big statement with its small print under it (see Pledge). */
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

/** The default for `disabledTools`, one array for good, so the parts under the hero see the same prop every render. */
const NO_TOOLS: string[] = [];

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "לילה טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  if (hour < 21) return "ערב טוב";
  return "לילה טוב";
}

export function Home({ onOpen, onOpenWork, disabledTools = NO_TOOLS, onFeedback }: Props) {
  const { user, profile } = useAuth();
  const { favorites } = useFavorites();
  const recentTools = useRecentTools();
  const [works, setWorks] = useState<SavedWork[]>([]);
  const [now] = useState(() => new Date());
  const word = useRotatingIndex(WORDS.length, 2400);

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
  // The last tool opened gets a place of its own at the head of the dock; the rest line up after it.
  const [lastTool, ...earlier] = recent;
  // Favourites whose tool was hidden since drop out; a list of only those
  // used to leave the "your tools" heading over an empty shelf.
  const favoriteTools = favorites.map(findTool).filter((tool): tool is ToolDefinition => Boolean(tool));
  const firstName = user ? profile?.full_name?.split(" ")[0] : null;

  const scrollToCatalog = () => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="home">
      <section className="hub-hero">
        <div className="hero-stage" aria-hidden="true">
          <span className="hero-aurora is-a" />
          <span className="hero-aurora is-b" />
          <span className="hero-aurora is-c" />
          <span className="hero-floor" />
          <div className="hero-spectrum">
            {SPECTRUM.map((height, index) => (
              <i key={index} style={{ "--h": `${height}%`, "--d": `${index * -0.13}s` } as CSSProperties} />
            ))}
          </div>
          {GLYPHS.map((glyph, index) => (
            <span key={index} className="hero-glyph" style={glyph.style}>
              {glyph.char}
            </span>
          ))}
        </div>

        <div className="hero-copy">
          <span className="hero-kicker">
            <span className="hero-kicker-dot" />
            {firstName ? `${greeting(now)}, ${firstName}` : "הסטודיו המוזיקלי שלך, בדפדפן"}
          </span>
          <h1>
            <span className="sr-only">הפכו כל שיר לתווים, לאקורדים, לקריוקי, לצלצול ועוד</span>
            <span aria-hidden="true" className="hero-line">
              הפכו כל שיר
            </span>
            <span aria-hidden="true" className="hero-line hero-rotator">
              <span key={word} className="hero-word">
                {WORDS[word]}
              </span>
            </span>
          </h1>
          <p>
            תווים מכל שיר, קריוקי, אקורדים, צלצולים, מכונת תופים, טיונר ועוד — {MENU_TOOLS.length} כלים, ורובם רצים
            אצלך במכשיר, בלי להעלות את הקובץ.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-button compact hero-cta" onClick={() => onOpen("notes")}>
              <Wand2 size={18} /> הפכו שיר לתווים
            </button>
            <button type="button" className="secondary-button" onClick={scrollToCatalog}>
              לכל הכלים <ArrowLeft size={16} />
            </button>
          </div>
          <dl className="hero-stats">
            <div>
              <dt>כלים</dt>
              <dd>{MENU_TOOLS.length}</dd>
            </div>
            <div>
              <dt>כלים בדפדפן בלבד</dt>
              <dd>{MENU_TOOLS.filter((tool) => !tool.server).length}</dd>
            </div>
            <div>
              <dt>מחיר</dt>
              <dd>חינם</dd>
            </div>
          </dl>
        </div>

        <div className="hero-panel">
          <span className="hero-orbit is-bpm" aria-hidden="true">
            <span dir="ltr">
              <b>♩</b> 120 BPM
            </span>
          </span>
          <span className="hero-orbit is-chords" aria-hidden="true">
            <span dir="ltr">Am · F · C · G</span>
          </span>
          <span className="hero-orbit is-tune" aria-hidden="true">
            <span dir="ltr">
              <b>A4</b> 440Hz
            </span>
          </span>
          <div className="hero-panel-ring">
            <QuickStart disabledTools={disabledTools} />
          </div>
        </div>
      </section>

      <ToolMarquee onOpen={onOpen} disabledTools={disabledTools} />

      <div className="aura">
        {/* Right under the marquee, where it stood before the redesign: the
            daily credits are what a new visitor most needs to hear about. */}
        <CreditsPromo onOpen={onOpen} />

        {(favoriteTools.length > 0 || recent.length > 0 || works.length > 0) && (
          <Dock
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

        <Pledge />

        <SiteFooter onOpen={onOpen} onFeedback={onFeedback} />
      </div>
    </div>
  );
}

/**
 * The promises as a band of the hero's night across the page: the one that
 * matters most as a pull quote, then all four in a row. Memoised, like the
 * rest under the hero, so the hero's rotating word renders only the hero.
 */
const Pledge = memo(function Pledge() {
  const idle = useIdleOffscreen<HTMLElement>();
  return (
    <section className="aura-section aura-pledge" aria-labelledby="promises-title" ref={idle}>
      <span className="aura-pledge-stage" aria-hidden="true" />
      <header className="aura-pledge-head">
        <span className="aura-beam" aria-hidden="true" />
        <span className="aura-pledge-mark" aria-hidden="true">
          ”
        </span>
        <h2 id="promises-title">
          <span>ברוב הכלים,</span> <span className="aura-pledge-rest">השיר שלך לא יוצא מהמכשיר.</span>
        </h2>
      </header>
      <ul className="aura-pledge-list">
        {PROMISES.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <span className="aura-pledge-icon" aria-hidden="true">
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
 * Credits in one line on the home page: for a visitor, what signing in gives;
 * for an account, the balance and the private link, one tap from the clipboard.
 */
const CreditsPromo = memo(function CreditsPromo({ onOpen }: { onOpen: (id: string) => void }) {
  const { user } = useAuth();
  const { rules, status } = useCredits();
  const [copied, setCopied] = useState(false);
  const idle = useIdleOffscreen<HTMLElement>();

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
    <section className="credits-promo" aria-labelledby="credits-promo-title" ref={idle}>
      <span className="aura-beam" aria-hidden="true" />
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
          <button type="button" className="primary-button compact" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "הקישור הועתק" : "העתקת הקישור שלי"}
          </button>
        )}
        <button type="button" className="secondary-button" onClick={() => onOpen("credits")}>
          {user ? "לדף הקרדיטים" : "איך זה עובד"} <ArrowLeft size={15} />
        </button>
      </div>
    </section>
  );
});

/**
 * Two bands of tools sliding past under the hero. Each band is its list
 * twice over so the loop has no seam; the copy is hidden from readers and
 * the keyboard, which meet every tool once.
 */
function ToolMarquee({ onOpen, disabledTools }: { onOpen: (id: string) => void; disabledTools: string[] }) {
  const tools = MENU_TOOLS.filter((tool) => !disabledTools.includes(tool.id));
  const half = Math.ceil(tools.length / 2);
  const rows = [tools.slice(0, half), tools.slice(half)].filter((row) => row.length > 0);
  return (
    <section className="tool-marquee" aria-label="הכלים באתר">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className={`marquee-row ${rowIndex % 2 ? "is-reverse" : ""}`}>
          <div className="marquee-track">
            {[0, 1].map((copy) =>
              row.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={`${copy}-${tool.id}`}
                    type="button"
                    className="marquee-chip"
                    style={{ "--accent-hue": tool.hue } as CSSProperties}
                    onClick={() => onOpen(tool.id)}
                    aria-hidden={copy === 1 || undefined}
                    tabIndex={copy === 1 ? -1 : undefined}
                  >
                    <span className="marquee-chip-icon">
                      <Icon size={15} />
                    </span>
                    {tool.title}
                  </button>
                );
              }),
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

type DockProps = {
  /** The tool opened last, shown large at the head of the dock. */
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

/** The visitor's own corner: their tools on one side, the work they saved on the other, in one glass panel. */
function Dock({ lastTool, favoriteTools, recentTools, canClear, works, disabledTools, onOpen, onOpenWork }: DockProps) {
  const hasShelf = favoriteTools.length > 0 || recentTools.length > 0;
  const hasTools = Boolean(lastTool) || hasShelf;

  // The button goes with the history it clears: focus moves to what is left
  // of the dock, or, when nothing is, on to the catalogue's search.
  const clear = (event: MouseEvent<HTMLButtonElement>) => {
    const hadFocus = document.activeElement === event.currentTarget;
    flushSync(clearRecentTools);
    if (!hadFocus) return;
    const next = document.getElementById("mine-title") ?? document.getElementById("works-title") ?? document.querySelector<HTMLElement>(".aura-search input");
    next?.focus();
  };

  return (
    <div className={`aura-dock ${hasTools && works.length > 0 ? "is-split" : ""}`}>
      {hasTools && (
        <section className="aura-dock-pane" aria-labelledby="mine-title">
          <div className="aura-dock-head">
            <div>
              <h2 id="mine-title" tabIndex={-1}>
                הכלים שלך
              </h2>
              <p>המועדפים והכלים שפתחת לאחרונה, במרחק לחיצה.</p>
            </div>
            {canClear && (
              <button type="button" className="ghost-button" onClick={clear}>
                <X size={14} /> ניקוי ההיסטוריה
              </button>
            )}
          </div>
          {lastTool && <LastOpened tool={lastTool} off={disabledTools.includes(lastTool.id)} onOpen={onOpen} />}
          {hasShelf && (
            <div className="aura-dock-shelf">
              <DockGroup
                label="המועדפים שלי"
                icon={<Star size={12} fill="currentColor" />}
                tools={favoriteTools}
                disabledTools={disabledTools}
                onOpen={onOpen}
              />
              <DockGroup label="נפתחו לאחרונה" icon={<Clock3 size={12} />} tools={recentTools} disabledTools={disabledTools} onOpen={onOpen} />
            </div>
          )}
        </section>
      )}

      {works.length > 0 && (
        <section className="aura-dock-pane" aria-labelledby="works-title">
          <div className="aura-dock-head">
            <div>
              <h2 id="works-title" tabIndex={-1}>
                להמשיך מאיפה שעצרת
              </h2>
              <p>העבודות האחרונות ששמרת. כל אחת נפתחת בכלי שיצר אותה.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => onOpen("me")}>
              לכל העבודות <ArrowLeft size={14} />
            </button>
          </div>
          <ul className="aura-dock-works">
            {works.map((work) => {
              const tool = findTool(KIND_TOOL[work.kind]);
              return (
                <li key={work.id}>
                  <button
                    type="button"
                    className="aura-work"
                    style={{ "--accent-hue": tool?.hue ?? 292 } as CSSProperties}
                    onClick={() => onOpenWork(work)}
                  >
                    <WorkThumb work={work} />
                    <span className="aura-work-text">
                      <b>{work.title}</b>
                      <small>
                        {KIND_LABELS[work.kind]}
                        {describeWork(work) ? ` · ${describeWork(work)}` : ""}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The tool opened last, one tap from where the visitor left it — unless it has been switched off since. */
function LastOpened({ tool, off, onOpen }: { tool: ToolDefinition; off: boolean; onOpen: (id: string) => void }) {
  const Icon = tool.icon;
  return (
    <div className={`aura-last${off ? " is-off" : ""}`} style={{ "--accent-hue": tool.hue } as CSSProperties}>
      <span className="aura-last-icon" aria-hidden="true">
        <Icon size={26} />
      </span>
      <span className="aura-last-text">
        <small>
          <Clock3 size={12} aria-hidden="true" />
          נפתח לאחרונה
        </small>
        <b>{tool.title}</b>
        <span>{tool.tagline}</span>
      </span>
      {off ? (
        <button type="button" className="primary-button compact aura-last-go" disabled>
          מכובה זמנית
        </button>
      ) : (
        <button type="button" className="primary-button compact aura-last-go" onClick={() => onOpen(tool.id)} aria-label={`לפתוח שוב את ${tool.title}`}>
          לפתוח שוב <ArrowLeft size={15} />
        </button>
      )}
    </div>
  );
}

/** One shelf of the dock — the favourites or the recently opened — named in words, not only by its mark. */
function DockGroup({
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
    <div className="aura-dock-group">
      <span className="aura-dock-caption" id={id}>
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
                className="aura-app"
                style={{ "--accent-hue": tool.hue } as CSSProperties}
                onClick={() => onOpen(tool.id)}
                disabled={off}
                title={off ? "מכובה זמנית" : tool.tagline}
              >
                <span className="aura-app-icon">
                  <Icon size={21} />
                </span>
                <span className="aura-app-name">{tool.title}</span>
                {off && <span className="sr-only">מכובה זמנית</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
