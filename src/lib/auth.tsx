import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SESSION_KEY, getSupabase } from "./supabase";

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateName: (fullName: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Loading the profile is a nicety; a failure must never block the app. */
function ignoreProfileError(error: unknown) {
  console.warn("Profile could not be loaded", error);
}

function profileFromUser(user: User): Profile {
  return {
    id: user.id,
    full_name:
      (user.user_metadata.full_name as string | undefined) ??
      (user.user_metadata.name as string | undefined) ??
      null,
    avatar_url: (user.user_metadata.avatar_url as string | undefined) ?? null,
  };
}

/**
 * The session supabase-js keeps in this browser, read directly, so the first
 * paint knows who is here without waiting for the library. Once loaded, the
 * library confirms it, refreshes it, or signs out.
 */
function storedSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Session> | null) : null;
    if (!parsed?.access_token || !parsed.user?.id) return null;
    return { ...parsed, user: { ...parsed.user, user_metadata: parsed.user.user_metadata ?? {} } } as Session;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(storedSession);
  const [profile, setProfile] = useState<Profile | null>(() => (session ? profileFromUser(session.user) : null));
  // Waiting only on a stored session the library has yet to confirm; a
  // visitor with none is signed out from the first paint.
  const [loading, setLoading] = useState(() => session !== null);

  const loadProfile = useCallback(async (user: User) => {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle<Profile>();

    if (error) throw error;
    if (data) {
      setProfile(data);
      return;
    }

    const fallback = profileFromUser(user);
    const { data: created, error: createError } = await supabase
      .from("profiles")
      .upsert(fallback)
      .select("id, full_name, avatar_url")
      .single<Profile>();
    if (createError) throw createError;
    setProfile(created);
  }, []);

  useEffect(() => {
    let active = true;
    // The client loads on first use; until it has, nobody is signed in yet.
    let subscription: { unsubscribe: () => void } | null = null;
    const ready = getSupabase();
    void ready
      .then((supabase) => supabase.auth.getSession())
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) {
          void loadProfile(data.session.user)
            .catch(ignoreProfileError)
            .finally(() => {
              if (active) setLoading(false);
            });
        } else {
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        // Supabase unreachable: the app still works, just without history.
        ignoreProfileError(error);
        if (active) setLoading(false);
      });

    void ready
      .then((supabase) => {
        if (!active) return;
        subscription = supabase.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession);
          if (nextSession?.user) {
            window.setTimeout(() => {
              void loadProfile(nextSession.user)
                .catch(ignoreProfileError)
                .finally(() => setLoading(false));
            }, 0);
          } else {
            setProfile(null);
            setLoading(false);
          }
        }).data.subscription;
      })
      // A client that did not load is reported by the getSession branch above.
      .catch(() => undefined);

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      profile,
      loading,
      signInWithGoogle: async () => {
        const redirectTo = new URL(
          import.meta.env.BASE_URL,
          window.location.origin,
        ).toString();
        const supabase = await getSupabase();
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) throw error;
      },
      signOut: async () => {
        const { error } = await (await getSupabase()).auth.signOut();
        if (error) throw error;
      },
      updateName: async (fullName: string) => {
        const cleanName = fullName.trim().slice(0, 80);
        if (!session?.user || !cleanName) return;
        const supabase = await getSupabase();
        const { data, error } = await supabase
          .from("profiles")
          .update({ full_name: cleanName })
          .eq("id", session.user.id)
          .select("id, full_name, avatar_url")
          .single<Profile>();
        if (error) throw error;
        setProfile(data);
      },
    }),
    [loading, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The hook intentionally lives beside its provider so the authentication
// contract stays in one small module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
