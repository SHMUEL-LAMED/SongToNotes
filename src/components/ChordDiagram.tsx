import { chordName, type ChordQuality } from "../lib/audioChords";
import { guitarShape } from "../lib/guitarShapes";

type Props = {
  root: number;
  quality: ChordQuality;
  /** Larger for the "now playing" chord. */
  size?: number;
  flats?: boolean;
  active?: boolean;
};

const STRINGS = 6;
const FRETS = 4;

/**
 * A guitar chord box: strings left to right from low E, frets top to bottom,
 * dots where the fingers go, a bar for a barre, and × / ○ above the nut for
 * muted and open strings.
 */
export function ChordDiagram({ root, quality, size = 88, flats = false, active = false }: Props) {
  const shape = guitarShape(root, quality);
  const width = size;
  const height = size * 1.2;
  const padX = width * 0.16;
  const top = height * 0.22;
  const gridW = width - padX * 2;
  const gridH = height - top - height * 0.08;
  const stringGap = gridW / (STRINGS - 1);
  const fretGap = gridH / FRETS;
  const x = (string: number) => padX + string * stringGap;
  const y = (fret: number) => top + (fret - 0.5) * fretGap;
  const relative = (fret: number) => fret - shape.base + 1;
  const name = chordName(root, quality, flats);

  return (
    <figure className={`chord-diagram ${active ? "is-active" : ""}`} style={{ width }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`אקורד ${name}`}>
        {/* the nut, or the fret number when the shape sits up the neck */}
        {shape.base === 1 ? (
          <rect x={padX - 1} y={top - 3} width={gridW + 2} height={4} rx={1} fill="currentColor" />
        ) : (
          <text x={padX - 6} y={y(1) + 4} fontSize={size * 0.13} textAnchor="end" fill="currentColor">
            {shape.base}
          </text>
        )}
        {Array.from({ length: FRETS + 1 }, (_, fret) => (
          <line key={`f${fret}`} x1={padX} x2={padX + gridW} y1={top + fret * fretGap} y2={top + fret * fretGap} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} />
        ))}
        {Array.from({ length: STRINGS }, (_, string) => (
          <line key={`s${string}`} x1={x(string)} x2={x(string)} y1={top} y2={top + gridH} stroke="currentColor" strokeOpacity={0.6} strokeWidth={string === 0 ? 1.6 : 1} />
        ))}
        {shape.barre && (
          <rect
            x={x(shape.barre.from) - size * 0.05}
            y={y(relative(shape.barre.fret)) - size * 0.05}
            width={x(STRINGS - 1) - x(shape.barre.from) + size * 0.1}
            height={size * 0.1}
            rx={size * 0.05}
            fill="var(--accent)"
          />
        )}
        {shape.frets.map((fret, string) => {
          if (fret < 0) {
            return (
              <text key={`m${string}`} x={x(string)} y={top - size * 0.08} fontSize={size * 0.13} textAnchor="middle" fill="currentColor">
                ×
              </text>
            );
          }
          if (fret === 0) {
            return <circle key={`o${string}`} cx={x(string)} cy={top - size * 0.11} r={size * 0.04} fill="none" stroke="currentColor" strokeWidth={1.2} />;
          }
          const inBarre = shape.barre && fret === shape.barre.fret && string >= shape.barre.from;
          if (inBarre) return null;
          return <circle key={`d${string}`} cx={x(string)} cy={y(relative(fret))} r={size * 0.06} fill="var(--accent)" />;
        })}
      </svg>
      <figcaption dir="ltr">{name}</figcaption>
    </figure>
  );
}
