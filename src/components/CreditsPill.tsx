import { Gift, Infinity as InfinityIcon, Zap } from "lucide-react";
import { useAuth } from "../lib/auth";
import { balanceOf, passActive } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";

/**
 * The balance, always in sight: what the account can spend right now, which
 * pops when a server action takes from it. While a bought pass runs it says
 * so instead. Without an account it is the way to the page that explains
 * credits and the private link.
 */
export function CreditsPill({ current, onOpen }: { current: boolean; onOpen: () => void }) {
  const { user } = useAuth();
  const { status, rules, beat } = useCredits();
  if (!rules.enabled) return null;

  if (!user) {
    return (
      <button
        type="button"
        className={`credits-pill is-guest ${current ? "is-current" : ""}`}
        onClick={onOpen}
        aria-label="קרדיטים והזמנת חברים"
        title={`${rules.daily} קרדיטים חינם בכל יום, ועוד על כל חבר שמצטרף`}
      >
        <Gift size={15} aria-hidden="true" />
        <span className="credits-pill-label">קרדיטים חינם</span>
      </button>
    );
  }

  if (status?.pass && passActive(status.pass)) {
    const until = new Date(status.pass.until).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
    return (
      <button
        type="button"
        className={`credits-pill is-pass ${current ? "is-current" : ""}`}
        onClick={onOpen}
        aria-label={`חופשי פעיל עד ${until}`}
        title={`חופשי פעיל עד ${until} — פעולות השרת בלי קרדיטים (נשארו ${status.pass.left} לשימוש הוגן היום)`}
      >
        <InfinityIcon size={16} aria-hidden="true" />
        <span className="credits-pill-label">חופשי</span>
      </button>
    );
  }

  const total = status ? balanceOf(status) : null;
  return (
    <button
      type="button"
      className={`credits-pill ${current ? "is-current" : ""} ${total === 0 ? "is-empty" : ""}`}
      onClick={onOpen}
      aria-label={total === null ? "הקרדיטים שלך" : `הקרדיטים שלך: ${total}`}
      title={
        status
          ? `${status.dailyLeft} מהקצבה היומית${status.bonus ? ` · ${status.bonus} בונוס` : ""} — לחצו לקישור האישי ולהזמנת חברים`
          : "הקרדיטים שלך"
      }
    >
      <Zap size={15} aria-hidden="true" />
      {/* Keyed to every change, so each new balance arrives with a small pop. */}
      <b key={beat} className="credits-pill-count" translate="no">
        {total === null ? "…" : total.toLocaleString("he-IL")}
      </b>
      <span className="credits-pill-label">קרדיטים</span>
    </button>
  );
}
