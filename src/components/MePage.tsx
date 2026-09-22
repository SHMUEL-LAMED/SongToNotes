import {
  Archive,
  ArrowRight,
  ArrowUpFromLine,
  Calendar,
  CheckSquare,
  Clock,
  Cloud,
  CloudOff,
  Copy,
  Download,
  Ear,
  Eye,
  FileJson,
  Flame,
  FolderArchive,
  HardDrive,
  Image,
  LayoutGrid,
  Link2,
  List,
  LogIn,
  LogOut,
  Maximize2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Tag,
  Trash2,
  Trophy,
  UserRound,
  UserX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { deleteAccount, exportAccount } from "../lib/account";
import { dayRange, formatBytes, formatNumber, timeAgo } from "../lib/admin";
import { analyticsEnabled, setAnalyticsEnabled } from "../lib/analytics";
import { useAuth } from "../lib/auth";
import { canShareFiles, downloadFile, shareFile } from "../lib/export";
import { clearFiles, type StoredFileInfo } from "../lib/fileStore";
import {
  allTags,
  isStarred,
  loadMarks,
  saveMarks,
  tagsOf,
  withStar,
  withTags,
  type Marks,
} from "../lib/marks";
import {
  activityByDay,
  exportName,
  expiryLabel,
  filterWorks,
  monthCount,
  personalHeatmap,
  storageByKind,
  streak,
  topKind,
  type WorkSort,
} from "../lib/me";
import { createShare, listShares, revokeShare, setShareExpiry, shareLink, type MyShare } from "../lib/share";
import { findTool } from "../lib/tools";
import { clearTrash, listTrash, pushToTrash, removeFromTrash, TRASH_DAYS, type TrashEntry } from "../lib/trash";
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
  restoreWork,
  workFileUrl,
  type SavedWork,
  type WorkKind,
} from "../lib/works";
import { zipBlob } from "../lib/zip";
import { BarList, ConfirmButton, Meter, StatTile, TimeChart, WeekHeatmap } from "./Charts";
import { WorkThumb } from "./WorkThumb";

/**
 * The personal area as a page of its own: everything this person made on the
 * site, as a gallery they can search, star, tag and clear out; what it adds
 * up to over time; the files it weighs; the links they made public; and the
 * two things a person is owed about their own data — a copy of all of it and
 * the power to delete it.
 *
 * Without an account it still shows what this device saved, and says what
 * signing in would add. The drawer in the top bar is the short way in; this
 * is the whole thing.
 */

type Tab = "gallery" | "insights" | "files" | "links" | "privacy";

const TABS: { id: Tab; label: string; icon: typeof Star }[] = [
  { id: "gallery", label: "הגלריה", icon: LayoutGrid },
  { id: "insights", label: "תובנות", icon: Flame },
  { id: "files", label: "קבצים", icon: HardDrive },
  { id: "links", label: "הקישורים שלי", icon: Link2 },
  { id: "privacy", label: "פרטיות ונתונים", icon: ShieldCheck },
];

const sinceFormat = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
const dateFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" });

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

type Props = {
  onOpenWork: (work: SavedWork) => void;
  onOpenAdmin?: (() => void) | null;
  onHome: () => void;
  onSignInError: (message: string) => void;
  /** Where the page opens when it is reached from a link: `#/me/links`. */
  initialTab?: string | null;
};

function isTab(value: string | null | undefined): value is Tab {
  return TABS.some((tab) => tab.id === value);
}

function Card({
  title,
  icon,
  hint,
  actions,
  children,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`me-panel ${className}`}>
      <header className="me-panel-head">
        <div>
          <h2>
            {icon}
            {title}
          </h2>
          {hint && <p>{hint}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function MePage({ onOpenWork, onOpenAdmin, onHome, onSignInError, initialTab }: Props) {
  const { user, profile, updateName, signOut, signInWithGoogle } = useAuth();
  const userId = user?.id ?? null;

  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "gallery");
  const [works, setWorks] = useState<SavedWork[] | null>(null);
  const [files, setFiles] = useState<StoredFileInfo[]>([]);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [marks, setMarks] = useState<Marks>(() => loadMarks());
  const [trash, setTrash] = useState<TrashEntry[]>(() => listTrash());

  // The gallery's own state.
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WorkKind | "all">("all");
  const [tag, setTag] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [sort, setSort] = useState<WorkSort>("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<SavedWork | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [tagging, setTagging] = useState<{ id: string; text: string } | null>(null);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [shares, setShares] = useState<MyShare[] | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [tracking, setTracking] = useState(() => analyticsEnabled());
  const [deleteWord, setDeleteWord] = useState("");
  const [canShare] = useState(() =>
    canShareFiles(new File([new Uint8Array(1)], "probe.wav", { type: "audio/wav" })),
  );
  const reloadRef = useRef(0);

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
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (tab !== "links" || !userId) return;
    const timer = window.setTimeout(() => {
      void listShares()
        .then(setShares)
        .catch(() => setShares([]));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab, userId]);

  useEffect(() => {
    if (!playing || !playing.url.startsWith("blob:")) return;
    const { url } = playing;
    return () => URL.revokeObjectURL(url);
  }, [playing]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const setMarksAndSave = (next: Marks) => {
    setMarks(next);
    saveMarks(next);
  };

  /* ---------------------------------------------------------- readings */

  const all = useMemo(() => works ?? [], [works]);
  const fileIds = useMemo(() => new Set(files.map((item) => item.id)), [files]);
  const fileBytes = useMemo(() => files.reduce((sum, item) => sum + item.size, 0), [files]);
  const cloud = useMemo(() => {
    const inCloud = all.filter((item) => item.filePath);
    return {
      count: inCloud.length,
      bytes: inCloud.reduce((sum, item) => sum + Number(item.summary.fileBytes ?? 0), 0),
    };
  }, [all]);
  const counts = useMemo(() => {
    const table = Object.fromEntries(WORK_KINDS.map((item) => [item, 0])) as Record<WorkKind, number>;
    for (const item of all) table[item.kind] += 1;
    return table;
  }, [all]);
  const tags = useMemo(() => allTags(marks), [marks]);
  const starredCount = useMemo(() => all.filter((item) => isStarred(marks, item.id)).length, [all, marks]);

  const visible = useMemo(
    () => filterWorks(all, { query, kind, tag, starred: starredOnly }, marks, describeWork, sort),
    [all, kind, marks, query, sort, starredOnly, tag],
  );

  // Time is read once per load so the insights do not drift while the page
  // sits open, and so the memos below stay pure.
  const [now] = useState(() => new Date());
  const days = useMemo(() => dayRange(30, now), [now]);
  const activity = useMemo(() => activityByDay(all, days), [all, days]);
  const heat = useMemo(() => personalHeatmap(all), [all]);
  const currentStreak = useMemo(() => streak(all, now), [all, now]);
  const thisMonth = useMemo(() => monthCount(all, now), [all, now]);
  const top = useMemo(() => topKind(all), [all]);
  const storage = useMemo(() => storageByKind(all, files), [all, files]);
  const earSummary = useMemo(() => {
    const sessions = all.filter((item) => item.kind === "ear");
    if (!sessions.length) return null;
    const asked = sessions.reduce((sum, item) => sum + Number(item.summary.asked ?? 0), 0);
    const correct = sessions.reduce((sum, item) => sum + Number(item.summary.correct ?? 0), 0);
    return { sessions: sessions.length, accuracy: asked ? Math.round((correct / asked) * 100) : 0 };
  }, [all]);
  const unsynced = useMemo(() => all.filter((item) => item.localOnly).length, [all]);

  /* ----------------------------------------------------------- actions */

  const withFile = async (work: SavedWork, action: (file: File) => void | Promise<void>) => {
    const local = await getWorkFile(work.id);
    if (local) {
      await action(local);
      return;
    }
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
      try {
        setPlaying({ id: work.id, url: await workFileUrl(work.filePath) });
      } catch {
        setMessage("לא הצלחנו לנגן מהענן. נסה שוב.");
      }
    })();
  };

  const download = (work: SavedWork) =>
    void withFile(work, (file) => downloadFile(file, file.name, file.type || "audio/wav"));

  const share = (work: SavedWork) =>
    void withFile(work, async (file) => {
      const outcome = await shareFile(file, work.title);
      if (outcome === "failed") setMessage("השיתוף נכשל. אפשר להוריד את הקובץ במקום.");
    });

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
        setShares(null);
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : "יצירת הקישור נכשלה.");
      }
    })();
  };

  /** Into the recycle bin first; the account row goes at once. */
  const remove = async (work: SavedWork) => {
    if (playing?.id === work.id) setPlaying(null);
    if (preview?.id === work.id) setPreview(null);
    setTrash(pushToTrash(work));
    try {
      await deleteWork(work, userId);
      setWorks((current) => (current ?? []).filter((item) => item.id !== work.id));
      setFiles((current) => current.filter((item) => item.id !== work.id));
    } catch {
      setTrash(removeFromTrash(work.id));
      setMessage("לא הצלחנו למחוק. נסה שוב.");
    }
  };

  const removeMany = async (ids: string[]) => {
    setBusy("מוחק…");
    for (const id of ids) {
      const work = all.find((item) => item.id === id);
      if (work) await remove(work);
    }
    setBusy(null);
    setSelected(new Set());
    setSelecting(false);
    setMessage(`${ids.length} פריטים עברו לסל המיחזור ל־${TRASH_DAYS} ימים.`);
  };

  const restore = async (entry: TrashEntry) => {
    try {
      const restored = await restoreWork(entry.work, userId);
      setTrash(removeFromTrash(entry.work.id));
      setWorks((current) => [restored, ...(current ?? []).filter((item) => item.id !== restored.id)]);
      setMessage(`„${restored.title}” חזר לגלריה. הקובץ עצמו לא נשמר בסל.`);
    } catch {
      setMessage("לא הצלחנו לשחזר. נסה שוב.");
    }
  };

  const commitRename = () => {
    if (!editing) return;
    const target = all.find((item) => item.id === editing.id);
    const title = editing.title.trim();
    setEditing(null);
    if (!target || !title || title === target.title) return;
    void renameWork(target, title, userId)
      .then((updated) =>
        setWorks((current) => (current ?? []).map((item) => (item.id === updated.id ? updated : item))),
      )
      .catch(() => setMessage("לא הצלחנו לשנות את השם."));
  };

  const commitTags = () => {
    if (!tagging) return;
    const next = tagging.text.split(/[,،\n]+/).map((item) => item.trim()).filter(Boolean);
    setMarksAndSave(withTags(marks, tagging.id, next));
    setTagging(null);
  };

  /** Everything, with its files, as one ZIP. */
  const exportZip = async (chosen: SavedWork[] = all) => {
    if (!chosen.length) return;
    setBusy(`אורז ${chosen.length} פריטים…`);
    try {
      const entries: { name: string; data: Uint8Array; date?: Date }[] = [];
      const index = chosen.map((work) => ({
        id: work.id,
        kind: work.kind,
        title: work.title,
        sourceName: work.sourceName,
        summary: work.summary,
        payload: work.payload,
        fileName: work.fileName,
        createdAt: work.createdAt,
        tags: tagsOf(marks, work.id),
        starred: isStarred(marks, work.id),
      }));
      entries.push({
        name: "works.json",
        data: new TextEncoder().encode(JSON.stringify(index, null, 2)),
      });
      for (const work of chosen) {
        let file = await getWorkFile(work.id);
        if (!file && work.filePath) {
          file = await downloadWorkFile(work.filePath, work.fileName ?? `${work.title}.wav`).catch(() => null);
        }
        if (!file) continue;
        entries.push({
          name: exportName(work, file.name),
          data: new Uint8Array(await file.arrayBuffer()),
          date: new Date(work.createdAt),
        });
      }
      downloadFile(await zipBlob(entries).arrayBuffer(), "music-tools.zip", "application/zip");
      setMessage(`הורדו ${entries.length - 1} קבצים ורשימה אחת בתוך ZIP.`);
    } catch {
      setMessage("האריזה נכשלה. נסה שוב.");
    } finally {
      setBusy(null);
    }
  };

  const exportEverything = async () => {
    setBusy("אוסף את כל המידע…");
    try {
      const data = await exportAccount();
      downloadFile(JSON.stringify(data, null, 2), "my-account.json", "application/json");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "הייצוא נכשל.");
    } finally {
      setBusy(null);
    }
  };

  const eraseAccount = async () => {
    setBusy("מוחק את החשבון…");
    try {
      await deleteAccount();
      await signOut();
      onHome();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "המחיקה נכשלה.");
      setBusy(null);
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const memberSince = user?.created_at ? sinceFormat.format(new Date(user.created_at)) : null;
  const name = nameDraft ?? profile?.full_name ?? "";
  const chosenWorks = all.filter((item) => selected.has(item.id));

  /* ---------------------------------------------------------- the page */

  return (
    <div className="me-full" style={{ "--accent-hue": 262 } as CSSProperties}>
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
              <Sparkles size={15} /> האזור האישי
            </p>
            <h1>{user ? profile?.full_name || "החשבון שלי" : "מה שיצרת כאן"}</h1>
            <p className="me-subtitle">
              {user
                ? [user.email, memberSince ? `חבר מאז ${memberSince}` : null].filter(Boolean).join(" · ")
                : "בלי חשבון זה נשמר במכשיר הזה; עם חשבון — בכל מכשיר, עם הקבצים."}
            </p>
          </div>
        </div>
        <div className="me-hero-actions">
          <button type="button" className="secondary-button" onClick={onHome}>
            <ArrowRight size={16} /> לכלים
          </button>
          {user ? (
            <button className="secondary-button" type="button" onClick={() => void signOut()}>
              <LogOut size={16} /> יציאה
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
        </div>
      </header>

      <div className="admin-tiles me-tiles">
        <StatTile label="פריטים שמורים" value={works ? formatNumber(all.length) : "…"} icon={<Archive size={16} />} note={starredCount ? `${starredCount} מסומנים בכוכב` : undefined} />
        <StatTile label="רצף ימים" value={works ? String(currentStreak) : "…"} icon={<Flame size={16} />} note={currentStreak ? "ימים ברצף עם משהו שנשמר" : "שמור משהו היום כדי להתחיל"} hue={currentStreak ? 24 : 262} />
        <StatTile label="החודש" value={works ? String(thisMonth) : "…"} icon={<Calendar size={16} />} note="פריטים שנשמרו החודש" />
        <StatTile
          label="הכלי המוביל"
          value={top ? KIND_LABELS[top.kind] : "—"}
          icon={<Trophy size={16} />}
          note={top ? `${top.count} פריטים` : "עדיין אין"}
          hue={top ? findTool(KIND_TOOL[top.kind])?.hue : undefined}
        />
      </div>

      {unsynced > 0 && (
        <p className="notice-message admin-message" role="status">
          {user
            ? `${unsynced} פריטים עדיין לא עלו לפרופיל. הם יעלו בביקור הבא כשיהיה חיבור.`
            : `${unsynced} פריטים נשמרו במכשיר הזה בלבד. התחבר כדי שיעלו לפרופיל ויופיעו בכל מכשיר.`}
        </p>
      )}
      {failed && (
        <p className="error-message admin-message" role="alert">
          לא הצלחנו לטעון את ההיסטוריה מהפרופיל.{" "}
          <button type="button" className="link-button" onClick={load}>
            נסה שוב
          </button>
        </p>
      )}
      {message && (
        <p className="notice-message admin-message" role="status">
          {message}
          <button type="button" className="link-button" onClick={() => setMessage(null)}>
            סגור
          </button>
        </p>
      )}
      {busy && (
        <p className="notice-message admin-message" role="status">
          {busy}
        </p>
      )}

      <nav className="admin-tabs" role="tablist" aria-label="חלקי האזור האישי">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`admin-tab ${tab === item.id ? "active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={16} aria-hidden="true" /> {item.label}
            </button>
          );
        })}
      </nav>

      {/* ================================================== gallery */}
      {tab === "gallery" && (
        <div className="me-gallery">
          <div className="me-toolbar">
            <label className="hub-search me-search">
              <Search size={18} />
              <input
                type="search"
                placeholder="חיפוש לפי שם, קובץ, כלי או תגית…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="חיפוש בפריטים השמורים"
              />
              <kbd className="me-kbd">Ctrl K</kbd>
            </label>
            <label className="me-sort">
              <span>מיון</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as WorkSort)}>
                <option value="newest">מהחדש לישן</option>
                <option value="oldest">מהישן לחדש</option>
                <option value="title">לפי שם</option>
                <option value="kind">לפי כלי</option>
              </select>
            </label>
            <div className="me-view" role="group" aria-label="תצוגה">
              <button type="button" className={`icon-button ${view === "grid" ? "is-current" : ""}`} aria-pressed={view === "grid"} aria-label="גלריה" onClick={() => setView("grid")}>
                <LayoutGrid size={17} />
              </button>
              <button type="button" className={`icon-button ${view === "list" ? "is-current" : ""}`} aria-pressed={view === "list"} aria-label="רשימה" onClick={() => setView("list")}>
                <List size={17} />
              </button>
              <button
                type="button"
                className={`icon-button ${selecting ? "is-current" : ""}`}
                aria-pressed={selecting}
                aria-label="בחירה מרובה"
                title="בחירה מרובה"
                onClick={() => {
                  setSelecting((current) => !current);
                  setSelected(new Set());
                }}
              >
                <CheckSquare size={17} />
              </button>
            </div>
          </div>

          <div className="me-kinds" role="group" aria-label="סינון">
            <button type="button" className={`chip-toggle ${kind === "all" && !starredOnly && !tag ? "active" : ""}`} onClick={() => { setKind("all"); setStarredOnly(false); setTag(null); }}>
              הכול <b>{all.length}</b>
            </button>
            <button type="button" className={`chip-toggle ${starredOnly ? "active" : ""}`} aria-pressed={starredOnly} onClick={() => setStarredOnly((current) => !current)}>
              <Star size={14} /> מועדפים <b>{starredCount}</b>
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
                  onClick={() => setKind(kind === item ? "all" : item)}
                  style={{ "--accent-hue": tool?.hue ?? 258 } as CSSProperties}
                >
                  {Icon && <Icon size={14} />}
                  {KIND_LABELS[item]} <b>{counts[item]}</b>
                </button>
              );
            })}
          </div>

          {tags.length > 0 && (
            <div className="me-tags-row" role="group" aria-label="תגיות">
              <Tag size={14} aria-hidden="true" />
              {tags.map((item) => (
                <button key={item.tag} type="button" className={`me-tag ${tag === item.tag ? "is-active" : ""}`} aria-pressed={tag === item.tag} onClick={() => setTag(tag === item.tag ? null : item.tag)}>
                  {item.tag} <small>{item.count}</small>
                </button>
              ))}
            </div>
          )}

          {selecting && (
            <div className="me-bulk" role="toolbar" aria-label="פעולות על הבחירה">
              <span>
                <b>{selected.size}</b> נבחרו
              </span>
              <button type="button" className="link-button" onClick={() => setSelected(new Set(visible.map((item) => item.id)))}>
                בחר את כל המוצגים
              </button>
              <button type="button" className="secondary-button" disabled={!selected.size || Boolean(busy)} onClick={() => void exportZip(chosenWorks)}>
                <FolderArchive size={15} /> הורדה כ־ZIP
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!selected.size}
                onClick={() => {
                  let next = marks;
                  const allStarred = chosenWorks.every((item) => isStarred(marks, item.id));
                  for (const item of chosenWorks) next = withStar(next, item.id, !allStarred);
                  setMarksAndSave(next);
                }}
              >
                <Star size={15} /> כוכב
              </button>
              <ConfirmButton confirmLabel={`למחוק ${selected.size}?`} onConfirm={() => void removeMany([...selected])} disabled={!selected.size || Boolean(busy)}>
                <Trash2 size={15} /> מחיקה
              </ConfirmButton>
            </div>
          )}

          {works === null ? (
            <p className="empty-history">טוען את מה ששמרת…</p>
          ) : all.length === 0 ? (
            <div className="me-empty">
              <span className="tool-intro-icon">
                <Sparkles size={24} />
              </span>
              <strong>עדיין לא שמרת כלום.</strong>
              <p>בכל כלי יש כפתור „שמור באזור האישי”. תווים שמנתחים וצלצולים שמורידים נשמרים מעצמם.</p>
              <button className="secondary-button" type="button" onClick={onHome}>
                <ArrowRight size={16} /> לכלים
              </button>
            </div>
          ) : visible.length === 0 ? (
            <p className="empty-history">אין פריטים שמתאימים לסינון הזה.</p>
          ) : (
            <ul className={`me-grid ${view === "list" ? "is-list" : ""}`}>
              {visible.map((work) => {
                const tool = findTool(KIND_TOOL[work.kind]);
                const onDevice = fileIds.has(work.id);
                const inCloud = Boolean(work.filePath);
                const hasFile = onDevice || inCloud;
                const starred = isStarred(marks, work.id);
                const itemTags = tagsOf(marks, work.id);
                const isPlaying = playing?.id === work.id;
                const isChosen = selected.has(work.id);
                return (
                  <li
                    key={work.id}
                    className={`me-tile ${isPlaying ? "is-playing" : ""} ${isChosen ? "is-chosen" : ""}`}
                    style={{ "--accent-hue": tool?.hue ?? 258 } as CSSProperties}
                  >
                    {selecting && (
                      <button type="button" className="me-tile-check" aria-pressed={isChosen} aria-label={isChosen ? "בטל בחירה" : "בחר"} onClick={() => toggleSelected(work.id)}>
                        {isChosen ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                    )}
                    <button type="button" className="me-tile-thumb" aria-label={`תצוגה מקדימה של ${work.title}`} onClick={() => (selecting ? toggleSelected(work.id) : setPreview(work))}>
                      <WorkThumb work={work} />
                      <span className="me-tile-zoom" aria-hidden="true">
                        <Maximize2 size={14} />
                      </span>
                    </button>
                    <div className="me-tile-body">
                      {editing?.id === work.id ? (
                        <form
                          className="me-rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            commitRename();
                          }}
                        >
                          <input autoFocus value={editing.title} maxLength={120} aria-label="שם חדש" onChange={(event) => setEditing({ id: work.id, title: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }} />
                          <button type="submit" className="icon-button" aria-label="שמור שם"><Save size={16} /></button>
                          <button type="button" className="icon-button" aria-label="בטל" onClick={() => setEditing(null)}><X size={16} /></button>
                        </form>
                      ) : (
                        <button type="button" className="me-tile-title" onClick={() => onOpenWork(work)}>
                          {work.title}
                        </button>
                      )}
                      <p className="me-tile-meta">
                        <span className="me-kind">{KIND_LABELS[work.kind]}</span>
                        {describeWork(work) && <span>{describeWork(work)}</span>}
                        <span title={formatDate(work.createdAt)}>{timeAgo(work.createdAt, now)}</span>
                      </p>
                      <p className="me-tile-flags">
                        {inCloud && <span className="me-badge is-cloud"><Cloud size={12} /> בענן</span>}
                        {onDevice && <span className="me-badge is-file"><HardDrive size={12} /> במכשיר</span>}
                        {work.summary.fileTooLarge ? <span className="me-badge is-local"><CloudOff size={12} /> גדול מדי לענן</span> : null}
                        {work.localOnly && <span className="me-badge is-local"><ArrowUpFromLine size={12} /> טרם עלה</span>}
                        {itemTags.map((item) => (
                          <button key={item} type="button" className="me-tag is-small" onClick={() => setTag(item)}>
                            {item}
                          </button>
                        ))}
                      </p>
                      {tagging?.id === work.id && (
                        <form
                          className="me-rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            commitTags();
                          }}
                        >
                          <input autoFocus value={tagging.text} maxLength={140} placeholder="תגיות, מופרדות בפסיק" aria-label="תגיות" onChange={(event) => setTagging({ id: work.id, text: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setTagging(null); }} />
                          <button type="submit" className="icon-button" aria-label="שמור תגיות"><Save size={16} /></button>
                          <button type="button" className="icon-button" aria-label="בטל" onClick={() => setTagging(null)}><X size={16} /></button>
                        </form>
                      )}
                      {isPlaying && playing && (
                        <audio className="me-player" controls autoPlay src={playing.url} onEnded={() => setPlaying(null)} />
                      )}
                    </div>
                    <div className="me-tile-actions">
                      <button type="button" className={`icon-button ${starred ? "is-star" : ""}`} aria-pressed={starred} aria-label={starred ? "הסר כוכב" : "סמן בכוכב"} onClick={() => setMarksAndSave(withStar(marks, work.id, !starred))}>
                        <Star size={17} fill={starred ? "currentColor" : "none"} />
                      </button>
                      {hasFile && (
                        <>
                          <button type="button" className="icon-button" aria-label={isPlaying ? "עצור" : "נגן"} aria-pressed={isPlaying} onClick={() => togglePlay(work)}>
                            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
                          </button>
                          <button type="button" className="icon-button" aria-label="הורד את הקובץ" onClick={() => download(work)}>
                            <Download size={17} />
                          </button>
                          {canShare && (
                            <button type="button" className="icon-button" aria-label="שתף את הקובץ" onClick={() => share(work)}>
                              <Share2 size={17} />
                            </button>
                          )}
                        </>
                      )}
                      {userId && !work.localOnly && (
                        <button type="button" className="icon-button" aria-label="קישור ציבורי" title="קישור ציבורי" onClick={() => link(work)}>
                          <Link2 size={17} />
                        </button>
                      )}
                      <button type="button" className="icon-button" aria-label="תגיות" title="תגיות" onClick={() => setTagging({ id: work.id, text: itemTags.join(", ") })}>
                        <Tag size={17} />
                      </button>
                      <button type="button" className="icon-button" aria-label="שנה שם" onClick={() => setEditing({ id: work.id, title: work.title })}>
                        <Pencil size={17} />
                      </button>
                      <button type="button" className="icon-button is-danger" aria-label={`מחק את ${work.title}`} onClick={() => void remove(work)}>
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ================================================== insights */}
      {tab === "insights" && (
        <div className="admin-grid">
          <Card title="30 הימים האחרונים" icon={<Calendar size={17} />} hint="כמה פריטים נשמרו בכל יום" className="is-wide">
            <TimeChart points={activity} unit="פריטים" label="פריטים שנשמרו" height={200} />
          </Card>
          <Card title="מתי אתה יוצר" icon={<Clock size={17} />} hint="לפי יום בשבוע ושעה, על כל מה ששמרת">
            <WeekHeatmap grid={heat} unit="פריטים" />
          </Card>
          <Card title="לפי כלי" icon={<LayoutGrid size={17} />} hint="כמה פעמים כל כלי שמר משהו">
            <BarList
              rows={WORK_KINDS.filter((item) => counts[item] > 0)
                .map((item) => ({ key: item, label: KIND_LABELS[item], value: counts[item], hue: findTool(KIND_TOOL[item])?.hue }))
                .sort((a, b) => b.value - a.value)}
              unit="פריטים"
              onSelect={(key) => {
                setKind(key as WorkKind);
                setTab("gallery");
              }}
            />
          </Card>
          <Card title="שמיעה" icon={<Ear size={17} />} hint="מהאימונים ששמרת במאמן השמיעה">
            {earSummary ? (
              <ul className="admin-facts">
                <li><span>דיוק כולל</span><b>{earSummary.accuracy}%</b></li>
                <li><span>אימונים שמורים</span><b>{earSummary.sessions}</b></li>
              </ul>
            ) : (
              <p className="admin-empty">עדיין אין אימונים שמורים.</p>
            )}
          </Card>
        </div>
      )}

      {/* ================================================== files */}
      {tab === "files" && (
        <div className="admin-grid">
          <Card title="מה שוקל מה" icon={<HardDrive size={17} />} hint="הקבצים שהכלים הפיקו, לפי כלי">
            {storage.length ? (
              <div className="meter-stack">
                {storage.map((row) => (
                  <div key={row.kind} style={{ "--accent-hue": findTool(KIND_TOOL[row.kind])?.hue ?? 258 } as CSSProperties}>
                    <Meter label={row.label} value={row.bytes} max={storage[0].bytes} note={`${row.count} קבצים`} format={formatBytes} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-empty">עדיין אין קבצים.</p>
            )}
          </Card>
          <Card title="איפה הקבצים" icon={<Cloud size={17} />}>
            <ul className="admin-facts">
              <li><span>בענן, בתיקייה פרטית שלך</span><b>{cloud.count} <small>{formatBytes(cloud.bytes)}</small></b></li>
              <li><span>עותקים במכשיר הזה</span><b>{files.length} <small>{formatBytes(fileBytes)}</small></b></li>
            </ul>
            <p className="admin-foot-note">
              {user
                ? "כל קובץ שכלי מפיק עולה לענן (עד 60MB לקובץ) וזמין מכל מכשיר. העותק המקומי הוא הדרך המהירה."
                : "בלי חשבון הקבצים נשמרים במכשיר הזה בלבד. אחרי התחברות הם עולים לענן."}
            </p>
            <div className="me-card-actions">
              <button type="button" className="secondary-button" disabled={!all.length || Boolean(busy)} onClick={() => void exportZip()}>
                <FolderArchive size={15} /> הורדת הכול כ־ZIP
              </button>
              <ConfirmButton className="secondary-button" confirmLabel={`למחוק ${files.length} עותקים מקומיים?`} disabled={!files.length} onConfirm={() => { setPlaying(null); void clearFiles().then(() => setFiles([])); }}>
                <Trash2 size={15} /> ניקוי עותקים מקומיים
              </ConfirmButton>
            </div>
          </Card>
          <Card
            title="סל מיחזור"
            icon={<RotateCcw size={17} />}
            hint={`מה שנמחק מחכה כאן ${TRASH_DAYS} ימים. הרשומה נשמרת; הקובץ עצמו לא.`}
            className="is-wide"
            actions={
              trash.length ? (
                <ConfirmButton className="link-button is-danger" confirmLabel="לרוקן לצמיתות?" onConfirm={() => { clearTrash(); setTrash([]); }}>
                  רוקן את הסל
                </ConfirmButton>
              ) : undefined
            }
          >
            {trash.length ? (
              <ul className="trash-list">
                {trash.map((entry) => {
                  const tool = findTool(KIND_TOOL[entry.work.kind]);
                  return (
                    <li key={entry.work.id} style={{ "--accent-hue": tool?.hue ?? 258 } as CSSProperties}>
                      <WorkThumb work={entry.work} className="is-tiny" />
                      <span className="trash-text">
                        <b>{entry.work.title}</b>
                        <small>{KIND_LABELS[entry.work.kind]} · נמחק {timeAgo(entry.deletedAt, now)}</small>
                      </span>
                      <span className="row-actions">
                        <button type="button" className="secondary-button" onClick={() => void restore(entry)}>
                          <RotateCcw size={15} /> שחזור
                        </button>
                        <button type="button" className="link-button is-danger" onClick={() => setTrash(removeFromTrash(entry.work.id))}>
                          הסר
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="admin-empty">הסל ריק.</p>
            )}
          </Card>
        </div>
      )}

      {/* ================================================== links */}
      {tab === "links" && (
        <div className="admin-grid">
          <Card title="קישורים ציבוריים" icon={<Link2 size={17} />} hint="כל קישור שיצרת, כמה פעמים נפתח, ומתי הוא פג" className="is-wide">
            {!user ? (
              <p className="admin-empty">קישורים ציבוריים דורשים חשבון.</p>
            ) : shares === null ? (
              <p className="admin-empty">טוען…</p>
            ) : shares.length === 0 ? (
              <p className="admin-empty">עדיין לא יצרת קישור. בכל פריט בגלריה יש כפתור קישור.</p>
            ) : (
              <ul className="links-list">
                {shares.map((item) => {
                  const dead = Boolean(item.revokedAt) || expiryLabel(item.expiresAt, now) === "פג תוקף";
                  const url = shareLink(item.token);
                  return (
                    <li key={item.token} className={dead ? "is-dead" : ""} style={{ "--accent-hue": findTool(KIND_TOOL[item.kind])?.hue ?? 258 } as CSSProperties}>
                      <span className="links-text">
                        <b>{item.title}</b>
                        <small>
                          {KIND_LABELS[item.kind] ?? item.kind} · נוצר {formatDate(item.createdAt)} ·{" "}
                          {item.revokedAt ? "בוטל" : expiryLabel(item.expiresAt, now)}
                        </small>
                      </span>
                      <span className="links-views" title="צפיות">
                        <Eye size={14} /> {formatNumber(item.views)}
                      </span>
                      {!dead && (
                        <select
                          className="links-expiry"
                          aria-label="תפוגה"
                          value=""
                          onChange={(event) => {
                            const days = event.target.value === "never" ? null : Number(event.target.value);
                            void setShareExpiry(item.token, days)
                              .then((expiresAt) => setShares((current) => (current ?? []).map((row) => (row.token === item.token ? { ...row, expiresAt } : row))))
                              .catch(() => setMessage("לא הצלחנו לשנות את התפוגה."));
                          }}
                        >
                          <option value="" disabled>תפוגה…</option>
                          <option value="1">יום אחד</option>
                          <option value="7">שבוע</option>
                          <option value="30">חודש</option>
                          <option value="never">ללא תפוגה</option>
                        </select>
                      )}
                      <span className="row-actions">
                        {!dead && (
                          <button type="button" className="icon-button" aria-label="העתק קישור" onClick={() => void navigator.clipboard.writeText(url).then(() => setMessage("הקישור הועתק.")).catch(() => setMessage(url))}>
                            <Copy size={16} />
                          </button>
                        )}
                        {!dead && (
                          <ConfirmButton className="link-button is-danger" confirmLabel="לבטל?" onConfirm={() => void revokeShare(item.token).then(() => setShares((current) => (current ?? []).map((row) => (row.token === item.token ? { ...row, revokedAt: new Date().toISOString() } : row)))).catch(() => setMessage("הביטול נכשל."))}>
                            ביטול
                          </ConfirmButton>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ================================================== privacy */}
      {tab === "privacy" && (
        <div className="admin-grid">
          {onOpenAdmin && (
            <Card title="אזור ניהול" icon={<ShieldCheck size={17} />} hint="פתוח לחשבון של בעל האתר בלבד" className="me-admin-card">
              <p className="admin-foot-note">מה קורה באתר — אילו כלים נפתחים, מתי, מה עובד ומה נשבר — בלי לדעת מי עשה מה.</p>
              <button type="button" className="primary-button compact" onClick={onOpenAdmin}>
                <ShieldCheck size={16} /> כניסה לאזור הניהול
              </button>
            </Card>
          )}

          {user && (
            <Card title="השם שיוצג באתר" icon={<UserRound size={17} />}>
              <div className="me-name-field">
                <input value={name} maxLength={80} aria-label="שם תצוגה" onChange={(event) => setNameDraft(event.target.value)} />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!name.trim() || name.trim() === profile?.full_name}
                  onClick={() => {
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
            </Card>
          )}

          <Card title="מדידה אנונימית" icon={<Eye size={17} />} hint="מה האתר סופר על עצמו">
            <label className="switch-row">
              <input
                type="checkbox"
                checked={tracking}
                onChange={(event) => {
                  setAnalyticsEnabled(event.target.checked);
                  setTracking(event.target.checked);
                }}
              />
              <span>
                <b>לספור את הביקור שלי</b>
                <small>
                  האתר רושם איזה כלי נפתח ומתי, כמה זמן, ואם הוא הצליח — בלי שם, בלי חשבון, בלי קובץ ובלי מה שהקלדת. מספר
                  אקראי בדפדפן מתחלף כל חודש כדי לספור „חוזרים”. כיבוי מפסיק הכול, כולל את המספר.
                </small>
              </span>
            </label>
          </Card>

          <Card title="המידע שלי" icon={<FileJson size={17} />} hint="עותק של כל מה שהחשבון מחזיק">
            <p className="admin-foot-note">
              קובץ JSON אחד עם הפרופיל, כל הפריטים מכל הכלים, הקישורים והשיחות עם העוזר, ורשימת הקבצים בענן. לקבצים
              עצמם יש ZIP בלשונית „קבצים”.
            </p>
            <div className="me-card-actions">
              <button type="button" className="secondary-button" disabled={!user || Boolean(busy)} onClick={() => void exportEverything()}>
                <Download size={15} /> הורדת כל המידע שלי
              </button>
              {!user && <p className="admin-foot-note">בלי חשבון אין מה להוריד מהשרת; מה שבמכשיר נמצא ב־ZIP.</p>}
            </div>
          </Card>

          {user && (
            <Card title="מחיקת החשבון" icon={<UserX size={17} />} hint="לצמיתות, בלי דרך חזרה" className="is-danger">
              <p className="admin-foot-note">
                נמחקים החשבון, הפרופיל, כל הפריטים והקבצים בענן, הקישורים הציבוריים והשיחות. מה שנשמר במכשיר הזה נשאר
                בו. כדאי להוריד עותק קודם.
              </p>
              <label className="me-confirm-word">
                <span>כדי לאשר, כתוב <b>מחק</b></span>
                <input value={deleteWord} onChange={(event) => setDeleteWord(event.target.value)} aria-label="מילת אישור" />
              </label>
              <ConfirmButton confirmLabel="למחוק את החשבון לצמיתות?" disabled={deleteWord.trim() !== "מחק" || Boolean(busy)} onConfirm={() => void eraseAccount()}>
                <UserX size={15} /> מחיקת החשבון
              </ConfirmButton>
            </Card>
          )}
        </div>
      )}

      {/* ================================================== preview */}
      {preview && (
        <div className="preview-overlay" role="presentation" onMouseDown={() => setPreview(null)}>
          <div className="preview" role="dialog" aria-modal="true" aria-label={preview.title} onMouseDown={(event) => event.stopPropagation()} style={{ "--accent-hue": findTool(KIND_TOOL[preview.kind])?.hue ?? 258 } as CSSProperties}>
            <button type="button" className="icon-button preview-close" aria-label="סגור" onClick={() => setPreview(null)}>
              <X size={18} />
            </button>
            <WorkThumb work={preview} className="is-large" />
            <h2>{preview.title}</h2>
            <p className="me-tile-meta">
              <span className="me-kind">{KIND_LABELS[preview.kind]}</span>
              {describeWork(preview) && <span>{describeWork(preview)}</span>}
              {preview.sourceName && <span>{preview.sourceName}</span>}
              <span>{formatDate(preview.createdAt)}</span>
            </p>
            {playing?.id === preview.id && <audio className="me-player" controls autoPlay src={playing.url} onEnded={() => setPlaying(null)} />}
            <div className="preview-actions">
              <button type="button" className="primary-button compact" onClick={() => onOpenWork(preview)}>
                <Image size={16} /> פתיחה בכלי
              </button>
              {(fileIds.has(preview.id) || preview.filePath) && (
                <>
                  <button type="button" className="secondary-button" onClick={() => togglePlay(preview)}>
                    {playing?.id === preview.id ? <Pause size={16} /> : <Play size={16} />} {playing?.id === preview.id ? "עצור" : "נגן"}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => download(preview)}>
                    <Download size={16} /> הורדה
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MePage;
