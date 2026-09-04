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
import { supabase } from "./supabase";

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type AuthContextValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** Set when the visitor chose to work without an account. */
  guest: boolean;
  continueAsGuest: () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateName: (fullName: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const GUEST_KEY = "songtonotes.guest";

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

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [guest, setGuest] = useState(() => {
    try {
      return localStorage.getItem(GUEST_KEY) === "1";
    } catch {
      return false;
    }
  });

  const loadProfile = useCallback(async (user: User) => {
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
    void supabase.auth
      .getSession()
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      profile,
      loading,
      guest,
      continueAsGuest: () => {
        setGuest(true);
        try {
          localStorage.setItem(GUEST_KEY, "1");
        } catch {
          // Storage blocked; the choice lasts for this visit only.
        }
      },
      signInWithGoogle: async () => {
        const redirectTo = new URL(
          import.meta.env.BASE_URL,
          window.location.origin,
        ).toString();
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) throw error;
      },
      signOut: async () => {
        setGuest(false);
        try {
          localStorage.removeItem(GUEST_KEY);
        } catch {
          // Nothing to clear.
        }
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
      updateName: async (fullName: string) => {
        const cleanName = fullName.trim().slice(0, 80);
        if (!session?.user || !cleanName) return;
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
    [guest, loading, profile, session],
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
