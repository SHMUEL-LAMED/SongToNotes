import { Download } from "lucide-react";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type LedgerRow = {
  id: string;
  /** The format, in mono: WAV, MP3, MIDI, MusicXML, PDF… */
  format: string;
  /** What the file is. */
  label?: ReactNode;
  /** Its size, in mono. */
  size?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** A ready address: the row is a link. */
  href?: string;
};

export type LedgerProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  rows: LedgerRow[];
  /** The save button (SaveButton), at the start of the last row. */
  save?: ReactNode;
  /** The share button (ShareButton), beside it. */
  share?: ReactNode;
  /** On a phone, stick to the bottom of the screen as a row of formats. */
  sticky?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
};

/**
 * The downloads: one row per format — the format in mono, what it is, its
 * size, and the download mark at the end — then save and share.
 */
export const Ledger = forwardRef<HTMLElement, LedgerProps>(function Ledger(
  { rows, save, share, sticky = false, title, hint, className, ...rest },
  ref,
) {
  return (
    <section
      ref={ref}
      aria-label={title == null ? "הורדות" : undefined}
      {...rest}
      className={cx("ledger", "downloads-card", sticky && "is-sticky", className)}
    >
      {(title != null || hint != null) && (
        <header className="ledger-head">
          {title != null && <h2 className="ledger-title">{title}</h2>}
          {hint != null && <p className="ledger-hint">{hint}</p>}
        </header>
      )}
      <ul className="ledger-rows">
        {rows.map((row) => {
          const body = (
            <>
              <span className="ledger-format">{row.format}</span>
              <span className="ledger-label">{row.label}</span>
              <span className="ledger-size" dir="ltr">
                {row.size}
              </span>
              <span className="ledger-go" aria-hidden="true">
                <Download size={16} />
              </span>
            </>
          );
          return (
            <li key={row.id}>
              {row.href ? (
                <a
                  className="ledger-row"
                  href={row.disabled ? undefined : row.href}
                  aria-disabled={row.disabled || undefined}
                  onClick={(event) => {
                    if (row.disabled) {
                      event.preventDefault();
                      return;
                    }
                    row.onClick();
                  }}
                >
                  {body}
                </a>
              ) : (
                <button type="button" className="ledger-row" disabled={row.disabled} onClick={row.onClick}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {(save != null || share != null) && (
        <div className="ledger-foot">
          {save}
          {share}
        </div>
      )}
    </section>
  );
});
