import {
  ArrowLeft,
  Calendar,
  Flame,
  LogIn,
  LogOut,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "../lib/auth";
import { balanceOf, creditsLabel } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";
import { monthCount, streak, topKind } from "../lib/me";
import { findTool } from "../lib/tools";
import { KIND_LABELS, KIND_TOOL, describeWork, listWorks, type SavedWork } from "../lib/works";
import { WorkThumb } from "./WorkThumb";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Opens a saved work in the tool that made it. */
  onOpenWork: (work: SavedWork) => void;
  /** Opens the full personal area page. */
  onOpenPage: () => void;
  /** Opens the admin area — given only to the account that owns the site. */
  onOpenAdmin?: (() => void) | null;
  /** Opens the credits page. */
  onOpenCredits?: () => void;
  onSignInError: (message: string) => void;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The short way into the personal area: who is signed in, what the last few
 * days added up to, the newest things saved, and the door to the full page.
 * It slides in over whatever tool is open so a recording can be reopened
 * without leaving the tool; everything heavier lives on the page itself.
 */
export function AccountDrawer({ open, onClose, onOpenWork, onOpenPage, onOpenAdmin, onOpenCredits, onSignInError }: Props) {
  const { user, profile, signOut, signInWithGoogle } = useAuth();
  const { rules, status: credits } = useCredits();
  const [works, setWorks] = useState<SavedWork[] | null>(null);
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const userId = user?.id ?? null;

  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  // The drawer declares `aria-modal`, so it has to behave like one: Escape
  // closes it, Tab stays inside it, and the button that opened it gets the
  // focus back.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = "";
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void listWorks(userId)
        .then((list) => {
          if (alive) setWorks(list);
        })
        .catch(() => {
          if (alive) setWorks([]);
        });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, userId]);

  const [now] = useState(() => new Date());
  const all = useMemo(() => works ?? [], [works]);
  const figures = useMemo(
    () => ({ streak: streak(all, now), month: monthCount(all, now), top: topKind(all) }),
    [all, now],
  );
  const recent = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? all.filter((work) => `${work.title} ${KIND_LABELS[work.kind]} ${describeWork(work)}`.toLowerCase().includes(needle))
      : all;
    return list.slice(0, 8);
  }, [all, query]);

  if (!open) return null;

  return (
    <div className="account-overlay" role="presentation" onMouseDown={close}>
      <aside
        ref={panelRef}
        className="account-drawer is-quick"
        role="dialog"
        aria-modal="true"
        aria-label="האזור האישי"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button account-drawer-close" type="button" onClick={close} aria-label="סגור">
          <X size={19} />
        </button>

        <header className="quick-head">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="me-avatar-placeholder is-small">
              <UserRound size={22} />
            </span>
          )}
          <div>
            <p className="me-eyebrow">
              <Sparkles size={14} /> האזור האישי
            </p>
            <h2>{user ? profile?.full_name || "החשבון שלי" : "מה שיצרת כאן"}</h2>
            <p className="me-subtitle">{user ? user.email : "בלי חשבון — נשמר במכשיר הזה בלבד"}</p>
          </div>
        </header>

        <div className="quick-figures">
          <div>
            <Flame size={15} />
            <b>{works ? figures.streak : "…"}</b>
            <span>ימים ברצף</span>
          </div>
          <div>
            <Calendar size={15} />
            <b>{works ? figures.month : "…"}</b>
            <span>החודש</span>
          </div>
          <div>
            <Trophy size={15} />
            <b>{figures.top ? KIND_LABELS[figures.top.kind] : "—"}</b>
            <span>הכלי המוביל</span>
          </div>
        </div>

        {onOpenCredits && rules.enabled && (
          <button type="button" className="quick-credits" onClick={onOpenCredits}>
            <span className="quick-credits-icon" aria-hidden="true">
              <Zap size={16} />
            </span>
            <span className="quick-item-text">
              <b>{credits ? creditsLabel(balanceOf(credits)) : user ? "הקרדיטים שלך" : `${rules.daily} קרדיטים חינם בכל יום`}</b>
              <small>{user ? "הקישור האישי והזמנת חברים" : "מתחברים ומקבלים, וחברים מביאים עוד"}</small>
            </span>
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
        )}

        <button type="button" className="primary-button compact quick-open" onClick={onOpenPage}>
          <ArrowLeft size={16} /> לאזור האישי המלא · {works ? all.length : "…"} פריטים
        </button>

        <label className="hub-search quick-search">
          <Search size={17} />
          <input
            type="search"
            value={query}
            placeholder="חיפוש מהיר במה ששמרת…"
            aria-label="חיפוש"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {works === null ? (
          <p className="empty-history">טוען…</p>
        ) : recent.length === 0 ? (
          <p className="empty-history">{all.length ? "אין התאמה." : "עדיין לא שמרת כלום. בכל כלי יש כפתור „שמור באזור האישי”."}</p>
        ) : (
          <ul className="quick-list">
            {recent.map((work) => {
              const tool = findTool(KIND_TOOL[work.kind]);
              return (
                <li key={work.id} style={{ "--accent-hue": tool?.hue ?? 292 } as CSSProperties}>
                  <button type="button" className="quick-item" onClick={() => onOpenWork(work)}>
                    <WorkThumb work={work} className="is-tiny" />
                    <span className="quick-item-text">
                      <b>{work.title}</b>
                      <small>
                        {KIND_LABELS[work.kind]}
                        {describeWork(work) ? ` · ${describeWork(work)}` : ""}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="quick-foot">
          {onOpenAdmin && (
            <button type="button" className="secondary-button" onClick={onOpenAdmin}>
              <ShieldCheck size={16} /> אזור ניהול
            </button>
          )}
          {user ? (
            <button className="secondary-button" type="button" onClick={() => void signOut()}>
              <LogOut size={16} /> יציאה מהחשבון
            </button>
          ) : (
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                void signInWithGoogle().catch(() =>
                  onSignInError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."),
                )
              }
            >
              <LogIn size={16} /> התחברות עם Google
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
