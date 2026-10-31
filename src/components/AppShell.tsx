import {
  ChevronLeft,
  Cloud,
  House,
  Keyboard,
  LayoutGrid,
  LockKeyhole,
  Menu,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Route as RouteIcon,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PropsWithChildren, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { useFavorites } from "../lib/prefs";
import { useRail } from "../lib/rail";
import type { ThemePreference } from "../lib/theme";
import { CATEGORY_LABELS, MENU_GROUPS, findTool, menuGroupLabel, type ToolDefinition } from "../lib/tools";
import { DESKTOP_QUERY, PHONE_QUERY, useMediaQuery } from "../lib/useMediaQuery";
import { CreditsPill } from "./CreditsPill";
import { LogoGlyph } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

type Props = PropsWithChildren<{
  route: string;
  tool: ToolDefinition | null;
  /** The name of a page that is not a tool — the personal area, the admin area. */
  pageTitle?: string | null;
  /** True while the personal-area drawer is open over the page. */
  account?: boolean;
  owner: boolean;
  disabledTools: string[];
  themePreference: ThemePreference;
  onOpenAppearance: () => void;
  onNavigate: (route: string) => void;
  onOpenAccount: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  onOpenShare: () => void;
  /** The feedback form: a problem, an idea, anything. */
  onOpenFeedback: () => void;
  /** The page about credits and the private link. */
  onOpenCredits: () => void;
  /** The guided tour of the page on screen. */
  onOpenTour: () => void;
  /** True while that tour is running. */
  touring?: boolean;
  /** Whether the assistant is open: the phone's tab bar shows and toggles it. */
  assistantOpen?: boolean;
  /** Shows or hides the assistant, from the phone's tab bar (the floating launcher is not drawn there). */
  onToggleAssistant?: () => void;
}>;

/** What can take the keyboard inside the drawer, for keeping Tab inside it. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The brand's own hue, for the rows that belong to no tool (home, personal area, credits). */
const BRAND_HUE = { "--accent-hue": "var(--brand-hue, 250)" } as CSSProperties;

/**
 * The frame every page shares. On a desktop a sidebar holds every tool,
 * grouped, with the pinned ones on top; it folds to an icon rail (Ctrl+B,
 * remembered). Between 720 and 1120 it is a drawer opened from the top bar;
 * on a phone a tab bar sits at the bottom and the sidebar rises from it as a
 * sheet. The top bar says where you are and carries what works from
 * anywhere. Tool pages set their hue here, so every component inside takes
 * on the tool's colour.
 *
 * What lives in two places at different widths — the search, the theme
 * button, the favourite star, the assistant's way in — is rendered in one of
 * them, chosen by the width, never hidden with CSS: the tours and the tests
 * look each one up and must find exactly one.
 */
export function AppShell({
  route,
  tool,
  pageTitle = null,
  account = false,
  owner,
  disabledTools,
  themePreference,
  onOpenAppearance,
  onNavigate,
  onOpenAccount,
  onOpenPalette,
  onOpenShortcuts,
  onOpenShare,
  onOpenFeedback,
  onOpenCredits,
  onOpenTour,
  touring = false,
  assistantOpen = false,
  onToggleAssistant,
  children,
}: Props) {
  const { user, profile } = useAuth();
  const { favorites, toggle, isFavorite } = useFavorites();
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8);
  const desktop = useMediaQuery(DESKTOP_QUERY, true);
  const phone = useMediaQuery(PHONE_QUERY);
  const [railChoice, setRail] = useRail();
  // The rail is a desktop thing; the drawer and the sheet are always full.
  const rail = desktop && railChoice;
  const overlay = !desktop;
  const drawerOpen = overlay && navOpen;

  // Grown to a desktop with the drawer open: the sidebar is in the page now,
  // and the drawer should not be waiting when the window shrinks again.
  const [wasDesktop, setWasDesktop] = useState(desktop);
  if (wasDesktop !== desktop) {
    setWasDesktop(desktop);
    setNavOpen(false);
  }

  useEffect(() => {
    const name = tool?.title ?? pageTitle;
    document.title = name ? `${name} — כלי מוזיקה` : "כלי מוזיקה — הסטודיו המוזיקלי שלך בדפדפן";
  }, [pageTitle, tool]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Ctrl+B (⌘B) folds the desktop sidebar to its rail and back. By the key's
  // place as well as its letter: on a Hebrew layout B types "נ".
  useEffect(() => {
    if (!desktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key !== "b" && event.key !== "B" && event.code !== "KeyB") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      event.preventDefault();
      setRail((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, setRail]);

  // The drawer (and the phone's sheet) is a modal: the page under it does not
  // scroll, Tab stays inside it, Esc and the scrim close it, and focus goes
  // back to whatever opened it. It opens on its search, the first thing in it.
  useEffect(() => {
    if (!drawerOpen) return;
    const panel = sidebarRef.current;
    if (!panel) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      (panel.querySelector<HTMLElement>(".sidebar-search") ?? panel.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      if (before?.isConnected && panel.contains(document.activeElement)) before.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  const go = (next: string) => {
    setNavOpen(false);
    onNavigate(next);
  };
  const openPalette = () => {
    setNavOpen(false);
    onOpenPalette();
  };
  const closeThen = (action: () => void) => () => {
    setNavOpen(false);
    action();
  };

  const me = route === "me" || route.startsWith("me/");
  const home = route === "home";
  const credits = route === "credits";
  const pinned = favorites.map(findTool).filter((item): item is ToolDefinition => Boolean(item));
  const favorite = tool ? isFavorite(tool.id) : false;
  const firstName = user ? profile?.full_name?.split(" ")[0] || "הפרופיל שלי" : "האזור האישי";

  /** A row of the sidebar: the LED in the row's hue, the icon, the name; on the rail the name is for readers and the tooltip. */
  const navButton = ({
    key,
    label,
    icon,
    current,
    off = false,
    hint,
    hue,
    onClick,
    badge,
    pageCurrent = true,
  }: {
    key: string;
    label: string;
    icon: ReactNode;
    current: boolean;
    off?: boolean;
    hint?: string;
    hue?: number;
    onClick: () => void;
    badge?: boolean;
    /** The admin row is highlighted but never announced as the page. */
    pageCurrent?: boolean;
  }) => (
    <li key={key}>
      <button
        type="button"
        className={`nav-item${current ? " is-current" : ""}${off ? " is-off" : ""}`}
        style={hue === undefined ? BRAND_HUE : ({ "--accent-hue": hue } as CSSProperties)}
        aria-current={current && pageCurrent ? "page" : undefined}
        onClick={onClick}
        title={rail ? label : hint}
      >
        <span className="nav-led" aria-hidden="true" />
        <span className="nav-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="nav-label">{label}</span>
        {badge && !rail && <span className="nav-badge">חדש</span>}
      </button>
    </li>
  );

  const toolItem = (item: ToolDefinition, keyPrefix = "") => {
    const Icon = item.icon;
    return navButton({
      key: `${keyPrefix}${item.id}`,
      label: item.title,
      icon: <Icon size={18} />,
      // A tab of a family lights its family's row: `tool` is the page tool.
      current: tool?.id === item.id,
      off: disabledTools.includes(item.id) && !owner,
      hint: item.tagline,
      hue: item.hue,
      onClick: () => go(item.id),
      badge: item.badge === "חדש",
    });
  };

  // The sidebar's search shows where the sidebar does in full; the top bar's
  // stands in for it on the rail and below the desktop width (on a phone the
  // tab bar's search does).
  const sidebarSearch = (desktop && !rail) || drawerOpen;
  const railSearch = rail;
  const topbarSearch = !phone && !(desktop && !rail);

  const searchField = (
    <button type="button" className="sidebar-search" onClick={openPalette}>
      <Search size={16} aria-hidden="true" />
      <span>חיפוש כלי או עבודה…</span>
      <kbd className="kbd">Ctrl K</kbd>
    </button>
  );

  return (
    <div
      className={`app ${tool ? "tool-page" : "hub-page"}`}
      style={tool ? ({ "--accent-hue": tool.hue } as CSSProperties) : undefined}
      data-nav-open={drawerOpen}
      data-rail={rail}
      data-layout={desktop ? "desktop" : phone ? "phone" : "tablet"}
    >
      {/* A link would put its target in the hash and send the router to an
          unknown route, so the skip control moves focus itself. */}
      <button type="button" className="skip-link" onClick={() => contentRef.current?.focus()}>
        דלג לתוכן
      </button>

      <aside
        ref={sidebarRef}
        className="sidebar"
        aria-label="ניווט באתר"
        data-open={drawerOpen || undefined}
        data-sheet={phone || undefined}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen || undefined}
        // Closed, the drawer is out of sight and out of the keyboard's way.
        inert={overlay && !navOpen}
      >
        {phone && <span className="sheet-handle" aria-hidden="true" />}

        {phone ? (
          // On a phone the sheet opens on its search, which stays in reach as the list scrolls.
          <div className="sidebar-head is-sheet">
            {sidebarSearch && searchField}
            <button className="icon-button sidebar-close" type="button" onClick={() => setNavOpen(false)} aria-label="סגירת התפריט">
              <X size={18} />
            </button>
          </div>
        ) : (
          <>
            <div className="sidebar-head">
              <button className="brand brand-button" type="button" onClick={() => go("home")} aria-label="לדף הבית" title={rail ? "דף הבית" : undefined}>
                <span className="brand-mark">
                  <LogoGlyph />
                </span>
                {!rail && (
                  <span className="brand-text">
                    <strong>כלי מוזיקה</strong>
                    <small>סטודיו בדפדפן</small>
                  </span>
                )}
              </button>
              {desktop ? (
                <button
                  type="button"
                  className="rail-toggle"
                  onClick={() => setRail((value) => !value)}
                  aria-pressed={rail}
                  aria-label={rail ? "הרחבת התפריט" : "כיווץ התפריט"}
                  title={rail ? "הרחבת התפריט (Ctrl+B)" : "כיווץ התפריט (Ctrl+B)"}
                >
                  {rail ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
                </button>
              ) : (
                <button className="icon-button sidebar-close" type="button" onClick={() => setNavOpen(false)} aria-label="סגירת התפריט">
                  <X size={18} />
                </button>
              )}
            </div>
            {sidebarSearch && searchField}
            {railSearch && (
              <button type="button" className="sidebar-search is-rail" onClick={openPalette} aria-label="חיפוש כלי או עבודה" title="חיפוש (Ctrl+K)">
                <Search size={18} aria-hidden="true" />
              </button>
            )}
          </>
        )}

        <nav className="sidebar-nav" aria-label="כל הכלים">
          <ul className="nav-list">
            {navButton({ key: "home", label: "דף הבית", icon: <House size={18} />, current: home, onClick: () => go("home") })}
            {navButton({ key: "me", label: "האזור האישי", icon: <UserRound size={18} />, current: me, onClick: () => go("me") })}
            {navButton({ key: "credits", label: "קרדיטים והזמנת חברים", icon: <Zap size={18} />, current: credits, onClick: () => go("credits") })}
            {owner &&
              navButton({
                key: "admin",
                label: "אזור ניהול",
                icon: <ShieldCheck size={18} />,
                current: route === "admin",
                pageCurrent: false,
                onClick: () => go("admin"),
              })}
          </ul>

          {pinned.length > 0 && (
            <section className="nav-section" aria-label="מועדפים">
              <h2 className="nav-heading">
                <Star size={12} fill="currentColor" aria-hidden="true" /> <span className="nav-heading-text">מועדפים</span>
              </h2>
              <ul className="nav-list">{pinned.map((item) => toolItem(item, "fav-"))}</ul>
            </section>
          )}

          {MENU_GROUPS.map((group) => {
            const items = group.tools.map(findTool).filter((item): item is ToolDefinition => Boolean(item));
            if (!items.length) return null;
            return (
              <section key={group.id} className="nav-section" aria-label={group.label}>
                <h2 className="nav-heading">
                  <span className="nav-heading-text">{group.label}</span>
                </h2>
                <ul className="nav-list">{items.map((item) => toolItem(item))}</ul>
              </section>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {/* On a desktop the theme lives here; below it, in the top bar (one of them, never both). */}
          {desktop && <ThemeToggle preference={themePreference} onOpen={onOpenAppearance} />}
          {phone && <ThemeToggle preference={themePreference} onOpen={closeThen(onOpenAppearance)} />}
          <button type="button" className="icon-button shortcuts-button" onClick={closeThen(onOpenShortcuts)} aria-label="קיצורי מקלדת" title="קיצורי מקלדת (?)">
            <Keyboard size={18} />
          </button>
          <button
            type="button"
            className="icon-button feedback-button"
            onClick={closeThen(onOpenFeedback)}
            aria-label="משוב והצעות"
            title="משוב והצעות: בעיה, רעיון או כל דבר אחר"
          >
            <MessageSquareText size={18} />
          </button>
          <button type="button" className="icon-button share-site-button" onClick={closeThen(onOpenShare)} aria-label="שיתוף האתר" title="שיתוף האתר עם חברים">
            <Share2 size={18} />
          </button>
        </div>
      </aside>
      {overlay && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="main-column">
        <header className={`topbar ${scrolled ? "is-scrolled" : ""}`}>
          <div className="topbar-start">
            {overlay && !phone && (
              <button
                type="button"
                className="icon-button nav-toggle"
                onClick={() => setNavOpen(true)}
                aria-label="פתיחת התפריט"
                aria-expanded={drawerOpen}
              >
                <Menu size={20} />
              </button>
            )}
            {overlay && (
              <button className="brand brand-button topbar-brand" type="button" onClick={() => go("home")} aria-label="לדף הבית">
                <span className="brand-mark">
                  <LogoGlyph />
                </span>
              </button>
            )}
            <nav className="crumbs" aria-label="מיקום באתר">
              {home ? (
                <strong>דף הבית</strong>
              ) : (
                <>
                  {desktop && (
                    <>
                      <button type="button" onClick={() => go("home")}>
                        דף הבית
                      </button>
                      <ChevronLeft size={14} aria-hidden="true" />
                      {tool && (
                        <>
                          <span>{menuGroupLabel(tool.id) ?? CATEGORY_LABELS[tool.category]}</span>
                          <ChevronLeft size={14} aria-hidden="true" />
                        </>
                      )}
                    </>
                  )}
                  {tool && <span className="crumb-dot" aria-hidden="true" />}
                  <strong>{tool?.title ?? pageTitle ?? ""}</strong>
                </>
              )}
            </nav>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="tour-button"
              onClick={onOpenTour}
              aria-pressed={touring}
              aria-label={tool ? `הסבר: סיור ב${tool.title}` : "הסבר: סיור בעמוד"}
              title="סיור מודרך שמסביר איך משתמשים בעמוד הזה"
            >
              <span className="tour-button-mark" aria-hidden="true">
                <RouteIcon size={16} />
              </span>
              <span className="tour-button-label">הסבר</span>
            </button>
            {/* On a phone the star sits in the tool's masthead instead. */}
            {tool && !phone && (
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
            {desktop &&
              (tool?.server ? (
                <span className="privacy-pill is-server">
                  <Cloud size={14} aria-hidden="true" /> הכלי נעזר בשרת
                </span>
              ) : (
                <span className="privacy-pill">
                  <LockKeyhole size={14} aria-hidden="true" /> הקובץ נשאר אצלך
                </span>
              ))}
            {!phone && <CreditsPill current={credits} onOpen={onOpenCredits} />}
            {topbarSearch && (
              <button type="button" className="icon-button topbar-search" onClick={openPalette} aria-label="חיפוש" title="חיפוש (Ctrl+K)">
                <Search size={18} />
              </button>
            )}
            {!desktop && !phone && <ThemeToggle preference={themePreference} onOpen={onOpenAppearance} />}
            <button
              className={`account-button ${account ? "is-current" : ""}`}
              type="button"
              onClick={onOpenAccount}
              aria-expanded={account}
              aria-label={phone || !desktop ? firstName : undefined}
            >
              {user && profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar">
                  <UserRound size={16} />
                </span>
              )}
              {desktop && (
                <span className="account-button-copy">
                  <strong>{firstName}</strong>
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Moving between tools changes the hash, not the document, so a
            screen reader is told nothing on its own. This says where we landed. */}
        <p className="sr-only" role="status" aria-live="polite">
          {tool ? `${tool.title} — ${tool.tagline}` : (pageTitle ?? "דף הבית")}
        </p>

        <div className="page-content" ref={contentRef} tabIndex={-1}>
          {children}
        </div>
      </div>

      {phone && (
        <nav className="tabbar" aria-label="ניווט מהיר">
          <button type="button" className={home ? "is-current" : ""} aria-current={home ? "page" : undefined} onClick={() => go("home")}>
            <House size={22} aria-hidden="true" />
            <span className="tabbar-label">בית</span>
          </button>
          <button
            type="button"
            className={`tabbar-tools${tool ? " is-current" : ""}`}
            onClick={() => setNavOpen(true)}
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
          >
            <LayoutGrid size={22} aria-hidden="true" />
            <span className="tabbar-label">כלים</span>
          </button>
          {/* The phone's search: it stands where the top bar's does on wider screens, so it carries that name too. */}
          <button type="button" className="tabbar-search topbar-search" onClick={openPalette}>
            <Search size={22} aria-hidden="true" />
            <span className="tabbar-label">חיפוש</span>
          </button>
          {/* The assistant's way in on a phone: the floating launcher is not drawn here, so this one carries its name. */}
          <button
            type="button"
            className={`tabbar-assistant assistant-launcher${assistantOpen ? " is-current" : ""}`}
            onClick={onToggleAssistant}
            aria-expanded={assistantOpen}
            title="העוזר (Ctrl+J)"
          >
            <Sparkles size={22} aria-hidden="true" />
            <span className="tabbar-label">עוזר</span>
          </button>
          <button type="button" className={me ? "is-current" : ""} aria-current={me ? "page" : undefined} onClick={() => go("me")}>
            <UserRound size={22} aria-hidden="true" />
            <span className="tabbar-label">אישי</span>
          </button>
        </nav>
      )}
    </div>
  );
}
