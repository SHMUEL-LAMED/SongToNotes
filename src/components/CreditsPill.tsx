import { Gift, Zap } from "lucide-react";
import { useAuth } from "../lib/auth";
import { balanceOf } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";

/**
 * The balance, always in sight: what the account can spend right now, which
 * pops when a server action takes from it. Without an account it is the way
 * to the page that explains credits and the private link.
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
