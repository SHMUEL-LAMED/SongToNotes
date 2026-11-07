import { AlertTriangle, CircleCheck, CircleSlash, Gauge, HardDrive, KeyRound, RefreshCw, Search, Stethoscope, Timer, Wrench } from "lucide-react";
import { useState } from "react";
import {
  compactNumber,
  formatBytes,
  formatNumber,
  quotaLabel,
  type AdminSetting,
  type AdminSnapshot,
  type HealthCheck,
} from "../../lib/admin";
import { Button, Chip, Input } from "../../ui";
import { Meter } from "../Charts";
import { ArmedButton, Card, Empty, Note } from "./shared";

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

const HEALTH_ICON: Record<HealthCheck["state"], typeof CircleCheck> = {
  good: CircleCheck,
  bad: AlertTriangle,
  off: CircleSlash,
};

function settingNumber(settings: AdminSetting[], key: string, fallback = 0) {
  return Number(settings.find((item) => item.key === key)?.preview || fallback);
}

export function ServerSection({
  snapshot,
  settings,
  checks,
  orphans,
  busy,
  onHealth,
  onSetting,
  onDeleteSetting,
  onResetUsage,
  onScan,
  onClean,
  onPrune,
}: {
  snapshot: AdminSnapshot;
  settings: AdminSetting[];
  checks: HealthCheck[] | null;
  orphans: { count: number; bytes: number } | null;
  busy: boolean;
  onHealth: () => void;
  onSetting: (key: string, value: string) => void;
  onDeleteSetting: (key: string) => void;
  onResetUsage: () => void;
  onScan: () => void;
  onClean: () => void;
  onPrune: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const softGb = settingNumber(settings, "STORAGE_SOFT_GB", 2) || 2;
  const limits: Record<string, number> = {
    stt: settingNumber(settings, "STT_DAILY_SECONDS"),
    ai: settingNumber(settings, "AI_DAILY_TOKENS"),
    tts: settingNumber(settings, "TTS_DAILY_CHARS"),
    separation: settingNumber(settings, "SEPARATION_DAILY"),
  };
  const missing = settings.filter((setting) => !setting.set).length;
  const failing = checks?.filter((check) => check.state === "bad").length ?? 0;

  const stopEditing = () => {
    setEditing(null);
    setDraft("");
  };

  return (
    <div className="admin-grid adm-grid">
      <Card
        title="בריאות השירותים"
        hint={checks ? (failing ? `${formatNumber(failing)} שירותים לא עונים` : "כל השירותים שנבדקו עונים") : "בדיקה חיה מול כל שירות חיצוני"}
        icon={<Stethoscope size={16} />}
        actions={
          <Button size="sm" icon={<RefreshCw size={15} />} loading={busy && !checks} onClick={onHealth} disabled={busy}>
            {checks ? "בדיקה חוזרת" : "בדיקה"}
          </Button>
        }
      >
        {checks ? (
          <ul className="adm-health">
            {checks.map((check) => {
              const Icon = HEALTH_ICON[check.state];
              return (
                <li key={check.service} className={`is-${check.state}`}>
                  <span className="adm-health-mark" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className="adm-health-name">
                    <b>{check.label}</b>
                    <small>{check.note}</small>
                  </span>
                  <span className="adm-health-ms" dir="ltr">
                    {check.ms ? `${check.ms}ms` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>„בדיקה” פונה לכל שירות ומראה אם הוא עונה ותוך כמה זמן.</Empty>
        )}
      </Card>

      <Card title="מכסות היום" hint="הצריכה היום מול התקרה היומית שהוגדרה" icon={<Gauge size={16} />}>
        <div className="adm-meters">
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
          <Meter
            label="אחסון בענן"
            value={snapshot.totals.bytes}
            max={softGb * 1024 ** 3}
            note={`${formatNumber(snapshot.totals.files)} קבצים · התקרה הרכה ${softGb}GB`}
            format={formatBytes}
          />
        </div>
        <div className="adm-card-links">
          <ArmedButton icon={<RefreshCw size={15} />} confirmLabel="לאפס את מכסות היום ואת הקרדיטים היומיים לכולם?" onConfirm={onResetUsage} disabled={busy}>
            איפוס מכסות היום
          </ArmedButton>
        </div>
      </Card>

      <Card
        wide
        title="מפתחות והגדרות שרת"
        hint={missing ? `${formatNumber(missing)} חסרים · ערך של מפתח לא מוצג אף פעם, רק אם הוא קיים` : "ערך של מפתח לא מוצג אף פעם — רק אם הוא קיים"}
        icon={<KeyRound size={16} />}
      >
        {settings.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table adm-settings-table">
              <thead>
                <tr>
                  <th scope="col">מפתח</th>
                  <th scope="col">מצב</th>
                  <th scope="col">מקור</th>
                  <th scope="col">
                    <span className="sr-only">פעולה</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.map((setting) => (
                  <tr key={setting.key}>
                    <th scope="row">
                      <code dir="ltr">{setting.key}</code>
                      {setting.preview && (
                        <span className="adm-setting-preview" dir="ltr">
                          {setting.preview}
                        </span>
                      )}
                      {SETTING_HINTS[setting.key] && <small className="adm-setting-hint">{SETTING_HINTS[setting.key]}</small>}
                    </th>
                    <td>
                      <Chip tone={setting.set ? "success" : "neutral"}>{setting.set ? "מוגדר" : "חסר"}</Chip>
                    </td>
                    <td>{setting.source === "secret" ? "סוד של הפונקציה" : setting.source === "table" ? "טבלת הגדרות" : "—"}</td>
                    <td>
                      {editing === setting.key ? (
                        <form
                          className="adm-inline"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!draft.trim()) return;
                            onSetting(setting.key, draft.trim());
                            stopEditing();
                          }}
                        >
                          <Input
                            size="sm"
                            type={/KEY|TOKEN|SECRET|PASSWORD/.test(setting.key) ? "password" : "text"}
                            value={draft}
                            dir="ltr"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={SETTING_PLACEHOLDERS[setting.key]}
                            autoFocus
                            aria-label={`ערך ל־${setting.key}`}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") stopEditing();
                            }}
                          />
                          <Button size="sm" variant="primary" type="submit" disabled={!draft.trim() || busy}>
                            שמירה
                          </Button>
                          <Button size="sm" variant="ghost" onClick={stopEditing}>
                            ביטול
                          </Button>
                        </form>
                      ) : setting.editable ? (
                        <span className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(setting.key);
                              setDraft("");
                            }}
                          >
                            {setting.set ? "החלפה" : "הגדרה"}
                          </Button>
                          {setting.source === "table" && (
                            <ArmedButton confirmLabel="למחוק?" onConfirm={() => onDeleteSetting(setting.key)} disabled={busy}>
                              מחיקה
                            </ArmedButton>
                          )}
                        </span>
                      ) : (
                        <small className="adm-muted">נקבע כסוד — לא ניתן לשינוי מכאן</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>השרת לא החזיר רשימת מפתחות.</Empty>
        )}
      </Card>

      <Card wide title="ניקיון" hint="קבצים שאף פריט לא מצביע עליהם, ומדידות ישנות" icon={<Wrench size={16} />}>
        <div className="adm-chores">
          <div className="adm-chore">
            <span className="adm-chore-icon" aria-hidden="true">
              <HardDrive size={18} />
            </span>
            <div className="adm-chore-text">
              <b>קבצים יתומים</b>
              <p>
                {orphans
                  ? orphans.count
                    ? `נמצאו ${formatNumber(orphans.count)} קבצים (${formatBytes(orphans.bytes)}).`
                    : "לא נמצאו קבצים יתומים."
                  : "הסריקה עוברת על האחסון ומשווה לטבלאות."}
              </p>
            </div>
            <div className="row-actions">
              <Button size="sm" icon={<Search size={15} />} onClick={onScan} disabled={busy}>
                סריקה
              </Button>
              <ArmedButton confirmLabel="למחוק לצמיתות?" onConfirm={onClean} disabled={busy || !orphans?.count}>
                ניקוי
              </ArmedButton>
            </div>
          </div>
          <div className="adm-chore">
            <span className="adm-chore-icon" aria-hidden="true">
              <Timer size={18} />
            </span>
            <div className="adm-chore-text">
              <b>מדידות ישנות</b>
              <p>
                {formatNumber(snapshot.stats.events)} מדידות בטווח הנוכחי. הניקוי מסיר כל מה שישן משנה — הן אנונימיות, אבל אין
                סיבה לשמור אותן לנצח.
              </p>
            </div>
            <ArmedButton confirmLabel="למחוק מדידות מעל שנה?" onConfirm={onPrune} disabled={busy}>
              ניקוי מעל שנה
            </ArmedButton>
          </div>
        </div>
        <Note>שתי הפעולות נרשמות ביומן הפעולות.</Note>
      </Card>
    </div>
  );
}
