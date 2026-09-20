import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Ban,
  ChartNoAxesColumn,
  Cloud,
  Download,
  ExternalLink,
  Eye,
  FileCog,
  Gauge,
  KeyRound,
  Link2,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AdminError,
  activeUsers,
  changeOverRange,
  compactNumber,
  dayKey,
  dayRange,
  describeAdminError,
  digestUsers,
  fetchAudit,
  fetchSettings,
  fetchSnapshot,
  formatBytes,
  formatDuration,
  formatNumber,
  isAdmin,
  kindLabel,
  runAdminAction,
  seriesByDay,
  sumSeries,
  tally,
  timeAgo,
  toCsv,
  weekHeatmap,
  type AdminAction,
  type AdminAuditEntry,
  type AdminSetting,
  type AdminSnapshot,
  type AdminWork,
  type Point,
  type UserDigest,
} from "../lib/admin";
import { useAuth } from "../lib/auth";
import { downloadFile } from "../lib/export";
import { shareLink } from "../lib/share";
import { findTool } from "../lib/tools";
import { KIND_TOOL, type WorkKind } from "../lib/works";
import { BarList, ConfirmButton, Sparkline, TimeChart, WeekHeatmap } from "./AdminCharts";

/**
 * The admin area: the whole site in one page, for the one account that owns
 * it. Accounts, everything the tools saved, the daily allowances, the public
 * links, the server keys and a log of what was changed from here.
 *
 * The gate is on the server. `supabase/functions/admin` checks the verified
 * address on the caller's own token before it answers, so this page is not a
 * permission — it is the door. Opening it without that address shows the
 * refusal below, and forcing the route past it would still get 403 from every
 * request it makes.
 *
 * The data arrives once, as rows: a range, a tool, an account or a day is a
 * matter of counting what is already in hand, so moving around the dashboard
 * costs nothing and the figures across the tabs always agree with each other.
 */

type Tab = "overview" | "users" | "works" | "shares" | "system";

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "סקירה", icon: ChartNoAxesColumn },
  { id: "users", label: "משתמשים", icon: Users },
  { id: "works", label: "עבודות", icon: Activity },
  { id: "shares", label: "שיתופים", icon: Link2 },
  { id: "system", label: "מערכת", icon: FileCog },
];

const RANGES = [7, 30, 90] as const;

type MetricId = "works" | "signups" | "ai" | "separation" | "tts" | "identify" | "stt" | "shares";

const dateTime = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

/** A number with what it means, the direction it moved, and its shape. */
function StatTile({
  label,
  value,
  hint,
  delta,
  upIsGood = true,
  series,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  upIsGood?: boolean;
  series?: Point[];
  icon?: ReactNode;
}) {
  const good = delta == null || delta === 0 ? null : delta > 0 === upIsGood;
  return (
    <div className="admin-tile">
      <span className="admin-tile-label">
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      <span className="admin-tile-foot">
        {delta != null && (
          <span className={`admin-delta ${good === null ? "" : good ? "is-good" : "is-bad"}`}>
            {delta > 0 ? <TrendingUp size={13} /> : delta < 0 ? <TrendingDown size={13} /> : null}
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        {hint && <small>{hint}</small>}
      </span>
      {series && <Sparkline points={series} label={`${label} לאורך התקופה`} />}
    </div>
  );
}

function AdminCard({
  title,
  icon,
  actions,
  children,
  wide,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`admin-card ${wide ? "is-wide" : ""}`}>
      <header className="admin-card-head">
        <h2>
          {icon}
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function AdminPanel({ onHome }: { onHome: () => void }) {
  const { user } = useAuth();
  const allowed = isAdmin(user);

  const [days, setDays] = useState<number>(30);
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [metric, setMetric] = useState<MetricId>("works");
  const [userQuery, setUserQuery] = useState("");
  const [workQuery, setWorkQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState<AdminSetting[] | null>(null);
  const [audit, setAudit] = useState<AdminAuditEntry[] | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const load = useCallback(
    async (range: number) => {
      setLoading(true);
      setError(null);
      try {
        setSnapshot(await fetchSnapshot(range));
      } catch (failure) {
        setError(
          failure instanceof AdminError ? failure.message : describeAdminError("storage"),
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!allowed) return;
    // After the first paint: the frame around the dashboard appears at once,
    // and the figures drop in when the server answers.
    const timer = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(timer);
  }, [allowed, days, load]);

  // The system tab asks for its own two lists, and only when it is opened.
  useEffect(() => {
    if (!allowed || tab !== "system") return;
    void fetchSettings().then(setSettings).catch(() => setSettings([]));
    void fetchAudit().then(setAudit).catch(() => setAudit([]));
  }, [allowed, tab]);

  /** Runs one change on the server, then refreshes what the page shows. */
  const act = useCallback(
    async (action: AdminAction, payload: Record<string, unknown>, done: string) => {
      setBusy(true);
      setNote(null);
      try {
        await runAdminAction(action, payload);
        setNote(done);
        await load(days);
        if (action.startsWith("setting.")) {
          setSettings(await fetchSettings().catch(() => []));
        }
        setAudit(await fetchAudit().catch(() => null));
      } catch (failure) {
        setNote(failure instanceof AdminError ? failure.message : describeAdminError("storage"));
      } finally {
        setBusy(false);
      }
    },
    [days, load],
  );

  // Every figure is measured from the moment the snapshot was taken, not from
  // the moment a render happens to run, so the tabs always agree with each
  // other — and with the "updated" line at the top.
  const taken = useMemo(
    () => (snapshot ? new Date(snapshot.generatedAt) : new Date(0)),
    [snapshot],
  );

  const range = useMemo(() => dayRange(days, taken), [days, taken]);

  const worksInRange = useMemo(() => {
    if (!snapshot) return [];
    const from = taken.getTime() - days * 86_400_000;
    return snapshot.works.filter((work) => new Date(work.createdAt).getTime() >= from);
  }, [days, snapshot, taken]);

  const series = useMemo(() => {
    const empty = range.map((day) => ({ day, value: 0 }));
    if (!snapshot) {
      return { works: empty, signups: empty, ai: empty, separation: empty, tts: empty, identify: empty, stt: empty, shares: empty };
    }
    const usage = (kind: string, scale = 1) =>
      seriesByDay(
        snapshot.ai.filter((row) => row.kind === kind),
        (row) => row.day,
        range,
        (row) => row.amount * scale,
      );
    return {
      works: seriesByDay(snapshot.works, (work) => dayKey(work.createdAt), range),
      signups: seriesByDay(snapshot.users, (account) => dayKey(account.createdAt), range),
      ai: usage("ai"),
      separation: usage("separation"),
      tts: usage("tts"),
      identify: usage("identify"),
      stt: seriesByDay(snapshot.stt, (row) => row.day, range, (row) => row.amount / 60),
      shares: seriesByDay(snapshot.shares, (share) => dayKey(share.createdAt), range),
    };
  }, [range, snapshot]);

  const metrics: { id: MetricId; label: string; unit: string; points: Point[]; format: (value: number) => string }[] =
    useMemo(
      () => [
        { id: "works", label: "עבודות שנשמרו", unit: "עבודות", points: series.works, format: formatNumber },
        { id: "signups", label: "חשבונות חדשים", unit: "חשבונות", points: series.signups, format: formatNumber },
        { id: "ai", label: "טוקנים של מודל השפה", unit: "טוקנים", points: series.ai, format: compactNumber },
        { id: "stt", label: "תמלול דיבור", unit: "דקות", points: series.stt, format: (value) => formatNumber(value) },
        { id: "separation", label: "הפרדות שירה בשרת", unit: "שירים", points: series.separation, format: formatNumber },
        { id: "tts", label: "הקראה", unit: "תווים", points: series.tts, format: compactNumber },
        { id: "identify", label: "זיהוי שירים", unit: "בקשות", points: series.identify, format: formatNumber },
        { id: "shares", label: "קישורים ציבוריים", unit: "קישורים", points: series.shares, format: formatNumber },
      ],
      [series],
    );

  const shown = metrics.find((item) => item.id === metric) ?? metrics[0];

  const digest = useMemo(() => (snapshot ? digestUsers(snapshot, taken) : []), [snapshot, taken]);

  const kinds = useMemo(() => tally(worksInRange, (work) => work.kind), [worksInRange]);

  const topUsers = useMemo(
    () => [...digest].sort((a, b) => b.works - a.works || b.bytes - a.bytes).slice(0, 8),
    [digest],
  );

  const heatmap = useMemo(() => weekHeatmap(worksInRange), [worksInRange]);

  const active7 = useMemo(
    () => (snapshot ? activeUsers(snapshot.works, 7, taken).size : 0),
    [snapshot, taken],
  );

  const storage = useMemo(
    () =>
      (snapshot?.storage ?? []).reduce(
        (totals, row) => ({ files: totals.files + row.files, bytes: totals.bytes + row.bytes }),
        { files: 0, bytes: 0 },
      ),
    [snapshot],
  );

  const shareViews = useMemo(
    () => (snapshot?.shares ?? []).reduce((total, share) => total + share.views, 0),
    [snapshot],
  );

  const userRows = useMemo(() => {
    const needle = userQuery.trim().toLowerCase();
    const rows = needle
      ? digest.filter((row) =>
          `${row.email ?? ""} ${row.name ?? ""} ${row.id}`.toLowerCase().includes(needle),
        )
      : digest;
    return [...rows].sort((a, b) => {
      const left = a.lastWorkAt ?? a.lastSignInAt ?? a.createdAt;
      const right = b.lastWorkAt ?? b.lastSignInAt ?? b.createdAt;
      return right.localeCompare(left);
    });
  }, [digest, userQuery]);

  const emails = useMemo(
    () => new Map(digest.map((row) => [row.id, row.email ?? row.name ?? row.id.slice(0, 8)])),
    [digest],
  );

  const workRows = useMemo(() => {
    const needle = workQuery.trim().toLowerCase();
    return (snapshot?.works ?? []).filter((work) => {
      if (kindFilter !== "all" && work.kind !== kindFilter) return false;
      if (!needle) return true;
      const owner = emails.get(work.userId) ?? "";
      return `${work.title} ${work.source ?? ""} ${owner}`.toLowerCase().includes(needle);
    });
  }, [emails, kindFilter, snapshot, workQuery]);

  const openUser = useCallback(
    (id: string) => {
      setSelected(id);
      setTab("users");
    },
    [],
  );

  const chosen = selected ? digest.find((row) => row.id === selected) ?? null : null;
  const chosenWorks = useMemo(
    () => (selected ? (snapshot?.works ?? []).filter((work) => work.userId === selected) : []),
    [selected, snapshot],
  );

  if (!allowed) {
    return (
      <div className="admin-page admin-locked">
        <div className="admin-locked-card">
          <span className="admin-locked-mark">
            <ShieldX size={26} />
          </span>
          <h1>האזור הזה סגור</h1>
          <p>
            אזור הניהול פתוח לחשבון של בעל האתר בלבד. גם אם מגיעים לכתובת הזאת ישירות, השרת
            אינו עונה לאף חשבון אחר.
          </p>
          <button type="button" className="primary-button" onClick={onHome}>
            <ArrowRight size={17} /> חזרה לכלי המוזיקה
          </button>
        </div>
      </div>
    );
  }

  const worksTotal = sumSeries(series.works);
  const worksChange = changeOverRange(series.works);

  return (
    <div className="admin-page" style={{ "--accent-hue": 212 } as CSSProperties}>
      <header className="admin-head">
        <div>
          <p className="admin-eyebrow">
            <ShieldCheck size={15} /> אזור ניהול · {user?.email}
          </p>
          <h1>מצב האתר</h1>
          <p className="admin-subtitle">
            {snapshot
              ? `עודכן ${timeAgo(snapshot.generatedAt)} · ${formatNumber(snapshot.totals.users)} חשבונות · ${formatNumber(snapshot.totals.works)} פריטים שמורים`
              : "טוען את הנתונים מהשרת…"}
          </p>
        </div>
        <div className="admin-head-actions">
          <div className="admin-range" role="group" aria-label="טווח הזמן">
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip-toggle ${days === option ? "active" : ""}`}
                aria-pressed={days === option}
                onClick={() => setDays(option)}
              >
                {option} ימים
              </button>
            ))}
          </div>
          <button type="button" className="secondary-button" onClick={() => void load(days)} disabled={loading}>
            <RefreshCw size={16} className={loading ? "is-spinning" : ""} /> רענון
          </button>
          <button type="button" className="secondary-button" onClick={onHome}>
            <ArrowRight size={16} /> לאתר
          </button>
        </div>
      </header>

      {error && (
        <div className="error-message admin-message" role="alert">
          {error}
        </div>
      )}
      {note && (
        <p className="notice-message admin-message" role="status">
          {note}
          <button type="button" className="link-button" onClick={() => setNote(null)}>
            סגור
          </button>
        </p>
      )}
      {snapshot?.truncated.works && (
        <p className="notice-message admin-message" role="status">
          יש יותר פריטים ממה שהשרת שולח בבת אחת; הרשימות מציגות את החדשים ביותר, והמספרים
          הכוללים למעלה מדויקים.
        </p>
      )}

      <nav className="admin-tabs" role="tablist" aria-label="חלקי אזור הניהול">
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
              <Icon size={16} /> {item.label}
            </button>
          );
        })}
      </nav>

      {loading && !snapshot ? (
        <div className="admin-loading" role="status">
          <Gauge size={20} /> אוסף את הנתונים מכל הטבלאות…
        </div>
      ) : (
        <div className="admin-body">
          {/* ------------------------------ סקירה ------------------------------ */}
          {tab === "overview" && snapshot && (
            <>
              <section className="admin-hero">
                <div>
                  <p className="admin-hero-label">עבודות שנשמרו ב־{days} הימים האחרונים</p>
                  <strong className="admin-hero-value">{formatNumber(worksTotal)}</strong>
                  <p className="admin-hero-foot">
                    {worksChange != null ? (
                      <span className={`admin-delta ${worksChange >= 0 ? "is-good" : "is-bad"}`}>
                        {worksChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {worksChange > 0 ? "+" : ""}
                        {worksChange}% מול המחצית הקודמת
                      </span>
                    ) : (
                      <span className="admin-delta">אין עדיין תקופה קודמת להשוות אליה</span>
                    )}
                  </p>
                </div>
                <Sparkline points={series.works} label="עבודות לאורך התקופה" />
              </section>

              <div className="admin-tiles">
                <StatTile
                  label="חשבונות"
                  icon={<Users size={14} />}
                  value={formatNumber(snapshot.totals.users)}
                  hint={`${formatNumber(sumSeries(series.signups))} נרשמו בטווח`}
                  delta={changeOverRange(series.signups)}
                  series={series.signups}
                />
                <StatTile
                  label="פעילים השבוע"
                  icon={<Activity size={14} />}
                  value={formatNumber(active7)}
                  hint={
                    snapshot.totals.users
                      ? `${Math.round((active7 / snapshot.totals.users) * 100)}% מהחשבונות`
                      : undefined
                  }
                />
                <StatTile
                  label="פריטים שמורים"
                  icon={<Sparkles size={14} />}
                  value={formatNumber(snapshot.totals.works)}
                  hint={`${formatNumber(worksTotal)} נוצרו בטווח`}
                  series={series.works}
                />
                <StatTile
                  label="אחסון בענן"
                  icon={<Cloud size={14} />}
                  value={formatBytes(storage.bytes)}
                  hint={`${formatNumber(storage.files)} קבצים`}
                />
                <StatTile
                  label="טוקני AI בטווח"
                  icon={<Gauge size={14} />}
                  value={compactNumber(sumSeries(series.ai))}
                  hint={`${formatNumber(sumSeries(series.separation))} הפרדות · ${formatNumber(sumSeries(series.identify))} זיהויים`}
                  delta={changeOverRange(series.ai)}
                  series={series.ai}
                />
                <StatTile
                  label="תמלול בטווח"
                  icon={<Activity size={14} />}
                  value={formatDuration(sumSeries(series.stt) * 60)}
                  hint={`${compactNumber(sumSeries(series.tts))} תווים להקראה`}
                  series={series.stt}
                />
                <StatTile
                  label="קישורים ציבוריים"
                  icon={<Link2 size={14} />}
                  value={formatNumber(snapshot.totals.shares)}
                  hint={`${formatNumber(shareViews)} צפיות`}
                  series={series.shares}
                />
                <StatTile
                  label="עבודות לחשבון"
                  icon={<ChartNoAxesColumn size={14} />}
                  value={
                    snapshot.totals.users
                      ? (snapshot.totals.works / snapshot.totals.users).toFixed(1)
                      : "0"
                  }
                  hint="ממוצע על כל החשבונות"
                />
              </div>

              <AdminCard
                title={shown.label}
                icon={<ChartNoAxesColumn size={18} />}
                wide
                actions={
                  <label className="admin-select">
                    <span className="sr-only">מה מוצג בגרף</span>
                    <select value={metric} onChange={(event) => setMetric(event.target.value as MetricId)}>
                      {metrics.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                }
              >
                <TimeChart
                  points={shown.points}
                  unit={shown.unit}
                  format={shown.format}
                  label={shown.label}
                />
              </AdminCard>

              <div className="admin-grid">
                <AdminCard title="לפי כלי" icon={<Sparkles size={18} />}>
                  <BarList
                    rows={kinds.map((row) => {
                      const tool = findTool(KIND_TOOL[row.key as WorkKind] ?? "");
                      const Icon = tool?.icon;
                      return {
                        key: row.key,
                        label: kindLabel(row.key),
                        value: row.value,
                        icon: Icon ? <Icon size={14} /> : undefined,
                      };
                    })}
                    onSelect={(key) => {
                      setKindFilter(key);
                      setTab("works");
                    }}
                    empty={`לא נשמרו עבודות ב־${days} הימים האחרונים`}
                  />
                </AdminCard>

                <AdminCard title="החשבונות הפעילים ביותר" icon={<Users size={18} />}>
                  <BarList
                    rows={topUsers.map((row) => ({
                      key: row.id,
                      label: row.name || row.email || row.id.slice(0, 8),
                      hint: row.email && row.name ? row.email : undefined,
                      value: row.works,
                    }))}
                    unit="פריטים"
                    onSelect={openUser}
                    empty="אין עדיין חשבונות עם עבודות שמורות"
                  />
                </AdminCard>
              </div>

              <AdminCard title="מתי עובדים באתר" icon={<Activity size={18} />} wide>
                <WeekHeatmap grid={heatmap} />
              </AdminCard>

              <AdminCard title="הפעילות האחרונה" icon={<Activity size={18} />} wide>
                <ul className="admin-feed">
                  {snapshot.works.slice(0, 14).map((work) => (
                    <li key={`${work.origin}-${work.id}`}>
                      <span className="admin-feed-kind">{kindLabel(work.kind)}</span>
                      <span className="admin-feed-title">{work.title}</span>
                      <button type="button" className="link-button" onClick={() => openUser(work.userId)}>
                        {emails.get(work.userId) ?? work.userId.slice(0, 8)}
                      </button>
                      <time dateTime={work.createdAt}>{timeAgo(work.createdAt)}</time>
                    </li>
                  ))}
                  {!snapshot.works.length && <li className="admin-empty">עוד לא נשמרה עבודה באתר</li>}
                </ul>
              </AdminCard>
            </>
          )}

          {/* ----------------------------- משתמשים ----------------------------- */}
          {tab === "users" && snapshot && (
            <>
              {chosen && (
                <AdminCard
                  title={chosen.name || chosen.email || "חשבון"}
                  icon={<UserRound size={18} />}
                  wide
                  actions={
                    <button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label="סגור">
                      <X size={17} />
                    </button>
                  }
                >
                  <div className="admin-detail">
                    <dl className="admin-detail-facts">
                      <div>
                        <dt>כתובת</dt>
                        <dd>{chosen.email ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>נרשם</dt>
                        <dd>{formatDate(chosen.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>כניסה אחרונה</dt>
                        <dd>{formatDate(chosen.lastSignInAt)}</dd>
                      </div>
                      <div>
                        <dt>פריטים</dt>
                        <dd>{formatNumber(chosen.works)}</dd>
                      </div>
                      <div>
                        <dt>אחסון</dt>
                        <dd>
                          {formatBytes(chosen.bytes)} ({formatNumber(chosen.files)} קבצים)
                        </dd>
                      </div>
                      <div>
                        <dt>מכסות בטווח</dt>
                        <dd>
                          {compactNumber(chosen.aiAmount)} AI · {formatDuration(chosen.sttSeconds)} תמלול
                        </dd>
                      </div>
                      <div>
                        <dt>שיתופים</dt>
                        <dd>
                          {formatNumber(chosen.shares)} קישורים · {formatNumber(chosen.shareViews)} צפיות
                        </dd>
                      </div>
                      <div>
                        <dt>מצב</dt>
                        <dd>
                          {chosen.banned ? (
                            <span className="admin-flag is-bad">
                              <Ban size={13} /> חסום עד {formatDate(chosen.bannedUntil)}
                            </span>
                          ) : (
                            <span className="admin-flag is-good">
                              <BadgeCheck size={13} /> פעיל
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>

                    <div className="admin-detail-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void act("usage.reset", { userId: chosen.id }, "המכסה של היום אופסה.")}
                      >
                        <Gauge size={15} /> אפס מכסה להיום
                      </button>
                      {chosen.banned ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void act("user.unban", { userId: chosen.id }, "החסימה הוסרה.")}
                        >
                          <BadgeCheck size={15} /> הסר חסימה
                        </button>
                      ) : (
                        <ConfirmButton
                          confirmLabel="לחסום ל־30 יום?"
                          disabled={busy}
                          className="secondary-button admin-warn-button"
                          onConfirm={() =>
                            void act("user.ban", { userId: chosen.id, hours: 720 }, "החשבון נחסם ל־30 יום.")
                          }
                        >
                          <Ban size={15} /> חסום חשבון
                        </ConfirmButton>
                      )}
                      <ConfirmButton
                        confirmLabel="למחוק את החשבון וכל מה שבו?"
                        disabled={busy}
                        onConfirm={() =>
                          void act("user.delete", { userId: chosen.id }, "החשבון נמחק על כל מה ששמר.").then(() =>
                            setSelected(null),
                          )
                        }
                      >
                        <Trash2 size={15} /> מחק חשבון
                      </ConfirmButton>
                    </div>

                    <h3 className="admin-detail-heading">מה החשבון שמר ({chosenWorks.length})</h3>
                    <ul className="admin-rows admin-rows-compact">
                      {chosenWorks.slice(0, 40).map((work) => (
                        <li key={`${work.origin}-${work.id}`}>
                          <span className="admin-feed-kind">{kindLabel(work.kind)}</span>
                          <span className="admin-feed-title">{work.title}</span>
                          <time dateTime={work.createdAt}>{formatDate(work.createdAt)}</time>
                          <ConfirmButton
                            confirmLabel="למחוק?"
                            disabled={busy}
                            onConfirm={() =>
                              void act(
                                "work.delete",
                                { userId: work.userId, id: work.id, origin: work.origin },
                                "הפריט נמחק.",
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </ConfirmButton>
                        </li>
                      ))}
                      {!chosenWorks.length && <li className="admin-empty">החשבון עוד לא שמר כלום</li>}
                    </ul>
                  </div>
                </AdminCard>
              )}

              <AdminCard
                title={`חשבונות (${formatNumber(userRows.length)})`}
                icon={<Users size={18} />}
                wide
                actions={
                  <div className="admin-card-tools">
                    <label className="hub-search admin-search">
                      <Search size={17} />
                      <input
                        type="search"
                        value={userQuery}
                        placeholder="חיפוש לפי כתובת או שם…"
                        onChange={(event) => setUserQuery(event.target.value)}
                        aria-label="חיפוש חשבונות"
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        downloadFile(
                          toCsv(
                            userRows.map((row) => ({
                              email: row.email ?? "",
                              name: row.name ?? "",
                              created_at: row.createdAt,
                              last_sign_in: row.lastSignInAt ?? "",
                              works: row.works,
                              bytes: row.bytes,
                              ai: row.aiAmount,
                              stt_seconds: row.sttSeconds,
                            })),
                          ),
                          "users.csv",
                          "text/csv;charset=utf-8",
                        )
                      }
                    >
                      <Download size={15} /> CSV
                    </button>
                  </div>
                }
              >
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">חשבון</th>
                        <th scope="col">נרשם</th>
                        <th scope="col">פעילות אחרונה</th>
                        <th scope="col">פריטים</th>
                        <th scope="col">אחסון</th>
                        <th scope="col">AI בטווח</th>
                        <th scope="col">תמלול</th>
                        <th scope="col">
                          <span className="sr-only">פעולות</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {userRows.map((row: UserDigest) => (
                        <tr key={row.id} className={selected === row.id ? "is-selected" : ""}>
                          <th scope="row">
                            <span className="admin-user">
                              {row.avatar ? (
                                <img src={row.avatar} alt="" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="admin-user-mark">
                                  <UserRound size={15} />
                                </span>
                              )}
                              <span>
                                <b>{row.name || row.email || row.id.slice(0, 8)}</b>
                                <small>{row.email}</small>
                              </span>
                              {row.banned && (
                                <span className="admin-flag is-bad">
                                  <Ban size={12} /> חסום
                                </span>
                              )}
                            </span>
                          </th>
                          <td>{formatDate(row.createdAt)}</td>
                          <td>{timeAgo(row.lastWorkAt ?? row.lastSignInAt)}</td>
                          <td className="admin-number">{formatNumber(row.works)}</td>
                          <td className="admin-number">{formatBytes(row.bytes)}</td>
                          <td className="admin-number">{compactNumber(row.aiAmount)}</td>
                          <td className="admin-number">{formatDuration(row.sttSeconds)}</td>
                          <td>
                            <button type="button" className="link-button" onClick={() => setSelected(row.id)}>
                              פרטים
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!userRows.length && (
                        <tr>
                          <td colSpan={8} className="admin-empty">
                            אין חשבון שמתאים לחיפוש
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </AdminCard>
            </>
          )}

          {/* ------------------------------ עבודות ------------------------------ */}
          {tab === "works" && snapshot && (
            <AdminCard
              title={`פריטים שמורים (${formatNumber(workRows.length)})`}
              icon={<Activity size={18} />}
              wide
              actions={
                <div className="admin-card-tools">
                  <label className="hub-search admin-search">
                    <Search size={17} />
                    <input
                      type="search"
                      value={workQuery}
                      placeholder="חיפוש לפי שם, קובץ או חשבון…"
                      onChange={(event) => setWorkQuery(event.target.value)}
                      aria-label="חיפוש בפריטים"
                    />
                  </label>
                  <label className="admin-select">
                    <span className="sr-only">סינון לפי כלי</span>
                    <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
                      <option value="all">כל הכלים</option>
                      {tally(snapshot.works, (work) => work.kind).map((row) => (
                        <option key={row.key} value={row.key}>
                          {kindLabel(row.key)} ({row.value})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              }
            >
              <ul className="admin-rows">
                {workRows.slice(0, 200).map((work: AdminWork) => (
                  <li key={`${work.origin}-${work.id}`}>
                    <span className="admin-feed-kind">{kindLabel(work.kind)}</span>
                    <span className="admin-feed-title">
                      {work.title}
                      {work.source && <small>{work.source}</small>}
                    </span>
                    <button type="button" className="link-button" onClick={() => openUser(work.userId)}>
                      {emails.get(work.userId) ?? work.userId.slice(0, 8)}
                    </button>
                    {work.hasFile && (
                      <span className="admin-flag">
                        <Cloud size={12} /> קובץ
                      </span>
                    )}
                    <time dateTime={work.createdAt}>{formatDate(work.createdAt)}</time>
                    <ConfirmButton
                      confirmLabel="למחוק?"
                      disabled={busy}
                      onConfirm={() =>
                        void act(
                          "work.delete",
                          { userId: work.userId, id: work.id, origin: work.origin },
                          "הפריט נמחק.",
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </ConfirmButton>
                  </li>
                ))}
                {!workRows.length && <li className="admin-empty">אין פריט שמתאים לסינון</li>}
              </ul>
              {workRows.length > 200 && (
                <p className="admin-card-note">מוצגים 200 הפריטים החדשים ביותר מתוך {formatNumber(workRows.length)}.</p>
              )}
            </AdminCard>
          )}

          {/* ----------------------------- שיתופים ----------------------------- */}
          {tab === "shares" && snapshot && (
            <AdminCard title={`קישורים ציבוריים (${formatNumber(snapshot.shares.length)})`} icon={<Link2 size={18} />} wide>
              <ul className="admin-rows">
                {snapshot.shares.map((share) => (
                  <li key={share.token} className={share.revokedAt ? "is-muted" : ""}>
                    <span className="admin-feed-kind">{kindLabel(share.kind)}</span>
                    <span className="admin-feed-title">{share.title}</span>
                    <button type="button" className="link-button" onClick={() => openUser(share.userId)}>
                      {emails.get(share.userId) ?? share.userId.slice(0, 8)}
                    </button>
                    <span className="admin-flag">
                      <Eye size={12} /> {formatNumber(share.views)}
                    </span>
                    <time dateTime={share.createdAt}>{formatDate(share.createdAt)}</time>
                    {share.revokedAt ? (
                      <span className="admin-flag is-bad">בוטל</span>
                    ) : (
                      <>
                        <a className="link-button" href={shareLink(share.token)} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} /> פתח
                        </a>
                        <ConfirmButton
                          confirmLabel="לבטל?"
                          disabled={busy}
                          onConfirm={() => void act("share.revoke", { token: share.token }, "הקישור בוטל.")}
                        >
                          <X size={14} /> בטל
                        </ConfirmButton>
                      </>
                    )}
                  </li>
                ))}
                {!snapshot.shares.length && <li className="admin-empty">עוד לא נוצר קישור ציבורי</li>}
              </ul>
            </AdminCard>
          )}

          {/* ------------------------------ מערכת ------------------------------ */}
          {tab === "system" && (
            <>
              <AdminCard title="מפתחות והגדרות שרת" icon={<KeyRound size={18} />} wide>
                <p className="admin-card-note">
                  מפתח שמוגדר כסוד של הפונקציה גובר על הטבלה ואי אפשר לשנות אותו מכאן — רק
                  בלוח של Supabase. הערכים עצמם לעולם אינם חוזרים לדפדפן; מוצגות רק ארבע
                  הספרות האחרונות.
                </p>
                <div className="admin-setting-new">
                  <input
                    value={draftKey}
                    onChange={(event) => setDraftKey(event.target.value)}
                    placeholder="GROQ_API_KEY"
                    aria-label="שם ההגדרה"
                    className="admin-key-input"
                  />
                  <input
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    placeholder="הערך"
                    aria-label="ערך ההגדרה"
                    type="password"
                  />
                  <button
                    type="button"
                    className="primary-button compact"
                    disabled={busy || !draftKey.trim() || !draftValue.trim()}
                    onClick={() =>
                      void act("setting.set", { key: draftKey, value: draftValue }, "ההגדרה נשמרה.").then(() => {
                        setDraftKey("");
                        setDraftValue("");
                      })
                    }
                  >
                    שמור
                  </button>
                </div>
                <ul className="admin-rows admin-rows-compact">
                  {(settings ?? []).map((item) => (
                    <li key={item.key} className={item.set ? "" : "is-muted"}>
                      <code className="admin-key" dir="ltr">{item.key}</code>
                      <span className="admin-feed-title" dir={item.preview ? "ltr" : undefined}>
                        {item.preview ?? "לא מוגדר"}
                      </span>
                      {item.source && (
                        <span className={`admin-flag ${item.source === "secret" ? "is-good" : ""}`}>
                          {item.source === "secret" ? "סוד של הפונקציה" : "טבלה"}
                        </span>
                      )}
                      {item.set && item.editable && (
                        <ConfirmButton
                          confirmLabel="למחוק?"
                          disabled={busy}
                          onConfirm={() => void act("setting.delete", { key: item.key }, "ההגדרה נמחקה.")}
                        >
                          <Trash2 size={14} />
                        </ConfirmButton>
                      )}
                    </li>
                  ))}
                  {settings === null && <li className="admin-empty">טוען…</li>}
                </ul>
              </AdminCard>

              <AdminCard title="יומן פעולות הניהול" icon={<ScrollText size={18} />} wide>
                <ul className="admin-rows admin-rows-compact">
                  {(audit ?? []).map((entry) => (
                    <li key={entry.id}>
                      <code className="admin-key" dir="ltr">{entry.action}</code>
                      <span className="admin-feed-title">{entry.target ?? "—"}</span>
                      <span className="admin-flag">{entry.actorEmail}</span>
                      <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                    </li>
                  ))}
                  {audit !== null && !audit.length && <li className="admin-empty">עוד לא בוצעה פעולה מאזור הניהול</li>}
                  {audit === null && <li className="admin-empty">טוען…</li>}
                </ul>
              </AdminCard>
            </>
          )}
        </div>
      )}
    </div>
  );
}
