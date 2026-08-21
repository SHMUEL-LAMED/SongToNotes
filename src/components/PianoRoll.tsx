import type { NoteEventTime } from "@spotify/basic-pitch";

type PianoRollProps = {
  notes: NoteEventTime[];
};

const MIN_MIDI = 36;
const MAX_MIDI = 96;
const ROW_HEIGHT = 12;
const PX_PER_SECOND = 52;

export function PianoRoll({ notes }: PianoRollProps) {
  const duration = Math.max(
    8,
    ...notes.map((note) => note.startTimeSeconds + note.durationSeconds),
  );
  const width = Math.max(900, duration * PX_PER_SECOND);
  const height = (MAX_MIDI - MIN_MIDI + 1) * ROW_HEIGHT;
  const filtered = notes.filter(
    (note) => note.pitchMidi >= MIN_MIDI && note.pitchMidi <= MAX_MIDI,
  );

  return (
    <div className="piano-roll-wrap" dir="ltr">
      <svg
        className="piano-roll"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="תצוגת Piano Roll של התווים שזוהו"
      >
        <defs>
          <linearGradient id="note-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="#7c5cff" />
            <stop offset="1" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>
        {Array.from({ length: MAX_MIDI - MIN_MIDI + 1 }, (_, index) => {
          const midi = MAX_MIDI - index;
          const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
          return (
            <rect
              key={midi}
              x="0"
              y={index * ROW_HEIGHT}
              width={width}
              height={ROW_HEIGHT}
              fill={isBlack ? "#11182b" : index % 2 ? "#151d32" : "#182139"}
            />
          );
        })}
        {Array.from({ length: Math.ceil(duration) + 1 }, (_, second) => (
          <line
            key={second}
            x1={second * PX_PER_SECOND}
            x2={second * PX_PER_SECOND}
            y1="0"
            y2={height}
            stroke={second % 4 === 0 ? "#4b5778" : "#303a59"}
            strokeWidth={second % 4 === 0 ? 1.2 : 0.5}
          />
        ))}
        {filtered.map((note, index) => {
          const y = (MAX_MIDI - note.pitchMidi) * ROW_HEIGHT + 1;
          return (
            <rect
              key={`${note.startTimeSeconds}-${note.pitchMidi}-${index}`}
              x={note.startTimeSeconds * PX_PER_SECOND}
              y={y}
              width={Math.max(2, note.durationSeconds * PX_PER_SECOND)}
              height={ROW_HEIGHT - 2}
              rx="3"
              fill="url(#note-gradient)"
              opacity={Math.max(0.5, note.amplitude)}
            />
          );
        })}
      </svg>
    </div>
  );
}

