import { useMemo, useRef } from "react";
import { formatTime } from "../lib/audio";
import type { TrimRange } from "../lib/audio";

type WaveformProps = {
  peaks: Float32Array;
  duration: number;
  trim: TrimRange;
  onTrimChange: (trim: TrimRange) => void;
};

const WIDTH = 1000;
const HEIGHT = 96;

/**
 * Waveform overview with a draggable region. Transcribing only the interesting
 * part of a long file is both faster and more accurate, since the tempo and
 * key estimates stop averaging over sections that do not belong together.
 */
export function Waveform({ peaks, duration, trim, onTrimChange }: WaveformProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ anchor: number } | null>(null);

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

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const anchor = timeAt(event.clientX);
    dragRef.current = { anchor };
    event.currentTarget.setPointerCapture(event.pointerId);
    onTrimChange(null);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const current = timeAt(event.clientX);
    const start = Math.min(drag.anchor, current);
    const end = Math.max(drag.anchor, current);
    // A stray click should not create a sliver of a selection.
    if (end - start < 0.4) return;
    onTrimChange({ start, end });
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const selection = trim
    ? {
        x: (trim.start / duration) * WIDTH,
        width: ((trim.end - trim.start) / duration) * WIDTH,
      }
    : null;

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
        aria-label="גל הקול של הקובץ. אפשר לסמן קטע לניתוח."
      >
        <rect width={WIDTH} height={HEIGHT} fill="#0b1120" />
        <path d={path} fill="#7c5cff" opacity={selection ? 0.22 : 0.6} />
        {selection && (
          <>
            <rect
              x={selection.x}
              y={0}
              width={selection.width}
              height={HEIGHT}
              fill="#2dd4bf"
              opacity="0.14"
            />
            <path
              d={path}
              fill="#2dd4bf"
              opacity="0.75"
              clipPath="url(#trim-clip)"
            />
            <defs>
              <clipPath id="trim-clip">
                <rect
                  x={selection.x}
                  y={0}
                  width={selection.width}
                  height={HEIGHT}
                />
              </clipPath>
            </defs>
            <line
              x1={selection.x}
              x2={selection.x}
              y1={0}
              y2={HEIGHT}
              stroke="#2dd4bf"
              strokeWidth="2"
            />
            <line
              x1={selection.x + selection.width}
              x2={selection.x + selection.width}
              y1={0}
              y2={HEIGHT}
              stroke="#2dd4bf"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      <div className="waveform-legend">
        {trim ? (
          <>
            <span>
              קטע נבחר: {formatTime(trim.start)}–{formatTime(trim.end)}
            </span>
            <button type="button" onClick={() => onTrimChange(null)}>
              נתח את כל השיר
            </button>
          </>
        ) : (
          <span>סמן קטע בגל הקול כדי לנתח רק אותו · {formatTime(duration)}</span>
        )}
      </div>
    </div>
  );
}
