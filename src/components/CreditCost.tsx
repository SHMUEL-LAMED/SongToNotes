import { Infinity as InfinityIcon, Zap } from "lucide-react";
import { useAuth } from "../lib/auth";
import { balanceOf, creditsLabel, passActive } from "../lib/credits";
import { useCredits } from "../lib/creditsContext";

/**
 * The price of a server action, said before it is paid: what it costs, what
 * the account holds, and the way to more when that is not enough — or that a
 * running pass covers it. Says nothing while credits are switched off.
 */
export function CreditCost({
  cost,
  estimate = false,
  unit,
}: {
  cost: number;
  /** The price may come out a little lower (minutes already paid for today). */
  estimate?: boolean;
  /** "לכל זיהוי": the price is per something, not for this one action. */
  unit?: string;
}) {
  const { user } = useAuth();
  const { rules, status } = useCredits();
  if (!rules.enabled || cost <= 0) return null;
  if (user && status?.pass && passActive(status.pass) && status.pass.left >= cost) {
    return (
      <p className="credit-cost is-pass">
        <InfinityIcon size={14} aria-hidden="true" />
        <span>כלול בחופשי שלך</span>
      </p>
    );
  }
  const balance = user && status ? balanceOf(status) : null;
  const short = balance !== null && balance < cost;
  const price = unit
    ? `${creditsLabel(cost)} ${unit}`
    : estimate
      ? `עולה בערך ${creditsLabel(cost)}`
      : `עולה ${creditsLabel(cost)}`;
  return (
    <p className={`credit-cost ${short ? "is-short" : ""}`}>
      <Zap size={13} aria-hidden="true" />
      <span>{price}</span>
      {balance !== null && <span>{short ? `· יש לך רק ${balance}` : `· יש לך ${balance}`}</span>}
      {(short || !user) && <a href="#/credits">{short ? "לקבלת קרדיטים" : "מה זה?"}</a>}
    </p>
  );
}
