import {
  ChevronLeft,
  History,
  House,
  Keyboard,
  LayoutGrid,
  LockKeyhole,
  Menu,
  Search,
  ShieldCheck,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PropsWithChildren } from "react";
import { useAuth } from "../lib/auth";
import { useFavorites } from "../lib/prefs";
import type { ThemePreference } from "../lib/theme";
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, findTool, type ToolDefinition } from "../lib/tools";
import { Logo } from "./Logo";
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
  onCycleTheme: () => void;
  onNavigate: (route: string) => void;
  onOpenAccount: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}>;

/**
 * The frame every page shares. A sidebar holds every tool, grouped, with the
 * pinned ones on top; the top bar says where you are and carries what works
 * from anywhere. Below 960px the sidebar turns into a drawer and a tab bar
 * appears at the bottom. Tool pages set their hue here, so every component
 * inside takes on the tool's colour.
 */
export function AppShell({
  route,
  tool,
  pageTitle = null,
  account = false,
  owner,
  disabledTools,
  themePreference,
  onCycleTheme,
  onNavigate,
  onOpenAccount,
  onOpenPalette,
  onOpenShortcuts,
  children,
}: Props) {
  const { user, profile } = useAuth();
  const { favorites, toggle, isFavorite } = useFavorites();
  const contentRef = useRef<HTMLDivElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8);

  useEffect(() => {
    const name = tool?.title ?? pageTitle;
    document.title = name ? `${name} — כלי מוזיקה` : "כלי מוזיקה — הסטודיו המוזיקלי שלך בדפדפן";
  }, [pageTitle, tool]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The drawer closes once a page has been picked (see go), and with Esc.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const go = (next: string) => {
    setNavOpen(false);
    onNavigate(next);
  };
  const openPalette = () => {
    setNavOpen(false);
    onOpenPalette();
  };

  const me = route === "me" || route.startsWith("me/");
  const home = route === "home";
  const pinned = favorites.map(findTool).filter((item): item is ToolDefinition => Boolean(item));

  const toolItem = (item: ToolDefinition, keyPrefix = "") => {
    const Icon = item.icon;
    const off = disabledTools.includes(item.id) && !owner;
    return (
      <li key={`${keyPrefix}${item.id}`}>
        <button
          type="button"
          className={`nav-item ${tool?.id === item.id ? "is-current" : ""} ${off ? "is-off" : ""}`}
          style={{ "--accent-hue": item.hue } as CSSProperties}
          aria-current={tool?.id === item.id ? "page" : undefined}
          onClick={() => go(item.id)}
          title={item.tagline}
        >
          <span className="nav-icon">
            <Icon size={15} />
          </span>
          <span className="nav-label">{item.title}</span>
          {item.badge === "חדש" && <span className="nav-badge">חדש</span>}
        </button>
      </li>
    );
  };

  const favorite = tool ? isFavorite(tool.id) : false;

  return (
    <div
      className={`app ${tool ? "tool-page" : "hub-page"}`}
      style={tool ? ({ "--accent-hue": tool.hue } as CSSProperties) : undefined}
      data-nav-open={navOpen}
    >
      {/* A link would put its target in the hash and send the router to an
          unknown route, so the skip control moves focus itself. */}
      <button type="button" className="skip-link" onClick={() => contentRef.current?.focus()}>
        דלג לתוכן
      </button>

      <aside className="sidebar" aria-label="ניווט באתר">
        <div className="sidebar-head">
          <button className="brand brand-button" type="button" onClick={() => go("home")} aria-label="לדף הבית">
            <Logo />
          </button>
          <button className="icon-button sidebar-close" type="button" onClick={() => setNavOpen(false)} aria-label="סגירת התפריט">
            <X size={18} />
          </button>
        </div>

        <button type="button" className="sidebar-search" onClick={openPalette}>
          <Search size={16} aria-hidden="true" />
          <span>חיפוש כלי או עבודה…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <nav className="sidebar-nav">
          <ul className="nav-list">
            <li>
              <button type="button" className={`nav-item ${home ? "is-current" : ""}`} onClick={() => go("home")} aria-current={home ? "page" : undefined}>
                <House size={17} /> <span className="nav-label">דף הבית</span>
              </button>
            </li>
            <li>
              <button type="button" className={`nav-item ${me ? "is-current" : ""}`} onClick={() => go("me")} aria-current={me ? "page" : undefined}>
                <UserRound size={17} /> <span className="nav-label">האזור האישי</span>
              </button>
            </li>
            {owner && (
              <li>
                <button type="button" className={`nav-item ${route === "admin" ? "is-current" : ""}`} onClick={() => go("admin")}>
                  <ShieldCheck size={17} /> <span className="nav-label">אזור ניהול</span>
                </button>
              </li>
            )}
          </ul>

          {pinned.length > 0 && (
            <section className="nav-section" aria-label="מועדפים">
              <h2 className="nav-heading">
                <Star size={12} fill="currentColor" /> מועדפים
              </h2>
              <ul className="nav-list">{pinned.map((item) => toolItem(item, "fav-"))}</ul>
            </section>
          )}

          {CATEGORY_ORDER.map((category) => (
            <section key={category} className="nav-section" aria-label={CATEGORY_LABELS[category]}>
              <h2 className="nav-heading">{CATEGORY_LABELS[category]}</h2>
              <ul className="nav-list">
                {TOOLS.filter((item) => item.category === category).map((item) => toolItem(item))}
              </ul>
            </section>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p className="sidebar-note">
            <LockKeyhole size={14} />
            <span>הקבצים שלכם לא עוזבים את המכשיר. העיבוד כולו קורה בדפדפן.</span>
          </p>
        </div>
      </aside>
      <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="main-column">
        <header className={`topbar ${scrolled ? "is-scrolled" : ""}`}>
          <div className="topbar-start">
            <button
              type="button"
              className="icon-button nav-toggle"
              onClick={() => setNavOpen(true)}
              aria-label="פתיחת התפריט"
              aria-expanded={navOpen}
            >
              <Menu size={18} />
            </button>
            <button className="brand brand-button topbar-brand" type="button" onClick={() => go("home")} aria-label="לדף הבית">
              <Logo />
            </button>
            <nav className="crumbs" aria-label="מיקום באתר">
              {home ? (
                <strong>דף הבית</strong>
              ) : (
                <>
                  <button type="button" onClick={() => go("home")}>
                    דף הבית
                  </button>
                  <ChevronLeft size={14} />
                  {tool && (
                    <>
                      <span>{CATEGORY_LABELS[tool.category]}</span>
                      <ChevronLeft size={14} />
                      <span className="crumb-dot" aria-hidden="true" />
                    </>
                  )}
                  <strong>{tool?.title ?? pageTitle ?? ""}</strong>
                </>
              )}
            </nav>
          </div>

          <div className="topbar-actions">
            {tool && (
              <button
                type="button"
                className={`icon-button fav-toggle ${favorite ? "is-on" : ""}`}
                onClick={() => toggle(tool.id)}
                aria-pressed={favorite}
                aria-label={favorite ? `הסרת ${tool.title} מהמועדפים` : `הוספת ${tool.title} למועדפים`}
                title={favorite ? "במועדפים" : "הוספה למועדפים"}
              >
                <Star size={17} />
              </button>
            )}
            <span className="privacy-pill">
              <LockKeyhole size={14} /> הקובץ נשאר אצלך
            </span>
            <button type="button" className="icon-button topbar-search" onClick={openPalette} aria-label="חיפוש">
              <Search size={17} />
            </button>
            <button type="button" className="icon-button shortcuts-button" onClick={onOpenShortcuts} aria-label="קיצורי מקלדת" title="קיצורי מקלדת (?)">
              <Keyboard size={17} />
            </button>
            <ThemeToggle preference={themePreference} onCycle={onCycleTheme} />
            <button
              className={`account-button ${account ? "is-current" : ""}`}
              type="button"
              onClick={onOpenAccount}
              aria-expanded={account}
            >
              {user && profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar">
                  <UserRound size={17} />
                </span>
              )}
              <span className="account-button-copy">
                <strong>{user ? profile?.full_name?.split(" ")[0] || "הפרופיל שלי" : "האזור האישי"}</strong>
                <small>
                  <History size={11} /> {user ? "העבודות שלי" : "התחברות ושמירה"}
                </small>
              </span>
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

      <nav className="tabbar" aria-label="ניווט מהיר">
        <button type="button" className={home ? "is-current" : ""} onClick={() => go("home")}>
          <House size={20} /> בית
        </button>
        <button type="button" className={tool ? "is-current" : ""} onClick={() => setNavOpen(true)}>
          <LayoutGrid size={20} /> כלים
        </button>
        <button type="button" onClick={openPalette}>
          <Search size={20} /> חיפוש
        </button>
        <button type="button" className={me ? "is-current" : ""} onClick={() => go("me")}>
          <UserRound size={20} /> אישי
        </button>
      </nav>
    </div>
  );
}
