import { Check, Mail, MessageSquareText, RefreshCw, RotateCcw, Search, Trash2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { formatNumber, senderLabel, timeAgo, toolLabel, type FeedbackEntry } from "../../lib/admin";
import { Button, ChipToggle, Input, Notice, Segmented } from "../../ui";
import { formatDate } from "./format";
import { ArmedButton, Card, Empty, Loading } from "./shared";

export type FeedbackState = { entries: FeedbackEntry[]; missing: boolean; upgrade: boolean };

type Status = "open" | "handled" | "all";
type From = "all" | "accounts" | "guests";
type Kind = FeedbackEntry["kind"];

const KIND_LABELS: Record<Kind, string> = { problem: "בעיה", idea: "רעיון", other: "אחר" };
const KINDS: Kind[] = ["problem", "idea", "other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where to answer a message: the account's address, or one the visitor wrote in. */
function replyAddress(entry: FeedbackEntry) {
  if (entry.sender?.email) return entry.sender.email;
  return entry.contact && EMAIL.test(entry.contact) ? entry.contact : null;
}

/** What visitors sent from "משוב והצעות": the open ones first, with who sent each. */
export function FeedbackSection({
  feedback,
  busy,
  query,
  setQuery,
  onHandle,
  onDelete,
  onReload,
}: {
  feedback: FeedbackState | null;
  busy: boolean;
  /** The search, held above: the accounts list can open this page filtered to one sender. */
  query: string;
  setQuery: (value: string) => void;
  onHandle: (entry: FeedbackEntry) => void;
  onDelete: (entry: FeedbackEntry) => void;
  onReload: () => void;
}) {
  const [status, setStatus] = useState<Status>("open");
  const [from, setFrom] = useState<From>("all");
  const [kinds, setKinds] = useState<Set<Kind>>(() => new Set());

  const perSender = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of feedback?.entries ?? []) if (entry.sender) counts.set(entry.sender.id, (counts.get(entry.sender.id) ?? 0) + 1);
    return counts;
  }, [feedback]);

  if (!feedback) return <Loading text="טוען את ההודעות…" />;

  if (feedback.missing) {
    return (
      <Notice tone="warning">
        כדי לקבל משוב צריך להריץ פעם אחת את <code dir="ltr">supabase/site_feedback.sql</code> בפרויקט ה־Supabase.
      </Notice>
    );
  }

  const entries = feedback.entries;
  const openCount = entries.filter((entry) => !entry.handled).length;
  const needle = query.trim().toLowerCase();
  const shown = entries.filter((entry) => {
    if (status === "open" && entry.handled) return false;
    if (status === "handled" && !entry.handled) return false;
    if (from === "accounts" && !entry.sender) return false;
    if (from === "guests" && entry.sender) return false;
    if (kinds.size && !kinds.has(entry.kind)) return false;
    if (!needle) return true;
    const sender = entry.sender;
    return [entry.message, entry.contact, sender?.name, sender?.email, sender?.phone, sender?.id].some((text) =>
      text?.toLowerCase().includes(needle),
    );
  });
  const filtered = Boolean(needle) || from !== "all" || kinds.size > 0;

  const toggleKind = (kind: Kind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  return (
    <div className="adm-feedback">
      {feedback.upgrade && (
        <Notice tone="info">
          כדי לראות מי שלח כל הודעה צריך להריץ שוב את <code dir="ltr">supabase/site_feedback.sql</code> בפרויקט ה־Supabase.
        </Notice>
      )}

      <Card
        title="ההודעות"
        hint={`${formatNumber(openCount)} ממתינות · ${formatNumber(entries.length)} בסך הכול · ${formatNumber(entries.filter((entry) => entry.sender).length)} מחשבונות`}
        icon={<MessageSquareText size={16} />}
        actions={
          <Button size="sm" icon={<RefreshCw size={15} />} onClick={onReload} disabled={busy}>
            רענון
          </Button>
        }
      >
        <div className="adm-filters">
          <Segmented
            size="sm"
            label="מצב ההודעות"
            value={status}
            onChange={setStatus}
            options={[
              { id: "open", label: "ממתינות" },
              { id: "handled", label: "טופלו" },
              { id: "all", label: "הכול" },
            ]}
          />
          <Segmented
            size="sm"
            label="מי שלח"
            value={from}
            onChange={setFrom}
            options={[
              { id: "all", label: "מכולם" },
              { id: "accounts", label: "מחשבונות" },
              { id: "guests", label: "מאורחים" },
            ]}
          />
          <div className="adm-chips" role="group" aria-label="סוג ההודעה">
            {KINDS.map((kind) => (
              <ChipToggle key={kind} pressed={kinds.has(kind)} onChange={() => toggleKind(kind)}>
                {KIND_LABELS[kind]}
              </ChipToggle>
            ))}
          </div>
          <div className="adm-search">
            <Search size={15} aria-hidden="true" />
            <Input
              size="sm"
              type="search"
              value={query}
              placeholder="תוכן, שם או אימייל"
              aria-label="חיפוש בהודעות"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        {shown.length ? (
          <ul className="adm-messages">
            {shown.map((entry) => {
              const reply = replyAddress(entry);
              const count = entry.sender ? perSender.get(entry.sender.id) ?? 0 : 0;
              return (
                <li key={entry.id} className={entry.handled ? "is-handled" : ""}>
                  <div className="adm-message-meta">
                    <span className={`adm-kind is-${entry.kind}`}>{KIND_LABELS[entry.kind]}</span>
                    <span title={formatDate(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
                    {entry.page && <span>{entry.page === "home" ? "דף הבית" : toolLabel(entry.page)}</span>}
                    {(entry.device || entry.browser || entry.os) && (
                      <span dir="ltr">{[entry.device, entry.browser, entry.os].filter(Boolean).join(" · ")}</span>
                    )}
                    {entry.handled && <span className="adm-handled">טופל</span>}
                  </div>
                  <div className={`adm-sender ${entry.sender ? "" : "is-guest"}`}>
                    <UserRound size={15} aria-hidden="true" />
                    {entry.sender ? (
                      <>
                        <button
                          type="button"
                          className="adm-sender-name"
                          title="כל ההודעות מהחשבון הזה"
                          dir="auto"
                          onClick={() => setQuery(entry.sender?.email ?? entry.sender?.id ?? "")}
                        >
                          {senderLabel(entry.sender)}
                        </button>
                        {entry.sender.email && entry.sender.email !== senderLabel(entry.sender) && <span dir="ltr">{entry.sender.email}</span>}
                        {count > 1 && <span className="adm-sender-count">{formatNumber(count)} הודעות</span>}
                      </>
                    ) : (
                      <span>אורח (לא מחובר)</span>
                    )}
                    {entry.contact && entry.contact !== entry.sender?.email && (
                      <span className="adm-contact" dir="auto" title="פרטי קשר שנכתבו בהודעה">
                        {entry.contact}
                      </span>
                    )}
                  </div>
                  <p className="adm-message-text" dir="auto">
                    {entry.message}
                  </p>
                  <div className="adm-message-actions">
                    <Button
                      size="sm"
                      variant={entry.handled ? "secondary" : "primary"}
                      icon={entry.handled ? <RotateCcw size={15} /> : <Check size={15} />}
                      onClick={() => onHandle(entry)}
                      disabled={busy}
                    >
                      {entry.handled ? "החזרה לטיפול" : "סימון כטופל"}
                    </Button>
                    {reply && (
                      <Button
                        as="a"
                        size="sm"
                        icon={<Mail size={15} />}
                        href={`mailto:${reply}?subject=${encodeURIComponent("תודה על המשוב")}`}
                      >
                        תשובה במייל
                      </Button>
                    )}
                    <ArmedButton icon={<Trash2 size={15} />} confirmLabel="בטוח? למחוק" onConfirm={() => onDelete(entry)} disabled={busy}>
                      מחיקה
                    </ArmedButton>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>
            {filtered
              ? "אין הודעה שמתאימה לסינון."
              : status === "open" && entries.length
                ? "כל ההודעות טופלו."
                : status === "handled"
                  ? "עוד לא סומנה הודעה כטופלה."
                  : "עוד לא הגיעו הודעות."}
          </Empty>
        )}
        {filtered && (
          <div className="adm-card-links">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery("");
                setFrom("all");
                setKinds(new Set());
              }}
            >
              ניקוי הסינון
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
