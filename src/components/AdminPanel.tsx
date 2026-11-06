import { ArrowRight, RefreshCw, ShieldCheck, ShieldX } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AdminError,
  compactNumber,
  describeAdminError,
  fetchAccounts,
  fetchAudit,
  fetchFeedback,
  fetchSettings,
  fetchSnapshot,
  formatNumber,
  isAdmin,
  runAdminAction,
  timeAgo,
  type AccountEntry,
  type AdminAuditEntry,
  type AdminSetting,
  type AdminSnapshot,
  type ControlState,
  type FeedbackEntry,
  type HealthCheck,
} from "../lib/admin";
import { useAuth } from "../lib/auth";
import { Button, Notice, Segmented } from "../ui";
import { AccountsSection, type AccountsState } from "./admin/AccountsSection";
import { AudienceSection } from "./admin/AudienceSection";
import { AuditSection } from "./admin/AuditSection";
import { ControlSection } from "./admin/ControlSection";
import { CreditsSection } from "./admin/CreditsSection";
import { FeedbackSection, type FeedbackState } from "./admin/FeedbackSection";
import { OverviewSection } from "./admin/OverviewSection";
import { SECTION_GROUPS, sectionById, sectionFrom, type SectionId } from "./admin/sections";
import { ServerSection } from "./admin/ServerSection";
import { ToolsSection } from "./admin/ToolsSection";
import { Loading } from "./admin/shared";

/**
 * The admin area: how the site is doing, the people who use it, and the
 * switches that change it — nine parts in three groups, each on an address
 * of its own (`#/admin/feedback`), with the navigation beside them.
 *
 * What it does *not* show is as deliberate as what it does. The measurements
 * carry no titles of anybody's work and no account — the rows they are drawn
 * from never had any. The one list of people is the accounts part, read only
 * when opened and logged by the server each time.
 *
 * The gate is on the server. `supabase/functions/admin` checks the verified
 * address on the caller's own token before it answers, so this page is not a
 * permission — it is the door. Opening it without that address shows the
 * refusal below, and forcing the route past it would still get 403 from every
 * request it makes.
 */

const RANGES = ["7", "30", "90"] as const;

type Props = {
  /** The part named by the address (`#/admin/<part>`); the overview when absent. */
  section: string | null;
  onSection: (id: SectionId) => void;
  onHome: () => void;
};

export function AdminPanel({ section: sectionRoute, onSection, onHome }: Props) {
  const { user } = useAuth();
  const allowed = isAdmin(user);
  const section = sectionFrom(sectionRoute);
  const current = sectionById(section);

  const [days, setDays] = useState<number>(30);
  const [focusTool, setFocusTool] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[] | null>(null);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditRound, setAuditRound] = useState(0);
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [orphans, setOrphans] = useState<{ count: number; bytes: number } | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [feedbackQuery, setFeedbackQuery] = useState("");
  const [accounts, setAccounts] = useState<AccountsState | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* ------------------------------------------------------------ reading */

  const load = useCallback(async (range: number) => {
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
  }, []);

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
      .catch(() => setFeedback((existing) => existing ?? { entries: [], missing: false, upgrade: false }));
  }, []);

  // Read with everything else, so the count of waiting messages is in the
  // navigation from the start.
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(loadFeedback, 0);
    return () => window.clearTimeout(timer);
  }, [allowed, loadFeedback]);

  const loadAccounts = useCallback(() => {
    setAccountsLoading(true);
    setAccountsError(null);
    void fetchAccounts()
      .then(setAccounts)
      .catch((cause) => setAccountsError(cause instanceof AdminError ? cause.message : describeAdminError("storage")))
      .finally(() => setAccountsLoading(false));
  }, []);

  // The list of people is read only when its part is opened, not with the rest.
  const wantAccounts = allowed && section === "accounts" && !accounts && !accountsError;
  useEffect(() => {
    if (!wantAccounts) return;
    const timer = window.setTimeout(loadAccounts, 0);
    return () => window.clearTimeout(timer);
  }, [wantAccounts, loadAccounts]);

  useEffect(() => {
    if (!allowed || section !== "audit") return;
    const timer = window.setTimeout(
      () => {
        void fetchAudit(auditQuery)
          .then(setAudit)
          .catch(() => setAudit((existing) => existing ?? []));
      },
      auditQuery ? 300 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [allowed, auditQuery, auditRound, section]);

  const refresh = () => {
    void load(days);
    loadFeedback();
    if (accounts) loadAccounts();
    if (section === "audit") setAuditRound((round) => round + 1);
  };

  // A word that something was saved goes away by itself.
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 7000);
    return () => window.clearTimeout(timer);
  }, [note]);

  /* ------------------------------------------------------------ writing */

  const act = useCallback(async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof AdminError ? cause.message : describeAdminError("storage"));
    } finally {
      setBusy(false);
    }
  }, []);

  const onControl = useCallback(
    (patch: Record<string, unknown>) =>
      void act(async () => {
        const result = await runAdminAction("control.set", patch);
        setSnapshot((existing) =>
          existing && result.control
            ? { ...existing, control: { ...existing.control, ...normalizePatch(patch, existing.control) } }
            : existing,
        );
        setNote("נשמר. הגולשים יראו את השינוי תוך כמה דקות.");
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

  const onHandleFeedback = useCallback(
    (entry: FeedbackEntry) =>
      void act(async () => {
        await runAdminAction("feedback.handle", { id: entry.id, handled: !entry.handled });
        setFeedback(
          (existing) =>
            existing && {
              ...existing,
              entries: existing.entries.map((item) => (item.id === entry.id ? { ...item, handled: !entry.handled } : item)),
            },
        );
      }),
    [act],
  );

  const onDeleteFeedback = useCallback(
    (entry: FeedbackEntry) =>
      void act(async () => {
        await runAdminAction("feedback.delete", { id: entry.id });
        setFeedback((existing) => existing && { ...existing, entries: existing.entries.filter((item) => item.id !== entry.id) });
      }),
    [act],
  );

  /* ------------------------------------------------------- between parts */

  const go = (id: SectionId) => {
    setError(null);
    onSection(id);
  };

  const openTool = (tool: string) => {
    setFocusTool(tool);
    go("tools");
  };

  const showMessagesFrom = (account: AccountEntry) => {
    setFeedbackQuery(account.email ?? account.id);
    go("feedback");
  };

  const waiting = feedback ? feedback.entries.filter((entry) => !entry.handled).length : 0;
  const messagesFrom = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of feedback?.entries ?? []) if (entry.sender) counts.set(entry.sender.id, (counts.get(entry.sender.id) ?? 0) + 1);
    return counts;
  }, [feedback]);

  /** What each part of the navigation has waiting: a number, or a dot. */
  const badges: Partial<Record<SectionId, { text: string; tone: "accent" | "warning" | "danger"; label: string }>> = {};
  if (waiting) badges.feedback = { text: formatNumber(waiting), tone: "accent", label: `${formatNumber(waiting)} ממתינות` };
  if (snapshot?.control.maintenance) badges.control = { text: "!", tone: "danger", label: "מצב תחזוקה פעיל" };
  else if (snapshot?.control.disabledTools.length) {
    badges.control = { text: formatNumber(snapshot.control.disabledTools.length), tone: "warning", label: "כלים מכובים" };
  }
  if (snapshot?.alerts.some((alert) => alert.kind === "bad")) badges.server = { text: "!", tone: "danger", label: "אזהרה מהשרת" };

  /* --------------------------------------------------------------- door */

  if (!allowed) {
    return (
      <div className="admin-page adm-locked">
        <section className="adm-locked-card" aria-labelledby="adm-locked-title">
          <span className="adm-locked-mark" aria-hidden="true">
            <ShieldX size={26} />
          </span>
          <h1 id="adm-locked-title">האזור הזה סגור</h1>
          <p>
            אזור הניהול פתוח לחשבון של בעל האתר בלבד. גם אם מגיעים לכתובת הזאת ישירות, השרת אינו עונה לאף חשבון
            אחר.
          </p>
          <Button variant="primary" size="lg" icon={<ArrowRight size={17} />} onClick={onHome}>
            חזרה לכלי המוזיקה
          </Button>
        </section>
      </div>
    );
  }

  /* --------------------------------------------------------------- page */

  const needsSnapshot = !["accounts", "feedback", "audit"].includes(section);

  let content;
  if (section === "accounts") {
    content = (
      <AccountsSection
        state={accounts}
        loading={accountsLoading}
        error={accountsError}
        onReload={loadAccounts}
        messagesFrom={messagesFrom}
        onShowMessages={showMessagesFrom}
      />
    );
  } else if (section === "feedback") {
    content = (
      <FeedbackSection
        feedback={feedback}
        busy={busy}
        query={feedbackQuery}
        setQuery={setFeedbackQuery}
        onHandle={onHandleFeedback}
        onDelete={onDeleteFeedback}
        onReload={loadFeedback}
      />
    );
  } else if (section === "audit") {
    content = <AuditSection audit={audit} query={auditQuery} setQuery={setAuditQuery} />;
  } else if (!snapshot) {
    content = error ? (
      <Notice tone="danger" action={<Button size="sm" onClick={() => void load(days)}>נסה שוב</Button>}>
        {error}
      </Notice>
    ) : (
      <Loading text={loading ? "אוסף את המדידות…" : "אין נתונים."} />
    );
  } else if (section === "overview") {
    content = <OverviewSection snapshot={snapshot} waiting={waiting} onGo={go} onTool={openTool} />;
  } else if (section === "tools") {
    content = <ToolsSection snapshot={snapshot} focus={focusTool} setFocus={setFocusTool} />;
  } else if (section === "audience") {
    content = <AudienceSection snapshot={snapshot} />;
  } else if (section === "control") {
    content = <ControlSection key={JSON.stringify(snapshot.control)} control={snapshot.control} busy={busy} onSave={onControl} />;
  } else if (section === "credits") {
    content = (
      <CreditsSection
        key={JSON.stringify(snapshot.credits.rules)}
        credits={snapshot.credits}
        days={snapshot.days}
        busy={busy}
        onSave={onCredits}
      />
    );
  } else {
    content = (
      <ServerSection
        snapshot={snapshot}
        settings={settings}
        checks={checks}
        orphans={orphans}
        busy={busy}
        onHealth={onHealth}
        onSetting={onSetting}
        onDeleteSetting={onDeleteSetting}
        onResetUsage={onResetUsage}
        onScan={onScan}
        onClean={onClean}
        onPrune={onPrune}
      />
    );
  }

  return (
    <div className="admin-page adm" style={{ "--accent-hue": 250 } as CSSProperties}>
      <header className="adm-head">
        <div className="adm-head-text">
          <p className="adm-kicker">
            <ShieldCheck size={15} aria-hidden="true" /> אזור ניהול
            {user?.email && (
              <span className="adm-kicker-who" dir="ltr">
                {user.email}
              </span>
            )}
          </p>
          <h1>{current.title}</h1>
          <p className="adm-lead">{current.lead}</p>
        </div>
        <div className="adm-head-actions">
          {current.ranged && (
            <Segmented
              size="sm"
              className="adm-range"
              label="טווח הזמן"
              value={String(days) as (typeof RANGES)[number]}
              onChange={(value) => setDays(Number(value))}
              options={RANGES.map((value) => ({ id: value, label: `${value} ימים` }))}
            />
          )}
          <Button size="sm" icon={<RefreshCw size={15} />} loading={loading} onClick={refresh}>
            רענון
          </Button>
          <Button size="sm" variant="ghost" icon={<ArrowRight size={15} />} onClick={onHome}>
            לאתר
          </Button>
        </div>
      </header>

      <p className="adm-status" role="status">
        <span className={`adm-live ${snapshot?.stats.live ? "is-on" : ""}`} aria-hidden="true" />
        {snapshot
          ? `עודכן ${timeAgo(snapshot.generatedAt)} · ${formatNumber(snapshot.stats.live)} עכשיו באתר · ${compactNumber(snapshot.stats.views)} כניסות ב־${snapshot.days} ימים`
          : loading
            ? "טוען את הנתונים מהשרת…"
            : "אין עדיין נתונים להצגה."}
      </p>

      {error && (snapshot || !needsSnapshot) && (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {note && (
        <Notice tone="success" onClose={() => setNote(null)}>
          {note}
        </Notice>
      )}
      {snapshot?.truncated && needsSnapshot && (
        <Notice tone="info">בטווח הזה יש יותר מדידות ממה שהשרת קורא בבת אחת; המספרים מבוססים על החדשות ביותר.</Notice>
      )}

      <div className="adm-layout">
        <nav className="adm-nav" aria-label="חלקי אזור הניהול">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label} className="adm-nav-group">
              <p className="adm-nav-heading">{group.label}</p>
              <ul>
                {group.ids.map((id) => {
                  const item = sectionById(id);
                  const Icon = item.icon;
                  const badge = badges[id];
                  const active = id === section;
                  return (
                    <li key={id}>
                      <a
                        href={id === "overview" ? "#/admin" : `#/admin/${id}`}
                        className={`adm-nav-item ${active ? "is-current" : ""}`}
                        aria-current={active ? "page" : undefined}
                        data-tour={`admin-nav-${id}`}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                          event.preventDefault();
                          go(id);
                        }}
                      >
                        <Icon size={17} aria-hidden="true" />
                        <span className="adm-nav-label">{item.label}</span>
                        {badge && (
                          <span className={`adm-badge is-${badge.tone}`} title={badge.label}>
                            {badge.text}
                            <span className="sr-only"> ({badge.label})</span>
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="adm-nav-privacy">
            <ShieldCheck size={14} aria-hidden="true" />
            המדידות אנונימיות: איזה כלי נפתח ומתי, לא מי. רשימת האנשים נמצאת ב„חשבונות” בלבד, וכל פתיחה שלה נרשמת ביומן.
          </p>
        </nav>

        <div className="adm-main" key={section}>
          {content}
        </div>
      </div>
    </div>
  );
}

/** The switches a save changed, in the shape the page already holds. */
function normalizePatch(patch: Record<string, unknown>, existing: ControlState): Partial<ControlState> {
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
    next.disabledTools = Array.isArray(patch.disabledTools) ? patch.disabledTools.map(String) : existing.disabledTools;
  }
  return next;
}

export default AdminPanel;
