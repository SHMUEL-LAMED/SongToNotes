import { ChartNoAxesColumn, Coins, Gift, ListChecks, Save, Undo2, Zap } from "lucide-react";
import { useState } from "react";
import { compactNumber, formatNumber, type AdminCredits } from "../../lib/admin";
import { PRICE_KEYS, PRICE_LABELS, entryLabel, type CreditRules } from "../../lib/credits";
import { Button, Field, FieldGrid, Input, Notice, PanelSection, Stat, StatGrid, Switch } from "../../ui";
import { BarList, TimeChart } from "../Charts";
import { Card } from "./shared";

type RuleField = { key: keyof Omit<CreditRules, "enabled" | "prices">; server: string; label: string; hint: string };

const RULE_FIELDS: RuleField[] = [
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

function draftFrom(rules: CreditRules): Record<string, string> {
  return Object.fromEntries([
    ...RULE_FIELDS.map((field) => [field.key, String(rules[field.key])]),
    ...PRICE_KEYS.map((key) => [`price:${key}`, String(rules.prices[key])]),
  ]);
}

/**
 * The credit rules, and how credits moved across the site in the range — in
 * totals only, never whose, like everything else outside the accounts list.
 * The drafts start from the server's numbers; a save remounts the section by
 * its key.
 */
export function CreditsSection({
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
  const [draft, setDraft] = useState<Record<string, string>>(() => (rules ? draftFrom(rules) : {}));

  if (!rules) {
    return (
      <Notice tone="warning">
        השרת לא החזיר את כללי הקרדיטים: פונקציית הניהול עוד לא עודכנה, או ש־<code dir="ltr">supabase/credits.sql</code> לא הורץ
        בפרויקט.
      </Notice>
    );
  }

  const original = draftFrom(rules);
  const changed = Object.keys(original).some((key) => draft[key] !== original[key]);
  const valid = Object.values(draft).every((value) => /^\d{1,6}$/.test(value.trim()));
  const granted = stats?.granted ?? {};

  const save = () => {
    const patch: Record<string, unknown> = {};
    for (const field of RULE_FIELDS) patch[field.server] = Number(draft[field.key]);
    patch.prices = Object.fromEntries(PRICE_KEYS.map((key) => [key, Number(draft[`price:${key}`])]));
    onSave(patch);
  };

  const numberField = (key: string, label: string, hint: string) => {
    const value = draft[key] ?? "";
    const bad = !/^\d{1,6}$/.test(value.trim());
    return (
      <Field key={key} label={label} hint={hint} error={bad ? "מספר שלם, 0 או יותר" : undefined} className={draft[key] !== original[key] ? "is-changed" : undefined}>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          mono
          value={value}
          disabled={busy}
          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        />
      </Field>
    );
  };

  return (
    <div className="admin-grid adm-grid">
      <Card wide title="מתג ראשי" hint="המכסות היומיות של כל כלי ממשיכות לחול גם כשהקרדיטים כבויים" icon={<Zap size={16} />}>
        <Switch
          label={rules.enabled ? "הקרדיטים פעילים" : "הקרדיטים כבויים"}
          hint="כבוי: פעולות השרת לא נגבות ולא נחסמות, והאתר לא מזכיר קרדיטים."
          checked={rules.enabled}
          disabled={busy}
          onChange={(checked) => onSave({ enabled: checked })}
        />
      </Card>

      {stats && (
        <Card wide title="איך הקרדיטים זזים" hint={`ב־${days} הימים האחרונים`} icon={<ChartNoAxesColumn size={16} />}>
          <StatGrid min={120}>
            <Stat label="נוצלו היום" value={formatNumber(stats.spentToday)} />
            <Stat label={`נוצלו ב־${days} ימים`} value={compactNumber(stats.spent)} />
            <Stat label="כניסות לקישורים" value={formatNumber(stats.visits)} hint={`${formatNumber(stats.visitsRewarded)} זיכו בקרדיט`} />
            <Stat label="הצטרפו דרך חברים" value={formatNumber(stats.referred)} hint={`${formatNumber(stats.referredTotal)} מאז ההתחלה`} />
            <Stat label="בונוס שמחכה בחשבונות" value={compactNumber(stats.bonusOutstanding)} hint={`ב־${formatNumber(stats.accounts)} חשבונות`} />
            <Stat label="החזרים על כשלים" value={formatNumber(stats.refunds)} />
          </StatGrid>
          {stats.daily.length > 0 && (
            <TimeChart
              points={stats.daily.map((row) => ({ day: row.day, value: row.spent }))}
              unit="קרדיטים"
              label="קרדיטים שנוצלו בכל יום"
              height={170}
            />
          )}
        </Card>
      )}

      {stats && (
        <>
          <Card title="על מה הלכו הקרדיטים" hint="לפי סוג הפעולה" icon={<Coins size={16} />}>
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
          </Card>
          <Card title="מה ניתן במתנה" hint="על חברים, הצטרפות וכניסות" icon={<Gift size={16} />}>
            <BarList
              rows={[
                { key: "signup", label: "על חברים שהצטרפו", value: granted.signup ?? 0 },
                { key: "welcome", label: "מתנות הצטרפות", value: granted.welcome ?? 0 },
                { key: "visit", label: "על כניסות לקישורים", value: granted.visit ?? 0 },
                { key: "grant", label: "מתנות מהמנהל", value: granted.grant ?? 0 },
              ].filter((row) => row.value > 0)}
              unit="קרדיטים"
              empty="עדיין לא ניתנו קרדיטים בטווח"
            />
          </Card>
        </>
      )}

      <Card
        wide
        className="adm-credits-rules"
        title="הכללים והמחירון"
        hint="שינוי חל מהפעולה הבאה של כל גולש"
        icon={<ListChecks size={16} />}
        actions={
          <>
            {changed && (
              <Button size="sm" variant="ghost" icon={<Undo2 size={15} />} disabled={busy} onClick={() => setDraft(original)}>
                ביטול השינויים
              </Button>
            )}
            <Button size="sm" variant="primary" icon={<Save size={15} />} disabled={busy || !changed || !valid} onClick={save}>
              שמירת הכללים
            </Button>
          </>
        }
      >
        <PanelSection title="כמה מקבלים">
          <FieldGrid min={210}>{RULE_FIELDS.map((field) => numberField(field.key, field.label, field.hint))}</FieldGrid>
        </PanelSection>
        <PanelSection title="כמה עולה כל פעולה">
          <FieldGrid min={210}>
            {PRICE_KEYS.map((key) => numberField(`price:${key}`, PRICE_LABELS[key].title, PRICE_LABELS[key].unit))}
          </FieldGrid>
        </PanelSection>
      </Card>
    </div>
  );
}
