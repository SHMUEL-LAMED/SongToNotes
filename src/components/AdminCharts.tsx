import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { compactNumber, formatNumber, type Point } from "../lib/admin";

/**
 * The dashboard's charts, drawn as SVG against the site's own tokens so they
 * follow the theme instead of carrying colours of their own.
 *
 * Three rules hold across all of them. Every chart shows one measure, so
 * there is never a second scale to misread. Magnitude is one hue, light to
 * dark — identity lives in the labels, not in a ring of colours. And the text
 * wears text tokens: the mark beside a label carries the colour, never the
 * label itself.
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
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  return ticks;
}

function dayLabel(day: string) {
  const [, month, date] = day.split("-");
  return `${Number(date)}.${Number(month)}`;
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function fullDayLabel(day: string) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return `יום ${WEEKDAYS[date.getDay()]}, ${dayLabel(day)}`;
}

type TimeChartProps = {
  points: Point[];
  /** What one point is — "עבודות", "טוקנים"; used in the tooltip. */
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
export function TimeChart({ points, unit, format = formatNumber, height = 210, label }: TimeChartProps) {
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
              <text x={padding.left + plotWidth + 8} y={y(tick) + 4} className="chart-tick" textAnchor="start">
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

export type BarRow = { key: string; label: string; value: number; hint?: string; icon?: React.ReactNode };

/**
 * A ranked list as bars. The name is the identity, so the bars are one hue
 * with the value at the tip — a colour per row would say something the data
 * does not.
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
              <span className="bar-list-fill" style={{ "--fill": `${(row.value / max) * 100}%` } as CSSProperties} />
            </span>
            <b className="bar-list-value">
              {format(row.value)}
              {unit && <small> {unit}</small>}
            </b>
          </>
        );
        return (
          <li key={row.key}>
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
export function WeekHeatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  const busiest = grid.flatMap((row, day) => row.map((value, hour) => ({ value, day, hour })))
    .reduce((best, cell) => (cell.value > best.value ? cell : best), { value: 0, day: 0, hour: 0 });

  return (
    <div className="heatmap" role="img" aria-label={`שעות הפעילות בשבוע; הכי עמוס ביום ${WEEKDAYS[busiest.day]} בשעה ${busiest.hour}:00`}>
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
                title={`יום ${WEEKDAYS[day]}, ${String(hour).padStart(2, "0")}:00 — ${value} פריטים`}
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
  children: React.ReactNode;
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
    <button type="button" className={`${className} ${armed ? "is-armed" : ""}`} onClick={press} disabled={disabled}>
      {armed ? confirmLabel : children}
    </button>
  );
}
