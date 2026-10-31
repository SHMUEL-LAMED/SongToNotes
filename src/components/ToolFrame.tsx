import { Check, Cloud, Link2, LockKeyhole, Share2, Star } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFavorites } from "../lib/prefs";
import { canShareNatively, shareNatively } from "../lib/siteShare";
import { CATEGORY_LABELS, findAnyTool, menuGroupLabel, type ToolDefinition } from "../lib/tools";
import { PHONE_QUERY, useMediaQuery } from "../lib/useMediaQuery";
import { NextSteps } from "./NextSteps";
import { SiteFooter } from "./SiteFooter";
import { ToolTabs } from "./ToolTabs";
import { ToolVideo } from "./ToolVideo";

/** Per tool, whether "מה זה עושה?" was left open: `{ [toolId]: boolean }`. */
const HELP_KEY = "musictools.toolhelp.v1";

function readHelp(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HELP_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeHelp(id: string, open: boolean) {
  try {
    localStorage.setItem(HELP_KEY, JSON.stringify({ ...readHelp(), [id]: open }));
  } catch {
    // Storage blocked: the description just opens again next time.
  }
}

/** The masthead's slot for the tool's own controls, filled through {@link ToolActions}. */
const SlotContext = createContext<HTMLElement | null>(null);

/**
 * Puts a tool's own controls — its save button, an engine picker, the
 * metronome's or the tuner's side controls — into the masthead of the page,
 * beside the share button. Renders nothing until the masthead is there (and
 * nothing outside a tool page).
 */
export function ToolActions({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  return slot ? createPortal(children, slot) : null;
}

type Props = {
  /** The page's tool: a tab is shown under its family's tool. */
  tool: ToolDefinition;
  /** The tool (or tab) actually on screen. */
  current: string;
  onOpen: (route: string) => void;
  onFeedback: () => void;
  disabledTools?: readonly string[];
  children: ReactNode;
};

/**
 * Every tool page, around the tool: the masthead (what the tool is, from the
 * registry), the one full-width line of the tool's colour under it, the
 * family's tabs, the tool itself, and the foot — carrying the file on, the
 * tools that usually come next, the how-to video and the site's footer.
 * Tools render only their body (`section.tool-body`).
 */
export function ToolFrame({ tool, current, onOpen, onFeedback, disabledTools = [], children }: Props) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const { toggle, isFavorite } = useFavorites();
  const Icon = tool.icon;
  const favorite = isFavorite(tool.id);
  // The video is the tab's own; everything else is the page's.
  const shown = findAnyTool(current) ?? tool;

  return (
    <SlotContext.Provider value={slot}>
      <div className="tool-frame">
        {/* Also .tool-intro: the tours open on that name. */}
        <header className="tool-masthead tool-intro">
          <span className="masthead-icon" aria-hidden="true">
            <Icon size={26} />
          </span>
          <div className="masthead-copy">
            <p className="masthead-kicker">
              <span>{menuGroupLabel(tool.id) ?? CATEGORY_LABELS[tool.category]}</span>
              <span className="masthead-sep" aria-hidden="true">
                ·
              </span>
              {tool.server ? (
                <span className="masthead-where is-server">
                  <Cloud size={12} aria-hidden="true" /> נעזר בשרת
                </span>
              ) : (
                <span className="masthead-where">
                  <LockKeyhole size={12} aria-hidden="true" /> רץ במכשיר
                </span>
              )}
              {tool.badge && (
                <>
                  <span className="masthead-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className={`masthead-badge${tool.badge === "חדש" ? " is-new" : ""}`}>{tool.badge}</span>
                </>
              )}
            </p>
            <h1 className="masthead-title">{tool.title}</h1>
            <p className="masthead-tagline">{tool.tagline}</p>
            <MastheadMore key={tool.id} tool={tool} />
          </div>
          <div className="masthead-actions">
            {/* On a phone the star is here; wider, it is in the top bar. */}
            {phone && (
              <button
                type="button"
                className={`icon-button fav-toggle ${favorite ? "is-on" : ""}`}
                onClick={() => toggle(tool.id)}
                aria-pressed={favorite}
                aria-label={favorite ? `הסרת ${tool.title} מהמועדפים` : `הוספת ${tool.title} למועדפים`}
                title={favorite ? "במועדפים" : "הוספה למועדפים"}
              >
                <Star size={18} />
              </button>
            )}
            <PageShare tool={tool} current={current} />
            <div className="masthead-slot" ref={setSlot} />
          </div>
        </header>
        <div className="masthead-rule" aria-hidden="true" />

        <ToolTabs current={current} />

        {children}

        <div className="tool-foot">
          <NextSteps tool={tool} onOpen={onOpen} disabledTools={disabledTools} />
          <ToolVideo tool={shown} />
        </div>
      </div>
      <SiteFooter onOpen={onOpen} onFeedback={onFeedback} />
    </SlotContext.Provider>
  );
}

/**
 * The tool's long description, folded under "מה זה עושה?". Open on a tool's
 * first visit, closed on the visits after, and from then on as it was left.
 */
function MastheadMore({ tool }: { tool: ToolDefinition }) {
  const [open, setOpen] = useState(() => readHelp()[tool.id] ?? true);

  // The first visit is remembered as seen, so the next one opens folded.
  useEffect(() => {
    if (readHelp()[tool.id] === undefined) writeHelp(tool.id, false);
  }, [tool.id]);

  return (
    <details
      className="masthead-more"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        // The browser also reports the open state it was rendered with; only
        // the visitor's own unfolding and folding are stored.
        if (next === open) return;
        setOpen(next);
        writeHelp(tool.id, next);
      }}
    >
      <summary>מה זה עושה?</summary>
      <p>{tool.description}</p>
    </details>
  );
}

/**
 * Passes the page itself on: the system's share sheet where there is one (a
 * phone), the clipboard elsewhere. The address is the tool's own page, which
 * carries its title and description for the chat app's preview.
 */
function PageShare({ tool, current }: { tool: ToolDefinition; current: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const share = () => {
    const url = new URL(`${import.meta.env.BASE_URL}${current}/`, window.location.origin).toString();
    if (canShareNatively()) {
      void shareNatively(url, tool.tagline, `${tool.title} — כלי מוזיקה`).then((outcome) => {
        if (outcome === "failed") setState("failed");
      });
      return;
    }
    if (!navigator.clipboard) {
      setState("failed");
      return;
    }
    void navigator.clipboard
      .writeText(url)
      .then(() => setState("copied"))
      .catch(() => setState("failed"));
  };

  return (
    <button
      type="button"
      className={`page-share${state === "copied" ? " is-on" : ""}`}
      onClick={share}
      title="שיתוף הקישור לכלי"
      aria-label={state === "copied" ? "הקישור הועתק" : `שיתוף הקישור ל${tool.title}`}
    >
      {state === "copied" ? <Check size={16} aria-hidden="true" /> : canShareNatively() ? <Share2 size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
      <span>{state === "copied" ? "הקישור הועתק" : state === "failed" ? "לא הצלחנו לשתף" : "שיתוף"}</span>
    </button>
  );
}
