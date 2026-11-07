import {
  Activity,
  ArrowLeft,
  ChartNoAxesColumn,
  CircleCheck,
  Cloud,
  Eye,
  Megaphone,
  MessageSquareText,
  Power,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";
import { useState } from "react";
import {
  changeOverRange,
  compactNumber,
  formatBytes,
  formatDuration,
  formatNumber,
  series,
  sumSeries,
  toolHue,
  toolLabel,
  type AdminSnapshot,
} from "../../lib/admin";
import { findAnyTool } from "../../lib/tools";
import { Button, Chip, Segmented } from "../../ui";
import { BarList, Sparkline, SplitBar, StatTile, TimeChart } from "../Charts";
import type { SectionId } from "./sections";
import { Card, Note } from "./shared";

type MetricId = "views" | "visitors" | "results" | "errors";

const METRICS: { id: MetricId; label: string; unit: string }[] = [
  { id: "views", label: "כניסות", unit: "כניסות" },
  { id: "visitors", label: "גולשים", unit: "גולשים" },
  { id: "results", label: "תוצאות", unit: "תוצאות" },
  { id: "errors", label: "שגיאות", unit: "שגיאות" },
];

type Attention = {
  key: string;
  tone: "bad" | "warn" | "info";
  text: string;
  go?: SectionId;
  action?: string;
};

/**
 * What needs a look before anything else, gathered from every part of the
 * area: a closed site, a message on every page, tools switched off, feedback
 * waiting, the server's own warnings, a spike in errors.
 */
function attentionList(snapshot: AdminSnapshot, waiting: number, errorRate: number): Attention[] {
  const items: Attention[] = [];
  const { control } = snapshot;
  if (control.maintenance) {
    items.push({ key: "maintenance", tone: "bad", text: "האתר סגור לגולשים: מצב תחזוקה פעיל.", go: "control", action: "לפתוח" });
  }
  if (waiting > 0) {
    items.push({
      key: "feedback",
      tone: "warn",
      text: waiting === 1 ? "הודעת משוב אחת ממתינה לטיפול." : `${formatNumber(waiting)} הודעות משוב ממתינות לטיפול.`,
      go: "feedback",
      action: "לקרוא",
    });
  }
  if (control.disabledTools.length) {
    items.push({
      key: "tools-off",
      tone: "warn",
      text:
        control.disabledTools.length === 1
          ? `הכלי „${toolLabel(control.disabledTools[0])}” מכובה.`
          : `${formatNumber(control.disabledTools.length)} כלים מכובים.`,
      go: "control",
      action: "לשליטה",
    });
  }
  for (const alert of snapshot.alerts) {
    items.push({ key: `alert:${alert.text}`, tone: alert.kind, text: alert.text, go: "server", action: "לשרת" });
  }
  if (errorRate >= 5) {
    items.push({ key: "errors", tone: "warn", text: `שיעור השגיאות עומד על ${errorRate}% מהכניסות.`, go: "tools", action: "לכלים" });
  }
  if (control.banner) {
    items.push({ key: "banner", tone: "info", text: `מוצגת הודעה לכל האתר: „${control.banner}”`, go: "control", action: "לעריכה" });
  }
  if (snapshot.credits.rules && !snapshot.credits.rules.enabled) {
    items.push({ key: "credits-off", tone: "info", text: "הקרדיטים כבויים: פעולות השרת לא נגבות.", go: "credits", action: "לקרדיטים" });
  }
  return items;
}

const ATTENTION_ICON = {
  bad: <TriangleAlert size={16} />,
  warn: <TriangleAlert size={16} />,
  info: <Megaphone size={16} />,
};

export function OverviewSection({
  snapshot,
  waiting,
  onGo,
  onTool,
}: {
  snapshot: AdminSnapshot;
  /** Feedback not yet handled. */
  waiting: number;
  onGo: (id: SectionId) => void;
  onTool: (tool: string) => void;
}) {
  const [metric, setMetric] = useState<MetricId>("views");
  const stats = snapshot.stats;
  // The pages that are not tools — home, the personal area — count in the
  // totals but have no place in a ranking of tools.
  const tools = stats.tools.filter((tool) => findAnyTool(tool.tool));
  const chosen = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const points = series(stats.daily, metric);
  const change = changeOverRange(points);
  const viewPoints = series(stats.daily, "views");
  const errors = sumSeries(series(stats.daily, "errors"));
  const errorRate = stats.views ? Math.round((errors / stats.views) * 100) : 0;
  const attention = attentionList(snapshot, waiting, errorRate);
  const top = tools[0];

  return (
    <div className="admin-grid adm-grid">
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
          note={`${formatNumber(errors)} שגיאות מתוך ${compactNumber(stats.views)} כניסות`}
          icon={<TriangleAlert size={16} />}
          hue={errorRate >= 5 ? 25 : undefined}
        />
      </div>

      <Card
        wide
        className="adm-attention"
        title="מה דורש תשומת לב"
        hint={attention.length ? `${formatNumber(attention.length)} דברים לבדוק` : "נאסף מכל חלקי האזור"}
        icon={attention.length ? <TriangleAlert size={16} /> : <CircleCheck size={16} />}
      >
        {attention.length ? (
          <ul className="adm-attention-list">
            {attention.map((item) => (
              <li key={item.key} className={`is-${item.tone}`}>
                <span className="adm-attention-mark" aria-hidden="true">
                  {ATTENTION_ICON[item.tone]}
                </span>
                <span className="adm-attention-text" dir="auto">
                  {item.text}
                </span>
                {item.go && (
                  <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => onGo(item.go!)}>
                    {item.action}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-all-clear">
            <CircleCheck size={18} aria-hidden="true" /> הכול שקט: האתר פתוח, אין משוב שממתין ואין אזהרות מהשרת.
          </p>
        )}
      </Card>

      <Card
        wide
        title={chosen.label === "כניסות" ? "כניסות לכלים" : chosen.label}
        hint={
          change == null
            ? `לאורך ${snapshot.days} הימים האחרונים`
            : `המחצית האחרונה של הטווח לעומת הראשונה: ${change > 0 ? "+" : ""}${change}%`
        }
        icon={<ChartNoAxesColumn size={16} />}
        actions={
          <Segmented
            size="sm"
            label="מה להציג בגרף"
            value={metric}
            onChange={setMetric}
            options={METRICS.map((item) => ({ id: item.id, label: item.label }))}
          />
        }
      >
        <TimeChart points={points} unit={chosen.unit} label={chosen.label} height={230} />
      </Card>

      <Card
        title="הכלים הנצפים ביותר"
        hint="לחיצה על כלי פותחת את הפירוט שלו"
        icon={<Activity size={16} />}
        actions={top ? <Chip tone="accent">המוביל: {toolLabel(top.tool)}</Chip> : undefined}
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

      <div className="adm-stack">
        <Card title="חדשים מול חוזרים" hint="לפי מזהה אנונימי שמתחלף כל חודש" icon={<Users size={16} />}>
          <SplitBar
            label="חדשים מול חוזרים"
            parts={[
              { key: "fresh", label: "נכנסו ביום אחד", value: stats.visitors.fresh },
              { key: "returning", label: "חזרו ביותר מיום", value: stats.visitors.returning },
            ]}
          />
          <Note>{stats.signedInShare}% מהכניסות נעשו כשמישהו מחובר לחשבון. מי — לא נשמר.</Note>
        </Card>

        <Card title="מה נשמר באתר" hint="סך הכול, לא לפי טווח" icon={<Cloud size={16} />}>
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
                {formatNumber(snapshot.totals.liveShares)} <small>{formatNumber(snapshot.totals.shareViews)} צפיות</small>
              </b>
            </li>
          </ul>
          <div className="adm-card-links">
            <Button size="sm" variant="ghost" icon={<Users size={15} />} onClick={() => onGo("accounts")}>
              לחשבונות
            </Button>
            <Button size="sm" variant="ghost" icon={<MessageSquareText size={15} />} onClick={() => onGo("feedback")}>
              למשוב
            </Button>
            <Button size="sm" variant="ghost" icon={<Power size={15} />} onClick={() => onGo("control")}>
              לשליטה באתר
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
