import {
  ArrowLeft,
  Check,
  Clock3,
  Cloud,
  Copy,
  Gift,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  WifiOff,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { balanceOf, creditsLabel, referralLink } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";
import { markShared } from "../lib/siteShare";
import { clearRecentTools, useFavorites, useRecentTools } from "../lib/prefs";
import { CATEGORY_LABELS, CATEGORY_ORDER, MENU_TOOLS, findTool, type ToolCategory, type ToolDefinition } from "../lib/tools";
import { WORKFLOWS } from "../lib/workflows";
import { KIND_LABELS, KIND_TOOL, describeWork, listWorks, type SavedWork } from "../lib/works";
import { HeroSynth } from "./HeroSynth";
import { QuickStart } from "./QuickStart";
import { SiteFooter } from "./SiteFooter";
import { WorkThumb } from "./WorkThumb";

type Props = {
  onOpen: (id: string) => void;
  onOpenWork: (work: SavedWork) => void;
  /** Tools the admin area switched off; shown, but not openable. */
  disabledTools?: string[];
  /** Opens "משוב והצעות". */
  onFeedback: () => void;
};

type Filter = ToolCategory | "all" | "favorites";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "הכול" },
  { id: "create", label: CATEGORY_LABELS.create },
  { id: "practice", label: CATEGORY_LABELS.practice },
  { id: "analyze", label: CATEGORY_LABELS.analyze },
  { id: "favorites", label: "המועדפים שלי" },
];

const PROMISES = [
  { icon: ShieldCheck, title: "פרטי מהיסוד", text: "ברוב הכלים השמע מעובד בדפדפן ולא עולה לשום מקום. הכלים שנעזרים בשרת מסומנים ככאלה." },
  { icon: WifiOff, title: "עובד גם בלי רשת", text: "אפשר להתקין את האתר כאפליקציה, ורוב הכלים ממשיכים לעבוד גם במצב טיסה." },
  { icon: Cloud, title: "הכול נשמר, אם תרצו", text: "מתחברים עם Google, וכל מה שיצרתם מחכה באזור האישי — מכל מכשיר." },
  { icon: Sparkles, title: "עוזר שעושה", text: "מבקשים בשפה חופשית, והעוזר פותח כלים, מכוון מטרונום, כותב לשירון ושומר." },
];

/** Every tool's place in the menu, shown as its number on the rack. */
const RACK_NUMBER = new Map(MENU_TOOLS.map((tool, index) => [tool.id, String(index + 1).padStart(2, "0")]));

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "לילה טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  if (hour < 21) return "ערב טוב";
  return "לילה טוב";
}

export function Home({ onOpen, onOpenWork, disabledTools = [], onFeedback }: Props) {
  const { user, profile } = useAuth();
  const { favorites, toggle, isFavorite } = useFavorites();
  const recentTools = useRecentTools();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MENU_TOOLS.filter((tool) => {
      if (filter === "favorites" && !favorites.includes(tool.id)) return false;
      if (filter !== "all" && filter !== "favorites" && tool.category !== filter) return false;
      if (!needle) return true;
      return [tool.title, tool.tagline, tool.description, ...tool.tags].join(" ").toLowerCase().includes(needle);
    });
  }, [favorites, filter, query]);

  const recent = recentTools.map(findTool).filter((tool): tool is ToolDefinition => Boolean(tool)).slice(0, 6);
  // Favourites whose tool was hidden since drop out, so the shelf never shows an empty heading.
  const favoriteTools = favorites.map(findTool).filter((tool): tool is ToolDefinition => Boolean(tool));
  const shelf = [
    ...favoriteTools.map((tool) => ({ tool, pinned: true })),
    ...recent.filter((tool) => !favorites.includes(tool.id)).map((tool) => ({ tool, pinned: false })),
  ];
  const firstName = user ? profile?.full_name?.split(" ")[0] : null;
  const offline = MENU_TOOLS.filter((tool) => !tool.server).length;
  // Grouped into the rack's three shelves only while the whole catalogue shows.
  const grouped = filter === "all" && !query.trim();

  const scrollToCatalog = () => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const renderUnit = (tool: ToolDefinition, index: number) => (
    <RackUnit
      key={tool.id}
      tool={tool}
      index={index}
      off={disabledTools.includes(tool.id)}
      pinned={isFavorite(tool.id)}
      onOpen={onOpen}
      onToggle={toggle}
    />
  );

  return (
    <div className="home">
      {/* ---- the stage ---- */}
      <section className="hub-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-kicker">
            <i aria-hidden="true" />
            {firstName ? `${greeting(now)}, ${firstName}` : `${MENU_TOOLS.length} כלים · חינם · בלי הרשמה`}
          </span>
          <h1 id="hero-title">
            <span className="hero-line">שירים נכנסים.</span>
            <span className="hero-line">
              <span className="hero-outline">מוזיקה</span> <span className="hero-gradient">יוצאת.</span>
            </span>
          </h1>
          <p>
            תווים מכל שיר, קריוקי, אקורדים, צלצולים, מכונת תופים, טיונר ועוד — {MENU_TOOLS.length} כלים בסטודיו אחד, ורובם
            רצים אצלך במכשיר בלי להעלות את הקובץ.
          </p>
          <div className="hero-actions">
            <button type="button" className="hero-cta" onClick={() => onOpen("notes")}>
              <Wand2 size={18} /> הפכו שיר לתווים
            </button>
            <button type="button" className="hero-link" onClick={scrollToCatalog}>
              לכל הכלים <ArrowLeft size={16} />
            </button>
          </div>
          <dl className="hero-stats">
            <div>
              <dt>כלים</dt>
              <dd>{MENU_TOOLS.length}</dd>
            </div>
            <div>
              <dt>בדפדפן בלבד</dt>
              <dd>{offline}</dd>
            </div>
            <div>
              <dt>מחיר</dt>
              <dd>חינם</dd>
            </div>
          </dl>
        </div>
        <div className="hero-device">
          <HeroSynth />
        </div>
      </section>

      {/* ---- the front door ---- */}
      <section className="drop-stage" aria-labelledby="drop-title">
        <div className="drop-copy">
          <SectionHead index="01" id="drop-title" title="יש לכם קובץ?" text="גררו לכאן כל שיר, הקלטה או סרטון, ונציע מה אפשר לעשות איתו. הקובץ נשאר אצלכם עד שתבחרו כלי." />
          <ul className="drop-points">
            <li>MP3, WAV, M4A, FLAC — וגם סרטונים</li>
            <li>עד 800MB לקובץ</li>
            <li>מגיע ישר לכלי שבחרתם</li>
          </ul>
        </div>
        <QuickStart disabledTools={disabledTools} />
      </section>

      <CreditsPromo onOpen={onOpen} />

      {/* ---- the visitor's own desk ---- */}
      {(shelf.length > 0 || works.length > 0) && (
        <section className="desk" aria-labelledby="desk-title">
          <SectionHead id="desk-title" title="השולחן שלך" text="המועדפים, מה שפתחת לאחרונה והעבודות ששמרת — במרחק לחיצה.">
            {recent.length > 0 && (
              <button type="button" className="ghost-button" onClick={clearRecentTools}>
                <X size={14} /> ניקוי ההיסטוריה
              </button>
            )}
            {works.length > 0 && (
              <button type="button" className="ghost-button" onClick={() => onOpen("me")}>
                לכל העבודות <ArrowLeft size={14} />
              </button>
            )}
          </SectionHead>
          {shelf.length > 0 && (
            <div className="desk-rail">
              {shelf.map(({ tool, pinned }) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    className="desk-chip"
                    style={{ "--accent-hue": tool.hue } as CSSProperties}
                    onClick={() => onOpen(tool.id)}
                  >
                    <span className="desk-chip-icon">
                      <Icon size={17} />
                    </span>
                    <span className="desk-chip-text">
                      <b>{tool.title}</b>
                      <small>{tool.tagline}</small>
                    </span>
                    <span className={`desk-chip-mark ${pinned ? "is-pinned" : ""}`} aria-label={pinned ? "מועדף" : "נפתח לאחרונה"}>
                      {pinned ? <Star size={12} fill="currentColor" /> : <Clock3 size={12} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {works.length > 0 && (
            <div className="desk-works">
              {works.map((work) => {
                const tool = findTool(KIND_TOOL[work.kind]);
                const detail = describeWork(work);
                return (
                  <button
                    key={work.id}
                    type="button"
                    className="desk-work"
                    style={{ "--accent-hue": tool?.hue ?? 292 } as CSSProperties}
                    onClick={() => onOpenWork(work)}
                  >
                    <WorkThumb work={work} />
                    <span className="desk-work-text">
                      <b>{work.title}</b>
                      <small>
                        {KIND_LABELS[work.kind]}
                        {detail ? ` · ${detail}` : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ---- guided routes ---- */}
      <Routes onOpen={onOpen} />

      {/* ---- the rack: every tool ---- */}
      <section className="rack" id="catalog" aria-labelledby="catalog-title">
        <SectionHead index="03" id="catalog-title" title="כל הכלים" text="סמנו ☆ כדי להצמיד כלי לתפריט ולשולחן שלכם." />
        <div className="rack-controls">
          <label className="hub-search">
            <Search size={17} />
            <input
              type="search"
              placeholder="חיפוש: „קריוקי”, „טיונר”, „MIDI”…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="חיפוש כלי"
            />
          </label>
          <div className="rack-filters" role="group" aria-label="סינון לפי קטגוריה">
            {FILTERS.map((item) => {
              const count =
                item.id === "all"
                  ? MENU_TOOLS.length
                  : item.id === "favorites"
                    ? favoriteTools.length
                    : MENU_TOOLS.filter((tool) => tool.category === item.id).length;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={filter === item.id ? "is-on" : ""}
                  onClick={() => setFilter(item.id)}
                  aria-pressed={filter === item.id}
                >
                  {item.label}
                  <small>{count}</small>
                </button>
              );
            })}
          </div>
        </div>

        {grouped ? (
          CATEGORY_ORDER.map((category) => {
            const tools = visible.filter((tool) => tool.category === category);
            if (tools.length === 0) return null;
            return (
              <div key={category} className="rack-shelf">
                <h3 className="rack-shelf-label">
                  <span>{CATEGORY_LABELS[category]}</span>
                  <small>{tools.length} כלים</small>
                </h3>
                <div className="rack-grid">{tools.map(renderUnit)}</div>
              </div>
            );
          })
        ) : (
          <div className="rack-grid">
            {visible.map(renderUnit)}
            {visible.length === 0 && (
              <p className="rack-empty">
                {filter === "favorites" && !query
                  ? "עוד לא סימנת מועדפים. לחיצה על הכוכב ביחידה של כלי מצמידה אותו."
                  : `לא נמצא כלי שמתאים ל„${query}”. נסו מילה אחרת.`}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---- the promises ---- */}
      <section className="promises" aria-label="למה כאן">
        {PROMISES.map((promise, index) => {
          const Icon = promise.icon;
          return (
            <div key={promise.title} className="promise">
              <span className="promise-num" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Icon size={22} />
              <h3>{promise.title}</h3>
              <p>{promise.text}</p>
            </div>
          );
        })}
      </section>

      <SiteFooter onOpen={onOpen} onFeedback={onFeedback} />
    </div>
  );
}

function SectionHead({
  index,
  id,
  title,
  text,
  children,
}: {
  index?: string;
  id: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-head">
      {index && (
        <span className="section-index" aria-hidden="true">
          {index}
        </span>
      )}
      <div className="section-titles">
        <h2 id={id}>{title}</h2>
        <p>{text}</p>
      </div>
      {children && <div className="section-actions">{children}</div>}
    </div>
  );
}

/**
 * One tool as a unit in a rack: its number, a lamp in its colour, the name
 * and what it does. The name is the unit's one real button, stretched over it.
 */
function RackUnit({
  tool,
  index,
  off,
  pinned,
  onOpen,
  onToggle,
}: {
  tool: ToolDefinition;
  index: number;
  off: boolean;
  pinned: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const Icon = tool.icon;
  return (
    <article
      className={`tool-card ${tool.id === "notes" ? "is-featured" : ""} ${off ? "is-off" : ""}`}
      style={{ "--accent-hue": tool.hue, "--reveal": `${Math.min(index, 10) * 30}ms` } as CSSProperties}
    >
      <span className="unit-screws" aria-hidden="true" />
      <div className="unit-head">
        <span className="unit-num" aria-hidden="true">
          {RACK_NUMBER.get(tool.id)}
        </span>
        <i className="unit-lamp" aria-hidden="true" />
        {off ? (
          <span className="unit-badge is-off">מכובה זמנית</span>
        ) : tool.badge ? (
          <span className="unit-badge">{tool.badge}</span>
        ) : null}
        <button
          type="button"
          className={`unit-star ${pinned ? "is-on" : ""}`}
          onClick={() => onToggle(tool.id)}
          aria-pressed={pinned}
          aria-label={pinned ? `הסרת ${tool.title} מהמועדפים` : `הוספת ${tool.title} למועדפים`}
        >
          <Star size={15} />
        </button>
      </div>
      <div className="unit-body">
        <span className="unit-icon">
          <Icon size={tool.id === "notes" ? 30 : 22} />
        </span>
        <div className="unit-text">
          <h3>
            <button type="button" className="tool-card-open" disabled={off} onClick={() => onOpen(tool.id)}>
              {tool.title}
            </button>
          </h3>
          <p className="unit-tagline">{tool.tagline}</p>
        </div>
      </div>
      <p className="unit-desc">{tool.description}</p>
      <div className="unit-foot">
        <span>{tool.server ? "נעזר בשרת" : "רץ בדפדפן"}</span>
        <ArrowLeft size={16} className="unit-go" aria-hidden="true" />
      </div>
    </article>
  );
}

/**
 * The guided routes as a switchboard: the list of jobs on one side, and the
 * chosen job's steps laid out large on the other, each opening its tool.
 */
function Routes({ onOpen }: { onOpen: (id: string) => void }) {
  const [chosen, setChosen] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const flow = WORKFLOWS[chosen];
  // A step whose tool is hidden drops out, and the rest are numbered without it.
  const steps = flow ? flow.steps.filter((step) => findTool(step.tool)) : [];

  if (!flow) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowLeft: 1, ArrowRight: -1 };
    let next: number | null = null;
    if (event.key in moves) next = (chosen + moves[event.key] + WORKFLOWS.length) % WORKFLOWS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = WORKFLOWS.length - 1;
    if (next === null) return;
    event.preventDefault();
    setChosen(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className="routes" aria-labelledby="routes-title">
      <SectionHead index="02" id="routes-title" title="מסלולי עבודה" text="כמה כלים ברצף למשימה אחת. בחרו משימה — וכל שלב פותח את הכלי שלו." />
      <div className="routes-board" style={{ "--accent-hue": flow.hue } as CSSProperties}>
        <div className="routes-list" role="tablist" aria-label="משימות" aria-orientation="vertical">
          {WORKFLOWS.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`route-tab-${item.id}`}
              aria-selected={index === chosen}
              aria-controls="route-panel"
              tabIndex={index === chosen ? 0 : -1}
              className={index === chosen ? "is-on" : ""}
              style={{ "--accent-hue": item.hue } as CSSProperties}
              onClick={() => setChosen(index)}
              onKeyDown={onKeyDown}
            >
              <i aria-hidden="true" />
              {item.title}
            </button>
          ))}
        </div>
        <div className="routes-panel" role="tabpanel" id="route-panel" aria-labelledby={`route-tab-${flow.id}`} key={flow.id}>
          <h3>{flow.title}</h3>
          <p>{flow.description}</p>
          <ol className="routes-steps">
            {steps.map((step, stepIndex) => {
              const tool = findTool(step.tool)!;
              const Icon = tool.icon;
              return (
                <li key={step.tool} style={{ "--accent-hue": tool.hue, "--step": stepIndex } as CSSProperties}>
                  <button type="button" onClick={() => onOpen(tool.id)}>
                    <span className="routes-step-num">שלב {stepIndex + 1}</span>
                    <span className="routes-step-icon">
                      <Icon size={22} />
                    </span>
                    <b>{step.label}</b>
                    <small>{tool.title}</small>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

/**
 * Credits in one line on the home page: for a visitor, what signing in gives;
 * for an account, the balance and the private link, one tap from the clipboard.
 */
function CreditsPromo({ onOpen }: { onOpen: (id: string) => void }) {
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
    <section className="credits-promo" aria-labelledby="credits-promo-title">
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
}
