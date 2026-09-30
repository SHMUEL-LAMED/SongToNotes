import {
  ArrowLeft,
  Check,
  Cloud,
  Clock3,
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
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { balanceOf, creditsLabel, referralLink } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";
import { markShared } from "../lib/siteShare";
import { clearRecentTools, useFavorites, useRecentTools } from "../lib/prefs";
import { CATEGORY_LABELS, MENU_TOOLS, findTool, type ToolCategory, type ToolDefinition } from "../lib/tools";
import { WORKFLOWS } from "../lib/workflows";
import { KIND_LABELS, KIND_TOOL, describeWork, listWorks, type SavedWork } from "../lib/works";
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

const FILTERS: { id: ToolCategory | "all" | "favorites"; label: string }[] = [
  { id: "all", label: "הכול" },
  { id: "create", label: CATEGORY_LABELS.create },
  { id: "practice", label: CATEGORY_LABELS.practice },
  { id: "analyze", label: CATEGORY_LABELS.analyze },
  { id: "favorites", label: "המועדפים שלי" },
];

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

/** The card under the pointer lights up where the pointer is. */
function trackSpotlight(event: PointerEvent<HTMLElement>) {
  const card = (event.target as HTMLElement).closest<HTMLElement>(".tool-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  card.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

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
  const [filter, setFilter] = useState<ToolCategory | "all" | "favorites">("all");
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

      <CreditsPromo onOpen={onOpen} />

      {(recent.length > 0 || favoriteTools.length > 0) && (
        <section className="home-section" aria-labelledby="mine-title">
          <div className="section-head">
            <div>
              <h2 id="mine-title">הכלים שלך</h2>
              <p>המועדפים והכלים שפתחת לאחרונה, במרחק לחיצה.</p>
            </div>
            {recent.length > 0 && (
              <button type="button" className="ghost-button" onClick={clearRecentTools}>
                <X size={14} /> ניקוי ההיסטוריה
              </button>
            )}
          </div>
          <div className="shelf">
            {favoriteTools.map((tool) => (
              <MiniTool key={`fav-${tool.id}`} tool={tool} onOpen={onOpen} icon={<Star size={12} fill="currentColor" />} />
            ))}
            {recent
              .filter((tool) => !favorites.includes(tool.id))
              .map((tool) => (
                <MiniTool key={`recent-${tool.id}`} tool={tool} onOpen={onOpen} icon={<Clock3 size={12} />} />
              ))}
          </div>
        </section>
      )}

      {works.length > 0 && (
        <section className="home-section" aria-labelledby="works-title">
          <div className="section-head">
            <div>
              <h2 id="works-title">להמשיך מאיפה שעצרת</h2>
              <p>העבודות האחרונות ששמרת. כל אחת נפתחת בכלי שיצר אותה.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => onOpen("me")}>
              לכל העבודות <ArrowLeft size={14} />
            </button>
          </div>
          <div className="recent-works">
            {works.map((work) => {
              const tool = findTool(KIND_TOOL[work.kind]);
              return (
                <button
                  key={work.id}
                  type="button"
                  className="recent-work"
                  style={{ "--accent-hue": tool?.hue ?? 292 } as CSSProperties}
                  onClick={() => onOpenWork(work)}
                >
                  <WorkThumb work={work} />
                  <span className="recent-work-text">
                    <b>{work.title}</b>
                    <small>
                      {KIND_LABELS[work.kind]}
                      {describeWork(work) ? ` · ${describeWork(work)}` : ""}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="home-section" aria-labelledby="flows-title">
        <div className="section-head">
          <div>
            <span className="section-eyebrow">מסלולים</span>
            <h2 id="flows-title">מסלולי עבודה</h2>
            <p>כמה כלים ברצף למשימה אחת. כל שלב פותח את הכלי שלו.</p>
          </div>
        </div>
        <div className="flow-grid">
          {WORKFLOWS.map((flow, index) => (
            <article
              key={flow.id}
              className="flow-card"
              style={{ "--accent-hue": flow.hue, "--reveal": `${index * 50}ms` } as CSSProperties}
            >
              <h3>{flow.title}</h3>
              <p>{flow.description}</p>
              <ol className="flow-steps">
                {/* A step whose tool is hidden drops out, and the rest are numbered without it. */}
                {flow.steps.filter((step) => findTool(step.tool)).map((step, stepIndex) => {
                  const tool = findTool(step.tool)!;
                  const Icon = tool.icon;
                  return (
                    <li key={step.tool} style={{ "--accent-hue": tool.hue } as CSSProperties}>
                      <button type="button" onClick={() => onOpen(tool.id)} title={tool.title}>
                        <span className="flow-step-icon">
                          <Icon size={16} />
                        </span>
                        <span className="flow-step-text">
                          <small>שלב {stepIndex + 1}</small>
                          <b>{step.label}</b>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" id="catalog" aria-labelledby="catalog-title">
        <div className="section-head">
          <div>
            <span className="section-eyebrow">הקטלוג</span>
            <h2 id="catalog-title">כל הכלים</h2>
            <p>סמנו ☆ כדי להצמיד כלי לתפריט ולראש הדף.</p>
          </div>
        </div>
        <div className="hub-controls">
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
          <div className="hub-filters" role="group" aria-label="סינון לפי קטגוריה">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? "active" : ""}
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="tool-grid" onPointerMove={trackSpotlight}>
          {visible.map((tool, index) => {
            const Icon = tool.icon;
            const off = disabledTools.includes(tool.id);
            const pinned = isFavorite(tool.id);
            return (
              <article
                key={tool.id}
                className={`tool-card ${tool.id === "notes" ? "is-featured" : ""} ${off ? "is-off" : ""}`}
                style={{ "--accent-hue": tool.hue, "--reveal": `${Math.min(index, 12) * 35}ms` } as CSSProperties}
              >
                <div className="tool-card-top">
                  <span className="tool-card-icon">
                    <Icon size={24} />
                  </span>
                  <button
                    type="button"
                    className={`tool-card-star ${pinned ? "is-on" : ""}`}
                    onClick={() => toggle(tool.id)}
                    aria-pressed={pinned}
                    aria-label={pinned ? `הסרת ${tool.title} מהמועדפים` : `הוספת ${tool.title} למועדפים`}
                  >
                    <Star size={16} />
                  </button>
                </div>
                <h3>
                  <button type="button" className="tool-card-open" disabled={off} onClick={() => onOpen(tool.id)}>
                    {tool.title}
                  </button>
                </h3>
                <p className="tool-card-tagline">{tool.tagline}</p>
                <p className="tool-card-desc">{tool.description}</p>
                <div className="tool-card-foot">
                  <span className="tool-card-category">{CATEGORY_LABELS[tool.category]}</span>
                  {off ? (
                    <span className="tool-card-badge is-off">מכובה זמנית</span>
                  ) : tool.badge ? (
                    <span className="tool-card-badge">{tool.badge}</span>
                  ) : null}
                  <ArrowLeft size={16} className="tool-card-arrow" aria-hidden="true" />
                </div>
              </article>
            );
          })}
          {visible.length === 0 && (
            <p className="hub-empty">
              {filter === "favorites" && !query ? "עוד לא סימנת מועדפים. לחיצה על הכוכב בכרטיס של כלי מצמידה אותו." : `לא נמצא כלי שמתאים ל„${query}”. נסו מילה אחרת.`}
            </p>
          )}
        </div>
      </section>

      <section className="home-section">
        <div className="promise-grid">
          <div>
            <ShieldCheck size={20} />
            <h3>פרטי מהיסוד</h3>
            <p>ברוב הכלים השמע מעובד בדפדפן ולא עולה לשום מקום. הכלים שנעזרים בשרת מסומנים ככאלה.</p>
          </div>
          <div>
            <WifiOff size={20} />
            <h3>עובד גם בלי רשת</h3>
            <p>אפשר להתקין את האתר כאפליקציה, ורוב הכלים ממשיכים לעבוד גם במצב טיסה.</p>
          </div>
          <div>
            <Cloud size={20} />
            <h3>הכול נשמר, אם תרצו</h3>
            <p>מתחברים עם Google, וכל מה שיצרתם מחכה באזור האישי — מכל מכשיר.</p>
          </div>
          <div>
            <Sparkles size={20} />
            <h3>עוזר שעושה</h3>
            <p>מבקשים בשפה חופשית, והעוזר פותח כלים, מכוון מטרונום, כותב לשירון ושומר.</p>
          </div>
        </div>
      </section>

      <SiteFooter onOpen={onOpen} onFeedback={onFeedback} />
    </div>
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

function MiniTool({ tool, onOpen, icon }: { tool: ToolDefinition; onOpen: (id: string) => void; icon: ReactNode }) {
  const Icon = tool.icon;
  return (
    <button type="button" className="mini-tool" style={{ "--accent-hue": tool.hue } as CSSProperties} onClick={() => onOpen(tool.id)}>
      <span className="mini-tool-icon">
        <Icon size={18} />
      </span>
      <span className="mini-tool-text">
        <b>{tool.title}</b>
        <small>{tool.tagline}</small>
      </span>
      <span className="mini-tool-mark">{icon}</span>
    </button>
  );
}
