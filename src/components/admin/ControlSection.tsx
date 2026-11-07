import { Construction, Megaphone, Power, Search, ToggleRight } from "lucide-react";
import { useMemo, useState } from "react";
import { formatNumber, type ControlState } from "../../lib/admin";
import { TOOLS } from "../../lib/tools";
import { Button, ChipToggle, Field, Input, LedBar, Notice, Select, Switch, type NoticeTone } from "../../ui";
import { Card, Empty, Note } from "./shared";

const BANNER_KINDS: { id: ControlState["bannerKind"]; label: string; tone: NoticeTone }[] = [
  { id: "info", label: "מידע", tone: "info" },
  { id: "good", label: "בשורה טובה", tone: "success" },
  { id: "warn", label: "אזהרה", tone: "warning" },
];

/**
 * The switches every visitor feels within minutes: closing the site,
 * a message on every page, and a tool taken out of reach.
 *
 * The drafts start from whatever the server holds; when that changes the
 * section is remounted from above by its key, which is simpler and less
 * surprising than copying props into state on every render.
 */
export function ControlSection({
  control,
  busy,
  onSave,
}: {
  control: ControlState;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [message, setMessage] = useState(control.maintenanceMessage ?? "");
  const [banner, setBanner] = useState(control.banner ?? "");
  const [bannerKind, setBannerKind] = useState(control.bannerKind);
  const [query, setQuery] = useState("");

  const off = useMemo(() => new Set(control.disabledTools), [control.disabledTools]);
  const needle = query.trim().toLowerCase();
  const tools = TOOLS.filter((tool) => !needle || tool.title.toLowerCase().includes(needle) || tool.id.includes(needle));
  const tone = BANNER_KINDS.find((kind) => kind.id === bannerKind)?.tone ?? "info";
  const bannerChanged = banner.trim() !== (control.banner ?? "") || bannerKind !== control.bannerKind;

  const toggleTool = (id: string) => {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSave({ disabledTools: [...next] });
  };

  return (
    <div className="admin-grid adm-grid">
      <Card
        title="מצב תחזוקה"
        hint="האתר נסגר לכולם ומוצגת הודעה בלבד. אזור הניהול נשאר פתוח לך."
        icon={<Construction size={16} />}
        className={control.maintenance ? "adm-card-alarm" : undefined}
      >
        <Switch
          label={control.maintenance ? "האתר סגור עכשיו לגולשים" : "האתר פתוח"}
          hint={control.maintenance ? "כיבוי המתג פותח אותו מחדש לכולם." : "הדלקה סוגרת אותו מיד לכל מי שאינו מנהל."}
          checked={control.maintenance}
          disabled={busy}
          onChange={(checked) => onSave({ maintenance: checked })}
        />
        <Field label="ההודעה שהגולשים יראו" htmlFor="adm-maintenance-text" hint="עד 300 תווים. ריק — הודעת ברירת המחדל.">
          <span className="adm-inline">
            <Input
              id="adm-maintenance-text"
              value={message}
              maxLength={300}
              placeholder="חוזרים בעוד כמה דקות…"
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              disabled={busy || message.trim() === (control.maintenanceMessage ?? "")}
              onClick={() => onSave({ maintenanceMessage: message })}
            >
              שמירה
            </Button>
          </span>
        </Field>
      </Card>

      <Card title="הודעה לכל האתר" hint="פס קטן בראש כל עמוד, לכל הגולשים" icon={<Megaphone size={16} />}>
        <Field label="הנוסח" htmlFor="adm-banner-text">
          <Input
            id="adm-banner-text"
            value={banner}
            maxLength={300}
            placeholder="למשל: הוספנו כלי חדש להפרדת שירה"
            onChange={(event) => setBanner(event.target.value)}
          />
        </Field>
        <Field label="סוג" htmlFor="adm-banner-kind">
          <Select
            id="adm-banner-kind"
            value={bannerKind}
            onChange={(event) => setBannerKind(event.target.value as ControlState["bannerKind"])}
          >
            {BANNER_KINDS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>
        {banner.trim() && (
          <div className="adm-preview">
            <span className="adm-preview-label">{control.banner && !bannerChanged ? "מוצגת עכשיו" : "כך היא תיראה"}</span>
            <Notice tone={tone}>{banner.trim()}</Notice>
          </div>
        )}
        <div className="adm-card-links">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !banner.trim() || !bannerChanged}
            onClick={() => onSave({ banner: banner.trim(), bannerKind })}
          >
            {control.banner ? "עדכון ההודעה" : "פרסום"}
          </Button>
          {control.banner && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBanner("");
                onSave({ banner: "" });
              }}
            >
              הסרת ההודעה
            </Button>
          )}
        </div>
      </Card>

      <Card
        wide
        title="כלים פעילים"
        hint={
          off.size
            ? `${formatNumber(off.size)} מתוך ${formatNumber(TOOLS.length)} כלים מכובים`
            : `כל ${formatNumber(TOOLS.length)} הכלים פעילים`
        }
        icon={<ToggleRight size={16} />}
        actions={
          <>
            <div className="adm-search">
              <Search size={15} aria-hidden="true" />
              <Input
                size="sm"
                type="search"
                value={query}
                placeholder="חיפוש כלי"
                aria-label="חיפוש כלי"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {off.size > 0 && (
              <Button size="sm" icon={<Power size={15} />} disabled={busy} onClick={() => onSave({ disabledTools: [] })}>
                להפעיל את כולם
              </Button>
            )}
          </>
        }
      >
        {tools.length ? (
          <ul className="adm-tool-switches">
            {tools.map((tool) => {
              const isOff = off.has(tool.id);
              return (
                <li key={tool.id}>
                  <ChipToggle
                    pressed={!isOff}
                    className={isOff ? "is-off" : undefined}
                    disabled={busy}
                    icon={<LedBar hue={tool.hue} on={!isOff} />}
                    onChange={() => toggleTool(tool.id)}
                    title={isOff ? "מכובה — לחיצה מפעילה" : "פעיל — לחיצה מכבה"}
                  >
                    {tool.title}
                    <small>{isOff ? "מכובה" : "פעיל"}</small>
                  </ChipToggle>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>אין כלי שמתאים לחיפוש.</Empty>
        )}
        <Note>כלי שמכובה נשאר בדף הבית עם הסבר קצר, ואי אפשר לפתוח אותו. שימושי כששירות חיצוני נופל. לך הוא ממשיך להיפתח.</Note>
      </Card>
    </div>
  );
}
