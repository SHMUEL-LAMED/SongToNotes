import { ArrowLeft, AudioWaveform, Guitar, Search, Star, WandSparkles, type LucideIcon } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { useFavorites } from "../lib/prefs";
import { CATEGORY_LABELS, CATEGORY_ORDER, MENU_TOOLS, type ToolCategory, type ToolDefinition } from "../lib/tools";
import { useIdleOffscreen } from "../lib/useIdleOffscreen";
import { SectionHead } from "./SectionHead";

type Filter = ToolCategory | "all" | "favorites";

/** The one tool shown large, first in its zone, with the stave it writes. */
const FLAGSHIP = "notes";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "הכול" },
  { id: "create", label: CATEGORY_LABELS.create },
  { id: "practice", label: CATEGORY_LABELS.practice },
  { id: "analyze", label: CATEGORY_LABELS.analyze },
  { id: "favorites", label: "המועדפים שלי" },
];

/** Each category is a zone of its own colour, so the catalogue reads as three rooms rather than one long wall. */
const ZONES: Record<ToolCategory, { hue: number; icon: LucideIcon; blurb: string }> = {
  create: { hue: 318, icon: WandSparkles, blurb: "להפיק, לערוך ולהמיר — מהשיר ועד הקובץ המוכן." },
  practice: { hue: 196, icon: Guitar, blurb: "האימון היומי: כיוון, קצב, שמיעה ונגינה." },
  analyze: { hue: 62, icon: AudioWaveform, blurb: "לשמוע מה יש בשיר: אקורדים, מילים ומה בכלל מתנגן." },
};

/** How far a tile's rim light reaches from the pointer: the radius of .tool-card::after's gradient. */
const GLOW_REACH = 260;

function matches(tool: ToolDefinition, needle: string) {
  return !needle || [tool.title, tool.tagline, tool.description, ...tool.tags].join(" ").toLowerCase().includes(needle);
}

/**
 * Lights the rims of the tiles near the pointer, so the glow spills over the
 * neighbours of the tile under it instead of stopping at its edge. Only the
 * hovered zone is measured, every tile read before any is written, once a
 * frame: pointer events come faster than paints.
 */
function usePointerGlow() {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    // A finger has no hover to follow.
    if (event.pointerType !== "mouse") return;
    const zone = event.currentTarget;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const tiles = Array.from(zone.querySelectorAll<HTMLElement>(".tool-card"));
      const rects = tiles.map((tile) => tile.getBoundingClientRect());
      tiles.forEach((tile, index) => {
        const rect = rects[index];
        const near =
          Math.hypot(Math.max(rect.left - clientX, 0, clientX - rect.right), Math.max(rect.top - clientY, 0, clientY - rect.bottom)) <
          GLOW_REACH;
        if (near) {
          tile.style.setProperty("--mx", `${Math.round(clientX - rect.left)}px`);
          tile.style.setProperty("--my", `${Math.round(clientY - rect.top)}px`);
        }
        tile.toggleAttribute("data-glow", near);
      });
    });
  };

  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(frame.current);
    event.currentTarget.querySelectorAll(".tool-card[data-glow]").forEach((tile) => tile.removeAttribute("data-glow"));
  };

  return { onPointerMove, onPointerLeave };
}

export const ToolMosaic = memo(function ToolMosaic({ onOpen, disabledTools }: { onOpen: (id: string) => void; disabledTools: string[] }) {
  const { favorites, toggle, isFavorite } = useFavorites();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const switchRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const glow = usePointerGlow();

  /**
   * Stars or unstars a tool, keeping the page and the keyboard where they
   * were. The first star mounts the dock above the catalogue, and another
   * can add a row to it: the page is moved back by as much, or the next tap
   * would land on another tile. Unstarred under "my favourites", the tile
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
      (next ?? switchRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]'))?.focus();
    }
  };

  const needle = query.trim().toLowerCase();
  // What the search leaves, before the category filter: the switcher counts from it.
  const found = useMemo(() => MENU_TOOLS.filter((tool) => matches(tool, needle)), [needle]);
  const counts = useMemo(() => {
    const byFilter: Record<Filter, number> = { all: found.length, create: 0, practice: 0, analyze: 0, favorites: 0 };
    for (const tool of found) {
      byFilter[tool.category] += 1;
      if (favorites.includes(tool.id)) byFilter.favorites += 1;
    }
    return byFilter;
  }, [favorites, found]);

  const zones = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => {
        const tools = found
          .filter((tool) => {
            if (tool.category !== category) return false;
            if (filter === "favorites") return favorites.includes(tool.id);
            return filter === "all" || filter === category;
          })
          // The flagship's square opens its zone, so the grid places every tile in reading order.
          .sort((a, b) => Number(b.id === FLAGSHIP) - Number(a.id === FLAGSHIP));
        return { category, tools };
      }).filter((zone) => zone.tools.length > 0),
    [favorites, filter, found],
  );
  const shown = zones.reduce((sum, zone) => sum + zone.tools.length, 0);

  // The switcher's highlight slides to the pressed button, onto the second
  // line too when the buttons wrap. It is placed by hand rather than by
  // state, and its first placement is not animated.
  useLayoutEffect(() => {
    const group = switchRef.current;
    const thumb = thumbRef.current;
    if (!group || !thumb) return;
    const place = () => {
      const pressed = group.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!pressed) return;
      thumb.style.setProperty("--x", `${pressed.offsetLeft}px`);
      thumb.style.setProperty("--y", `${pressed.offsetTop}px`);
      thumb.style.setProperty("--w", `${pressed.offsetWidth}px`);
      thumb.style.setProperty("--h", `${pressed.offsetHeight}px`);
      if (!thumb.dataset.ready) {
        void thumb.offsetWidth;
        thumb.dataset.ready = "true";
      }
    };
    place();
    // The buttons too: a count's digits or a translated label change a
    // button's width, and not always the row's.
    const observer = new ResizeObserver(place);
    observer.observe(group);
    group.querySelectorAll("button").forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [filter]);

  return (
    <section className="aura-section" id="catalog" aria-labelledby="catalog-title">
      <SectionHead id="catalog-title" eyebrow="הקטלוג" title="כל הכלים">
        <p>סמנו ☆ כדי להצמיד כלי לתפריט ולראש הדף.</p>
      </SectionHead>

      <div className="aura-finder">
        <div className="aura-controls">
          <label className="hub-search aura-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              placeholder="חיפוש: „קריוקי”, „טיונר”, „MIDI”…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="חיפוש כלי"
            />
          </label>
          <div className="aura-switch" role="group" aria-label="סינון לפי קטגוריה" ref={switchRef}>
            <span className="aura-switch-thumb" ref={thumbRef} aria-hidden="true" />
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? "active" : ""}
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
              >
                {item.label}
                <span className="aura-switch-count">{counts[item.id]}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="aura-result" aria-live="polite">
          {shown === 1 ? `מוצג כלי אחד מתוך ${MENU_TOOLS.length}` : `מוצגים ${shown} מתוך ${MENU_TOOLS.length} כלים`}
        </p>
      </div>

      <div className="aura-catalog" ref={catalogRef}>
        {zones.map(({ category, tools }) => {
          const ZoneIcon = ZONES[category].icon;
          return (
            <section
              key={category}
              className="aura-zone"
              aria-labelledby={`zone-${category}`}
              style={{ "--accent-hue": ZONES[category].hue } as CSSProperties}
              {...glow}
            >
              <header className="aura-zone-head">
                <span className="aura-zone-orb" aria-hidden="true">
                  <ZoneIcon size={20} />
                </span>
                <h3 id={`zone-${category}`}>{CATEGORY_LABELS[category]}</h3>
                <p>{ZONES[category].blurb}</p>
                {/* The number a text of its own, so the word is translated as a word. */}
                <span className="aura-zone-count">
                  {tools.length === 1 ? (
                    "כלי אחד"
                  ) : (
                    <>
                      <b>{tools.length}</b> כלים
                    </>
                  )}
                </span>
              </header>
              <div className="aura-grid">
                {tools.map((tool, index) => (
                  <ToolTile
                    key={tool.id}
                    tool={tool}
                    flagship={tool.id === FLAGSHIP}
                    index={index}
                    off={disabledTools.includes(tool.id)}
                    pinned={isFavorite(tool.id)}
                    onToggle={star}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {zones.length === 0 && (
          <div className="hub-empty">
            {!needle && filter === "favorites" ? (
              <p>עוד לא סימנת מועדפים. לחיצה על הכוכב בכרטיס של כלי מצמידה אותו.</p>
            ) : found.length === 0 ? (
              <p>{`לא נמצא כלי שמתאים ל„${query.trim()}”. נסו מילה אחרת.`}</p>
            ) : (
              // The search did find tools, only not under this filter.
              <>
                <p>{`אין ב„${FILTERS.find((item) => item.id === filter)?.label}” כלי שמתאים ל„${query.trim()}”.`}</p>
                <button type="button" className="secondary-button" onClick={() => setFilter("all")}>
                  חיפוש בכל הכלים <span className="aura-switch-count">{found.length}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
});

type TileProps = {
  tool: ToolDefinition;
  flagship: boolean;
  index: number;
  off: boolean;
  pinned: boolean;
  onToggle: (id: string, button: HTMLElement) => void;
  onOpen: (id: string) => void;
};

function ToolTile({ tool, flagship, index, off, pinned, onToggle, onOpen }: TileProps) {
  const Icon = tool.icon;
  const descId = `tool-desc-${tool.id}`;
  return (
    <article
      className={`tool-card${flagship ? " is-flagship" : ""}${off ? " is-off" : ""}`}
      style={{ "--accent-hue": tool.hue, "--reveal": `${Math.min(index, 10) * 30}ms` } as CSSProperties}
    >
      {flagship && <StaffArt />}
      <span className="tool-card-icon" aria-hidden="true">
        <Icon size={flagship ? 28 : 20} />
      </span>
      <div className="tool-card-head">
        <h4 className="tool-card-title">
          <button type="button" className="tool-card-open" disabled={off} onClick={() => onOpen(tool.id)} aria-describedby={descId}>
            {tool.title}
          </button>
        </h4>
        {off ? (
          <span className="tool-card-badge is-off">מכובה זמנית</span>
        ) : tool.badge ? (
          <span className="tool-card-badge">{tool.badge}</span>
        ) : null}
      </div>
      <p className="tool-card-tagline">{tool.tagline}</p>
      <p className="tool-card-desc" id={descId}>
        {tool.description}
      </p>
      <button
        type="button"
        className={`tool-card-star ${pinned ? "is-on" : ""}`}
        onClick={(event) => onToggle(tool.id, event.currentTarget)}
        aria-pressed={pinned}
        aria-label={pinned ? `הסרת ${tool.title} מהמועדפים` : `הוספת ${tool.title} למועדפים`}
      >
        <Star size={16} />
      </button>
      <ArrowLeft size={16} className="tool-card-arrow" aria-hidden="true" />
    </article>
  );
}

/** The stave's lines, and notes sitting on its lines and spaces, in its own units (360 × 80). */
const STAVE_LINES = [18, 28, 38, 48, 58];
const STAVE_NOTES = [
  { x: 40, y: 43 },
  { x: 78, y: 38 },
  { x: 116, y: 33 },
  { x: 154, y: 43 },
  { x: 204, y: 28 },
  { x: 242, y: 33 },
  { x: 280, y: 23 },
  { x: 318, y: 38 },
];

/**
 * A stave with a few notes and a playhead crossing it, and the readings the
 * tool takes floating by as they do round the hero's quick start: the
 * flagship's tile shows what it makes. Music reads left to right in either
 * language, so the playhead runs that way on both. It all rests while the
 * tile is out of sight.
 */
function StaffArt() {
  const idle = useIdleOffscreen<HTMLDivElement>();
  return (
    <div className="tool-card-art" aria-hidden="true" ref={idle}>
      <div className="tool-card-stave">
        <svg className="tool-card-staff" viewBox="0 0 360 80">
          {STAVE_LINES.map((y) => (
            <line key={y} x1="0" x2="360" y1={y} y2={y} className="staff-line" />
          ))}
          <line x1="184" x2="184" y1="18" y2="58" className="staff-line is-bar" />
          {STAVE_NOTES.map((note) => {
            // Above the middle line a stem hangs down on the left, as it is written.
            const up = note.y >= 38;
            const stemX = up ? note.x + 5.6 : note.x - 5.6;
            return (
              // Each note lights as the playhead crosses it: its delay is how far along the stave it sits.
              <g key={note.x} className="staff-note" style={{ "--d": `${((note.x / 360 - 1) * 3.6).toFixed(2)}s` } as CSSProperties}>
                <ellipse cx={note.x} cy={note.y} rx="6.5" ry="4.6" transform={`rotate(-20 ${note.x} ${note.y})`} />
                <line x1={stemX} x2={stemX} y1={up ? note.y - 1 : note.y + 1} y2={up ? note.y - 26 : note.y + 26} />
              </g>
            );
          })}
        </svg>
        <span className="staff-playhead" />
      </div>
      <span className="tool-card-chip is-tempo" dir="ltr">
        <b>♩</b> 96 BPM
      </span>
      <span className="tool-card-chip is-key" dir="ltr">
        C major · 4/4
      </span>
    </div>
  );
}
