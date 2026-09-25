import {
  ArrowLeft,
  Cloud,
  Clock3,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  WifiOff,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { clearRecentTools, useFavorites, useRecentTools } from "../lib/prefs";
import { CATEGORY_LABELS, TOOLS, findTool, type ToolCategory, type ToolDefinition } from "../lib/tools";
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
    return TOOLS.filter((tool) => {
      if (filter === "favorites" && !favorites.includes(tool.id)) return false;
      if (filter !== "all" && filter !== "favorites" && tool.category !== filter) return false;
      if (!needle) return true;
      return [tool.title, tool.tagline, tool.description, ...tool.tags].join(" ").toLowerCase().includes(needle);
    });
  }, [favorites, filter, query]);

  const recent = recentTools.map(findTool).filter((tool): tool is ToolDefinition => Boolean(tool)).slice(0, 6);
  const firstName = user ? profile?.full_name?.split(" ")[0] : null;

  const scrollToCatalog = () => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="home">
      <section className="hub-hero">
        <div className="hero-spectrum" aria-hidden="true">
          {SPECTRUM.map((height, index) => (
            <i key={index} style={{ "--h": `${height}%`, "--d": `${index * -0.13}s` } as CSSProperties} />
          ))}
        </div>

        <div className="hero-copy">
          <span className="hero-kicker">
            <Sparkles size={14} /> {firstName ? `${greeting(now)}, ${firstName}` : `${TOOLS.length} כלים · חינם · בלי הרשמה`}
          </span>
          <h1>
            הסטודיו המוזיקלי <span className="gradient-text">שלך, בדפדפן.</span>
          </h1>
          <p>
            תווים מכל שיר, קריוקי, אקורדים, צלצולים, מכונת תופים, טיונר ועוד — {TOOLS.length} כלים, ורובם רצים
            כולם אצלך במכשיר, בלי להעלות את הקובץ.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-button compact" onClick={() => onOpen("notes")}>
              <Wand2 size={17} /> הפכו שיר לתווים
            </button>
            <button type="button" className="secondary-button" onClick={scrollToCatalog}>
              לכל הכלים <ArrowLeft size={16} />
            </button>
          </div>
          <dl className="hero-stats">
            <div>
              <dt>כלים</dt>
              <dd>{TOOLS.length}</dd>
            </div>
            <div>
              <dt>כלים בדפדפן בלבד</dt>
              <dd>{TOOLS.filter((tool) => !tool.server).length}</dd>
            </div>
            <div>
              <dt>מחיר</dt>
              <dd>חינם</dd>
            </div>
          </dl>
        </div>

        <div className="hero-panel">
          <QuickStart disabledTools={disabledTools} />
        </div>
      </section>

      {(recent.length > 0 || favorites.length > 0) && (
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
            {favorites
              .map(findTool)
              .filter((tool): tool is ToolDefinition => Boolean(tool))
              .map((tool) => (
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

        <div className="tool-grid">
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
