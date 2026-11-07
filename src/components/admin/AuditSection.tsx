import { Download, ScrollText, Search } from "lucide-react";
import { actionLabel, timeAgo, type AdminAuditEntry } from "../../lib/admin";
import { Button, Input } from "../../ui";
import { downloadCsv, formatDate } from "./format";
import { Card, Empty, Loading } from "./shared";

/** Every change made from the admin area: when, what, on what, and by whom. */
export function AuditSection({
  audit,
  query,
  setQuery,
}: {
  /** Null until the first read comes back. */
  audit: AdminAuditEntry[] | null;
  query: string;
  setQuery: (value: string) => void;
}) {
  const exportRows = () =>
    downloadCsv(
      (audit ?? []).map((entry) => ({
        מתי: formatDate(entry.createdAt),
        פעולה: actionLabel(entry.action),
        על: entry.target ?? "",
        מי: entry.actorEmail,
      })),
      "admin-audit.csv",
    );

  return (
    <Card
      title="היומן"
      hint="הרשומות האחרונות; החיפוש פונה לשרת"
      icon={<ScrollText size={16} />}
      actions={
        <>
          <div className="adm-search">
            <Search size={15} aria-hidden="true" />
            <Input
              size="sm"
              type="search"
              value={query}
              placeholder="חיפוש פעולה"
              aria-label="חיפוש ביומן"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button size="sm" icon={<Download size={15} />} onClick={exportRows} disabled={!audit?.length}>
            CSV
          </Button>
        </>
      }
    >
      {!audit ? (
        <Loading text="טוען את היומן…" lines={2} />
      ) : audit.length ? (
        <ol className="adm-audit">
          {audit.map((entry) => (
            <li key={entry.id}>
              <span className="adm-audit-when" title={formatDate(entry.createdAt)}>
                {timeAgo(entry.createdAt)}
              </span>
              <span className="adm-audit-what">
                <b>{actionLabel(entry.action)}</b>
                {entry.target && <code dir="ltr">{entry.target}</code>}
              </span>
              <span className="adm-audit-who" dir="ltr">
                {entry.actorEmail}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>{query ? "אין רשומה שמתאימה לחיפוש." : "אין עדיין רשומות ביומן."}</Empty>
      )}
    </Card>
  );
}
