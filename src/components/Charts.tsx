import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { compactNumber, formatNumber, type Point } from "../lib/admin";

/**
 * The site's charts, drawn as SVG against its own tokens so they follow the
 * theme instead of carrying colours of their own. Both the admin area and the
 * personal area draw from here, so a figure looks the same wherever it is read.
 *
 * Three rules hold across all of them. Every chart shows one measure, so there
 * is never a second scale to misread. Magnitude is one hue, light to dark —
 * identity lives in the labels, not in a ring of colours. And the text wears
 * text tokens: the mark beside a label carries the colour, never the label.
 *
 * The page reads right to left, and so do the charts: the oldest day sits on
 * the right and time runs towards the left, which is how the eye moves here.
 */

/** The drawn width of an element, kept current as the window changes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    // Charts are measured rather than scaled: a viewBox stretched to fit
    // would stretch the labels with it.
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** A bar whose data-end is rounded and whose baseline stays square. */
function columnPath(x: number, y: number, width: number, height: number, radius = 4) {
  const r = Math.min(radius, width / 2, Math.max(0, height));
  const bottom = y + height;
  return `M${x} ${bottom} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} L${x + width - r} ${y} Q${x + width} ${y} ${x + width} ${y + r} L${x + width} ${bottom} Z`;
}

/** Clean round numbers for the axis — 0, 25, 50 rather than 0, 23, 46. */
function niceTicks(max: number, count = 3) {
  if (max <= 0) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ??
    magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  return ticks;
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function dayLabel(day: string) {
  const [, month, date] = day.split("-");
  return `${Number(date)}.${Number(month)}`;
}

function fullDayLabel(day: string) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return `יום ${WEEKDAYS[date.getDay()]}, ${dayLabel(day)}`;
}

type TimeChartProps = {
  points: Point[];
  /** What one point is — "כניסות", "עבודות"; used in the read-out. */
  unit: string;
  /** How a value is written out, when a plain number is not the whole story. */
  format?: (value: number) => string;
  height?: number;
  label: string;
};

/**
 * Activity over time as columns, with a hover read-out. Columns rather than a
 * line: these are counts of separate days, not a continuous quantity, and a
 * line between two days implies values in between that were never measured.
 */
export function TimeChart({
  points,
  unit,
  format = formatNumber,
  height = 210,
  label,
}: TimeChartProps) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  // The value axis sits on the right, where the reading starts.
  const padding = { top: 14, right: 46, bottom: 24, left: 12 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const ticks = niceTicks(max);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);
  const band = points.length ? plotWidth / points.length : 0;
  // A 2px gap in the surface colour is what separates neighbouring columns;
  // a stroke around them would add ink that is not data.
  const barWidth = Math.max(2, Math.min(24, band - 2));
  const y = (value: number) => padding.top + plotHeight - (value / top) * plotHeight;
  // Oldest on the right: the page runs right to left and so does the time.
  const x = (index: number) => padding.left + plotWidth - (index + 1) * band + (band - barWidth) / 2;

  const active = hover != null ? points[hover] : null;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}: ${points.length} ימים, שיא ${format(max)} ${unit}`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={padding.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                className="chart-grid"
              />
              <text
                x={padding.left + plotWidth + 8}
                y={y(tick) + 4}
                className="chart-tick"
                textAnchor="start"
              >
                {compactNumber(tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) => {
            const value = Math.max(0, point.value);
            const barHeight = value === 0 ? 0 : Math.max(2, plotHeight - (y(value) - padding.top));
            return (
              <g key={point.day}>
                {barHeight > 0 && (
                  <path
                    d={columnPath(x(index), padding.top + plotHeight - barHeight, barWidth, barHeight)}
                    className={`chart-bar ${hover === index ? "is-hover" : ""}`}
                  />
                )}
                {/* The hit target is the whole column slot, not the mark. */}
                <rect
                  x={padding.left + plotWidth - (index + 1) * band}
                  y={padding.top}
                  width={Math.max(band, 1)}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHover(index)}
                >
                  <title>{`${fullDayLabel(point.day)}: ${format(point.value)} ${unit}`}</title>
                </rect>
              </g>
            );
          })}

          <line
            x1={padding.left}
            x2={padding.left + plotWidth}
            y1={padding.top + plotHeight}
            y2={padding.top + plotHeight}
            className="chart-axis"
          />

          {points.length > 0 && (
            <>
              <text x={padding.left + plotWidth} y={height - 6} className="chart-tick" textAnchor="end">
                {dayLabel(points[0].day)}
              </text>
              <text x={padding.left} y={height - 6} className="chart-tick" textAnchor="start">
                {dayLabel(points[points.length - 1].day)}
              </text>
            </>
          )}
        </svg>
      )}

      <p className="chart-readout" role="status">
        {active ? (
          <>
            <b>{format(active.value)}</b> {unit} · {fullDayLabel(active.day)}
          </>
        ) : (
          <span className="chart-readout-idle">העבר את העכבר על עמודה כדי לראות יום מסוים</span>
        )}
      </p>
    </div>
  );
}

/** Twelve points of context inside a tile — no axes, no labels, just shape. */
export function Sparkline({ points, label }: { points: Point[]; label: string }) {
  const width = 108;
  const height = 30;
  const tail = points.slice(-12);
  if (tail.length < 2) return null;
  const max = Math.max(1, ...tail.map((point) => point.value));
  const step = width / (tail.length - 1);
  // Right to left, like every other chart here.
  const at = (index: number, value: number) =>
    [width - index * step, height - 2 - (value / max) * (height - 6)] as const;
  const line = tail.map((point, index) => at(index, point.value).join(",")).join(" L");
  const [lastX, lastY] = at(tail.length - 1, tail[tail.length - 1].value);

  return (
    <svg className="sparkline" width={width} height={height} role="img" aria-label={label}>
      <path d={`M${line}`} className="sparkline-line" />
      <circle cx={lastX} cy={lastY} r={3} className="sparkline-dot" />
    </svg>
  );
}

export type BarRow = {
  key: string;
  label: string;
  value: number;
  hint?: string;
  icon?: ReactNode;
  /** The row's own hue, where the rows are tools and the colour names one. */
  hue?: number;
};

/**
 * A ranked list as bars. Where the rows are plain categories the bars are one
 * hue with the value at the tip; where a row *is* a tool, it wears that tool's
 * own colour, because the site already taught that colour as its name.
 */
export function BarList({
  rows,
  unit,
  format = formatNumber,
  onSelect,
  empty = "אין עדיין נתונים",
}: {
  rows: BarRow[];
  unit?: string;
  format?: (value: number) => string;
  onSelect?: (key: string) => void;
  empty?: string;
}) {
  if (!rows.length) return <p className="admin-empty">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="bar-list">
      {rows.map((row) => {
        const style = {
          "--fill": `${(row.value / max) * 100}%`,
          ...(row.hue === undefined ? {} : { "--accent-hue": String(row.hue) }),
        } as CSSProperties;
        const content = (
          <>
            <span className="bar-list-name">
              {row.icon}
              <span className="bar-list-text">
                <span>{row.label}</span>
                {row.hint && <small>{row.hint}</small>}
              </span>
            </span>
            <span className="bar-list-track">
              <span className="bar-list-fill" />
            </span>
            <b className="bar-list-value">
              {format(row.value)}
              {unit && <small> {unit}</small>}
            </b>
          </>
        );
        return (
          <li key={row.key} style={style}>
            {onSelect ? (
              <button type="button" className="bar-list-row is-button" onClick={() => onSelect(row.key)}>
                {content}
              </button>
            ) : (
              <div className="bar-list-row">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * When the site is used: a week of days against the hours of the day. One
 * hue, stepped by how busy the hour is — the scale is magnitude, so the
 * colour is a single ramp rather than a spectrum.
 */
export function WeekHeatmap({ grid, unit = "כניסות" }: { grid: number[][]; unit?: string }) {
  const max = Math.max(1, ...grid.flat());
  const busiest = grid
    .flatMap((row, day) => row.map((value, hour) => ({ value, day, hour })))
    .reduce((best, cell) => (cell.value > best.value ? cell : best), { value: 0, day: 0, hour: 0 });

  return (
    <div
      className="heatmap"
      role="img"
      aria-label={`שעות הפעילות בשבוע; הכי עמוס ביום ${WEEKDAYS[busiest.day]} בשעה ${busiest.hour}:00`}
    >
      <div className="heatmap-hours" aria-hidden="true">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
      {grid.map((row, day) => (
        <div className="heatmap-row" key={day}>
          <span className="heatmap-day">{WEEKDAYS[day].slice(0, 3)}׳</span>
          <span className="heatmap-cells">
            {row.map((value, hour) => (
              <span
                key={hour}
                className={`heatmap-cell ${value > 0 ? "has-value" : ""}`}
                style={{ "--weight": value === 0 ? 0 : 0.18 + (value / max) * 0.82 } as CSSProperties}
                title={`יום ${WEEKDAYS[day]}, ${String(hour).padStart(2, "0")}:00 — ${value} ${unit}`}
              />
            ))}
          </span>
        </div>
      ))}
      <p className="heatmap-legend" aria-hidden="true">
        <span>שקט</span>
        <i className="heatmap-ramp" />
        <span>עמוס ({max})</span>
      </p>
    </div>
  );
}

/**
 * One quantity against its ceiling. The bar turns from accent to warning as it
 * fills, because a meter's whole job is to say "how close".
 */
export function Meter({
  value,
  max,
  label,
  note,
  format = formatNumber,
}: {
  value: number;
  max: number;
  label: string;
  note?: string;
  format?: (value: number) => string;
}) {
  const share = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const state = share >= 90 ? "is-full" : share >= 70 ? "is-high" : "";

  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <b className="meter-value">
          {format(value)}
          {max > 0 && <small> / {format(max)}</small>}
        </b>
      </div>
      <div
        className={`meter-track ${state}`}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max || value || 1}
        aria-label={label}
      >
        <span className="meter-fill" style={{ "--fill": `${share}%` } as CSSProperties} />
      </div>
      {note && <p className="meter-note">{note}</p>}
    </div>
  );
}

export type FunnelRow = { label: string; value: number; share: number };

/**
 * Opened → started → finished. Each step is as wide as its share of the first,
 * and the drop between two steps is written out, because the gap is the point.
 */
export function Funnel({ steps, unit = "" }: { steps: FunnelRow[]; unit?: string }) {
  return (
    <ol className="funnel">
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1].value : 0;
        const lost = index > 0 && previous > 0 ? previous - step.value : 0;
        return (
          <li key={step.label} className="funnel-step">
            <div className="funnel-head">
              <span>{step.label}</span>
              <b>
                {formatNumber(step.value)}
                {unit && <small> {unit}</small>}
              </b>
            </div>
            <div className="funnel-track">
              <span className="funnel-fill" style={{ "--fill": `${step.share}%` } as CSSProperties} />
            </div>
            {lost > 0 && (
              <p className="funnel-drop">
                נשרו {formatNumber(lost)} ({Math.round((lost / previous) * 100)}%)
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Two halves of one whole — new against returning — as a single bar. */
export function SplitBar({
  parts,
  label,
}: {
  parts: { key: string; label: string; value: number }[];
  label: string;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return <p className="admin-empty">אין עדיין נתונים</p>;

  return (
    <div className="split" role="img" aria-label={`${label}: ${parts.map((part) => `${part.label} ${part.value}`).join(", ")}`}>
      <div className="split-track">
        {parts.map((part, index) => (
          <span
            key={part.key}
            className={`split-part split-part-${index + 1}`}
            style={{ "--share": `${(part.value / total) * 100}%` } as CSSProperties}
          />
        ))}
      </div>
      <ul className="split-legend">
        {parts.map((part, index) => (
          <li key={part.key}>
            <i className={`split-dot split-part-${index + 1}`} aria-hidden="true" />
            <span>{part.label}</span>
            <b>{Math.round((part.value / total) * 100)}%</b>
            <small>{formatNumber(part.value)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A figure with its name, and whatever context fits beside it: a trend, a
 * sparkline, a note. The trend is a plain percentage, never a colour alone.
 */
export function StatTile({
  label,
  value,
  note,
  trend,
  icon,
  children,
  hue,
}: {
  label: string;
  value: string;
  note?: string;
  trend?: number | null;
  icon?: ReactNode;
  children?: ReactNode;
  hue?: number;
}) {
  const style = hue === undefined ? undefined : ({ "--accent-hue": String(hue) } as CSSProperties);
  const tone = trend == null ? "" : trend > 0 ? "is-up" : trend < 0 ? "is-down" : "is-flat";

  return (
    <article className="stat-tile" style={style}>
      <header className="stat-tile-head">
        {icon && <span className="stat-tile-icon">{icon}</span>}
        <span className="stat-tile-label">{label}</span>
      </header>
      <strong className="stat-tile-value">{value}</strong>
      <div className="stat-tile-foot">
        {trend != null && (
          <span className={`stat-trend ${tone}`}>
            {trend > 0 ? "▲" : trend < 0 ? "▼" : "■"} {Math.abs(trend)}%
          </span>
        )}
        {note && <span className="stat-tile-note">{note}</span>}
      </div>
      {children}
    </article>
  );
}

/**
 * A destructive button that asks first: the first press arms it, the second
 * carries it out, and walking away disarms it a few seconds later.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  className = "admin-danger-button",
  disabled,
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const press = useCallback(() => {
    if (armed) {
      setArmed(false);
      onConfirm();
    } else {
      setArmed(true);
    }
  }, [armed, onConfirm]);

  return (
    <button
      type="button"
      className={`${className} ${armed ? "is-armed" : ""}`}
      onClick={press}
      disabled={disabled}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
