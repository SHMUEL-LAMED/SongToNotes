import { Clock, Globe, Languages, Laptop, Link2, MonitorSmartphone } from "lucide-react";
import type { ReactNode } from "react";
import { busiestHour, formatNumber, hourLabel, weekdayLabel, type AdminSnapshot, type Tally } from "../../lib/admin";
import { BarList, WeekHeatmap } from "../Charts";
import { Card } from "./shared";

/** When people come, on what, and from where — counts only, never who. */
export function AudienceSection({ snapshot }: { snapshot: AdminSnapshot }) {
  const stats = snapshot.stats;
  const peak = busiestHour(stats.hours);

  const lists: { title: string; hint: string; icon: ReactNode; rows: Tally[] }[] = [
    { title: "מכשירים", hint: "לפי רוחב המסך", icon: <MonitorSmartphone size={16} />, rows: stats.devices },
    { title: "דפדפנים", hint: "מה פותחים בו את האתר", icon: <Globe size={16} />, rows: stats.browsers },
    { title: "מערכות הפעלה", hint: "מה רץ על המכשיר", icon: <Laptop size={16} />, rows: stats.systems },
    { title: "שפות", hint: "שפת הדפדפן", icon: <Languages size={16} />, rows: stats.languages },
    { title: "מאיפה הגיעו", hint: "שם האתר המפנה בלבד — לא הדף", icon: <Link2 size={16} />, rows: stats.referrers },
  ];

  return (
    <div className="admin-grid adm-grid">
      <Card
        wide
        title="מתי נכנסים"
        hint={
          peak
            ? `הכי עמוס ביום ${weekdayLabel(peak.weekday)} בשעה ${hourLabel(peak.hour)} — ${formatNumber(peak.value)} כניסות`
            : "אין עדיין מספיק מדידות"
        }
        icon={<Clock size={16} />}
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
