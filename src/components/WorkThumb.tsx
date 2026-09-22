import type { CSSProperties, ReactNode } from "react";
import { findTool } from "../lib/tools";
import type { DetectedNote } from "../lib/types";
import { KIND_TOOL, type SavedWork } from "../lib/works";

/**
 * A small picture of a saved work, drawn from what the work itself holds.
 *
 * Notes become a piano roll, chords a row of blocks, a training session its
 * accuracy as an arc, a tempo its number. Audio a tool produced has no shape
 * of its own in the record — the waveform is not stored — so those cards get
 * a stable pattern seeded by the work's id: a face to recognise it by, not a
 * measurement, and drawn so it never looks like one.
 */

const WIDTH = 160;
const HEIGHT = 96;

function seed(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return ((hash >>> 0) % 1000) / 1000;
  };
}

function notesOf(work: SavedWork): DetectedNote[] {
  const raw = Array.isArray(work.payload.notes) ? (work.payload.notes as unknown[]) : [];
  return raw.filter(
    (note): note is DetectedNote =>
      typeof note === "object" &&
      note !== null &&
      typeof (note as DetectedNote).midi === "number" &&
      typeof (note as DetectedNote).start === "number" &&
      typeof (note as DetectedNote).duration === "number",
  );
}

function Roll({ notes }: { notes: DetectedNote[] }) {
  const shown = notes.slice(0, 160);
  const end = Math.max(1, ...shown.map((note) => note.start + note.duration));
  const midis = shown.map((note) => note.midi);
  const low = Math.min(...midis) - 1;
  const high = Math.max(...midis) + 1;
  const span = Math.max(8, high - low);
  const lane = (HEIGHT - 12) / span;
  return (
    <g>
      {shown.map((note, index) => (
        <rect
          key={index}
          x={6 + (note.start / end) * (WIDTH - 12)}
          y={6 + (high - note.midi) * lane}
          width={Math.max(2, (note.duration / end) * (WIDTH - 12))}
          height={Math.max(2, lane - 1)}
          rx={1.5}
          className="thumb-note"
        />
      ))}
    </g>
  );
}

function Blocks({ count, names }: { count: number; names: string[] }) {
  const shown = Math.max(1, Math.min(8, count));
  const width = (WIDTH - 12) / shown - 3;
  return (
    <g>
      {Array.from({ length: shown }, (_unused, index) => (
        <g key={index}>
          <rect x={6 + index * (width + 3)} y={30} width={width} height={36} rx={5} className="thumb-block" />
          {names[index] && (
            <text x={6 + index * (width + 3) + width / 2} y={53} textAnchor="middle" className="thumb-label">
              {names[index]}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function Arc({ value, label }: { value: number; label: string }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const share = Math.max(0, Math.min(1, value / 100));
  return (
    <g>
      <circle cx={WIDTH / 2} cy={HEIGHT / 2} r={radius} className="thumb-ring" />
      <circle
        cx={WIDTH / 2}
        cy={HEIGHT / 2}
        r={radius}
        className="thumb-arc"
        strokeDasharray={`${share * circumference} ${circumference}`}
        transform={`rotate(-90 ${WIDTH / 2} ${HEIGHT / 2})`}
      />
      <text x={WIDTH / 2} y={HEIGHT / 2 + 6} textAnchor="middle" className="thumb-big">
        {label}
      </text>
    </g>
  );
}

function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <g>
      <text x={WIDTH / 2} y={HEIGHT / 2 + 4} textAnchor="middle" className="thumb-huge">
        {value}
      </text>
      <text x={WIDTH / 2} y={HEIGHT / 2 + 24} textAnchor="middle" className="thumb-label">
        {unit}
      </text>
    </g>
  );
}

function Lines({ count }: { count: number }) {
  const rows = Math.max(3, Math.min(6, count));
  const draw = seed(String(count));
  return (
    <g>
      {Array.from({ length: rows }, (_unused, index) => (
        <rect
          key={index}
          x={WIDTH - 12 - (40 + draw() * 90)}
          y={14 + index * ((HEIGHT - 24) / rows)}
          width={40 + draw() * 90}
          height={6}
          rx={3}
          className="thumb-line"
        />
      ))}
    </g>
  );
}

/** Not a waveform: a pattern the id always draws the same way. */
function Pattern({ id }: { id: string }) {
  const draw = seed(id);
  const bars = 28;
  const gap = (WIDTH - 12) / bars;
  return (
    <g>
      {Array.from({ length: bars }, (_unused, index) => {
        const height = 10 + draw() * (HEIGHT - 30);
        return (
          <rect
            key={index}
            x={6 + index * gap + 1}
            y={(HEIGHT - height) / 2}
            width={Math.max(2, gap - 2)}
            height={height}
            rx={2}
            className="thumb-bar"
            style={{ opacity: 0.45 + draw() * 0.55 }}
          />
        );
      })}
    </g>
  );
}

export function WorkThumb({ work, className = "" }: { work: SavedWork; className?: string }) {
  const tool = findTool(KIND_TOOL[work.kind]);
  const s = work.summary;
  const num = (key: string) => (typeof s[key] === "number" ? (s[key] as number) : null);
  const str = (key: string) => (typeof s[key] === "string" ? (s[key] as string) : "");

  let body: ReactNode;
  switch (work.kind) {
    case "notes":
    case "piano": {
      const notes = notesOf(work);
      body = notes.length ? <Roll notes={notes} /> : <Pattern id={work.id} />;
      break;
    }
    case "chords":
      body = <Blocks count={num("chordCount") ?? 4} names={str("unique").split(" ").filter(Boolean)} />;
      break;
    case "song":
      body = <Blocks count={Math.min(8, str("chords").split(" ").filter(Boolean).length || 4)} names={str("chords").split(" ").filter(Boolean)} />;
      break;
    case "ear":
    case "rhythm":
      body = <Arc value={num("accuracy") ?? 0} label={`${num("accuracy") ?? 0}%`} />;
      break;
    case "metronome":
      body = <Figure value={String(num("bpm") ?? "—")} unit="BPM" />;
      break;
    case "analysis":
      body = <Figure value={num("bpm") ? String(Math.round(num("bpm")!)) : str("keyName") || "—"} unit={num("bpm") ? str("keyName") || "BPM" : ""} />;
      break;
    case "tuner":
      body = <Figure value={`${num("referenceA4") ?? 440}`} unit="Hz" />;
      break;
    case "transcript":
    case "lyrics":
      body = <Lines count={num("lines") ?? num("words") ?? 4} />;
      break;
    default:
      body = <Pattern id={work.id} />;
  }

  return (
    <svg
      className={`work-thumb ${className}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-hidden="true"
      style={{ "--accent-hue": tool?.hue ?? 258 } as CSSProperties}
    >
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={0} className="thumb-bg" />
      {body}
    </svg>
  );
}
