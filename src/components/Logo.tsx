/**
 * The mark: a few bars of sound that turn into a note — what the site does,
 * in one glyph. Drawn in currentColor so it sits on the brand gradient.
 */
export function LogoGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
        <path d="M3.5 13.5v-3" />
        <path d="M7.5 16.5v-9" />
        <path d="M11.5 13v-2" />
        <path d="M18.6 17.2V4.2c1.6.7 3 1.9 3 4" />
      </g>
      <ellipse cx="15.9" cy="17.6" rx="3" ry="2.4" transform="rotate(-18 15.9 17.6)" fill="currentColor" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <span className="brand-mark">
        <LogoGlyph />
      </span>
      <span className="brand-text">
        <strong>כלי מוזיקה</strong>
        {!compact && <small>הסטודיו שלך בדפדפן</small>}
      </span>
    </>
  );
}
