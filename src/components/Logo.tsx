import type { CSSProperties } from "react";

/**
 * The mark: an eighth note on a sapphire tile. The tile is the brand's
 * colour, the note is light with an amber head, and two faint staff lines
 * run behind it. At 16px it still reads as one note, not as stripes. `mono`
 * draws an outlined tile and the note in currentColor (the footer); so does a
 * `.is-mono` ancestor, through `--logo-tile` / `--logo-note`.
 */
export function LogoGlyph({ size = 24, mono = false }: { size?: number; mono?: boolean }) {
  const tile: CSSProperties = mono
    ? { fill: "none", stroke: "currentColor", strokeWidth: 1.5 }
    : { fill: "var(--logo-tile, var(--brand))" };
  const ink = mono ? "currentColor" : "var(--logo-ink, #fff)";
  const head = mono ? "currentColor" : "var(--logo-note, var(--brand-2))";
  return (
    <svg
      className={`logo-glyph${mono ? " is-mono" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" style={tile} />
      <g stroke={ink} strokeWidth="1.2" strokeLinecap="round" opacity={mono ? 0.45 : 0.3}>
        <path d="M6 13.5h20" />
        <path d="M6 19.5h20" />
      </g>
      <path d="M17.6 21.6V7.8c3.6 1 6 3.6 5.2 7.6" stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse className="logo-notehead" cx="13.6" cy="22" rx="4.6" ry="3.4" transform="rotate(-22 13.6 22)" fill={head} />
    </svg>
  );
}

/** The lockup: the mark, the name and, unless compact, the line under it. */
export function Logo({ compact = false, mono = false }: { compact?: boolean; mono?: boolean }) {
  return (
    <>
      <span className={`brand-mark${mono ? " is-mono" : ""}`}>
        <LogoGlyph size={28} mono={mono} />
      </span>
      <span className="brand-text">
        <strong>כלי מוזיקה</strong>
        {!compact && <small>סטודיו בדפדפן</small>}
      </span>
    </>
  );
}
