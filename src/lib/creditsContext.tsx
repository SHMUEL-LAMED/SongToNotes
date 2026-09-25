import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./auth";
import {
  DEFAULT_RULES,
  browserId,
  claimReferral,
  clearPending,
  fetchRules,
  fetchStatus,
  onCredits,
  onCreditsEmpty,
  readPending,
  recordVisit,
  setOwnReferralCode,
  updatePending,
  type ClaimReply,
  type CreditPulse,
  type CreditRules,
  type CreditStatus,
} from "./credits";

type Invite = { code: string; name: string | null };

type CreditsContextValue = {
  /** The rules the whole site runs on (the defaults until the server answers). */
  rules: CreditRules;
  /** The signed-in account's position; null when signed out or not loaded yet. */
  status: CreditStatus | null;
  loading: boolean;
  refresh: () => void;
  /** Somebody's link brought this visitor, who has no account yet. */
  invite: Invite | null;
  dismissInvite: () => void;
  /** The newcomer was just welcomed with credits. */
  welcome: { credits: number; name: string | null } | null;
  dismissWelcome: () => void;
  /** A server action was refused for want of credits. */
  empty: CreditPulse | { needed?: undefined } | null;
  dismissEmpty: () => void;
  /** Says which friend's code brought this new account. */
  claim: (code: string) => Promise<ClaimReply>;
  /** Grows with every live change to the balance, for the top bar to notice. */
  beat: number;
};

const CreditsContext = createContext<CreditsContextValue | null>(null);

/** Time on screen before a visit through a link is counted: a person, not a link preview. */
const VISIT_AFTER_MS = 3000;
/** The least time between two reloads of the status on focus. */
const FOCUS_REFRESH_MS = 60_000;

/** One claim at a time, whatever React does with the effects. */
let claiming: string | null = null;

/** An invitation already counted on an earlier visit, still waiting for its sign-in. */
function waitingInvite(): Invite | null {
  const pending = readPending();
  return pending?.visited && !pending.dismissed ? { code: pending.code, name: pending.name } : null;
}

/** A balance a server reply announced, laid over the status it belongs to. */
function withPulse(status: CreditStatus, pulse: CreditPulse): CreditStatus {
  return { ...status, dailyLeft: pulse.daily, bonus: pulse.bonus, allowance: pulse.allowance || status.allowance };
}

export function CreditsProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [rules, setRules] = useState<CreditRules>(DEFAULT_RULES);
  // Kept with the account it belongs to, so a sign-out or a switch of
  // account never shows the previous account's numbers for a moment.
  const [account, setAccount] = useState<{ user: string; status: CreditStatus | null; loading: boolean } | null>(null);
  const [invite, setInvite] = useState<Invite | null>(waitingInvite);
  const [welcome, setWelcome] = useState<CreditsContextValue["welcome"]>(null);
  const [empty, setEmpty] = useState<CreditsContextValue["empty"]>(null);
  const [beat, setBeat] = useState(0);
  const loadedAt = useRef(0);
  const request = useRef(0);

  const current = account && account.user === userId ? account : null;
  const status = current?.status ?? null;

  const load = useCallback(() => {
    if (!userId) return;
    const token = (request.current += 1);
    loadedAt.current = Date.now();
    setAccount((previous) => ({
      user: userId,
      status: previous?.user === userId ? previous.status : null,
      loading: true,
    }));
    void fetchStatus()
      .then((next) => {
        if (token !== request.current) return;
        setAccount({ user: userId, status: next, loading: false });
        if (next) setRules(next.rules);
      })
      .catch(() => {
        if (token !== request.current) return;
        setAccount((previous) => (previous?.user === userId ? { ...previous, loading: false } : previous));
      });
  }, [userId]);

  // The rules, for everybody — the explanation page shows the live numbers.
  useEffect(() => {
    let alive = true;
    void fetchRules()
      .then((next) => {
        if (alive) setRules(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // The account: on sign-in, and quietly again when the tab comes back.
  useEffect(() => {
    request.current += 1;
    if (!userId) return;
    const first = window.setTimeout(load, 0);
    const onFocus = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > FOCUS_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, userId]);

  // Every link the site hands out carries the account's code.
  useEffect(() => {
    setOwnReferralCode(status?.code ?? null);
  }, [status?.code]);

  // A server reply said where the balance stands: show it at once, and fetch
  // the history behind it a moment later.
  useEffect(() => {
    let timer = 0;
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 1500);
    };
    const offPulse = onCredits((pulse) => {
      setAccount((previous) => (previous?.status ? { ...previous, status: withPulse(previous.status, pulse) } : previous));
      setBeat((value) => value + 1);
      settle();
    });
    const offEmpty = onCreditsEmpty((pulse) => {
      setEmpty(pulse ?? {});
      if (pulse) {
        setAccount((previous) => (previous?.status ? { ...previous, status: withPulse(previous.status, pulse) } : previous));
        setBeat((value) => value + 1);
      }
      settle();
    });
    return () => {
      window.clearTimeout(timer);
      offPulse();
      offEmpty();
    };
  }, [load]);

  // An invitation the address brought (captured before the first render):
  // the visit is counted once the page has been looked at for a moment.
  useEffect(() => {
    const pending = readPending();
    if (!pending || pending.visited) return;
    let spent = 0;
    let last = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible") spent += now - last;
      last = now;
      if (spent < VISIT_AFTER_MS) return;
      window.clearInterval(timer);
      void recordVisit(pending.code, browserId())
        .then((reply) => {
          // A link to nobody, or the owner's own: forget it.
          if (!reply.ok || reply.self) {
            clearPending();
            return;
          }
          updatePending({ visited: true, name: reply.name });
          // Unless a sign-in has already settled the invitation meanwhile.
          const still = readPending();
          if (still && !still.dismissed) setInvite({ code: still.code, name: reply.name });
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  // Signed in with an invitation waiting: tell the server which friend it was.
  useEffect(() => {
    if (!userId) return;
    const pending = readPending();
    if (!pending || claiming === pending.code) return;
    claiming = pending.code;
    void claimReferral(pending.code)
      .then((reply) => {
        setInvite(null);
        if (reply.ok) {
          clearPending();
          if (reply.welcome > 0) setWelcome({ credits: reply.welcome, name: reply.name ?? pending.name });
          load();
          return;
        }
        // Signed out after all: keep it for the real sign-in.
        if (reply.reason !== "signed_out") clearPending();
      })
      .catch(() => undefined)
      .finally(() => {
        claiming = null;
      });
  }, [load, userId]);

  const claim = useCallback(
    async (code: string) => {
      const reply = await claimReferral(code);
      if (reply.ok) {
        clearPending();
        setInvite(null);
        if (reply.welcome > 0) setWelcome({ credits: reply.welcome, name: reply.name });
        load();
      }
      return reply;
    },
    [load],
  );

  const dismissInvite = useCallback(() => {
    updatePending({ dismissed: true });
    setInvite(null);
  }, []);
  const dismissWelcome = useCallback(() => setWelcome(null), []);
  const dismissEmpty = useCallback(() => setEmpty(null), []);

  const value = useMemo<CreditsContextValue>(
    () => ({
      rules,
      status,
      loading: current?.loading ?? false,
      refresh: load,
      invite: userId ? null : invite,
      dismissInvite,
      welcome,
      dismissWelcome,
      empty,
      dismissEmpty,
      claim,
      beat,
    }),
    [beat, claim, current?.loading, dismissEmpty, dismissInvite, dismissWelcome, empty, invite, load, rules, status, userId, welcome],
  );

  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>;
}

/**
 * What a component sees with no provider above it (a test, a tool rendered
 * on its own): the default rules and no account. Credits add to a page and
 * are never a reason for it to fail.
 */
const OUTSIDE: CreditsContextValue = {
  rules: DEFAULT_RULES,
  status: null,
  loading: false,
  refresh: () => undefined,
  invite: null,
  dismissInvite: () => undefined,
  welcome: null,
  dismissWelcome: () => undefined,
  empty: null,
  dismissEmpty: () => undefined,
  claim: () => Promise.resolve({ ok: false, reason: "signed_out", welcome: 0, name: null }),
  beat: 0,
};

// The hook lives beside its provider, like useAuth.
// eslint-disable-next-line react-refresh/only-export-components
export function useCredits() {
  return useContext(CreditsContext) ?? OUTSIDE;
}
