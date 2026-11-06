import { useEffect, useState, type ReactNode } from "react";
import { Button, Panel, type ButtonSize, type PanelProps } from "../../ui";
import { cx } from "../../ui/cx";

/**
 * The small parts every section of the admin area is drawn from: the card,
 * the button that asks before it destroys, the waiting state, the quiet
 * lines. Dates and the spreadsheet export are in format.ts.
 */

/**
 * A panel of the admin area. `wide` spans the whole row of the grid; the
 * rest sit two to a row where there is room.
 */
export function Card({ wide, className, ...rest }: PanelProps & { wide?: boolean }) {
  return <Panel step={false} {...rest} className={cx("adm-card", wide && "is-wide", className)} />;
}

/**
 * A destructive button that asks first: the first press arms it and says
 * what is about to happen, the second carries it out, and leaving it alone
 * disarms it after a few seconds.
 */
export function ArmedButton({
  children,
  confirmLabel,
  onConfirm,
  disabled,
  icon,
  size = "sm",
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  size?: ButtonSize;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      size={size}
      variant={armed ? "danger" : "secondary"}
      className={armed ? undefined : "adm-danger-text"}
      icon={armed ? undefined : icon}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

/** Shimmering lines while a section's data is on its way. */
export function Loading({ text, lines = 3 }: { text: string; lines?: number }) {
  return (
    <div className="adm-loading" role="status">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="adm-loading-bar" />
      ))}
      <p>{text}</p>
    </div>
  );
}

/** The quiet line under a list: what was looked for and found nothing. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}

/** A small explanation under a panel's content. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="admin-foot-note">{children}</p>;
}
