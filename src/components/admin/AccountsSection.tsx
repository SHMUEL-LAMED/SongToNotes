import { Activity, Clock, Download, Mail, MessageSquareText, RefreshCw, Search, UserRound, Users, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import {
  accountSummary,
  formatBytes,
  formatNumber,
  providerLabel,
  timeAgo,
  type AccountEntry,
} from "../../lib/admin";
import { Button, Chip, Input, Notice, Select, Sheet } from "../../ui";
import { StatTile } from "../Charts";
import { downloadCsv, formatDate } from "./format";
import { Card, Empty, Loading, Note } from "./shared";

export type AccountsState = { accounts: AccountEntry[]; truncated: boolean };

type AccountSort = "joined" | "seen" | "works" | "bytes" | "bonus";

const SORTS: { id: AccountSort; label: string }[] = [
  { id: "joined", label: "הצטרפות" },
  { id: "seen", label: "כניסה אחרונה" },
  { id: "works", label: "עבודות" },
  { id: "bytes", label: "אחסון" },
  { id: "bonus", label: "קרדיטים" },
];

const time = (value: string | null) => (value ? new Date(value).getTime() || 0 : 0);

const SORT_KEY: Record<AccountSort, (account: AccountEntry) => number> = {
  joined: (account) => time(account.createdAt),
  seen: (account) => time(account.lastSignInAt),
  works: (account) => account.works,
  bytes: (account) => account.bytes,
  bonus: (account) => account.bonus ?? -1,
};

export function AccountsSection({
  state,
  loading,
  error,
  onReload,
  messagesFrom,
  onShowMessages,
}: {
  state: AccountsState | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** How many feedback messages each account sent, by account id. */
  messagesFrom: Map<string, number>;
  /** Opens the feedback, filtered to one account. */
  onShowMessages: (account: AccountEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AccountSort>("joined");
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const rows = (state?.accounts ?? []).filter(
      (account) =>
        !wanted ||
        [account.email, account.name, account.phone, account.id].some((field) => field?.toLowerCase().includes(wanted)),
    );
    return [...rows].sort((a, b) => SORT_KEY[sort](b) - SORT_KEY[sort](a));
  }, [query, sort, state]);

  if (!state) {
    return error ? (
      <Notice tone="danger" action={<Button size="sm" onClick={onReload}>נסה שוב</Button>}>
        {error}
      </Notice>
    ) : (
      <Loading text={loading ? "טוען את החשבונות…" : "אין נתונים."} />
    );
  }

  const summary = accountSummary(state.accounts);
  const chosen = open ? state.accounts.find((account) => account.id === open) ?? null : null;

  const exportRows = () =>
    downloadCsv(
      shown.map((account) => ({
        אימייל: account.email ?? "",
        שם: account.name ?? "",
        טלפון: account.phone ?? "",
        "כניסה דרך": account.providers.map(providerLabel).join(" "),
        הצטרפות: formatDate(account.createdAt),
        "כניסה אחרונה": formatDate(account.lastSignInAt),
        מאומת: account.confirmed ? "כן" : "לא",
        עבודות: account.works,
        קבצים: account.files,
        אחסון: formatBytes(account.bytes),
        קרדיטים: account.bonus ?? "",
        חברים: account.friends,
      })),
      "accounts.csv",
    );

  return (
    <div className="admin-grid adm-grid">
      <div className="admin-tiles">
        <StatTile label="חשבונות רשומים" value={formatNumber(summary.total)} note={`${formatNumber(summary.joinedWeek)} הצטרפו השבוע`} icon={<Users size={16} />} />
        <StatTile label="נכנסו היום" value={formatNumber(summary.today)} note="התחברו ב־24 השעות האחרונות" icon={<Zap size={16} />} hue={155} />
        <StatTile label="נכנסו השבוע" value={formatNumber(summary.week)} note="התחברו ב־7 הימים האחרונים" icon={<Clock size={16} />} />
        <StatTile label="נכנסו החודש" value={formatNumber(summary.month)} note="התחברו ב־30 הימים האחרונים" icon={<Activity size={16} />} />
      </div>

      <Card
        wide
        title="כל החשבונות"
        hint={query ? `${formatNumber(shown.length)} מתוך ${formatNumber(summary.total)}` : `${formatNumber(summary.total)} חשבונות · לחיצה על חשבון פותחת את הפרטים`}
        icon={<UserRound size={16} />}
        actions={
          <>
            <div className="adm-search">
              <Search size={15} aria-hidden="true" />
              <Input
                size="sm"
                type="search"
                value={query}
                placeholder="אימייל, שם או טלפון"
                aria-label="חיפוש חשבון"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Select size="sm" value={sort} aria-label="מיון" onChange={(event) => setSort(event.target.value as AccountSort)}>
              {SORTS.map((item) => (
                <option key={item.id} value={item.id}>
                  מיון: {item.label}
                </option>
              ))}
            </Select>
            <Button size="sm" icon={<RefreshCw size={15} />} loading={loading} onClick={onReload}>
              רענון
            </Button>
            <Button size="sm" icon={<Download size={15} />} onClick={exportRows} disabled={!shown.length}>
              CSV
            </Button>
          </>
        }
      >
        {error && <Notice tone="danger">{error}</Notice>}
        {state.truncated && <Notice tone="info">יש יותר חשבונות ממה שהשרת קורא בבת אחת; מוצגים הראשונים.</Notice>}
        {shown.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table adm-accounts-table">
              <thead>
                <tr>
                  <th scope="col">חשבון</th>
                  <th scope="col">כניסה דרך</th>
                  <th scope="col">הצטרף</th>
                  <th scope="col">כניסה אחרונה</th>
                  <th scope="col">עבודות</th>
                  <th scope="col">אחסון</th>
                  <th scope="col">קרדיטים</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((account) => (
                  <tr key={account.id} className={open === account.id ? "is-focus" : ""}>
                    <th scope="row">
                      <button type="button" className="adm-row-link adm-account" onClick={() => setOpen(account.id)}>
                        <span dir="ltr">{account.email ?? account.phone ?? account.id.slice(0, 8)}</span>
                        {account.name && <small dir="auto">{account.name}</small>}
                      </button>
                    </th>
                    <td>{account.providers.map(providerLabel).join(", ") || "—"}</td>
                    <td title={formatDate(account.createdAt)}>{timeAgo(account.createdAt)}</td>
                    <td title={formatDate(account.lastSignInAt)}>{timeAgo(account.lastSignInAt)}</td>
                    <td>{account.works ? formatNumber(account.works) : "—"}</td>
                    <td>{account.bytes ? formatBytes(account.bytes) : "—"}</td>
                    <td>{account.bonus == null ? "—" : formatNumber(account.bonus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{query ? "אין חשבון שמתאים לחיפוש." : "עוד אין חשבונות."}</Empty>
        )}
        <Note>„כניסה אחרונה” היא הפעם האחרונה שהחשבון התחבר (לא כל ביקור באתר). כל פתיחה של הרשימה נרשמת ביומן הפעולות.</Note>
      </Card>

      <AccountSheet
        account={chosen}
        messages={chosen ? messagesFrom.get(chosen.id) ?? 0 : 0}
        onClose={() => setOpen(null)}
        onShowMessages={onShowMessages}
      />
    </div>
  );
}

function AccountSheet({
  account,
  messages,
  onClose,
  onShowMessages,
}: {
  account: AccountEntry | null;
  messages: number;
  onClose: () => void;
  onShowMessages: (account: AccountEntry) => void;
}) {
  return (
    <Sheet
      open={Boolean(account)}
      onClose={onClose}
      side="inline-start"
      height={440}
      title={account ? account.name || account.email || account.phone || "חשבון" : ""}
      description={account ? `הצטרף ${timeAgo(account.createdAt)}` : undefined}
      className="adm-sheet"
      footer={
        account ? (
          <div className="adm-sheet-actions">
            {account.email && (
              <Button as="a" size="sm" href={`mailto:${account.email}`} icon={<Mail size={15} />}>
                שליחת מייל
              </Button>
            )}
            {messages > 0 && (
              <Button
                size="sm"
                icon={<MessageSquareText size={15} />}
                onClick={() => {
                  onClose();
                  onShowMessages(account);
                }}
              >
                {messages === 1 ? "ההודעה ששלח" : `${formatNumber(messages)} הודעות ששלח`}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {account && (
        <div className="adm-sheet-body">
          <div className="adm-chips">
            {account.providers.map((provider) => (
              <Chip key={provider}>{providerLabel(provider)}</Chip>
            ))}
            <Chip tone={account.confirmed ? "success" : "warning"}>{account.confirmed ? "מאומת" : "לא מאומת"}</Chip>
            {account.banned && <Chip tone="danger">חסום</Chip>}
          </div>
          <dl className="adm-facts">
            <dt>אימייל</dt>
            <dd dir="ltr">{account.email ?? "—"}</dd>
            <dt>טלפון</dt>
            <dd dir="ltr">{account.phone ?? "—"}</dd>
            <dt>הצטרף</dt>
            <dd>{formatDate(account.createdAt)}</dd>
            <dt>כניסה אחרונה</dt>
            <dd>{formatDate(account.lastSignInAt)}</dd>
            <dt>עבודות שמורות</dt>
            <dd>{formatNumber(account.works)}</dd>
            <dt>קבצים בענן</dt>
            <dd>
              {formatNumber(account.files)} · {formatBytes(account.bytes)}
            </dd>
            <dt>קרדיטים שנצברו</dt>
            <dd>{account.bonus == null ? "—" : formatNumber(account.bonus)}</dd>
            <dt>חברים שהביא</dt>
            <dd>{formatNumber(account.friends)}</dd>
            <dt>מזהה</dt>
            <dd dir="ltr" className="adm-mono">
              {account.id}
            </dd>
          </dl>
        </div>
      )}
    </Sheet>
  );
}
