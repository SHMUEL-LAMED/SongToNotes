import { useId, useMemo, useRef } from "react";
import { formatTime } from "../lib/audio";
import type { TrimRange } from "../lib/audio";

type WaveformProps = {
  peaks: Float32Array;
  duration: number;
  trim: TrimRange;
  onTrimChange: (trim: TrimRange) => void;
  /** Playback position in seconds, drawn as a line; null hides it. */
  cursor?: number | null;
  selectLabel?: string;
  clearLabel?: string;
  emptyLabel?: string;
  /** Length of the region the keyboard handles create out of nothing. */
  defaultSpan?: number;
  /**
   * A click (a press that never moves) slides the existing region so it
   * starts where the click landed, keeping its length. That is what a
   * fixed-length cut like a ringtone wants; dragging still draws a fresh
   * region, and grabbing an edge still resizes.
   */
  clickMoves?: boolean;
};

const WIDTH = 1000;
const HEIGHT = 96;

/**
 * Waveform overview with a draggable region. Transcribing only the interesting
 * part of a long file is both faster and more accurate, since the tempo and
 * key estimates stop averaging over sections that do not belong together.
 * The same strip doubles as the loop picker and the ringtone trimmer.
 */
export function Waveform({
  peaks,
  duration,
  trim,
  onTrimChange,
  cursor = null,
  selectLabel = "קטע נבחר",
  clearLabel = "נתח את כל השיר",
  emptyLabel = "סמן קטע בגל הקול כדי לנתח רק אותו",
  defaultSpan = 30,
  clickMoves = false,
}: WaveformProps) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  // `anchor` is the edge that stays put for the length of the drag: the point
  // the pointer went down on when drawing a fresh region, or the opposite
  // handle when an existing one is being resized. `pending` marks a press
  // that has not moved yet, when the release is what decides what it meant.
  const dragRef = useRef<{ anchor: number; resizing: boolean; pending: boolean } | null>(
    null,
  );

  const path = useMemo(() => {
    const buckets = peaks.length / 2;
    const step = WIDTH / buckets;
    const top: string[] = [];
    const bottom: string[] = [];
    for (let index = 0; index < buckets; index += 1) {
      const x = index * step;
      const min = peaks[index * 2];
      const max = peaks[index * 2 + 1];
      top.push(`${x.toFixed(2)},${(HEIGHT / 2 - max * (HEIGHT / 2 - 4)).toFixed(2)}`);
      bottom.push(
        `${x.toFixed(2)},${(HEIGHT / 2 - min * (HEIGHT / 2 - 4)).toFixed(2)}`,
      );
    }
    return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
  }, [peaks]);

  function timeAt(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return 0;
    const bounds = svg.getBoundingClientRect();
    const ratio = (clientX - bounds.left) / bounds.width;
    return Math.max(0, Math.min(1, ratio)) * duration;
  }

  /** How far from an edge still counts as grabbing it, in seconds. */
  function grabTolerance() {
    const width = svgRef.current?.getBoundingClientRect().width ?? WIDTH;
    return (duration * 14) / Math.max(1, width);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const at = timeAt(event.clientX);
    // Landing on a handle resizes the region from that edge. Without this the
    // only way to correct a selection was to draw the whole thing again,
    // which on a long file meant losing an edge that was already right.
    if (trim) {
      const tolerance = grabTolerance();
      if (Math.abs(at - trim.start) <= tolerance) {
        dragRef.current = { anchor: trim.end, resizing: true, pending: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (Math.abs(at - trim.end) <= tolerance) {
        dragRef.current = { anchor: trim.start, resizing: true, pending: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (clickMoves && trim) {
      // The region is kept until the pointer either moves (a fresh drawing)
      // or lifts (a move); clearing it here would make a plain click flash
      // the selection away and back.
      dragRef.current = { anchor: at, resizing: false, pending: true };
      return;
    }
    dragRef.current = { anchor: at, resizing: false, pending: false };
    onTrimChange(null);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const current = timeAt(event.clientX);
    const start = Math.min(drag.anchor, current);
    const end = Math.max(drag.anchor, current);
    // A stray click should not create a sliver of a selection — but while
    // resizing there is already a region, so the edges stay where the pointer
    // is and only the minimum length is enforced.
    if (end - start < 0.4) {
      if (!drag.resizing) return;
      const clamped = Math.min(drag.anchor === start ? start + 0.4 : end, duration);
      onTrimChange({ start: Math.max(0, clamped - 0.4), end: clamped });
      return;
    }
    drag.pending = false;
    onTrimChange({ start, end });
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag?.pending && trim) {
      const length = trim.end - trim.start;
      const start = Math.max(0, Math.min(drag.anchor, duration - length));
      onTrimChange({ start, end: Math.min(duration, start + length) });
    }
  }

  const selection = trim
    ? {
        x: (trim.start / duration) * WIDTH,
        width: ((trim.end - trim.start) / duration) * WIDTH,
      }
    : null;
  const cursorX =
    cursor !== null && duration > 0 ? Math.max(0, Math.min(WIDTH, (cursor / duration) * WIDTH)) : null;

  return (
    <div className="waveform" dir="ltr">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="img"
        aria-label={
          clickMoves
            ? "גל הקול של הקובץ. לחיצה מזיזה את הקטע, גרירה מסמנת קטע חדש."
            : "גל הקול של הקובץ. אפשר לסמן קטע."
        }
      >
        <rect width={WIDTH} height={HEIGHT} className="waveform-bg" />
        <path d={path} className="waveform-body" opacity={selection ? 0.28 : 0.7} />
        {selection && (
          <>
            <defs>
              {/* A generated id, so two strips on one page never clip each
                  other's selection through a shared `#trim-clip`. */}
              <clipPath id={clipId}>
                <rect x={selection.x} y={0} width={selection.width} height={HEIGHT} />
              </clipPath>
            </defs>
            <rect
              x={selection.x}
              y={0}
              width={selection.width}
              height={HEIGHT}
              className="waveform-selection"
            />
            <path d={path} className="waveform-selected" clipPath={`url(#${clipId})`} />
            <line
              x1={selection.x}
              x2={selection.x}
              y1={0}
              y2={HEIGHT}
              className="waveform-handle"
            />
            <line
              x1={selection.x + selection.width}
              x2={selection.x + selection.width}
              y1={0}
              y2={HEIGHT}
              className="waveform-handle"
            />
          </>
        )}
        {cursorX !== null && (
          <line x1={cursorX} x2={cursorX} y1={0} y2={HEIGHT} className="waveform-cursor" />
        )}
      </svg>
      {/* The strip itself is pointer-only, so the region also gets a pair of
          real sliders. They stay out of the way until focused, which is what
          gives the selection a keyboard and screen-reader path — arrow keys
          move an edge, and moving one with nothing selected creates the
          region from scratch. */}
      <div className="waveform-handles" dir="rtl">
        <label>
          <span>תחילת {selectLabel}</span>
          <input
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={0.1}
            value={trim ? trim.start : 0}
            onChange={(event) => {
              const start = Number(event.target.value);
              const end = trim ? trim.end : Math.min(duration, start + defaultSpan);
              onTrimChange({ start: Math.min(start, end - 0.4), end });
            }}
            aria-valuetext={`${formatTime(trim ? trim.start : 0)}`}
          />
        </label>
        <label>
          <span>סוף {selectLabel}</span>
          <input
            type="range"
            min={0}
            max={Math.max(0.1, duration)}
            step={0.1}
            value={trim ? trim.end : Math.min(duration, defaultSpan)}
            onChange={(event) => {
              const end = Number(event.target.value);
              const start = trim ? trim.start : 0;
              onTrimChange({ start, end: Math.max(end, start + 0.4) });
            }}
            aria-valuetext={`${formatTime(trim ? trim.end : Math.min(duration, defaultSpan))}`}
          />
        </label>
      </div>
      <div className="waveform-legend">
        {trim ? (
          <>
            <span>
              {selectLabel}: {formatTime(trim.start)}–{formatTime(trim.end)}
            </span>
            {/* A fixed-length cut has no "whole file" state to go back to. */}
            {!clickMoves && (
              <button type="button" onClick={() => onTrimChange(null)}>
                {clearLabel}
              </button>
            )}
          </>
        ) : (
          <span>
            {emptyLabel} · {formatTime(duration)}
          </span>
        )}
      </div>
    </div>
  );
}
