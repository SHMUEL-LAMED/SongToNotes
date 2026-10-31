import { Search, Star, X } from "lucide-react";
import { memo, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { useFavorites } from "../lib/prefs";
import { MENU_GROUPS, MENU_TOOLS, type ToolDefinition } from "../lib/tools";
import { SectionHead } from "./SectionHead";

type Filter = "all" | "favorites" | string;

/** The one tool shown larger, first in its group, with what it makes. */
const FLAGSHIP = "notes";

/** A line under each group's name: what the group is for. */
const BLURBS: Record<string, string> = {
  notation: "מה שמתנגן בשיר, כתוב: תווים, אקורדים, ומה בכלל השיר.",
  edit: "לחתוך, להאט, לנקות ולהמיר — עד שהקובץ מוכן.",
  create: "מקצבים, מיקס, הרמוניות ושירון — לבנות משהו משלכם.",
  words: "תמלול, הקראה, ושירים שנולדים מדיבור.",
  practice: "האימון היומי: כיוון, קצב, שמיעה ונגינה.",
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "הכול" },
  ...MENU_GROUPS.map((group) => ({ id: group.id, label: group.label })),
  { id: "favorites", label: "המועדפים שלי" },
];

/** Which menu group a tool sits in. */
const GROUP_OF = new Map(MENU_GROUPS.flatMap((group) => group.tools.map((id) => [id, group.id] as const)));

function matches(tool: ToolDefinition, needle: string) {
  return !needle || [tool.title, tool.tagline, tool.description, ...tool.tags].join(" ").toLowerCase().includes(needle);
}

/**
 * The catalogue (`#catalog`): a search and a row of filters that stay in
 * reach as the page scrolls, then one group per menu group, each a grid of
 * tool cards. The search reads titles, taglines, descriptions and tags (a
 * family's tags include its tabs', so "karaoke" finds the tool that has it).
 */
export const ToolMosaic = memo(function ToolMosaic({ onOpen, disabledTools }: { onOpen: (id: string) => void; disabledTools: string[] }) {
  const { favorites, toggle, isFavorite } = useFavorites();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const chipsRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Stars or unstars a tool, keeping the page and the keyboard where they
   * were. The first star mounts the studio above the catalogue, and another
   * can add a row to it: the page is moved back by as much, or the next tap
   * would land on another card. Unstarred under "my favourites", the card
   * itself leaves, and focus goes on to its neighbour, not to the page's top.
   */
  const star = (id: string, button: HTMLElement) => {
    const top = button.getBoundingClientRect().top;
    const hadFocus = document.activeElement === button;
    const stars = Array.from(catalogRef.current?.querySelectorAll<HTMLElement>(".tool-card-star") ?? []);
    const at = stars.indexOf(button);
    const neighbours = [stars[at + 1], stars[at - 1]];
    flushSync(() => toggle(id));
    if (button.isConnected) {
      // Instant: the page scrolls smoothly otherwise.
      window.scrollBy({ top: button.getBoundingClientRect().top - top, behavior: "instant" });
    } else if (hadFocus) {
      const next = neighbours.find((element) => element?.isConnected);
      (next ?? chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]'))?.focus();
    }
  };

  const needle = query.trim().toLowerCase();
  // What the search leaves, before the filter: the chips count from it.
  const found = useMemo(() => MENU_TOOLS.filter((tool) => matches(tool, needle)), [needle]);
  const counts = useMemo(() => {
    const byFilter: Record<string, number> = { all: found.length, favorites: 0 };
    for (const group of MENU_GROUPS) byFilter[group.id] = 0;
    for (const tool of found) {
      const group = GROUP_OF.get(tool.id);
      if (group) byFilter[group] += 1;
      if (favorites.includes(tool.id)) byFilter.favorites += 1;
    }
    return byFilter;
  }, [favorites, found]);

  const groups = useMemo(
    () =>
      MENU_GROUPS.map((group) => {
        const tools = found
          .filter((tool) => {
            if (GROUP_OF.get(tool.id) !== group.id) return false;
            if (filter === "favorites") return favorites.includes(tool.id);
            return filter === "all" || filter === group.id;
          })
          // The flagship opens its group, so the grid places every card in reading order.
          .sort((a, b) => Number(b.id === FLAGSHIP) - Number(a.id === FLAGSHIP));
        return { group, tools };
      }).filter((entry) => entry.tools.length > 0),
    [favorites, filter, found],
  );
  const shown = groups.reduce((sum, entry) => sum + entry.tools.length, 0);

  const clear = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  return (
    <section className="catalog" id="catalog" aria-labelledby="catalog-title">
      <SectionHead id="catalog-title" kicker="הקטלוג" title="כל הכלים">
        <p>סמנו ☆ כדי להצמיד כלי לתפריט ולראש הדף.</p>
      </SectionHead>

      <div className="catalog-bar aura-controls">
        <label className="hub-search aura-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            placeholder="חיפוש: „קריוקי”, „טיונר”, „MIDI”…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="חיפוש כלי"
          />
          {query && (
            <button type="button" className="hub-search-clear" onClick={clear} aria-label="ניקוי החיפוש" title="ניקוי החיפוש">
              <X size={16} />
            </button>
          )}
        </label>
        <div className="catalog-chips" role="group" aria-label="סינון לפי קבוצה" ref={chipsRef}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip chip-toggle${filter === item.id ? " active" : ""}`}
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
            >
              {item.id === "favorites" && <Star size={14} aria-hidden="true" />}
              {item.label}
              <span className="chip-count">{counts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <p className="catalog-result" aria-live="polite">
          {shown === 1 ? `מוצג כלי אחד מתוך ${MENU_TOOLS.length}` : `מוצגים ${shown} מתוך ${MENU_TOOLS.length} כלים`}
        </p>
      </div>

      <div className="catalog-groups" ref={catalogRef}>
        {groups.map(({ group, tools }) => (
          <section key={group.id} className="catalog-group" aria-labelledby={`group-${group.id}`}>
            <header className="catalog-group-head">
              <h3 id={`group-${group.id}`}>{group.label}</h3>
              <p>{BLURBS[group.id]}</p>
              {/* The number a text of its own, so the word is translated as a word. */}
              <span className="catalog-count">
                {tools.length === 1 ? (
                  "כלי אחד"
                ) : (
                  <>
                    <b>{tools.length}</b> כלים
                  </>
                )}
              </span>
            </header>
            <div className="catalog-grid">
              {tools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  flagship={tool.id === FLAGSHIP}
                  off={disabledTools.includes(tool.id)}
                  pinned={isFavorite(tool.id)}
                  onToggle={star}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <div className="hub-empty empty">
            {!needle && filter === "favorites" ? (
              <p>עוד לא סימנת מועדפים. לחיצה על הכוכב בכרטיס של כלי מצמידה אותו.</p>
            ) : found.length === 0 ? (
              <p>{`לא נמצא כלי שמתאים ל„${query.trim()}”. נסו מילה אחרת.`}</p>
            ) : (
              // The search did find tools, only not under this filter.
              <>
                <p>{`אין ב„${FILTERS.find((item) => item.id === filter)?.label}” כלי שמתאים ל„${query.trim()}”.`}</p>
                <button type="button" className="secondary-button" onClick={() => setFilter("all")}>
                  חיפוש בכל הכלים <span className="chip-count">{found.length}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
});

type CardProps = {
  tool: ToolDefinition;
  flagship: boolean;
  off: boolean;
  pinned: boolean;
  onToggle: (id: string, button: HTMLElement) => void;
  onOpen: (id: string) => void;
};

/**
 * One tool: its mark, its name (the card's one real button, stretched over
 * the card) and tagline, and the star. The description is there for readers,
 * as the button's description, and for the search.
 */
function ToolCard({ tool, flagship, off, pinned, onToggle, onOpen }: CardProps) {
  const Icon = tool.icon;
  const descId = `tool-desc-${tool.id}`;
  return (
    <article
      className={`tool-card${flagship ? " is-flagship" : ""}${off ? " is-off" : ""}`}
      style={{ "--accent-hue": tool.hue } as CSSProperties}
    >
      <span className="tool-card-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div className="tool-card-text">
        <div className="tool-card-head">
          <h4 className="tool-card-title">
            <button type="button" className="tool-card-open" disabled={off} onClick={() => onOpen(tool.id)} aria-describedby={descId}>
              {tool.title}
            </button>
          </h4>
          {off ? (
            <span className="tool-card-badge chip is-off">מכובה זמנית</span>
          ) : tool.badge ? (
            <span className="tool-card-badge chip">{tool.badge}</span>
          ) : null}
        </div>
        <p className="tool-card-tagline">{tool.tagline}</p>
        <p className="tool-card-desc sr-only" id={descId}>
          {tool.description}
        </p>
        {flagship && (
          <p className="tool-card-outputs" aria-hidden="true">
            <span className="chip">תווים</span>
            <span className="chip" dir="ltr">
              MIDI
            </span>
            <span className="chip" dir="ltr">
              MusicXML
            </span>
          </p>
        )}
      </div>
      <button
        type="button"
        className={`tool-card-star ${pinned ? "is-on" : ""}`}
        onClick={(event) => onToggle(tool.id, event.currentTarget)}
        aria-pressed={pinned}
        aria-label={pinned ? `הסרת ${tool.title} מהמועדפים` : `הוספת ${tool.title} למועדפים`}
      >
        <Star size={16} />
      </button>
    </article>
  );
}
