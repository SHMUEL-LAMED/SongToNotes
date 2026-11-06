import { ArrowDown, ArrowUp, CircleSlash, Download, ExternalLink, Eye, Search, TriangleAlert, Activity } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import {
  formatDuration,
  formatNumber,
  funnel,
  successRate,
  timeAgo,
  toolHue,
  toolLabel,
  type AdminSnapshot,
  type ToolRow,
} from "../../lib/admin";
import { TOOLS, findAnyTool } from "../../lib/tools";
import { Button, Chip, Input, LedBar, Sheet } from "../../ui";
import { BarList, Funnel } from "../Charts";
import { downloadCsv } from "./format";
import { Card, Empty, Note } from "./shared";

type SortKey = "views" | "visitors" | "rate" | "dwell" | "work" | "errors";

const COLUMNS: { id: SortKey; label: string; value: (tool: ToolRow) => number }[] = [
  { id: "views", label: "כניסות", value: (tool) => tool.views },
  { id: "visitors", label: "גולשים", value: (tool) => tool.visitors },
  { id: "rate", label: "הצלחה", value: (tool) => successRate(tool) ?? -1 },
  { id: "dwell", label: "שהייה", value: (tool) => tool.dwellSeconds },
  { id: "work", label: "עיבוד", value: (tool) => tool.workSeconds },
  { id: "errors", label: "שגיאות", value: (tool) => tool.errors },
];

function Rate({ value }: { value: number | null }) {
  if (value == null) return <>—</>;
  return <span className={`rate ${value >= 60 ? "is-good" : value >= 25 ? "is-ok" : "is-low"}`}>{value}%</span>;
}

export function ToolsSection({
  snapshot,
  focus,
  setFocus,
}: {
  snapshot: AdminSnapshot;
  /** The tool whose details are open, from here or from the overview. */
  focus: string | null;
  setFocus: (tool: string | null) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: "views", down: true });
  const [query, setQuery] = useState("");

  const tools = useMemo(() => snapshot.stats.tools.filter((tool) => findAnyTool(tool.tool)), [snapshot]);
  const pages = useMemo(() => snapshot.stats.tools.filter((tool) => !findAnyTool(tool.tool)), [snapshot]);
  const quiet = useMemo(() => {
    const seen = new Set(tools.map((tool) => tool.tool));
    return TOOLS.filter((tool) => !seen.has(tool.id));
  }, [tools]);

  const shown = useMemo(() => {
    const column = COLUMNS.find((item) => item.id === sort.key) ?? COLUMNS[0];
    const needle = query.trim().toLowerCase();
    return tools
      .filter((tool) => !needle || toolLabel(tool.tool).toLowerCase().includes(needle) || tool.tool.includes(needle))
      .sort((a, b) => (sort.down ? column.value(b) - column.value(a) : column.value(a) - column.value(b)));
  }, [query, sort, tools]);

  const chosen = focus ? snapshot.stats.tools.find((tool) => tool.tool === focus) ?? null : null;

  const exportRows = () =>
    downloadCsv(
      shown.map((tool) => ({
        כלי: toolLabel(tool.tool),
        כניסות: tool.views,
        התחילו: tool.inputs,
        תוצאות: tool.results,
        שגיאות: tool.errors,
        גולשים: tool.visitors,
        "שהייה (שנ׳)": tool.dwellSeconds,
        "זמן עיבוד (שנ׳)": tool.workSeconds,
      })),
      `tools-${snapshot.days}d.csv`,
    );

  return (
    <div className="admin-grid adm-grid">
      <Card
        wide
        title="כלי מול כלי"
        hint={`${formatNumber(tools.length)} כלים נפתחו ב־${snapshot.days} הימים האחרונים · לחיצה על כותרת ממיינת, על כלי — פותחת את הפירוט`}
        icon={<Activity size={16} />}
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
            <Button size="sm" icon={<Download size={15} />} onClick={exportRows} disabled={!shown.length}>
              CSV
            </Button>
          </>
        }
      >
        {shown.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table adm-tools-table">
              <thead>
                <tr>
                  <th scope="col">כלי</th>
                  {COLUMNS.map((column) => {
                    const active = sort.key === column.id;
                    return (
                      <th key={column.id} scope="col" aria-sort={active ? (sort.down ? "descending" : "ascending") : undefined}>
                        <button
                          type="button"
                          className={`adm-sort ${active ? "is-active" : ""}`}
                          onClick={() => setSort((current) => ({ key: column.id, down: current.key === column.id ? !current.down : true }))}
                        >
                          {column.label}
                          {active && (sort.down ? <ArrowDown size={13} aria-hidden="true" /> : <ArrowUp size={13} aria-hidden="true" />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((tool) => (
                  <tr key={tool.tool} className={focus === tool.tool ? "is-focus" : ""}>
                    <th scope="row">
                      <button type="button" className="adm-row-link" onClick={() => setFocus(tool.tool)}>
                        <LedBar hue={toolHue(tool.tool)} on />
                        {toolLabel(tool.tool)}
                        {snapshot.control.disabledTools.includes(tool.tool) && <Chip tone="warning">מכובה</Chip>}
                      </button>
                    </th>
                    <td>{formatNumber(tool.views)}</td>
                    <td>{formatNumber(tool.visitors)}</td>
                    <td>
                      <Rate value={successRate(tool)} />
                    </td>
                    <td>{formatDuration(tool.dwellSeconds)}</td>
                    <td>{formatDuration(tool.workSeconds)}</td>
                    <td>{tool.errors ? <span className="rate is-low">{formatNumber(tool.errors)}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{query ? "אין כלי שמתאים לחיפוש." : "עדיין לא נאספו מדידות בטווח הזה."}</Empty>
        )}
        <Note>
          „הצלחה” היא היחס בין מי שנכנס לכלי לבין מי שיצא ממנו עם תוצאה. „שהייה” היא הזמן הממוצע בתוך הכלי,
          ו„עיבוד” הוא כמה זמן הכלי עצמו לקח.
        </Note>
      </Card>

      <Card title="תקלות חוזרות" hint="הסוג בלבד — בלי הקובץ, בלי מה שנכתב" icon={<TriangleAlert size={16} />}>
        {snapshot.stats.failures.length ? (
          <ul className="adm-failures">
            {snapshot.stats.failures.map((failure) => (
              <li key={`${failure.tool}|${failure.code}`}>
                <button type="button" className="adm-row-link" onClick={() => setFocus(failure.tool)}>
                  <LedBar hue={toolHue(failure.tool)} on />
                  {toolLabel(failure.tool)}
                </button>
                <code dir="ltr">{failure.code}</code>
                <b>{formatNumber(failure.count)}</b>
                <small>{timeAgo(failure.last)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>לא נרשמה אף שגיאה בטווח הזה.</Empty>
        )}
      </Card>

      <div className="adm-stack">
        <Card title="כלים ששקטים" hint="לא נפתחו אף פעם בטווח שנבחר" icon={<CircleSlash size={16} />}>
          {quiet.length ? (
            <ul className="adm-quiet">
              {quiet.map((tool) => (
                <li key={tool.id}>
                  <Chip icon={<LedBar hue={tool.hue} />}>{tool.title}</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>כל הכלים נפתחו לפחות פעם אחת.</Empty>
          )}
        </Card>

        {pages.length > 0 && (
          <Card title="דפים שאינם כלים" hint="דף הבית, האזור האישי, דפי שיתוף" icon={<Eye size={16} />}>
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

      <ToolSheet
        tool={chosen}
        off={chosen ? snapshot.control.disabledTools.includes(chosen.tool) : false}
        failures={chosen ? snapshot.stats.failures.filter((failure) => failure.tool === chosen.tool) : []}
        onClose={() => setFocus(null)}
      />
    </div>
  );
}

/** One tool's journey: in, started, out with a result — and what broke on the way. */
function ToolSheet({
  tool,
  off,
  failures,
  onClose,
}: {
  tool: ToolRow | null;
  off: boolean;
  failures: AdminSnapshot["stats"]["failures"];
  onClose: () => void;
}) {
  const known = tool ? findAnyTool(tool.tool) : null;
  return (
    <Sheet
      open={Boolean(tool)}
      onClose={onClose}
      side="inline-start"
      height={440}
      title={tool ? toolLabel(tool.tool) : ""}
      description="המסע בתוך הכלי בטווח שנבחר"
      className="adm-sheet"
      style={tool ? ({ "--accent-hue": toolHue(tool.tool) } as CSSProperties) : undefined}
      footer={
        known ? (
          <Button as="a" href={`#/${known.id}`} size="sm" icon={<ExternalLink size={15} />}>
            פתיחת הכלי
          </Button>
        ) : undefined
      }
    >
      {tool && (
        <div className="adm-sheet-body">
          {off && <Chip tone="warning">הכלי מכובה כרגע לגולשים</Chip>}
          <Funnel steps={funnel(tool)} />
          <ul className="admin-facts">
            <li>
              <span>אחוז הצלחה</span>
              <b>
                <Rate value={successRate(tool)} />
              </b>
            </li>
            <li>
              <span>גולשים שונים</span>
              <b>{formatNumber(tool.visitors)}</b>
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
              <span>שגיאות</span>
              <b>{formatNumber(tool.errors)}</b>
            </li>
          </ul>
          {failures.length > 0 && (
            <>
              <h3 className="adm-sheet-heading">תקלות בכלי הזה</h3>
              <ul className="adm-failures is-compact">
                {failures.map((failure) => (
                  <li key={failure.code}>
                    <code dir="ltr">{failure.code}</code>
                    <b>{formatNumber(failure.count)}</b>
                    <small>{timeAgo(failure.last)}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
