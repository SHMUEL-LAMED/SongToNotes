import {
  ArrowLeft,
  BadgeCheck,
  Headphones,
  LockKeyhole,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  TOOLS,
  type ToolCategory,
} from "../lib/tools";

type Props = {
  onOpen: (id: string) => void;
};

const FILTERS: { id: ToolCategory | "all"; label: string }[] = [
  { id: "all", label: "הכול" },
  { id: "create", label: CATEGORY_LABELS.create },
  { id: "practice", label: CATEGORY_LABELS.practice },
  { id: "analyze", label: CATEGORY_LABELS.analyze },
];

export function Hub({ onOpen }: Props) {
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
        <h1>
          כל מה שצריך
          <br />
          <span>כדי לעבוד עם מוזיקה</span>
        </h1>
        <p>
          תווים מכל שיר, צלצולים, קריוקי, האטה לתרגול, מטרונום, טיונר ופסנתר —
          כלים מקצועיים שרצים במכשיר שלך, בלי העלאה לשרת ובלי התקנה.
        </p>
        <div className="hero-points">
          <span>
            <LockKeyhole size={16} /> פרטי לחלוטין
          </span>
          <span>
            <Zap size={16} /> בלי התקנה ובלי הרשמה
          </span>
          <span>
            <Headphones size={16} /> איכות אולפן
          </span>
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
          return (
            <button
              key={tool.id}
              className={`tool-card ${tool.id === "notes" ? "is-featured" : ""}`}
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
                {tool.badge && (
                  <span className="tool-card-badge">
                    <BadgeCheck size={13} /> {tool.badge}
                  </span>
                )}
              </span>
              <strong>{tool.title}</strong>
              <em>{tool.tagline}</em>
              <p>{tool.description}</p>
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

      <section className="hub-trust">
        <div>
          <strong>0</strong>
          <span>קבצים שנשלחים לשרת</span>
        </div>
        <div>
          <strong>{TOOLS.length}</strong>
          <span>כלים במקום אחד</span>
        </div>
        <div>
          <strong>100%</strong>
          <span>חינם, בעברית, מכל מכשיר</span>
        </div>
      </section>

      <footer>
        <span className="brand">
          <span className="brand-mark">♪</span>
          <span>כלי מוזיקה</span>
        </span>
        <p>
          כל העיבוד מתבצע במכשיר שלך. הקבצים, ההקלטות וההשמעה אף פעם לא עוזבים
          את הדפדפן.
        </p>
      </footer>
    </>
  );
}
