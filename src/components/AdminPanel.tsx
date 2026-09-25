import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChartNoAxesColumn,
  CircleCheck,
  CircleSlash,
  Clock,
  Cloud,
  Download,
  Eye,
  FileCog,
  Gauge,
  Globe,
  KeyRound,
  Laptop,
  Megaphone,
  MessageSquareText,
  Power,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
  ShieldX,
  Stethoscope,
  Timer,
  TriangleAlert,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AdminError,
  actionLabel,
  busiestHour,
  changeOverRange,
  compactNumber,
  describeAdminError,
  fetchAudit,
  fetchFeedback,
  fetchSettings,
  fetchSnapshot,
  formatBytes,
  formatDuration,
  formatNumber,
  funnel,
  hourLabel,
  isAdmin,
  quotaLabel,
  runAdminAction,
  series,
  successRate,
  sumSeries,
  timeAgo,
  toCsv,
  toolHue,
  toolLabel,
  weekdayLabel,
  type AdminAuditEntry,
  type AdminCredits,
  type AdminSetting,
  type AdminSnapshot,
  type FeedbackEntry,
  type ControlState,
  type HealthCheck,
  type ToolRow,
} from "../lib/admin";
import { useAuth } from "../lib/auth";
import { PRICE_KEYS, PRICE_LABELS, entryLabel, type CreditRules } from "../lib/credits";
import { downloadFile } from "../lib/export";
import { TOOLS, findAnyTool } from "../lib/tools";
import {
  BarList,
  ConfirmButton,
  Funnel,
  Meter,
  Sparkline,
  SplitBar,
  StatTile,
  TimeChart,
  WeekHeatmap,
} from "./Charts";

/**
 * The admin area: how the site is doing, and the switches that change it.
 *
 * What it does *not* show is as deliberate as what it does. There is no list
 * of people here, no titles of anybody's work, no account to open — the rows
 * it draws from carry none of that to begin with. The question it answers is
 * "how is the site being used": which tools are opened, when, for how long,
 * what finishes and what breaks.
 *
 * The gate is on the server. `supabase/functions/admin` checks the verified
 * address on the caller's own token before it answers, so this page is not a
 * permission — it is the door. Opening it without that address shows the
 * refusal below, and forcing the route past it would still get 403 from every
 * request it makes.
 */

type Tab = "overview" | "tools" | "times" | "feedback" | "system";

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "סקירה", icon: ChartNoAxesColumn },
  { id: "tools", label: "כלים", icon: Activity },
  { id: "times", label: "זמנים וקהל", icon: Clock },
  { id: "feedback", label: "משוב", icon: MessageSquareText },
  { id: "system", label: "מערכת", icon: FileCog },
];

const RANGES = [7, 30, 90] as const;

type MetricId = "views" | "visitors" | "results" | "errors";

const METRICS: { id: MetricId; label: string; unit: string }[] = [
  { id: "views", label: "כניסות לכלים", unit: "כניסות" },
  { id: "visitors", label: "גולשים", unit: "גולשים" },
  { id: "results", label: "תוצאות שהופקו", unit: "תוצאות" },
  { id: "errors", label: "שגיאות", unit: "שגיאות" },
];

const dateTime = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

function Card({
  title,
  hint,
  icon,
  actions,
  children,
  wide,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`admin-card ${wide ? "is-wide" : ""}`}>
      <header className="admin-card-head">
        <div className="admin-card-title">
          {icon && <span className="admin-card-icon">{icon}</span>}
          <div>
            <h2>{title}</h2>
            {hint && <p>{hint}</p>}
          </div>
        </div>
        {actions && <div className="admin-card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ tabs */

function Overview({
  snapshot,
  metric,
  setMetric,
  onTool,
}: {
  snapshot: AdminSnapshot;
  metric: MetricId;
  setMetric: (id: MetricId) => void;
  onTool: (tool: string) => void;
}) {
  const stats = snapshot.stats;
  // The pages that are not tools — home, the personal area — count in the
  // totals but have no place in a ranking of tools.
  const tools = stats.tools.filter((tool) => findAnyTool(tool.tool));
  const chosen = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const points = series(stats.daily, metric);
  const change = changeOverRange(points);
  const viewPoints = series(stats.daily, "views");
  const errorRate = stats.views ? Math.round((sumSeries(series(stats.daily, "errors")) / stats.views) * 100) : 0;
  const top = tools[0];

  return (
    <div className="admin-grid">
      <div className="admin-tiles">
        <StatTile
          label="כניסות לכלים"
          value={compactNumber(stats.views)}
          trend={changeOverRange(viewPoints)}
          note={`ב־${snapshot.days} הימים האחרונים`}
          icon={<Eye size={16} />}
        >
          <Sparkline points={viewPoints} label="מגמת הכניסות" />
        </StatTile>
        <StatTile
          label="גולשים"
          value={compactNumber(stats.visitors.total)}
          note={`${formatNumber(stats.visitors.returning)} מהם חזרו ביותר מיום אחד`}
          icon={<Users size={16} />}
        />
        <StatTile
          label="עכשיו באתר"
          value={formatNumber(stats.live)}
          note="פעילות בחמש הדקות האחרונות"
          icon={<Zap size={16} />}
          hue={155}
        />
        <StatTile
          label="שיעור שגיאות"
          value={`${errorRate}%`}
          note={`${formatNumber(sumSeries(series(stats.daily, "errors")))} שגיאות מתוך ${compactNumber(stats.views)} כניסות`}
          icon={<TriangleAlert size={16} />}
          hue={errorRate >= 5 ? 25 : 250}
        />
      </div>

      <Card
        title={chosen.label}
        hint={
          change == null
            ? `לאורך ${snapshot.days} הימים האחרונים`
            : `המחצית האחרונה של הטווח לעומת הראשונה: ${change > 0 ? "+" : ""}${change}%`
        }
        icon={<ChartNoAxesColumn size={17} />}
        wide
        actions={
          <div className="chip-row" role="group" aria-label="מה להציג בגרף">
            {METRICS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip-toggle ${metric === item.id ? "active" : ""}`}
                aria-pressed={metric === item.id}
                onClick={() => setMetric(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        <TimeChart points={points} unit={chosen.unit} label={chosen.label} height={230} />
      </Card>

      <Card
        title="הכלים הנצפים ביותר"
        hint="לפי מספר הכניסות בטווח שנבחר"
        icon={<Activity size={17} />}
        actions={
          top ? <span className="admin-chip">המוביל: {toolLabel(top.tool)}</span> : undefined
        }
      >
        <BarList
          rows={tools.slice(0, 10).map((tool) => ({
            key: tool.tool,
            label: toolLabel(tool.tool),
            value: tool.views,
            hue: toolHue(tool.tool),
            hint: `${formatNumber(tool.results)} תוצאות · ${formatDuration(tool.dwellSeconds)}`,
          }))}
          unit="כניסות"
          onSelect={onTool}
          empty="עדיין לא נרשמו כניסות בטווח הזה"
        />
      </Card>

      <Card title="חדשים מול חוזרים" hint="לפי מזהה אנונימי שמתחלף כל חודש" icon={<Users size={17} />}>
        <SplitBar
          label="חדשים מול חוזרים"
          parts={[
            { key: "fresh", label: "נכנסו ביום אחד", value: stats.visitors.fresh },
            { key: "returning", label: "חזרו ביותר מיום", value: stats.visitors.returning },
          ]}
        />
        <p className="admin-foot-note">
          {stats.signedInShare}% מהכניסות נעשו כשמישהו מחובר לחשבון. מי — לא נשמר.
        </p>
      </Card>

      <Card title="מה נשמר באתר" hint="סך הכול, לא לפי טווח" icon={<Cloud size={17} />}>
        <ul className="admin-facts">
          <li>
            <span>חשבונות</span>
            <b>{formatNumber(snapshot.totals.accounts)}</b>
          </li>
          <li>
            <span>פריטים שמורים</span>
            <b>{formatNumber(snapshot.totals.works)}</b>
          </li>
          <li>
            <span>קבצים בענן</span>
            <b>
              {formatNumber(snapshot.totals.files)} <small>{formatBytes(snapshot.totals.bytes)}</small>
            </b>
          </li>
          <li>
            <span>קישורי שיתוף פעילים</span>
            <b>
              {formatNumber(snapshot.totals.liveShares)}{" "}
              <small>{formatNumber(snapshot.totals.shareViews)} צפיות</small>
            </b>
          </li>
        </ul>
      </Card>
    </div>
  );
}

function ToolsTab({ snapshot, focus, setFocus }: { snapshot: AdminSnapshot; focus: string | null; setFocus: (tool: string | null) => void }) {
  const tools = useMemo(() => snapshot.stats.tools.filter((tool) => findAnyTool(tool.tool)), [snapshot]);
  const pages = useMemo(() => snapshot.stats.tools.filter((tool) => !findAnyTool(tool.tool)), [snapshot]);
  const chosen = focus ? tools.find((tool) => tool.tool === focus) ?? null : null;
  const quiet = useMemo(() => {
    const seen = new Set(tools.map((tool) => tool.tool));
    return TOOLS.filter((tool) => !seen.has(tool.id));
  }, [tools]);

  const exportRows = () =>
    downloadFile(
      // A BOM, so a spreadsheet opens the Hebrew headings as Hebrew.
      `${String.fromCharCode(0xfeff)}${toCsv(
        tools.map((tool) => ({
          כלי: toolLabel(tool.tool),
          כניסות: tool.views,
          התחילו: tool.inputs,
          תוצאות: tool.results,
          שגיאות: tool.errors,
          גולשים: tool.visitors,
          "שהייה (שנ׳)": tool.dwellSeconds,
          "זמן עיבוד (שנ׳)": tool.workSeconds,
        })),
      )}`,
      `tools-${snapshot.days}d.csv`,
      "text/csv;charset=utf-8",
    );

  return (
    <div className="admin-grid">
      <Card
        title="כלי מול כלי"
        hint="כניסה, התחלה, תוצאה — ומה נשבר באמצע"
        icon={<Activity size={17} />}
        wide
        actions={
          <button type="button" className="secondary-button" onClick={exportRows} disabled={!tools.length}>
            <Download size={15} /> ייצוא CSV
          </button>
        }
      >
        {tools.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table tools-table">
              <thead>
                <tr>
                  <th scope="col">כלי</th>
                  <th scope="col">כניסות</th>
                  <th scope="col">גולשים</th>
                  <th scope="col">הצלחה</th>
                  <th scope="col">שהייה</th>
                  <th scope="col">עיבוד</th>
                  <th scope="col">שגיאות</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => {
                  const rate = successRate(tool);
                  return (
                    <tr
                      key={tool.tool}
                      className={focus === tool.tool ? "is-focus" : ""}
                      style={{ "--accent-hue": String(toolHue(tool.tool)) } as CSSProperties}
                    >
                      <th scope="row">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setFocus(focus === tool.tool ? null : tool.tool)}
                        >
                          <i className="tool-dot" aria-hidden="true" />
                          {toolLabel(tool.tool)}
                        </button>
                      </th>
                      <td>{formatNumber(tool.views)}</td>
                      <td>{formatNumber(tool.visitors)}</td>
                      <td>
                        {rate == null ? (
                          "—"
                        ) : (
                          <span className={`rate ${rate >= 60 ? "is-good" : rate >= 25 ? "is-ok" : "is-low"}`}>
                            {rate}%
                          </span>
                        )}
                      </td>
                      <td>{formatDuration(tool.dwellSeconds)}</td>
                      <td>{formatDuration(tool.workSeconds)}</td>
                      <td>{tool.errors ? <span className="rate is-low">{formatNumber(tool.errors)}</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-empty">עדיין לא נאספו מדידות בטווח הזה.</p>
        )}
        <p className="admin-foot-note">
          "הצלחה" היא היחס בין מי שנכנס לכלי לבין מי שיצא ממנו עם תוצאה. "שהייה" היא הזמן הממוצע
          בתוך הכלי, ו"עיבוד" הוא כמה זמן הכלי עצמו לקח.
        </p>
      </Card>

      {chosen && <ToolDetail tool={chosen} onClose={() => setFocus(null)} />}

      <Card title="תקלות חוזרות" hint="הסוג בלבד — בלי הקובץ, בלי מה שנכתב" icon={<TriangleAlert size={17} />}>
        {snapshot.stats.failures.length ? (
          <ul className="failure-list">
            {snapshot.stats.failures.map((failure) => (
              <li key={`${failure.tool}|${failure.code}`}>
                <span className="failure-tool" style={{ "--accent-hue": String(toolHue(failure.tool)) } as CSSProperties}>
                  <i className="tool-dot" aria-hidden="true" />
                  {toolLabel(failure.tool)}
                </span>
                <code>{failure.code}</code>
                <b>{formatNumber(failure.count)}</b>
                <small>{timeAgo(failure.last)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">לא נרשמה אף שגיאה בטווח הזה.</p>
        )}
      </Card>

      <Card title="כלים ששקטים" hint="לא נפתחו אף פעם בטווח שנבחר" icon={<CircleSlash size={17} />}>
        {quiet.length ? (
          <ul className="quiet-list">
            {quiet.map((tool) => (
              <li key={tool.id} style={{ "--accent-hue": String(tool.hue) } as CSSProperties}>
                <i className="tool-dot" aria-hidden="true" />
                {tool.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">כל הכלים נפתחו לפחות פעם אחת. יפה.</p>
        )}
      </Card>

      {pages.length > 0 && (
        <Card title="דפים שאינם כלים" hint="דף הבית, האזור האישי, דפי שיתוף" icon={<Eye size={17} />}>
          <BarList
            rows={pages.map((page) => ({
              key: page.tool,
              label: toolLabel(page.tool),
              value: page.views,
              hint: `שהייה ${formatDuration(page.dwellSeconds)}`,
            }))}
            unit="כניסות"
          />
        </Card>
      )}
    </div>
  );
}

function ToolDetail({ tool, onClose }: { tool: ToolRow; onClose: () => void }) {
  const rate = successRate(tool);
  return (
    <Card
      title={toolLabel(tool.tool)}
      hint="המסע בתוך הכלי"
      icon={<Gauge size={17} />}
      wide
      actions={
        <button type="button" className="link-button" onClick={onClose}>
          סגור
        </button>
      }
    >
      <div className="tool-detail" style={{ "--accent-hue": String(toolHue(tool.tool)) } as CSSProperties}>
        <Funnel steps={funnel(tool)} />
        <ul className="admin-facts">
          <li>
            <span>אחוז הצלחה</span>
            <b>{rate == null ? "—" : `${rate}%`}</b>
          </li>
          <li>
            <span>שהייה ממוצעת</span>
            <b>{formatDuration(tool.dwellSeconds)}</b>
          </li>
          <li>
            <span>זמן עיבוד ממוצע</span>
            <b>{formatDuration(tool.workSeconds)}</b>
          </li>
          <li>
            <span>גולשים שונים</span>
            <b>{formatNumber(tool.visitors)}</b>
          </li>
          <li>
            <span>שגיאות</span>
            <b>{formatNumber(tool.errors)}</b>
          </li>
        </ul>
      </div>
    </Card>
  );
}

function TimesTab({ snapshot }: { snapshot: AdminSnapshot }) {
  const stats = snapshot.stats;
  const peak = busiestHour(stats.hours);

  const lists: { title: string; hint: string; icon: ReactNode; rows: { key: string; value: number }[] }[] = [
    { title: "מכשירים", hint: "לפי רוחב המסך", icon: <Laptop size={17} />, rows: stats.devices },
    { title: "דפדפנים", hint: "מה פותחים בו את האתר", icon: <Globe size={17} />, rows: stats.browsers },
    { title: "מערכות הפעלה", hint: "", icon: <Laptop size={17} />, rows: stats.systems },
    { title: "שפות", hint: "שפת הדפדפן", icon: <Globe size={17} />, rows: stats.languages },
    { title: "מאיפה הגיעו", hint: "שם האתר המפנה בלבד — לא הדף", icon: <Globe size={17} />, rows: stats.referrers },
  ];

  return (
    <div className="admin-grid">
      <Card
        title="מתי נכנסים"
        hint={
          peak
            ? `הכי עמוס ביום ${weekdayLabel(peak.weekday)} בשעה ${hourLabel(peak.hour)} — ${formatNumber(peak.value)} כניסות`
            : "אין עדיין מספיק מדידות"
        }
        icon={<Clock size={17} />}
        wide
      >
        <WeekHeatmap grid={stats.hours} />
      </Card>

      {lists.map((list) => (
        <Card key={list.title} title={list.title} hint={list.hint} icon={list.icon}>
          <BarList
            rows={list.rows.map((row) => ({ key: row.key, label: row.key, value: row.value }))}
            unit="כניסות"
            empty="אין עדיין נתונים"
          />
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- system */

function ControlCard({
  control,
  onSave,
  busy,
}: {
  control: ControlState;
  onSave: (patch: Record<string, unknown>) => void;
  busy: boolean;
}) {
  // The drafts start from whatever the server holds. When that changes the
  // card is remounted from above by its key, which is simpler and less
  // surprising than copying props into state on every render.
  const [banner, setBanner] = useState(control.banner ?? "");
  const [bannerKind, setBannerKind] = useState(control.bannerKind);
  const [message, setMessage] = useState(control.maintenanceMessage ?? "");

  const toggleTool = (id: string) => {
    const off = new Set(control.disabledTools);
    if (off.has(id)) off.delete(id);
    else off.add(id);
    onSave({ disabledTools: [...off] });
  };

  return (
    <Card title="שליטה באתר" hint="שינוי כאן משפיע על כל הגולשים תוך דקות" icon={<Power size={17} />} wide>
      <div className="control-row">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={control.maintenance}
            disabled={busy}
            onChange={(event) => onSave({ maintenance: event.target.checked })}
          />
          <span>
            <b>מצב תחזוקה</b>
            <small>האתר נסגר לכולם ומוצגת הודעה בלבד. אזור הניהול נשאר פתוח לך.</small>
          </span>
        </label>
        <div className="control-field">
          <label htmlFor="admin-maintenance-text">הודעת התחזוקה</label>
          <div className="control-input">
            <input
              id="admin-maintenance-text"
              type="text"
              value={message}
              maxLength={300}
              placeholder="חוזרים בעוד כמה דקות…"
              onChange={(event) => setMessage(event.target.value)}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={busy || message === (control.maintenanceMessage ?? "")}
              onClick={() => onSave({ maintenanceMessage: message })}
            >
              שמירה
            </button>
          </div>
        </div>
      </div>

      <div className="control-field">
        <label htmlFor="admin-banner-text">
          <Megaphone size={15} /> הודעה לכל האתר
        </label>
        <div className="control-input">
          <input
            id="admin-banner-text"
            type="text"
            value={banner}
            maxLength={300}
            placeholder="למשל: הוספנו כלי חדש להפרדת שירה"
            onChange={(event) => setBanner(event.target.value)}
          />
          <select
            value={bannerKind}
            aria-label="סוג ההודעה"
            onChange={(event) => setBannerKind(event.target.value as ControlState["bannerKind"])}
          >
            <option value="info">מידע</option>
            <option value="good">בשורה טובה</option>
            <option value="warn">אזהרה</option>
          </select>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => onSave({ banner, bannerKind })}
          >
            פרסום
          </button>
          {control.banner && (
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => onSave({ banner: "" })}
            >
              הסרה
            </button>
          )}
        </div>
      </div>

      <div className="control-field">
        <span className="control-label">כלים פעילים</span>
        <p className="admin-foot-note">
          כלי שמכובה נשאר בדף הבית עם הסבר קצר, ואי אפשר לפתוח אותו. שימושי כששירות חיצוני נופל.
        </p>
        <ul className="tool-switches">
          {TOOLS.map((tool) => {
            const off = control.disabledTools.includes(tool.id);
            return (
              <li key={tool.id} style={{ "--accent-hue": String(tool.hue) } as CSSProperties}>
                <button
                  type="button"
                  className={`tool-switch ${off ? "is-off" : ""}`}
                  aria-pressed={!off}
                  disabled={busy}
                  onClick={() => toggleTool(tool.id)}
                >
                  <i className="tool-dot" aria-hidden="true" />
                  <span>{tool.title}</span>
                  <small>{off ? "מכובה" : "פעיל"}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

function SystemTab({
  snapshot,
  settings,
  audit,
  auditQuery,
  setAuditQuery,
  checks,
  busy,
  onControl,
  onSetting,
  onDeleteSetting,
  onHealth,
  onScan,
  onClean,
  onPrune,
  onResetUsage,
  onCredits,
  orphans,
}: {
  snapshot: AdminSnapshot;
  settings: AdminSetting[];
  audit: AdminAuditEntry[];
  auditQuery: string;
  setAuditQuery: (value: string) => void;
  checks: HealthCheck[] | null;
  busy: boolean;
  onControl: (patch: Record<string, unknown>) => void;
  onSetting: (key: string, value: string) => void;
  onDeleteSetting: (key: string) => void;
  onHealth: () => void;
  onScan: () => void;
  onClean: () => void;
  onPrune: () => void;
  onResetUsage: () => void;
  onCredits: (patch: Record<string, unknown>) => void;
  orphans: { count: number; bytes: number } | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const softGb = Number(settings.find((item) => item.key === "STORAGE_SOFT_GB")?.preview || "2");
  const limits: Record<string, number> = {
    stt: Number(settings.find((item) => item.key === "STT_DAILY_SECONDS")?.preview || 0),
    ai: Number(settings.find((item) => item.key === "AI_DAILY_TOKENS")?.preview || 0),
    tts: Number(settings.find((item) => item.key === "TTS_DAILY_CHARS")?.preview || 0),
    separation: Number(settings.find((item) => item.key === "SEPARATION_DAILY")?.preview || 0),
  };

  return (
    <div className="admin-grid">
      <ControlCard
        key={`${snapshot.control.banner ?? ""}|${snapshot.control.bannerKind}|${snapshot.control.maintenanceMessage ?? ""}`}
        control={snapshot.control}
        onSave={onControl}
        busy={busy}
      />

      <Card
        title="בריאות השירותים"
        hint="בדיקה חיה מול כל שירות חיצוני"
        icon={<Stethoscope size={17} />}
        actions={
          <button type="button" className="secondary-button" onClick={onHealth} disabled={busy}>
            <RefreshCw size={15} className={busy ? "is-spinning" : ""} /> בדיקה
          </button>
        }
      >
        {checks ? (
          <ul className="health-list">
            {checks.map((check) => (
              <li key={check.service} className={`health-${check.state}`}>
                <span className="health-mark" aria-hidden="true">
                  {check.state === "good" ? (
                    <CircleCheck size={16} />
                  ) : check.state === "bad" ? (
                    <AlertTriangle size={16} />
                  ) : (
                    <CircleSlash size={16} />
                  )}
                </span>
                <span className="health-name">
                  <b>{check.label}</b>
                  <small>{check.note}</small>
                </span>
                <span className="health-ms">{check.ms ? `${check.ms}ms` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">לחץ "בדיקה" כדי לפנות לכל שירות ולראות אם הוא עונה.</p>
        )}
      </Card>

      <CreditsAdminCard
        key={JSON.stringify(snapshot.credits.rules)}
        credits={snapshot.credits}
        days={snapshot.days}
        busy={busy}
        onSave={onCredits}
      />

      <Card title="מכסות וצריכה" hint="היום מול התקרה היומית שהוגדרה" icon={<Gauge size={17} />}>
        <div className="meter-stack">
          {snapshot.quotas.map((quota) => (
            <Meter
              key={quota.kind}
              label={quotaLabel(quota.kind)}
              value={quota.today}
              max={limits[quota.kind] || quota.today}
              note={
                limits[quota.kind]
                  ? `בטווח כולו: ${compactNumber(quota.range)}`
                  : `בטווח כולו: ${compactNumber(quota.range)} · אין תקרה מוגדרת`
              }
              format={compactNumber}
            />
          ))}
          <div className="row-actions">
            <ConfirmButton confirmLabel="לאפס את מכסות היום ואת הקרדיטים היומיים לכל החשבונות?" onConfirm={onResetUsage} disabled={busy}>
              <RefreshCw size={15} /> איפוס מכסות היום
            </ConfirmButton>
          </div>
          <Meter
            label="אחסון בענן"
            value={snapshot.totals.bytes}
            max={softGb * 1024 ** 3}
            note={`${formatNumber(snapshot.totals.files)} קבצים`}
            format={formatBytes}
          />
        </div>
      </Card>

      <Card
        title="מפתחות והגדרות שרת"
        hint="ערך של מפתח לא מוצג אף פעם — רק אם הוא קיים"
        icon={<KeyRound size={17} />}
        wide
      >
        <div className="admin-table-wrap">
          <table className="admin-table settings-table">
            <thead>
              <tr>
                <th scope="col">מפתח</th>
                <th scope="col">מצב</th>
                <th scope="col">מקור</th>
                <th scope="col">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => (
                <tr key={setting.key}>
                  <th scope="row">
                    <code>{setting.key}</code>
                    {setting.preview && <span className="setting-preview" dir="ltr">{setting.preview}</span>}
                    {SETTING_HINTS[setting.key] && <small className="setting-hint">{SETTING_HINTS[setting.key]}</small>}
                  </th>
                  <td>
                    <span className={`pill ${setting.set ? "is-on" : "is-off"}`}>
                      {setting.set ? "מוגדר" : "חסר"}
                    </span>
                  </td>
                  <td>{setting.source === "secret" ? "סוד של הפונקציה" : setting.source === "table" ? "טבלת הגדרות" : "—"}</td>
                  <td>
                    {editing === setting.key ? (
                      <span className="control-input">
                        <input
                          type={/KEY|TOKEN|SECRET|PASSWORD/.test(setting.key) ? "password" : "text"}
                          value={draft}
                          dir="ltr"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={SETTING_PLACEHOLDERS[setting.key]}
                          autoFocus
                          aria-label={`ערך ל־${setting.key}`}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!draft.trim() || busy}
                          onClick={() => {
                            onSetting(setting.key, draft.trim());
                            setEditing(null);
                            setDraft("");
                          }}
                        >
                          שמירה
                        </button>
                        <button type="button" className="link-button" onClick={() => setEditing(null)}>
                          ביטול
                        </button>
                      </span>
                    ) : setting.editable ? (
                      <span className="row-actions">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            setEditing(setting.key);
                            setDraft("");
                          }}
                        >
                          {setting.set ? "החלפה" : "הגדרה"}
                        </button>
                        {setting.source === "table" && (
                          <ConfirmButton
                            className="link-button is-danger"
                            confirmLabel="למחוק?"
                            onConfirm={() => onDeleteSetting(setting.key)}
                            disabled={busy}
                          >
                            מחיקה
                          </ConfirmButton>
                        )}
                      </span>
                    ) : (
                      <small className="admin-muted">נקבע כסוד — לא ניתן לשינוי מכאן</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="תחזוקה" hint="ניקוי קבצים יתומים ומדידות ישנות" icon={<Wrench size={17} />}>
        <div className="maintenance-row">
          <div>
            <b>קבצים שאף פריט לא מצביע עליהם</b>
            <p className="admin-foot-note">
              {orphans
                ? orphans.count
                  ? `נמצאו ${formatNumber(orphans.count)} קבצים (${formatBytes(orphans.bytes)}).`
                  : "לא נמצאו קבצים יתומים."
                : "סריקה עוברת על הדלי ומשווה לטבלאות."}
            </p>
          </div>
          <div className="row-actions">
            <button type="button" className="secondary-button" onClick={onScan} disabled={busy}>
              <Search size={15} /> סריקה
            </button>
            <ConfirmButton
              confirmLabel="למחוק לצמיתות?"
              onConfirm={onClean}
              disabled={busy || !orphans?.count}
            >
              ניקוי
            </ConfirmButton>
          </div>
        </div>
        <div className="maintenance-row">
          <div>
            <b>מדידות ישנות</b>
            <p className="admin-foot-note">
              {formatNumber(snapshot.stats.events)} מדידות בטווח הנוכחי. מחיקה מסירה כל מה שישן
              משנה — הן אנונימיות, אבל אין סיבה לשמור אותן לנצח.
            </p>
          </div>
          <ConfirmButton confirmLabel="למחוק מדידות מעל שנה?" onConfirm={onPrune} disabled={busy}>
            <Timer size={15} /> ניקוי מעל שנה
          </ConfirmButton>
        </div>
      </Card>

      <Card
        title="יומן פעולות"
        hint="כל שינוי שנעשה מאזור הניהול"
        icon={<ScrollText size={17} />}
        wide
        actions={
          <span className="admin-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={auditQuery}
              placeholder="חיפוש פעולה"
              aria-label="חיפוש ביומן"
              onChange={(event) => setAuditQuery(event.target.value)}
            />
          </span>
        }
      >
        {audit.length ? (
          <ul className="audit-list">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="audit-when">{formatDate(entry.createdAt)}</span>
                <span className="audit-what">
                  <b>{actionLabel(entry.action)}</b>
                  {entry.target && <code>{entry.target}</code>}
                </span>
                <span className="audit-who">{entry.actorEmail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">אין עדיין רשומות ביומן.</p>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- credits */

type CreditField = { key: keyof Omit<CreditRules, "enabled" | "prices">; server: string; label: string; hint: string };

const CREDIT_FIELDS: CreditField[] = [
  { key: "daily", server: "daily", label: "קצבה יומית לכל חשבון", hint: "מתחדשת בחצות, שעון ישראל" },
  { key: "signupBonus", server: "signup_bonus", label: "בונוס על חבר שמצטרף", hint: "פעם אחת, למי שהזמין" },
  { key: "friendDaily", server: "friend_daily", label: "תוספת יומית לכל חבר", hint: "לתמיד, לקצבה של מי שהזמין" },
  { key: "friendDailyMax", server: "friend_daily_max", label: "תקרת התוספת היומית", hint: "הכי הרבה שחברים מוסיפים ביום" },
  { key: "welcomeBonus", server: "welcome_bonus", label: "מתנת הצטרפות", hint: "לחבר החדש שהגיע דרך הזמנה" },
  { key: "visitBonus", server: "visit_bonus", label: "על כניסה חדשה לקישור", hint: "כל אדם נספר פעם אחת" },
  { key: "visitDailyMax", server: "visit_daily_max", label: "תקרת כניסות מתוגמלות ביום", hint: "לכל קישור" },
  { key: "signupDailyMax", server: "signup_daily_max", label: "תקרת בונוסי הצטרפות ביום", hint: "נגד חשבונות שנפתחים רק בשביל הבונוס" },
  { key: "claimHours", server: "claim_hours", label: "שעות לציון חבר אחרי ההרשמה", hint: "למי שנרשם ממכשיר אחר" },
];

/**
 * The credit rules, and how credits moved across the site in the range — in
 * totals only, never whose, like everything else on this page.
 */
function CreditsAdminCard({
  credits,
  days,
  busy,
  onSave,
}: {
  credits: AdminCredits;
  days: number;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const rules = credits.rules;
  const stats = credits.stats;
  // The drafts start from the server's numbers; a save remounts the card by its key.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    rules
      ? Object.fromEntries([
          ...CREDIT_FIELDS.map((field) => [field.key, String(rules[field.key])]),
          ...PRICE_KEYS.map((key) => [`price:${key}`, String(rules.prices[key])]),
        ])
      : {},
  );

  if (!rules) {
    return (
      <Card title="קרדיטים והזמנת חברים" hint="אין עדיין נתונים מהשרת" icon={<Zap size={17} />} wide>
        <p className="admin-empty">
          השרת לא החזיר את כללי הקרדיטים: פונקציית הניהול עוד לא עודכנה, או ש־supabase/credits.sql לא הורץ בפרויקט.
        </p>
      </Card>
    );
  }

  const changed =
    CREDIT_FIELDS.some((field) => draft[field.key] !== String(rules[field.key])) ||
    PRICE_KEYS.some((key) => draft[`price:${key}`] !== String(rules.prices[key]));
  const valid = Object.values(draft).every((value) => /^\d{1,6}$/.test(value.trim()));

  const save = () => {
    const patch: Record<string, unknown> = {};
    for (const field of CREDIT_FIELDS) patch[field.server] = Number(draft[field.key]);
    patch.prices = Object.fromEntries(PRICE_KEYS.map((key) => [key, Number(draft[`price:${key}`])]));
    onSave(patch);
  };

  const granted = stats?.granted ?? {};
  return (
    <Card
      title="קרדיטים והזמנת חברים"
      hint="כמה עולה כל פעולת שרת, כמה מקבלים — ואיך הקרדיטים זזים באתר"
      icon={<Zap size={17} />}
      wide
    >
      <label className="switch-row credits-admin-switch">
        <input type="checkbox" checked={rules.enabled} disabled={busy} onChange={(event) => onSave({ enabled: event.target.checked })} />
        <span>
          <b>קרדיטים פעילים</b>
          <small>כבוי: פעולות השרת לא נגבות ולא נחסמות, והאתר לא מזכיר קרדיטים. המכסות היומיות של כל כלי ממשיכות לחול.</small>
        </span>
      </label>

      {stats && (
        <div className="credits-admin-figures">
          <div>
            <span>נוצלו היום</span>
            <b>{formatNumber(stats.spentToday)}</b>
          </div>
          <div>
            <span>{`נוצלו ב־${days} ימים`}</span>
            <b>{compactNumber(stats.spent)}</b>
          </div>
          <div>
            <span>כניסות לקישורים</span>
            <b>{formatNumber(stats.visits)}</b>
            <small>{`${formatNumber(stats.visitsRewarded)} זיכו בקרדיט`}</small>
          </div>
          <div>
            <span>הצטרפו דרך חברים</span>
            <b>{formatNumber(stats.referred)}</b>
            <small>{`${formatNumber(stats.referredTotal)} מאז ההתחלה`}</small>
          </div>
          <div>
            <span>בונוס שמחכה בחשבונות</span>
            <b>{compactNumber(stats.bonusOutstanding)}</b>
            <small>{`ב־${formatNumber(stats.accounts)} חשבונות`}</small>
          </div>
          <div>
            <span>החזרים על כשלים</span>
            <b>{formatNumber(stats.refunds)}</b>
          </div>
        </div>
      )}

      {stats && (
        <div className="credits-admin-split">
          <div>
            <h3>על מה הלכו הקרדיטים</h3>
            <BarList
              rows={stats.byAction.map((row) => ({
                key: row.action,
                label: entryLabel({ kind: "spend", action: row.action, detail: {} }),
                value: row.credits,
                hint: `${formatNumber(row.count)} פעולות`,
              }))}
              unit="קרדיטים"
              empty="עדיין לא נוצלו קרדיטים בטווח"
            />
          </div>
          <div>
            <h3>מה ניתן במתנה</h3>
            <BarList
              rows={[
                { key: "signup", label: "על חברים שהצטרפו", value: granted.signup ?? 0 },
                { key: "welcome", label: "מתנות הצטרפות", value: granted.welcome ?? 0 },
                { key: "visit", label: "על כניסות לקישורים", value: granted.visit ?? 0 },
              ].filter((row) => row.value > 0)}
              unit="קרדיטים"
              empty="עדיין לא ניתנו קרדיטים בטווח"
            />
          </div>
        </div>
      )}

      <div className="credits-admin-form">
        <h3>הכללים</h3>
        <div className="credits-admin-fields">
          {CREDIT_FIELDS.map((field) => (
            <label key={field.key} className="credits-admin-field">
              <span>{field.label}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={draft[field.key] ?? ""}
                disabled={busy}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
              />
              <small>{field.hint}</small>
            </label>
          ))}
        </div>
        <h3>המחירון</h3>
        <div className="credits-admin-fields">
          {PRICE_KEYS.map((key) => (
            <label key={key} className="credits-admin-field">
              <span>{PRICE_LABELS[key].title}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={draft[`price:${key}`] ?? ""}
                disabled={busy}
                onChange={(event) => setDraft((current) => ({ ...current, [`price:${key}`]: event.target.value }))}
              />
              <small>{PRICE_LABELS[key].unit}</small>
            </label>
          ))}
        </div>
        <div className="row-actions">
          <button type="button" className="primary-button compact" disabled={busy || !changed || !valid} onClick={save}>
            שמירת הכללים
          </button>
          {!valid && <small className="admin-muted">כל ערך צריך להיות מספר שלם, 0 או יותר.</small>}
        </div>
      </div>
    </Card>
  );
}

/** Where to copy a setting from, shown under its name in the keys table. */
const SETTING_HINTS: Record<string, string> = {
  IDENTIFY_API_KEY: "זיהוי שירים (AudD). ה־API Token מ־dashboard.audd.io, או test לבדיקה (מכסה קטנה)",
  IDENTIFY_API_KEY_2: "מפתח AudD נוסף, לא חובה: כשהמכסה של המפתח הראשון נגמרת, הזיהוי עובר לכאן לבד",
  IDENTIFY_API_KEY_3: "מפתח AudD שלישי, לא חובה",
  IDENTIFY_DAILY: "כמה זיהויים מותרים לכל חשבון ביום (ברירת מחדל 30)",
};

const SETTING_PLACEHOLDERS: Record<string, string> = {
  IDENTIFY_DAILY: "30",
};

/* ------------------------------------------------------------------ page */

const FEEDBACK_KIND_LABELS: Record<FeedbackEntry["kind"], string> = { problem: "בעיה", idea: "רעיון", other: "אחר" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FeedbackState = { entries: FeedbackEntry[]; missing: boolean };

/** What visitors sent from "משוב והצעות": the open ones first, handled ones on request. */
function FeedbackTab({
  feedback,
  busy,
  onHandle,
  onDelete,
  onReload,
}: {
  feedback: FeedbackState | null;
  busy: boolean;
  onHandle: (entry: FeedbackEntry) => void;
  onDelete: (entry: FeedbackEntry) => void;
  onReload: () => void;
}) {
  const [showHandled, setShowHandled] = useState(false);
  // Deleting takes a second press on the same message.
  const [confirming, setConfirming] = useState<number | null>(null);

  if (!feedback) {
    return (
      <div className="admin-skeleton" role="status">
        <span className="admin-skeleton-bar" />
        <p>טוען את ההודעות…</p>
      </div>
    );
  }
  const open = feedback.entries.filter((entry) => !entry.handled);
  const shown = showHandled ? feedback.entries : open;

  return (
    <div className="admin-grid">
      <Card
        title="משוב מהגולשים"
        hint={feedback.missing ? "הטבלה עוד לא קיימת" : `${formatNumber(open.length)} ממתינות · ${formatNumber(feedback.entries.length)} בסך הכול`}
        icon={<MessageSquareText size={17} />}
        wide
        actions={
          <>
            <label className="feedback-filter">
              <input type="checkbox" checked={showHandled} onChange={(event) => setShowHandled(event.target.checked)} /> גם כאלה שטופלו
            </label>
            <button type="button" className="secondary-button compact" onClick={onReload} disabled={busy}>
              <RefreshCw size={15} /> רענון
            </button>
          </>
        }
      >
        {feedback.missing ? (
          <p className="notice-message">
            כדי לקבל משוב צריך להריץ פעם אחת את <code dir="ltr">supabase/site_feedback.sql</code> בפרויקט ה־Supabase.
          </p>
        ) : shown.length ? (
          <ul className="feedback-list">
            {shown.map((entry) => (
              <li key={entry.id} className={entry.handled ? "is-handled" : ""}>
                <div className="feedback-meta">
                  <span className={`feedback-kind is-${entry.kind}`}>{FEEDBACK_KIND_LABELS[entry.kind]}</span>
                  <span title={formatDate(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
                  {entry.page && <span>{entry.page === "home" ? "דף הבית" : toolLabel(entry.page)}</span>}
                  {(entry.device || entry.browser || entry.os) && <span dir="ltr">{[entry.device, entry.browser, entry.os].filter(Boolean).join(" · ")}</span>}
                </div>
                <p className="feedback-text" dir="auto">
                  {entry.message}
                </p>
                <div className="feedback-row-actions">
                  {entry.contact &&
                    (EMAIL.test(entry.contact) ? (
                      <a href={`mailto:${entry.contact}`} dir="ltr">
                        {entry.contact}
                      </a>
                    ) : (
                      <span dir="auto">{entry.contact}</span>
                    ))}
                  <button type="button" className="secondary-button compact" onClick={() => onHandle(entry)} disabled={busy}>
                    {entry.handled ? "החזר לטיפול" : "סמן כטופל"}
                  </button>
                  <button
                    type="button"
                    className={`secondary-button compact ${confirming === entry.id ? "is-danger" : ""}`}
                    onClick={() => {
                      if (confirming !== entry.id) {
                        setConfirming(entry.id);
                        return;
                      }
                      setConfirming(null);
                      onDelete(entry);
                    }}
                    onBlur={() => setConfirming((current) => (current === entry.id ? null : current))}
                    disabled={busy}
                  >
                    {confirming === entry.id ? "בטוח? למחוק" : "מחיקה"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">{feedback.entries.length ? "כל ההודעות טופלו." : "עוד לא הגיעו הודעות."}</p>
        )}
      </Card>
    </div>
  );
}

export function AdminPanel({ onHome }: { onHome: () => void }) {
  const { user } = useAuth();
  const allowed = isAdmin(user);

  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState<number>(30);
  const [metric, setMetric] = useState<MetricId>("views");
  const [focusTool, setFocusTool] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [orphans, setOrphans] = useState<{ count: number; bytes: number } | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (range: number) => {
      setLoading(true);
      setError(null);
      try {
        const [next, keys] = await Promise.all([fetchSnapshot(range), fetchSettings().catch(() => [])]);
        setSnapshot(next);
        setSettings(keys);
      } catch (cause) {
        setError(cause instanceof AdminError ? cause.message : describeAdminError("storage"));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!allowed) return;
    // The first paint should not wait on the network, and React wants the
    // fetch out of the effect body itself.
    const timer = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(timer);
  }, [allowed, days, load]);

  const loadFeedback = useCallback(() => {
    void fetchFeedback()
      .then(setFeedback)
      .catch(() => setFeedback((current) => current ?? { entries: [], missing: false }));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(loadFeedback, 0);
    return () => window.clearTimeout(timer);
  }, [allowed, loadFeedback]);
  const waiting = feedback ? feedback.entries.filter((entry) => !entry.handled).length : 0;

  useEffect(() => {
    if (!allowed || tab !== "system") return;
    const timer = window.setTimeout(() => {
      void fetchAudit(auditQuery)
        .then(setAudit)
        .catch(() => undefined);
    }, auditQuery ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [allowed, auditQuery, tab]);

  const act = useCallback(
    async (run: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await run();
      } catch (cause) {
        setError(cause instanceof AdminError ? cause.message : describeAdminError("storage"));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onControl = useCallback(
    (patch: Record<string, unknown>) =>
      void act(async () => {
        const result = await runAdminAction("control.set", patch);
        setSnapshot((current) =>
          current && result.control
            ? { ...current, control: { ...current.control, ...normalizePatch(patch, current.control) } }
            : current,
        );
        setNote("ההגדרות נשמרו. הגולשים יראו את השינוי תוך כמה דקות.");
      }),
    [act],
  );

  const onSetting = useCallback(
    (key: string, value: string) =>
      void act(async () => {
        await runAdminAction("setting.set", { key, value });
        setSettings(await fetchSettings());
        setNote(`${key} עודכן.`);
      }),
    [act],
  );

  const onDeleteSetting = useCallback(
    (key: string) =>
      void act(async () => {
        await runAdminAction("setting.delete", { key });
        setSettings(await fetchSettings());
        setNote(`${key} נמחק.`);
      }),
    [act],
  );

  const onHealth = useCallback(
    () =>
      void act(async () => {
        const result = await runAdminAction("health.check");
        setChecks(result.checks ?? []);
      }),
    [act],
  );

  const onScan = useCallback(
    () =>
      void act(async () => {
        const result = await runAdminAction("files.scan");
        setOrphans(result.orphans ?? { count: 0, bytes: 0 });
      }),
    [act],
  );

  const onClean = useCallback(
    () =>
      void act(async () => {
        const result = await runAdminAction("files.clean");
        setOrphans({ count: 0, bytes: 0 });
        setNote(`נמחקו ${formatNumber(result.orphans?.count ?? 0)} קבצים יתומים.`);
      }),
    [act],
  );

  const onPrune = useCallback(
    () =>
      void act(async () => {
        const result = await runAdminAction("events.prune", { days: 365 });
        setNote(`נמחקו ${formatNumber(result.removed ?? 0)} מדידות ישנות.`);
      }),
    [act],
  );

  const onHandleFeedback = useCallback(
    (entry: FeedbackEntry) =>
      void act(async () => {
        await runAdminAction("feedback.handle", { id: entry.id, handled: !entry.handled });
        setFeedback((current) => current && { ...current, entries: current.entries.map((item) => (item.id === entry.id ? { ...item, handled: !entry.handled } : item)) });
      }),
    [act],
  );

  const onDeleteFeedback = useCallback(
    (entry: FeedbackEntry) =>
      void act(async () => {
        await runAdminAction("feedback.delete", { id: entry.id });
        setFeedback((current) => current && { ...current, entries: current.entries.filter((item) => item.id !== entry.id) });
      }),
    [act],
  );

  const onResetUsage = useCallback(
    () =>
      void act(async () => {
        const result = await runAdminAction("usage.reset");
        setNote(`המכסות של היום אופסו (${formatNumber(result.removed ?? 0)} רשומות).`);
        await load(days);
      }),
    [act, load, days],
  );

  const onCredits = useCallback(
    (patch: Record<string, unknown>) =>
      void act(async () => {
        await runAdminAction("credits.set", patch);
        setNote("כללי הקרדיטים נשמרו. הם חלים מהפעולה הבאה של כל גולש.");
        await load(days);
      }),
    [act, load, days],
  );

  const openTool = useCallback((tool: string) => {
    setFocusTool(tool);
    setTab("tools");
  }, []);

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

  return (
    <div className="admin-page" style={{ "--accent-hue": 250 } as CSSProperties}>
      <header className="admin-head">
        <div>
          <p className="admin-eyebrow">
            <ShieldCheck size={15} /> אזור ניהול · {user?.email}
          </p>
          <h1>מצב האתר</h1>
          <p className="admin-subtitle">
            {snapshot
              ? `עודכן ${timeAgo(snapshot.generatedAt)} · ${compactNumber(snapshot.stats.views)} כניסות ב־${snapshot.days} ימים · ${formatNumber(snapshot.stats.live)} עכשיו באתר`
              : loading
                ? "טוען את הנתונים מהשרת…"
                : "אין עדיין נתונים להצגה."}
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

      <p className="admin-privacy-note">
        <ShieldCheck size={15} aria-hidden="true" />
        המדידות כאן אנונימיות לגמרי: הן אומרות איזה כלי נפתח ומתי, ולא מי עשה מה. אין כאן רשימת
        אנשים ואי אפשר לבנות אותה מהנתונים האלה.
      </p>

      {snapshot?.alerts.map((alert) => (
        <p key={alert.text} className={`admin-alert is-${alert.kind}`} role={alert.kind === "bad" ? "alert" : "status"}>
          {alert.kind === "bad" ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />} {alert.text}
        </p>
      ))}

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
      {snapshot?.truncated && (
        <p className="notice-message admin-message" role="status">
          בטווח הזה יש יותר מדידות ממה שהשרת קורא בבת אחת; המספרים מבוססים על החדשות ביותר.
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
              <Icon size={16} aria-hidden="true" /> {item.label}
              {item.id === "feedback" && waiting > 0 && <span className="admin-tab-count">{waiting}</span>}
            </button>
          );
        })}
      </nav>

      {tab === "feedback" ? (
        <FeedbackTab feedback={feedback} busy={busy} onHandle={onHandleFeedback} onDelete={onDeleteFeedback} onReload={loadFeedback} />
      ) : !snapshot ? (
        <div className="admin-skeleton" role="status">
          <span className="admin-skeleton-bar" />
          <span className="admin-skeleton-bar" />
          <span className="admin-skeleton-bar" />
          <p>{loading ? "אוסף את המדידות…" : "אין נתונים."}</p>
        </div>
      ) : tab === "overview" ? (
        <Overview snapshot={snapshot} metric={metric} setMetric={setMetric} onTool={openTool} />
      ) : tab === "tools" ? (
        <ToolsTab snapshot={snapshot} focus={focusTool} setFocus={setFocusTool} />
      ) : tab === "times" ? (
        <TimesTab snapshot={snapshot} />
      ) : (
        <SystemTab
          snapshot={snapshot}
          settings={settings}
          audit={audit}
          auditQuery={auditQuery}
          setAuditQuery={setAuditQuery}
          checks={checks}
          busy={busy}
          onControl={onControl}
          onSetting={onSetting}
          onDeleteSetting={onDeleteSetting}
          onHealth={onHealth}
          onScan={onScan}
          onClean={onClean}
          onPrune={onPrune}
          onResetUsage={onResetUsage}
          onCredits={onCredits}
          orphans={orphans}
        />
      )}
    </div>
  );
}

/** The switches a save changed, in the shape the page already holds. */
function normalizePatch(patch: Record<string, unknown>, current: ControlState): Partial<ControlState> {
  const next: Partial<ControlState> = {};
  if ("maintenance" in patch) next.maintenance = Boolean(patch.maintenance);
  if ("maintenanceMessage" in patch) {
    next.maintenanceMessage = String(patch.maintenanceMessage ?? "").trim() || null;
  }
  if ("banner" in patch) next.banner = String(patch.banner ?? "").trim() || null;
  if ("bannerKind" in patch) {
    const kind = patch.bannerKind;
    next.bannerKind = kind === "warn" || kind === "good" ? kind : "info";
  }
  if ("disabledTools" in patch) {
    next.disabledTools = Array.isArray(patch.disabledTools)
      ? patch.disabledTools.map(String)
      : current.disabledTools;
  }
  return next;
}

export default AdminPanel;
