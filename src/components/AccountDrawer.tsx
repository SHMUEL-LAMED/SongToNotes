import {
  ArrowUpFromLine,
  Clock3,
  Cloud,
  CloudOff,
  Download,
  Ear,
  FolderOpen,
  HardDrive,
  History,
  LogIn,
  LogOut,
  Pause,
  Pencil,
  Play,
  Save,
  Search,
  Link2,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "../lib/auth";
import { canShareFiles, downloadFile, shareFile } from "../lib/export";
import { clearFiles, type StoredFileInfo } from "../lib/fileStore";
import { createShare } from "../lib/share";
import { findTool } from "../lib/tools";
import {
  KIND_LABELS,
  KIND_TOOL,
  WORK_KINDS,
  deleteWork,
  describeWork,
  downloadWorkFile,
  getWorkFile,
  listWorkFiles,
  listWorks,
  renameWork,
  workFileUrl,
  type SavedWork,
  type WorkKind,
} from "../lib/works";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Opens a saved work in the tool that made it. */
  onOpenWork: (work: SavedWork) => void;
  /** Opens the admin area — given only to the account that owns the site. */
  onOpenAdmin?: (() => void) | null;
  onSignInError: (message: string) => void;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

type Sort = "newest" | "oldest" | "title";

const dayFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "full" });
const timeFormat = new Intl.DateTimeFormat("he-IL", { timeStyle: "short" });
const sinceFormat = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "היום", "אתמול", or the date written out. */
function dayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ללא תאריך";
  const today = startOfDay(new Date());
  const day = startOfDay(date);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff === 0) return "היום";
  if (diff === 1) return "אתמול";
  return dayFormat.format(date);
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Groups a sorted list by the day each entry was made, keeping the order. */
function groupByDay(items: SavedWork[]) {
  const groups: { label: string; items: SavedWork[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/**
 * The personal area: everything the visitor saved in any tool, in one place,
 * sliding in from the side over whatever tool is open.
 *
 * It holds nine kinds of work with their own actions — play a karaoke track,
 * reopen a recording as sheet music, restart a metronome preset — and shows
 * how the ear training is going over time. Without an account it still lists
 * what this device made and says what signing in would add.
 */
export function AccountDrawer({ open, onClose, onOpenWork, onOpenAdmin, onSignInError }: Props) {
  const { user, profile, updateName, signOut, signInWithGoogle } = useAuth();

  const [works, setWorks] = useState<SavedWork[] | null>(null);
  const [files, setFiles] = useState<StoredFileInfo[]>([]);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WorkKind | "all">("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [canShare] = useState(() =>
    canShareFiles(new File([new Uint8Array(1)], "probe.wav", { type: "audio/wav" })),
  );
  const reloadRef = useRef(0);

  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Held in a ref so the trap below depends only on whether the drawer is
  // open. Keying it on the callback would re-arm — and so re-steal the focus —
  // on every render of the page around it.
  // Closing the drawer stops whatever was playing in it and puts the search
  // and the filters back, so the next opening shows everything again.
  const close = useCallback(() => {
    setPlaying(null);
    setEditing(null);
    setQuery("");
    setKind("all");
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

  const name = nameDraft ?? profile?.full_name ?? "";
  const userId = user?.id ?? null;

  const load = useCallback(() => {
    const token = (reloadRef.current += 1);
    setFailed(false);
    void Promise.all([
      listWorks(userId).catch(() => {
        setFailed(true);
        return null;
      }),
      listWorkFiles(),
    ]).then(([nextWorks, nextFiles]) => {
      if (token !== reloadRef.current) return;
      setFiles(nextFiles);
      setWorks(nextWorks ?? []);
    });
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    // The lists are fetched after the first paint, so the drawer slides in
    // at once and the history fills in.
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);


  // An object URL is revoked when the player closes or the page unmounts;
  // a signed cloud URL simply expires.
  useEffect(() => {
    if (!playing || !playing.url.startsWith("blob:")) return;
    const { url } = playing;
    return () => URL.revokeObjectURL(url);
  }, [playing]);

  const fileIds = useMemo(() => new Set(files.map((item) => item.id)), [files]);
  const fileBytes = useMemo(() => files.reduce((sum, item) => sum + item.size, 0), [files]);
  const cloud = useMemo(() => {
    const inCloud = (works ?? []).filter((item) => item.filePath);
    return {
      count: inCloud.length,
      bytes: inCloud.reduce((sum, item) => sum + Number(item.summary.fileBytes ?? 0), 0),
    };
  }, [works]);

  const counts = useMemo(() => {
    const table = Object.fromEntries(WORK_KINDS.map((item) => [item, 0])) as Record<WorkKind, number>;
    for (const item of works ?? []) table[item.kind] += 1;
    return table;
  }, [works]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (works ?? []).filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      if (!needle) return true;
      return [item.title, item.sourceName ?? "", KIND_LABELS[item.kind], describeWork(item)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    if (sort === "title") return list.sort((a, b) => a.title.localeCompare(b.title, "he"));
    if (sort === "oldest") return list.reverse();
    return list;
  }, [kind, query, sort, works]);

  const groups = useMemo(() => groupByDay(visible), [visible]);

  const earSessions = useMemo(
    () =>
      (works ?? [])
        .filter((item) => item.kind === "ear")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [works],
  );
  const earSummary = useMemo(() => {
    if (!earSessions.length) return null;
    const asked = earSessions.reduce((sum, item) => sum + Number(item.summary.asked ?? 0), 0);
    const correct = earSessions.reduce((sum, item) => sum + Number(item.summary.correct ?? 0), 0);
    const best = earSessions.reduce((top, item) => Math.max(top, Number(item.summary.best ?? 0)), 0);
    return { asked, correct, best, accuracy: asked ? Math.round((correct / asked) * 100) : 0 };
  }, [earSessions]);

  const unsynced = useMemo(() => (works ?? []).filter((item) => item.localOnly).length, [works]);

  // ---- actions ----

  /**
   * The work's file: the device copy when there is one, otherwise the copy
   * in the cloud. Either way the caller gets a File it can play, save or
   * hand to another app.
   */
  const withFile = async (work: SavedWork, action: (file: File) => void | Promise<void>) => {
    const local = await getWorkFile(work.id);
    if (local) {
      await action(local);
      return;
    }
    setFiles((current) => current.filter((item) => item.id !== work.id));
    if (!work.filePath) {
      setMessage("הקובץ לא נמצא במכשיר הזה ולא בענן.");
      return;
    }
    try {
      setMessage("מוריד מהענן…");
      const file = await downloadWorkFile(work.filePath, work.fileName ?? `${work.title}.wav`);
      setMessage(null);
      await action(file);
    } catch {
      setMessage("לא הצלחנו להביא את הקובץ מהענן. נסה שוב.");
    }
  };

  const togglePlay = (work: SavedWork) => {
    if (playing?.id === work.id) {
      setPlaying(null);
      return;
    }
    void (async () => {
      const local = await getWorkFile(work.id);
      if (local) {
        setPlaying({ id: work.id, url: URL.createObjectURL(local) });
        return;
      }
      if (!work.filePath) {
        setMessage("הקובץ לא נמצא במכשיר הזה ולא בענן.");
        return;
      }
      // Streamed straight from the cloud: no wait for a full download before
      // the first note.
      try {
        setPlaying({ id: work.id, url: await workFileUrl(work.filePath) });
      } catch {
        setMessage("לא הצלחנו לנגן מהענן. נסה שוב.");
      }
    })();
  };

  const download = (work: SavedWork) =>
    void withFile(work, (file) => downloadFile(file, file.name, file.type || "audio/wav"));

  /** A public link, copied to the clipboard. */
  const link = (work: SavedWork) => {
    void (async () => {
      try {
        setMessage("יוצר קישור…");
        const url = await createShare(work);
        try {
          await navigator.clipboard.writeText(url);
          setMessage(`הקישור הועתק: ${url}`);
        } catch {
          setMessage(`הקישור לשיתוף: ${url}`);
        }
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : "יצירת הקישור נכשלה.");
      }
    })();
  };

  const share = (work: SavedWork) =>
    void withFile(work, async (file) => {
      const outcome = await shareFile(file, work.title);
      if (outcome === "failed") setMessage("השיתוף נכשל. אפשר להוריד את הקובץ במקום.");
    });

  const remove = (work: SavedWork) => {
    if (!window.confirm(`למחוק את „${work.title}” מהאזור האישי?`)) return;
    if (playing?.id === work.id) setPlaying(null);
    void deleteWork(work, userId)
      .then(() => {
        setWorks((current) => (current ?? []).filter((item) => item.id !== work.id));
        setFiles((current) => current.filter((item) => item.id !== work.id));
      })
      .catch(() => setMessage("לא הצלחנו למחוק. נסה שוב."));
  };

  const commitRename = () => {
    if (!editing) return;
    const target = (works ?? []).find((item) => item.id === editing.id);
    const title = editing.title.trim();
    setEditing(null);
    if (!target || !title || title === target.title) return;
    void renameWork(target, title, userId)
      .then((updated) =>
        setWorks((current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item))),
      )
      .catch(() => setMessage("לא הצלחנו לשנות את השם."));
  };

  const exportAll = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      account: user?.email ?? null,
      works: (works ?? []).map((work) => ({
        id: work.id,
        kind: work.kind,
        title: work.title,
        sourceName: work.sourceName,
        summary: work.summary,
        payload: work.payload,
        fileName: work.fileName,
        createdAt: work.createdAt,
        updatedAt: work.updatedAt,
      })),
    };
    downloadFile(JSON.stringify(data, null, 2), "music-tools-export.json", "application/json");
  };

  const clearDevice = () => {
    if (
      !window.confirm(
        `למחוק ${files.length} עותקים מקומיים (${formatBytes(fileBytes)}) מהמכשיר הזה? הרשומות והקבצים שבענן יישארו.`,
      )
    ) {
      return;
    }
    setPlaying(null);
    void clearFiles().then(() => setFiles([]));
  };

  const memberSince = user?.created_at ? sinceFormat.format(new Date(user.created_at)) : null;

  if (!open) return null;

  return (
    <div className="account-overlay" role="presentation" onMouseDown={close}>
      <aside
        ref={panelRef}
        className="account-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="האזור האישי"
        onMouseDown={(event) => event.stopPropagation()}
      >
      <button className="icon-button account-drawer-close" type="button" onClick={close} aria-label="סגור">
        <X size={19} />
      </button>
      <section className="me-page">
      {/* ---- who ---- */}
      <header className="me-hero">
        <div className="me-identity">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="me-avatar-placeholder">
              <UserRound size={30} />
            </span>
          )}
          <div>
            <p className="me-eyebrow">
              <History size={15} /> האזור האישי
            </p>
            <h1>{user ? profile?.full_name || "החשבון שלי" : "מה שיצרת כאן"}</h1>
            <p className="me-subtitle">
              {user
                ? [user.email, memberSince ? `חבר מאז ${memberSince}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : "כל כלי באתר יכול לשמור את מה שעשית. בלי חשבון זה נשמר במכשיר הזה; עם חשבון — בכל מכשיר."}
            </p>
          </div>
        </div>
        {user ? (
          <button className="secondary-button me-signout" type="button" onClick={() => void signOut()}>
            <LogOut size={16} /> יציאה מהחשבון
          </button>
        ) : (
          <button
            className="primary-button compact"
            type="button"
            onClick={() =>
              void signInWithGoogle().catch(() =>
                onSignInError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."),
              )
            }
          >
            <LogIn size={17} /> התחברות עם Google
          </button>
        )}
      </header>

      <div className="stats-grid me-stats">
        <div className="stat-card">
          <strong>{works ? works.length : "…"}</strong>
          <span>פריטים שמורים</span>
        </div>
        <div className="stat-card">
          <strong>{works ? counts.notes + counts.piano : "…"}</strong>
          <span>תווים והקלטות</span>
        </div>
        <div className="stat-card">
          <strong>{works ? counts.ringtone + counts.vocals + counts.speed : "…"}</strong>
          <span>קבצי שמע שנוצרו</span>
        </div>
        <div className="stat-card">
          <strong>{works ? cloud.count : "…"}</strong>
          <span>
            <Cloud size={13} /> קבצים בענן
          </span>
          {cloud.count > 0 && <small>{formatBytes(cloud.bytes)}</small>}
        </div>
        <div className="stat-card">
          <strong>{earSummary ? `${earSummary.accuracy}%` : "—"}</strong>
          <span>
            <Ear size={13} /> דיוק שמיעה
          </span>
          {earSummary && <small>{earSessions.length} אימונים</small>}
        </div>
      </div>

      {unsynced > 0 && (
        <div className="notice-message" role="status">
          {user
            ? `${unsynced} פריטים עדיין לא עלו לפרופיל. הם יעלו בביקור הבא כשיהיה חיבור.`
            : `${unsynced} פריטים נשמרו במכשיר הזה בלבד. התחבר כדי שיעלו לפרופיל ויופיעו בכל מכשיר.`}
        </div>
      )}

      <div className="me-columns">
        <div className="me-main">
          {/* ---- find ---- */}
          <div className="me-toolbar">
            <label className="hub-search me-search">
              <Search size={18} />
              <input
                type="search"
                placeholder="חיפוש לפי שם, קובץ או כלי…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="חיפוש בפריטים השמורים"
              />
            </label>
            <label className="me-sort">
              <span>מיון</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="newest">מהחדש לישן</option>
                <option value="oldest">מהישן לחדש</option>
                <option value="title">לפי שם</option>
              </select>
            </label>
          </div>
          <div className="me-kinds" role="group" aria-label="סינון לפי כלי">
            <button
              type="button"
              className={`chip-toggle ${kind === "all" ? "active" : ""}`}
              aria-pressed={kind === "all"}
              onClick={() => setKind("all")}
            >
              הכול <b>{works?.length ?? 0}</b>
            </button>
            {WORK_KINDS.filter((item) => counts[item] > 0).map((item) => {
              const tool = findTool(KIND_TOOL[item]);
              const Icon = tool?.icon;
              return (
                <button
                  key={item}
                  type="button"
                  className={`chip-toggle ${kind === item ? "active" : ""}`}
                  aria-pressed={kind === item}
                  onClick={() => setKind(item)}
                  style={{ "--accent-hue": tool?.hue ?? 258 } as CSSProperties}
                >
                  {Icon && <Icon size={14} />}
                  {KIND_LABELS[item]} <b>{counts[item]}</b>
                </button>
              );
            })}
          </div>

          {/* ---- the works ---- */}
          {works === null ? (
            <p className="empty-history">טוען את מה ששמרת…</p>
          ) : failed && works.length === 0 ? (
            <div className="error-message" role="alert">
              לא הצלחנו לטעון את ההיסטוריה מהפרופיל.{" "}
              <button type="button" className="link-button" onClick={load}>
                נסה שוב
              </button>
            </div>
          ) : works.length === 0 ? (
            <div className="me-empty">
              <span className="tool-intro-icon">
                <Sparkles size={24} />
              </span>
              <strong>עדיין לא שמרת כלום.</strong>
              <p>
                בכל כלי יש כפתור „שמור באזור האישי”. תווים שמנתחים וצלצולים שמורידים נשמרים
                מעצמם.
              </p>
              <button className="secondary-button" type="button" onClick={close}>
                <FolderOpen size={16} /> חזרה לכלים
              </button>
            </div>
          ) : visible.length === 0 ? (
            <p className="empty-history">אין פריטים שמתאימים לחיפוש הזה.</p>
          ) : (
            groups.map((group) => (
              <section className="me-day" key={group.label} aria-label={group.label}>
                <h2>
                  <Clock3 size={15} /> {group.label}
                  <span>{group.items.length}</span>
                </h2>
                <ul className="me-list">
                  {group.items.map((work) => {
                    const tool = findTool(KIND_TOOL[work.kind]);
                    const Icon = tool?.icon ?? Smartphone;
                    const onDevice = fileIds.has(work.id);
                    const inCloud = Boolean(work.filePath);
                    const hasFile = onDevice || inCloud;
                    const tooLarge = Boolean(work.summary.fileTooLarge);
                    // A file made here that has not gone up yet, and can.
                    const waitingForCloud =
                      onDevice && !inCloud && !tooLarge && Boolean(user);
                    const isEditing = editing?.id === work.id;
                    const isPlaying = playing?.id === work.id;
                    return (
                      <li
                        key={work.id}
                        className={`me-item ${isPlaying ? "is-playing" : ""}`}
                        style={{ "--accent-hue": tool?.hue ?? 258 } as CSSProperties}
                      >
                        <button
                          type="button"
                          className="me-item-open"
                          onClick={() => onOpenWork(work)}
                          aria-label={`פתח את ${work.title} ב${tool?.title ?? "כלי"}`}
                        >
                          <span className="me-item-icon">
                            <Icon size={20} />
                          </span>
                        </button>
                        <div className="me-item-body">
                          {isEditing ? (
                            <form
                              className="me-rename"
                              onSubmit={(event) => {
                                event.preventDefault();
                                commitRename();
                              }}
                            >
                              <input
                                autoFocus
                                value={editing.title}
                                maxLength={120}
                                aria-label="שם חדש"
                                onChange={(event) =>
                                  setEditing({ id: work.id, title: event.target.value })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") setEditing(null);
                                }}
                              />
                              <button type="submit" className="icon-button" aria-label="שמור שם">
                                <Save size={16} />
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="בטל"
                                onClick={() => setEditing(null)}
                              >
                                <X size={16} />
                              </button>
                            </form>
                          ) : (
                            <button
                              type="button"
                              className="me-item-title"
                              onClick={() => onOpenWork(work)}
                            >
                              {work.title}
                            </button>
                          )}
                          <p className="me-item-meta">
                            <span className="me-kind">{KIND_LABELS[work.kind]}</span>
                            {describeWork(work) && <span>{describeWork(work)}</span>}
                            {work.sourceName && work.sourceName !== work.title && (
                              <span className="me-source">{work.sourceName}</span>
                            )}
                            <span>{timeLabel(work.createdAt)}</span>
                          </p>
                          <p className="me-item-badges">
                            {inCloud && (
                              <span className="me-badge is-cloud">
                                <Cloud size={12} /> הקובץ בענן
                              </span>
                            )}
                            {onDevice && (
                              <span className="me-badge is-file">
                                <HardDrive size={12} /> עותק במכשיר הזה
                              </span>
                            )}
                            {waitingForCloud && (
                              <span className="me-badge is-local">
                                <ArrowUpFromLine size={12} /> הקובץ טרם עלה לענן
                              </span>
                            )}
                            {tooLarge && (
                              <span className="me-badge is-local">
                                <CloudOff size={12} /> גדול מדי לענן — במכשיר הזה בלבד
                              </span>
                            )}
                            {!hasFile && work.fileName && !tooLarge && (
                              <span className="me-badge">
                                <Smartphone size={12} /> הקובץ נשאר במכשיר שיצר אותו
                              </span>
                            )}
                            {work.localOnly && (
                              <span className="me-badge is-local">
                                <ArrowUpFromLine size={12} /> טרם עלה לפרופיל
                              </span>
                            )}
                          </p>
                          {isPlaying && playing && (
                            <audio
                              className="me-player"
                              controls
                              autoPlay
                              src={playing.url}
                              onEnded={() => setPlaying(null)}
                            />
                          )}
                        </div>
                        <div className="me-item-actions">
                          {hasFile && (
                            <>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={isPlaying ? "עצור" : "נגן"}
                                aria-pressed={isPlaying}
                                onClick={() => togglePlay(work)}
                              >
                                {isPlaying ? <Pause size={17} /> : <Play size={17} />}
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label="הורד את הקובץ"
                                onClick={() => download(work)}
                              >
                                <Download size={17} />
                              </button>
                              {canShare && (
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label="שתף את הקובץ"
                                  onClick={() => share(work)}
                                >
                                  <Share2 size={17} />
                                </button>
                              )}
                            </>
                          )}
                          {userId && !work.localOnly && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="קישור ציבורי לשיתוף"
                              title="קישור ציבורי"
                              onClick={() => link(work)}
                            >
                              <Link2 size={17} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="שנה שם"
                            onClick={() => setEditing({ id: work.id, title: work.title })}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            type="button"
                            className="icon-button is-danger"
                            aria-label={`מחק את ${work.title}`}
                            onClick={() => remove(work)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        {/* ---- the side ---- */}
        <aside className="me-side">
          {/* Only the owner's account is given this, and the server checks
              the address again on every request the area makes. */}
          {onOpenAdmin && (
            <section className="me-card me-admin-card">
              <h3>
                <ShieldCheck size={17} /> אזור ניהול
              </h3>
              <p className="me-card-note">
                כל האתר במקום אחד: חשבונות, מה שנשמר בכל הכלים, המכסות היומיות, הקישורים
                הציבוריים והמפתחות של השרת.
              </p>
              <button type="button" className="primary-button compact" onClick={onOpenAdmin}>
                <ShieldCheck size={16} /> כניסה לאזור הניהול
              </button>
            </section>
          )}

          {user && (
            <section className="me-card">
              <h3>
                <UserRound size={17} /> השם שיוצג באתר
              </h3>
              <div className="me-name-field">
                <input
                  value={name}
                  maxLength={80}
                  aria-label="שם תצוגה"
                  onChange={(event) => setNameDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!name.trim() || name.trim() === profile?.full_name}
                  onClick={() => {
                    setMessage(null);
                    void updateName(name)
                      .then(() => {
                        setNameDraft(null);
                        setMessage("השם נשמר.");
                      })
                      .catch(() => setMessage("לא הצלחנו לשמור את השם."));
                  }}
                >
                  <Save size={15} /> שמור
                </button>
              </div>
            </section>
          )}

          <section className="me-card">
            <h3>
              <Ear size={17} /> התקדמות בשמיעה
            </h3>
            {earSummary ? (
              <>
                <div className="me-ear-totals">
                  <div>
                    <strong>{earSummary.accuracy}%</strong>
                    <span>דיוק כולל</span>
                  </div>
                  <div>
                    <strong>{earSummary.asked}</strong>
                    <span>שאלות</span>
                  </div>
                  <div>
                    <strong>{earSummary.best}</strong>
                    <span>שיא רצף</span>
                  </div>
                </div>
                <div
                  className="me-ear-chart"
                  role="img"
                  aria-label={`דיוק ב־${Math.min(12, earSessions.length)} האימונים האחרונים`}
                >
                  {earSessions.slice(-12).map((session) => {
                    const accuracy = Number(session.summary.accuracy ?? 0);
                    return (
                      <span
                        key={session.id}
                        className="me-ear-bar"
                        title={`${session.title}: ${accuracy}% (${session.summary.correct}/${session.summary.asked})`}
                        style={{ "--value": `${Math.max(4, accuracy)}%` } as CSSProperties}
                      >
                        <i />
                      </span>
                    );
                  })}
                </div>
                <p className="me-card-note">כל אימון ששמרת במאמן השמיעה מופיע כאן כעמודה.</p>
              </>
            ) : (
              <p className="me-card-note">
                עדיין אין אימונים שמורים. במאמן השמיעה יש כפתור „שמור את האימון” אחרי כל
                סבב.
              </p>
            )}
          </section>

          <section className="me-card">
            <h3>
              <Cloud size={17} /> הקבצים שלך
            </h3>
            <p className="me-card-note">
              {user
                ? `הקבצים שהכלים מפיקים — קריוקי, גרסאות לתרגול, צלצולים — עולים לתיקייה פרטית שלך בענן (עד 60MB לקובץ) וזמינים מכל מכשיר. בענן: ${cloud.count} קבצים (${formatBytes(cloud.bytes)}). `
                : "הקבצים שהכלים מפיקים נשמרים במכשיר הזה; אחרי התחברות הם עולים לתיקייה פרטית שלך בענן וזמינים מכל מכשיר. "}
              עותק מקומי במכשיר הזה: {files.length} קבצים ({formatBytes(fileBytes)}).
            </p>
            <div className="me-card-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={files.length === 0}
                onClick={clearDevice}
              >
                <Trash2 size={15} /> נקה עותקים מקומיים
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!works || works.length === 0}
                onClick={exportAll}
              >
                <Download size={15} /> ייצוא הרשימה (JSON)
              </button>
            </div>
          </section>
        </aside>
      </div>

      {message && (
        <p className="account-message me-message" role="status">
          {message}
          <button type="button" className="link-button" onClick={() => setMessage(null)}>
            סגור
          </button>
        </p>
      )}
      </section>
      </aside>
    </div>
  );
}
