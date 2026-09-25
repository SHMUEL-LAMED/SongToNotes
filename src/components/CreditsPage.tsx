import {
  BadgeCheck,
  CalendarClock,
  Check,
  CircleHelp,
  Copy,
  Gift,
  History,
  Infinity as InfinityIcon,
  Link2,
  LogIn,
  MousePointerClick,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { isAdmin } from "../lib/admin";
import { useAuth } from "../lib/auth";
import {
  PASS_PLANS,
  PRICE_KEYS,
  PRICE_LABELS,
  allowanceFor,
  balanceOf,
  codeFromInput,
  creditsLabel,
  describeClaim,
  entryLabel,
  formatMoney,
  friendsToFullBoost,
  monthSaving,
  passActive,
  passDaysLeft,
  passesOnSale,
  referralLink,
  signed,
  untilReset,
  type CreditRules,
  type CreditStatus,
  type PassPlan,
  type PassPurchase,
} from "../lib/credits";
import { useCredits } from "../lib/creditsContext";
import { markShared, inviteMessage } from "../lib/siteShare";
import { TOOLS, findTool } from "../lib/tools";
import { Meter } from "./Charts";
import { ShareTargetButtons } from "./SiteShare";

type Props = {
  onOpen: (route: string) => void;
  onSignInError: (message: string) => void;
};

const dateTime = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "numeric" });

function formatWhen(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTime.format(date);
}

function formatDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateOnly.format(date);
}


/**
 * Credits and the private link, on one page: what the account holds and how
 * it renews, the link that brings more and what it has brought, what each
 * server action costs, the history, and the answers to the questions people
 * ask. Without an account it is the explanation, with the way in.
 */
export function CreditsPage({ onOpen, onSignInError }: Props) {
  const { user, signInWithGoogle } = useAuth();
  const { rules, status, loading, refresh, invite } = useCredits();
  const owner = isAdmin(user);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const signIn = () =>
    void signInWithGoogle().catch(() => onSignInError("לא הצלחנו לפתוח את ההתחברות ל־Google. נסה שוב."));
  const onSale = passesOnSale(rules, owner);

  return (
    <div className="credits-page" style={{ "--accent-hue": 62 } as CSSProperties}>
      <header className="credits-hero">
        <div className="credits-hero-copy">
          <p className="me-eyebrow">
            <Zap size={15} /> קרדיטים והזמנת חברים
          </p>
          <h1>
            {`${rules.daily} קרדיטים בכל יום,`} <span className="gradient-text">וחברים מביאים עוד.</span>
          </h1>
          <p>
            רוב הכלים באתר רצים אצלך בדפדפן — חינם ובלי הגבלה. קרדיטים משמשים רק לפעולות שרצות
            בשרתים של האתר: תמלול, מילים מסונכרנות, העוזר, הקראה לקובץ, הפרדת שירה ב־AI וזיהוי
            שירים. כל חשבון מקבל קצבה חדשה בכל יום, ולכל אחד יש קישור אישי: כל מי שנכנס דרכו —
            ובמיוחד מי שמצטרף — מביא לך עוד קרדיטים.
          </p>
          {!user && (
            <div className="credits-hero-actions">
              <button type="button" className="primary-button compact" onClick={signIn}>
                <LogIn size={17} /> התחברות עם Google — וקבלת הקישור שלי
              </button>
              <span className="credits-hero-note">חינם, בלי כרטיס אשראי ובלי התחייבות.</span>
            </div>
          )}
        </div>
        {user ? (
          status ? (
            <BalanceCard status={status} now={now} owner={owner} />
          ) : (
            <div className="credits-balance is-loading" role="status">
              {loading ? (
                <p>טוען את הקרדיטים…</p>
              ) : (
                <p>
                  לא הצלחנו לטעון את הקרדיטים.{" "}
                  <button type="button" className="link-button" onClick={refresh}>
                    נסה שוב
                  </button>
                </p>
              )}
            </div>
          )
        ) : (
          <GuestCard rules={rules} inviter={invite?.name ?? null} invited={Boolean(invite)} onSignIn={signIn} />
        )}
      </header>

      {!rules.enabled && (
        <p className="notice-message" role="status">
          הקרדיטים כבויים כרגע — כל פעולות השרת פתוחות בלי חיוב, בכפוף למכסה היומית של כל כלי.
        </p>
      )}

      {user && status && (
        <div className="credits-grid">
          <LinkCard status={status} rules={rules} />
          <FriendsCard status={status} rules={rules} />
        </div>
      )}

      {user && status?.canClaim && <ClaimCard rules={rules} />}

      {onSale && <PassCard rules={rules} status={user ? status : null} signedIn={Boolean(user)} now={now} onSignIn={signIn} />}

      <HowItWorks rules={rules} onSale={onSale} />
      <PriceList rules={rules} onOpen={onOpen} />

      {user && status && <HistoryCard status={status} onRefresh={refresh} loading={loading} />}

      <Questions rules={rules} onSale={onSale} />
    </div>
  );
}

/* ------------------------------------------------------------ the balance */

function BalanceCard({ status, now, owner }: { status: CreditStatus; now: number; owner: boolean }) {
  const total = balanceOf(status);
  const renews = untilReset(status.resetsAt, now);
  const pass = status.pass && passActive(status.pass, now) ? status.pass : null;
  return (
    <section className={`credits-balance ${pass ? "has-pass" : ""}`} aria-label="היתרה שלך">
      {pass && (
        <div className="credits-balance-pass">
          <p className="credits-balance-pass-title">
            <InfinityIcon size={18} aria-hidden="true" />
            <b>{`${PASS_PLANS[pass.plan ?? "week"].title} פעיל`}</b>
            <span>{`עד ${formatDay(pass.until)} · עוד ${passDaysLeft(pass, now)} ימים`}</span>
          </p>
          <Meter
            label="שימוש הוגן היום"
            value={pass.left}
            max={pass.daily}
            note="כל פעולות השרת בלי קרדיטים עד התקרה היומית; מעבר לה — הקרדיטים שלמטה."
          />
        </div>
      )}
      <p className="credits-balance-label">יש לך עכשיו</p>
      <p className="credits-balance-total">
        <Zap size={30} aria-hidden="true" />
        <b translate="no">{total.toLocaleString("he-IL")}</b>
        <span>קרדיטים</span>
      </p>
      <Meter
        label="מהקצבה היומית"
        value={status.dailyLeft}
        max={status.allowance}
        note={renews ? `מתחדשת לכדי ${status.allowance} בעוד ${renews} (בחצות, שעון ישראל)` : undefined}
      />
      <dl className="credits-balance-split">
        <div>
          <dt>קצבה יומית</dt>
          <dd>{`${status.dailyLeft} / ${status.allowance}`}</dd>
        </div>
        <div>
          <dt>בונוס שצברת</dt>
          <dd>{status.bonus.toLocaleString("he-IL")}</dd>
        </div>
        <div>
          <dt>נוצלו היום</dt>
          <dd>{status.spentToday.toLocaleString("he-IL")}</dd>
        </div>
      </dl>
      {owner && (
        <p className="credits-owner-note">
          <ShieldCheck size={14} aria-hidden="true" /> כמנהל האתר, פעולות לא נחסמות אצלך גם כשהיתרה נגמרת.
        </p>
      )}
    </section>
  );
}

function GuestCard({
  rules,
  inviter,
  invited,
  onSignIn,
}: {
  rules: CreditRules;
  inviter: string | null;
  invited: boolean;
  onSignIn: () => void;
}) {
  return (
    <section className="credits-balance is-guest" aria-label="מה מקבלים">
      {invited && (
        <p className="credits-invited">
          <Gift size={16} aria-hidden="true" />
          {inviter ? `קיבלת הזמנה מ${inviter}` : "קיבלת הזמנה מחבר"}
        </p>
      )}
      <p className="credits-balance-label">מתחברים ומקבלים</p>
      <p className="credits-balance-total">
        <Zap size={30} aria-hidden="true" />
        <b translate="no">{rules.daily}</b>
        <span>קרדיטים בכל יום</span>
      </p>
      <ul className="credits-guest-list">
        {invited && rules.welcomeBonus > 0 && <li>{`${creditsLabel(rules.welcomeBonus)} מתנה על ההצטרפות דרך ההזמנה`}</li>}
        <li>קישור אישי להזמנת חברים</li>
        <li>{`${creditsLabel(rules.signupBonus)} על כל חבר שמצטרף`}</li>
        <li>שמירת כל העבודות בענן, מכל מכשיר</li>
      </ul>
      <button type="button" className="primary-button compact" onClick={onSignIn}>
        <LogIn size={17} /> התחברות עם Google
      </button>
    </section>
  );
}

/* ------------------------------------------------------------ the link */

function LinkCard({ status, rules }: { status: CreditStatus; rules: CreditRules }) {
  const link = referralLink(status.code);
  const { title, text } = inviteMessage(rules.welcomeBonus);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (copy !== "copied") return;
    const timer = window.setTimeout(() => setCopy("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copy]);

  const copyLink = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(link);
        markShared();
        setCopy("copied");
      } catch {
        inputRef.current?.select();
        setCopy("failed");
      }
    })();
  };

  return (
    <section className="me-panel credits-link-card">
      <header className="me-panel-head">
        <div>
          <h2>
            <Link2 size={17} /> הקישור האישי שלך
          </h2>
          <p>שלחו אותו לחברים. כל מי שנכנס דרכו נספר לזכותך — וכל מי שמצטרף מביא לך הרבה יותר.</p>
        </div>
      </header>
      <div className="share-site-link credits-link-row">
        <input
          ref={inputRef}
          className="field"
          type="text"
          readOnly
          value={link}
          dir="ltr"
          aria-label="הקישור האישי שלך"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className={`primary-button compact ${copy === "copied" ? "is-done" : ""}`} onClick={copyLink}>
          {copy === "copied" ? <Check size={16} /> : <Copy size={16} />}
          {copy === "copied" ? "הועתק" : "העתקה"}
        </button>
      </div>
      {copy === "failed" && (
        <p className="share-site-note" role="status">
          ההעתקה האוטומטית לא עבדה כאן — הקישור מסומן, אפשר להעתיק אותו ידנית.
        </p>
      )}
      <ShareTargetButtons url={link} text={text} title={title} />
      <p className="credits-code">
        הקוד שלך: <code translate="no">{status.code}</code> · כל קישור שמשתפים מהאתר (גם לעבודה שמורה) כבר נושא אותו.
      </p>
    </section>
  );
}

function FriendsCard({ status, rules }: { status: CreditStatus; rules: CreditRules }) {
  const boost = allowanceFor(status.friends, rules) - rules.daily;
  const toFull = friendsToFullBoost(status.friends, rules);
  return (
    <section className="me-panel credits-friends-card">
      <header className="me-panel-head">
        <div>
          <h2>
            <Users size={17} /> מה הקישור הביא לך
          </h2>
          <p>המספרים מתעדכנים ברגע שמישהו נכנס או מצטרף.</p>
        </div>
      </header>
      <div className="credits-figures">
        <div>
          <MousePointerClick size={17} aria-hidden="true" />
          <b>{status.visits.toLocaleString("he-IL")}</b>
          <span>נכנסו לקישור</span>
        </div>
        <div>
          <UserPlus size={17} aria-hidden="true" />
          <b>{status.friends.toLocaleString("he-IL")}</b>
          <span>הצטרפו דרכו</span>
        </div>
        <div>
          <Gift size={17} aria-hidden="true" />
          <b>{status.earned.toLocaleString("he-IL")}</b>
          <span>קרדיטים שהרווחת</span>
        </div>
      </div>
      {rules.friendDaily > 0 && rules.friendDailyMax > 0 && (
        <Meter
          label="תוספת לקצבה היומית בזכות חברים"
          value={boost}
          max={rules.friendDailyMax}
          note={
            toFull > 0
              ? `הקצבה היומית שלך: ${rules.daily} + ${boost} = ${rules.daily + boost}. עוד ${toFull} חברים עד התוספת המלאה (${signed(rules.friendDailyMax)} ביום).`
              : `הקצבה היומית שלך: ${rules.daily} + ${boost} = ${rules.daily + boost} — התוספת המלאה!`
          }
        />
      )}
      {rules.visitBonus > 0 && (
        <p className="credits-small">
          {`היום קיבלת ${status.visitsRewardedToday} מתוך ${rules.visitDailyMax} קרדיטים אפשריים על כניסות לקישור.`}
        </p>
      )}
    </section>
  );
}

function ClaimCard({ rules }: { rules: CreditRules }) {
  const { claim } = useCredits();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = codeFromInput(value);
    if (!code) {
      setMessage({ ok: false, text: "זה לא נראה כמו קוד או קישור הזמנה. הקוד הוא 8 אותיות ומספרים באנגלית." });
      return;
    }
    setBusy(true);
    setMessage(null);
    void claim(code)
      .then((reply) =>
        setMessage(
          reply.ok
            ? { ok: true, text: reply.welcome > 0 ? `מעולה! קיבלת ${creditsLabel(reply.welcome)} מתנה.` : "נרשם. תודה!" }
            : { ok: false, text: describeClaim(reply) },
        ),
      )
      .catch(() => setMessage({ ok: false, text: "החיבור לשרת נכשל. נסה שוב." }))
      .finally(() => setBusy(false));
  };

  return (
    <section className="me-panel credits-claim">
      <header className="me-panel-head">
        <div>
          <h2>
            <Sparkles size={17} /> הגעת בזכות חבר?
          </h2>
          <p>
            {rules.welcomeBonus > 0
              ? `אם נרשמת ממכשיר אחר מזה שבו פתחת את ההזמנה, הזינו כאן את הקוד או הקישור של החבר — שניכם תקבלו קרדיטים (את ${creditsLabel(rules.welcomeBonus)} שלך מיד).`
              : "אם נרשמת ממכשיר אחר מזה שבו פתחת את ההזמנה, הזינו כאן את הקוד או הקישור של החבר — והוא יקבל את הקרדיטים שלו."}
          </p>
        </div>
      </header>
      <form className="credits-claim-form" onSubmit={submit}>
        <input
          className="field"
          type="text"
          value={value}
          dir="ltr"
          placeholder="abcd2345 או הקישור המלא"
          aria-label="הקוד או הקישור של החבר"
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
        />
        <button type="submit" className="secondary-button" disabled={busy || !value.trim()}>
          {busy ? "בודק…" : "אישור הקוד"}
        </button>
      </form>
      {message && (
        <p className={message.ok ? "notice-message" : "error-message"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ the pass */

const PURCHASE_STATUS: Record<PassPurchase["status"], string> = {
  completed: "שולם",
  pending: "בבדיקה אצל PayPal",
  refunded: "הוחזר",
};

/**
 * Buying a pass: a week or a month in which the server work costs no
 * credits. Paid once through PayPal; the page never names the price to the
 * server, which has it.
 */
function PassCard({
  rules,
  status,
  signedIn,
  now,
  onSignIn,
}: {
  rules: CreditRules;
  status: CreditStatus | null;
  signedIn: boolean;
  now: number;
  onSignIn: () => void;
}) {
  const { buyPass, buying } = useCredits();
  const pay = rules.pay;
  const active = status?.pass && passActive(status.pass, now) ? status.pass : null;
  const saving = monthSaving(pay);
  const plans: PassPlan[] = ["week", "month"];
  return (
    <section className="me-panel credits-pass" id="pass" aria-labelledby="credits-pass-title">
      <header className="me-panel-head">
        <div>
          <h2 id="credits-pass-title">
            <InfinityIcon size={17} /> חופשי — כל הכלים בלי לספור קרדיטים
          </h2>
          <p>
            <span>בזמן החופשי, תמלול, העוזר, הפרדת שירה, זיהוי שירים והקראה לא עולים קרדיטים. </span>
            <span>{`שימוש הוגן: עד ${pay.passDaily} ביום.`}</span>
          </p>
        </div>
        {pay.mode === "sandbox" && <span className="credits-test-badge">מצב ניסיון</span>}
      </header>

      {active && (
        <p className="credits-pass-active" role="status">
          <BadgeCheck size={17} aria-hidden="true" />
          <span>{`${PASS_PLANS[active.plan ?? "week"].title} שלך פעיל עד ${formatDay(active.until)}.`}</span>
          <span>אפשר להאריך — הימים החדשים נוספים אחרי הסוף.</span>
        </p>
      )}

      <div className="credits-pass-plans">
        {plans.map((plan) => (
          <div key={plan} className={`credits-pass-plan ${plan === "month" ? "is-best" : ""}`}>
            {plan === "month" && saving > 0 && <span className="credits-pass-ribbon">{`חוסך ${saving}%`}</span>}
            <b>{PASS_PLANS[plan].title}</b>
            <p className="credits-pass-price" translate="no">
              {formatMoney(pay[plan], pay.currency)}
            </p>
            <small>{`${PASS_PLANS[plan].length} בלי הגבלה`}</small>
            <button
              type="button"
              className={plan === "month" ? "primary-button compact" : "secondary-button compact"}
              disabled={buying !== null}
              onClick={() => (signedIn ? buyPass(plan) : onSignIn())}
            >
              {buying === plan ? "פותח את PayPal…" : !signedIn ? "להתחבר ולקנות" : active ? "להאריך" : "לקנות"}
            </button>
          </div>
        ))}
      </div>

      <p className="credits-small">
        <span>תשלום אחד דרך PayPal — בחשבון PayPal או בכרטיס אשראי. </span>
        <span>בלי מנוי ובלי חידוש אוטומטי.</span>
      </p>
      {pay.mode === "sandbox" && (
        <p className="credits-small credits-test-note">
          <span>מצב ניסיון: רק מנהל האתר רואה את המכירה, והתשלום הוא בכסף של בדיקה (חשבון Sandbox של PayPal). </span>
          <span>כשהכול עובד, מעבירים לתשלומים אמיתיים בלוח הניהול.</span>
        </p>
      )}

      {status && status.purchases.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table credits-purchases">
            <thead>
              <tr>
                <th scope="col">מתי</th>
                <th scope="col">מה</th>
                <th scope="col">סכום</th>
                <th scope="col">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {status.purchases.map((purchase) => (
                <tr key={purchase.id} className={`is-${purchase.status}`}>
                  <td>{formatWhen(purchase.at)}</td>
                  <td>
                    {PASS_PLANS[purchase.plan].title}
                    {purchase.mode === "sandbox" && <small className="credits-history-badge">ניסיון</small>}
                  </td>
                  <td translate="no">{formatMoney(purchase.amount, purchase.currency)}</td>
                  <td>
                    {PURCHASE_STATUS[purchase.status]}
                    {purchase.status === "completed" && purchase.until && <small>{` · עד ${formatDay(purchase.until)}`}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ the rules */

function HowItWorks({ rules, onSale }: { rules: CreditRules; onSale: boolean }) {
  // Each sentence is a text of its own, so each is translated on its own.
  const steps: { icon: ReactNode; title: string; text: string[] }[] = [
    {
      icon: <CalendarClock size={20} />,
      title: `כל יום ${creditsLabel(rules.daily)}`,
      text: ["הקצבה מתחדשת בכל חצות (שעון ישראל).", "מה שלא נוצל באותו יום לא נצבר — אז אין סיבה לחסוך."],
    },
    {
      icon: <Link2 size={20} />,
      title: "קישור אישי לכל אחד",
      text: [
        "לכל חשבון יש קישור פרטי משלו.",
        "משתפים אותו בוואטסאפ, ברשתות או במייל — וגם כל קישור לעבודה שמורה שמשתפים מהאתר נושא אותו.",
      ],
    },
    ...(rules.visitBonus > 0
      ? [
          {
            icon: <MousePointerClick size={20} />,
            title: `נכנסו לקישור שלך: ${signed(rules.visitBonus)}`,
            text: [
              `על כל אדם חדש שנכנס דרך הקישור (עד ${rules.visitDailyMax} ביום).`,
              "כל אדם נספר פעם אחת, וכניסות שלך לקישור של עצמך לא נספרות.",
            ],
          },
        ]
      : []),
    {
      icon: <UserPlus size={20} />,
      title:
        rules.friendDaily > 0
          ? `חבר הצטרף: ${signed(rules.signupBonus)}, ועוד ${signed(rules.friendDaily)} בכל יום`
          : `חבר הצטרף: ${signed(rules.signupBonus)}`,
      text: [
        rules.friendDaily > 0 ? `הקצבה היומית שלך גדלה לתמיד בכל חבר, עד תוספת של ${rules.friendDailyMax} ביום.` : null,
        rules.welcomeBonus > 0 ? `והחבר מקבל ${creditsLabel(rules.welcomeBonus)} מתנה על ההצטרפות.` : null,
      ].filter((line): line is string => Boolean(line)),
    },
    {
      icon: <PiggyBank size={20} />,
      title: "הבונוס לא פג",
      text: ["קרדיטים שהרווחת נשמרים עד שמשתמשים בהם.", "בכל פעולה נוצלת קודם הקצבה היומית, ורק אחריה הבונוס."],
    },
    ...(onSale
      ? [
          {
            icon: <InfinityIcon size={20} />,
            title: `חופשי: ${formatMoney(rules.pay.week, rules.pay.currency)} לשבוע, ${formatMoney(rules.pay.month, rules.pay.currency)} לחודש`,
            text: [
              "בזמן החופשי כל פעולות השרת לא עולות קרדיטים.",
              `שימוש הוגן: עד ${rules.pay.passDaily} ביום — ומעבר לזה הקרדיטים הרגילים.`,
            ],
          },
        ]
      : []),
  ];
  return (
    <section className="me-panel credits-how" aria-labelledby="credits-how-title">
      <header className="me-panel-head">
        <div>
          <h2 id="credits-how-title">
            <Sparkles size={17} /> איך זה עובד
          </h2>
          <p>כל הכללים, בקצרה.</p>
        </div>
      </header>
      <ol className="credits-steps">
        {steps.map((step, index) => (
          <li key={step.title} style={{ "--reveal": `${index * 60}ms` } as CSSProperties}>
            <span className="credits-step-icon">{step.icon}</span>
            <div>
              <b>{step.title}</b>
              <p>
                {step.text.map((line) => (
                  <span key={line}>{line} </span>
                ))}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PriceList({ rules, onOpen }: { rules: CreditRules; onOpen: (route: string) => void }) {
  const freeTools = useMemo(() => TOOLS.filter((tool) => !tool.server), []);
  const examples = [
    rules.prices.minute > 0 ? `לתמלל ${Math.floor(rules.daily / rules.prices.minute)} דקות` : null,
    rules.prices.assistant > 0 ? `לשלוח ${Math.floor(rules.daily / rules.prices.assistant)} הודעות לעוזר` : null,
    rules.prices.separate > 0 ? `להפריד שירה ב־${Math.floor(rules.daily / rules.prices.separate)} שירים` : null,
  ].filter(Boolean);
  return (
    <section className="me-panel credits-prices" aria-labelledby="credits-prices-title">
      <header className="me-panel-head">
        <div>
          <h2 id="credits-prices-title">
            <Zap size={17} /> מה עולה קרדיטים
          </h2>
          <p>רק פעולות שרצות בשרתים של האתר. אם פעולה נכשלת — הקרדיטים חוזרים אוטומטית.</p>
        </div>
      </header>
      <div className="admin-table-wrap">
        <table className="admin-table credits-table">
          <thead>
            <tr>
              <th scope="col">פעולה</th>
              <th scope="col">מחיר</th>
              <th scope="col">איפה</th>
            </tr>
          </thead>
          <tbody>
            {PRICE_KEYS.map((key) => {
              const label = PRICE_LABELS[key];
              const tools = label.tools.map(findTool).filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));
              return (
                <tr key={key}>
                  <th scope="row">
                    <b>{label.title}</b>
                    <small>{label.unit}</small>
                  </th>
                  <td className="credits-price">
                    {rules.prices[key] > 0 ? creditsLabel(rules.prices[key]) : "חינם"}
                  </td>
                  <td>
                    <span className="credits-tool-links">
                      {key === "assistant" ? (
                        <span className="credits-muted">בפינת כל עמוד (Ctrl+J)</span>
                      ) : (
                        tools.map((tool) => (
                          <button key={tool.id} type="button" className="link-button" onClick={() => onOpen(tool.id)}>
                            {tool.title}
                          </button>
                        ))
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            <tr className="credits-free-row">
              <th scope="row">
                <b>{`כל ${freeTools.length} הכלים שרצים בדפדפן`}</b>
                <small>תווים, צלצולים, מטרונום, טיונר, פסנתר, אקורדים, מכונת תופים ועוד</small>
              </th>
              <td className="credits-price is-free">
                <InfinityIcon size={16} aria-hidden="true" /> חינם
              </td>
              <td>
                <span className="credits-muted">בלי הגבלה ובלי חשבון</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {examples.length > 0 && (
        <p className="credits-small">{`עם ${rules.daily} הקרדיטים של יום אחד אפשר, למשל: ${examples.join(", או ")}.`}</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ history */

function HistoryCard({ status, onRefresh, loading }: { status: CreditStatus; onRefresh: () => void; loading: boolean }) {
  return (
    <section className="me-panel credits-history" aria-labelledby="credits-history-title">
      <header className="me-panel-head">
        <div>
          <h2 id="credits-history-title">
            <History size={17} /> ההיסטוריה שלך
          </h2>
          <p>מה נוצל, מה חזר ומה הרווחת — ארבעים התנועות האחרונות.</p>
        </div>
        <button type="button" className="secondary-button compact" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? "is-spinning" : ""} /> רענון
        </button>
      </header>
      {status.history.length === 0 ? (
        <p className="admin-empty">עדיין אין תנועות. הן יופיעו כאן אחרי הפעולה הראשונה בשרת, או כשמישהו ייכנס לקישור שלך.</p>
      ) : (
        <ul className="credits-history-list">
          {status.history.map((entry) => (
            <li key={entry.id} className={`is-${entry.kind} ${entry.refunded ? "is-refunded" : ""}`}>
              <span className="credits-history-when">{formatWhen(entry.at)}</span>
              <span className="credits-history-what">
                {entryLabel(entry)}
                {entry.refunded && <small className="credits-history-badge">הוחזר</small>}
              </span>
              {entry.kind === "purchase" || (entry.delta === 0 && entry.fromPass > 0) ? (
                <b className="credits-history-delta is-pass">
                  <InfinityIcon size={14} aria-hidden="true" /> {entry.kind === "purchase" ? "חופשי" : "בחופשי"}
                </b>
              ) : (
                <b className="credits-history-delta" translate="no" dir="ltr">
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </b>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ questions */

function Questions({ rules, onSale }: { rules: CreditRules; onSale: boolean }) {
  const claimDays = Math.max(1, Math.round(rules.claimHours / 24));
  const items = [
    {
      q: "מה קורה כשהקרדיטים נגמרים?",
      a: "פעולות השרת ממתינות עד חצות, כשהקצבה היומית מתחדשת — או עד שתצבור בונוס מחברים. כל שאר הכלים ממשיכים לעבוד כרגיל, ואת הפרדת השירה אפשר להריץ גם בדפדפן, בלי קרדיטים בכלל.",
    },
    {
      q: "למה רוב הכלים לא עולים קרדיטים?",
      a: "כי הם רצים אצלך במכשיר ולא עולים לאתר כלום. קרדיטים הם רק לעבודה שמתבצעת בשרתים — זיהוי דיבור, מודלי שפה, הפרדה וזיהוי שירים — שעולה לאתר כסף בכל שימוש.",
    },
    {
      q: "איך יודעים מי נכנס לקישור שלי?",
      a: "כשמישהו פותח את הקישור, האתר שומר טביעה מוצפנת של הדפדפן ושל החיבור — לא את הכתובת עצמה ולא שום פרט מזהה — רק כדי לספור כל אדם פעם אחת. אין לך דרך לדעת מי נכנס, רק כמה.",
    },
    {
      q: "חבר הצטרף ולא קיבלתי קרדיטים",
      a: `החבר צריך לפתוח את הקישור ולהתחבר באותו דפדפן, עם חשבון חדש (חשבון שכבר היה קיים לא נספר). אם נרשם ממכשיר אחר, הוא יכול להזין את הקוד שלך בדף הזה ${claimDays === 1 ? "ביום הראשון אחרי ההרשמה" : `עד ${claimDays} ימים אחרי ההרשמה`}.`,
    },
    {
      q: "פעולה נכשלה — הקרדיטים ירדו?",
      a: "לא. אם השירות נכשל, הקרדיטים חוזרים אוטומטית, וההחזר מופיע בהיסטוריה.",
    },
    onSale
      ? {
          q: "אפשר לקנות קרדיטים?",
          a: `את הקרדיטים עצמם לא קונים — אבל אפשר לקנות חופשי: ${formatMoney(rules.pay.week, rules.pay.currency)} לשבוע או ${formatMoney(rules.pay.month, rules.pay.currency)} לחודש, ובזמן הזה כל פעולות השרת לא עולות קרדיטים (שימוש הוגן: עד ${rules.pay.passDaily} ביום). התשלום חד־פעמי דרך PayPal, בלי מנוי ובלי חידוש אוטומטי.`,
        }
      : {
          q: "אפשר לקנות קרדיטים?",
          a: "לא. הקרדיטים חינמיים לגמרי: קצבה יומית לכל מי שמחובר, ועוד על כל חבר שמצטרף.",
        },
    ...(onSale
      ? [
          {
            q: "קניתי חופשי — מה קורה עם הקרדיטים שלי?",
            a: "הם נשארים בדיוק כמו שהם. בזמן החופשי הפעולות לא נוגעות בהם, והם מחכים לך לאחר מכן. אם קונים חופשי כשכבר יש אחד פעיל, הימים החדשים נוספים אחרי הסוף שלו.",
          },
          {
            q: "משהו השתבש בתשלום",
            a: "אם PayPal דחה את התשלום או שיצאת באמצע — לא חויבת, ואפשר פשוט לנסות שוב. אם חויבת והחופשי לא נפתח תוך כמה דקות, כתבו לנו ב'משוב והצעות' ונסדר. תשלום שמוחזר ב־PayPal מבטל גם את הימים שנקנו בו.",
          },
        ]
      : []),
  ];
  return (
    <section className="me-panel credits-faq" aria-labelledby="credits-faq-title">
      <header className="me-panel-head">
        <div>
          <h2 id="credits-faq-title">
            <CircleHelp size={17} /> שאלות נפוצות
          </h2>
        </div>
      </header>
      <div className="credits-faq-list">
        {items.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
