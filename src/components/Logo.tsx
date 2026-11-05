import type { CSSProperties } from "react";

/**
 * The mark: the first note on the staff. Five staff lines in ink (they flip
 * with the theme, through currentColor), an amber notehead on the fourth
 * line and a sapphire stem with its flag. `mono` draws the whole mark in
 * currentColor; so does a `.is-mono` ancestor (the footer), through the
 * `--logo-note` / `--logo-stem` properties.
 */
export function LogoGlyph({ size = 24, mono = false }: { size?: number; mono?: boolean }) {
  const note: CSSProperties = { fill: mono ? "currentColor" : "var(--logo-note, var(--brand-2))" };
  const stem: CSSProperties = { stroke: mono ? "currentColor" : "var(--logo-stem, var(--brand))" };
  return (
    <svg
      className={`logo-glyph${mono ? " is-mono" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <g className="logo-staff" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
        <path d="M3 9h26" />
        <path d="M3 13h26" />
        <path d="M3 17h26" />
        <path d="M3 21h26" />
        <path d="M3 25h26" />
      </g>
      <ellipse className="logo-notehead" cx="12.5" cy="21" rx="4.4" ry="3.1" transform="rotate(-22 12.5 21)" style={note} />
      <g className="logo-stem" strokeWidth="2" strokeLinecap="round" fill="none" style={stem}>
        <path d="M16.4 20V6.5" />
        <path d="M16.4 6.5c4.2 1.2 6.6 4.4 5.2 8.6" />
      </g>
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
