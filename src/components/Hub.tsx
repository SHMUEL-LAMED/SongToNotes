import {
  ArrowLeft,
  BadgeCheck,
  Music2,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import {
  CATEGORY_LABELS,
  TOOLS,
  type ToolCategory,
} from "../lib/tools";

/** The equaliser silhouette in the hero — a fixed shape, not live audio. */
const BAR_HEIGHTS = [18, 34, 55, 78, 46, 92, 64, 40, 72, 100, 68, 48, 82, 57, 29, 43, 24];

type Props = {
  onOpen: (id: string) => void;
  /** Tools the admin area switched off; shown, but not openable. */
  disabledTools?: string[];
};

const FILTERS: { id: ToolCategory | "all"; label: string }[] = [
  { id: "all", label: "הכול" },
  { id: "create", label: CATEGORY_LABELS.create },
  { id: "practice", label: CATEGORY_LABELS.practice },
  { id: "analyze", label: CATEGORY_LABELS.analyze },
];

export function Hub({ onOpen, disabledTools = [] }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ToolCategory | "all">("all");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TOOLS.filter((tool) => {
      if (filter !== "all" && tool.category !== filter) return false;
      if (!needle) return true;
      const haystack = [tool.title, tool.tagline, tool.description, ...tool.tags]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, query]);

  return (
    <>
      <section className="hub-hero">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="hero-glow hero-glow-three" />
        <div className="eyebrow">
          <Sparkles size={16} /> {TOOLS.length} כלי מוזיקה · הכול בדפדפן
        </div>
        <h1>כלי מוזיקה</h1>
        <p>בחר כלי והתחל ליצור.</p>
        <div className="hero-soundstage" aria-hidden="true">
          <span className="soundstage-orbit">
            <Music2 size={27} />
          </span>
          <span className="soundstage-line soundstage-line-one" />
          <span className="soundstage-line soundstage-line-two" />
          <div className="soundstage-bars">
            {BAR_HEIGHTS.map((height, index) => (
              <i
                key={index}
                style={
                  {
                    "--bar-height": `${height}%`,
                    "--bar-delay": `${index * -0.08}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <span className="soundstage-caption">AUDIO · NOTES · CREATE</span>
        </div>
      </section>

      <section className="hub-controls">
        <label className="hub-search">
          <Search size={18} />
          <input
            type="search"
            placeholder="חפש כלי… למשל „קריוקי” או „טיונר”"
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
      </section>

      <section className="tool-grid" aria-label="הכלים">
        {visible.map((tool, index) => {
          const Icon = tool.icon;
          const off = disabledTools.includes(tool.id);
          return (
            <button
              key={tool.id}
              className={`tool-card ${tool.id === "notes" ? "is-featured" : ""} ${off ? "is-off" : ""}`}
              disabled={off}
              aria-disabled={off}
              style={
                {
                  "--accent-hue": tool.hue,
                  "--reveal-delay": `${index * 45}ms`,
                } as React.CSSProperties
              }
              onClick={() => onOpen(tool.id)}
              type="button"
            >
              <span className="tool-card-icon">
                <Icon size={30} />
              </span>
              <span className="tool-card-meta">
                <span className="tool-card-category">
                  {CATEGORY_LABELS[tool.category]}
                </span>
                {off ? (
                  <span className="tool-card-badge is-off">מכובה זמנית</span>
                ) : (
                  tool.badge && (
                    <span className="tool-card-badge">
                      <BadgeCheck size={13} /> {tool.badge}
                    </span>
                  )
                )}
              </span>
              <strong>{tool.title}</strong>
              <em>{tool.tagline}</em>
              <b>
                פתח את הכלי <ArrowLeft size={16} />
              </b>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="hub-empty">לא נמצא כלי שמתאים ל„{query}”. נסה מילה אחרת.</p>
        )}
      </section>


      <footer>
        <span className="brand">
          <span className="brand-mark">♪</span>
          <span>כלי מוזיקה</span>
        </span>
      </footer>
    </>
  );
}
