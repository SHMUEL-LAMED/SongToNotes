import { useMemo, useRef } from "react";
import { scientificName } from "../lib/key";
import type { DetectedNote, KeySignature, Tempo } from "../lib/types";

type PianoRollProps = {
  notes: DetectedNote[];
  tempo: Tempo;
  meter: { beats: number; beatType: number };
  keySignature: KeySignature;
  transpose: number;
  playhead: number;
  zoom: number;
  onSeek: (time: number) => void;
};

const ROW_HEIGHT = 14;
const GUTTER = 52;
const BLACK_KEYS = [1, 3, 6, 8, 10];

export function PianoRoll({
  notes,
  tempo,
  meter,
  keySignature,
  transpose,
  playhead,
  zoom,
  onSeek,
}: PianoRollProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => {
    let lowest = 127;
    let highest = 0;
    let end = 4;
    for (const note of notes) {
      const midi = note.midi + transpose;
      if (midi < lowest) lowest = midi;
      if (midi > highest) highest = midi;
      const noteEnd = note.start + note.duration;
      if (noteEnd > end) end = noteEnd;
    }
    if (lowest > highest) {
      lowest = 60;
      highest = 72;
    }
    // A little headroom above and below keeps notes off the edges.
    lowest = Math.max(0, lowest - 2);
    highest = Math.min(127, highest + 2);
    return { lowest, highest, duration: end + 0.5 };
  }, [notes, transpose]);

  const rows = layout.highest - layout.lowest + 1;
  const height = rows * ROW_HEIGHT;
  const width = Math.max(640, layout.duration * zoom);
  const beatSeconds = 60 / tempo.bpm;
  const barSeconds = beatSeconds * meter.beats;

  const gridLines = useMemo(() => {
    const lines: { x: number; bar: boolean; label?: string }[] = [];
    // Anchor the grid on the detected downbeat so the bars match the score.
    let time = tempo.offset;
    while (time > 0) time -= barSeconds;
    let barNumber = 1;
    // Cap the line count so a long take cannot bloat the DOM.
    const maxLines = 4000;
    while (time < layout.duration && lines.length < maxLines) {
      if (time >= -0.001) {
        lines.push({
          x: GUTTER + time * zoom,
          bar: true,
          label: String(barNumber),
        });
      }
      for (let beat = 1; beat < meter.beats; beat += 1) {
        const beatTime = time + beat * beatSeconds;
        if (beatTime >= 0 && beatTime < layout.duration) {
          lines.push({ x: GUTTER + beatTime * zoom, bar: false });
        }
      }
      if (time >= -0.001) barNumber += 1;
      time += barSeconds;
    }
    return lines;
  }, [tempo.offset, barSeconds, beatSeconds, meter.beats, layout.duration, zoom]);

  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const scale = width / bounds.width;
    const x = (event.clientX - bounds.left) * scale - GUTTER;
    onSeek(Math.max(0, x / zoom));
  }

  return (
    <div className="piano-roll-wrap" dir="ltr">
      <svg
        ref={svgRef}
        className="piano-roll"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        onClick={handleClick}
        role="img"
        aria-label={`תצוגת פסנתר של ${notes.length} תווים`}
      >
        <defs>
          <linearGradient id="roll-note" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#8b6bff" />
            <stop offset="1" stopColor="#5b3fd6" />
          </linearGradient>
        </defs>

        {Array.from({ length: rows }, (_, index) => {
          const midi = layout.highest - index;
          const isBlack = BLACK_KEYS.includes(((midi % 12) + 12) % 12);
          return (
            <rect
              key={`row-${midi}`}
              x={GUTTER}
              y={index * ROW_HEIGHT}
              width={width - GUTTER}
              height={ROW_HEIGHT}
              fill={isBlack ? "#0e1424" : index % 2 ? "#151d31" : "#18213a"}
            />
          );
        })}

        {gridLines.map((line, index) => (
          <line
            key={`grid-${index}`}
            x1={line.x}
            x2={line.x}
            y1={0}
            y2={height}
            stroke={line.bar ? "#5a6790" : "#2b3450"}
            strokeWidth={line.bar ? 1.3 : 0.6}
          />
        ))}

        {gridLines
          .filter((line) => line.bar && line.label)
          .map((line, index) => (
            <text
              key={`bar-${index}`}
              x={line.x + 4}
              y={11}
              fill="#6f7ca6"
              fontSize="9"
              fontFamily="system-ui, sans-serif"
            >
              {line.label}
            </text>
          ))}

        {notes.map((note, index) => {
          const midi = note.midi + transpose;
          const y = (layout.highest - midi) * ROW_HEIGHT + 1.5;
          const x = GUTTER + note.start * zoom;
          return (
            <rect
              key={`note-${index}-${note.start}-${midi}`}
              x={x}
              y={y}
              width={Math.max(3, note.duration * zoom)}
              height={ROW_HEIGHT - 3}
              rx="3"
              fill="url(#roll-note)"
              stroke="#b9a6ff"
              strokeWidth="0.5"
              opacity={0.45 + Math.min(0.55, note.confidence * 0.7)}
            >
              <title>{`${scientificName(midi, keySignature.fifths)} · ${note.start.toFixed(2)}s · ${Math.round(note.confidence * 100)}%`}</title>
            </rect>
          );
        })}

        <rect x="0" y="0" width={GUTTER} height={height} fill="#0b1020" />
        {Array.from({ length: rows }, (_, index) => {
          const midi = layout.highest - index;
          const pitchClass = ((midi % 12) + 12) % 12;
          const isBlack = BLACK_KEYS.includes(pitchClass);
          return (
            <g key={`key-${midi}`}>
              <rect
                x={GUTTER - 18}
                y={index * ROW_HEIGHT}
                width={18}
                height={ROW_HEIGHT - 0.5}
                fill={isBlack ? "#1b2338" : "#dfe5f5"}
              />
              {pitchClass === 0 && (
                <text
                  x={4}
                  y={index * ROW_HEIGHT + ROW_HEIGHT - 4}
                  fill="#8e9ac2"
                  fontSize="9"
                  fontFamily="system-ui, sans-serif"
                >
                  {scientificName(midi, keySignature.fifths)}
                </text>
              )}
            </g>
          );
        })}

        <line
          x1={GUTTER + playhead * zoom}
          x2={GUTTER + playhead * zoom}
          y1={0}
          y2={height}
          stroke="#2dd4bf"
          strokeWidth="1.8"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
