/**
 * Auth Context - Supabase Auth Integration
 *
 * Provides authentication state and methods throughout the app.
 * Replaces the old roleContext with real Supabase Auth.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { supabase, toAuthUser, type AuthUser } from "./supabase";
import type { Session } from "@supabase/supabase-js";

interface AuthContextType {
  // User state
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;

  // Auth methods
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;

  // Legacy compatibility
  role: "client" | "superadmin" | null;
  setRole: (role: "client" | "superadmin" | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state on mount
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const authUser = toAuthUser(session.user);
        setUser(authUser);
      }
      setIsLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        const authUser = toAuthUser(session.user);
        setUser(authUser);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Sign in with magic link
  const signInWithEmail = async (email: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // Redirect to the current origin after clicking magic link
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        console.error("[auth] Sign in error:", error);
        return { error: error as Error };
      }

      return { error: null };
    } catch (err) {
      console.error("[auth] Unexpected sign in error:", err);
      return { error: err as Error };
    }
  };

  // Sign out
  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  // Legacy compatibility - map to old role format
  const role = user
    ? user.role === "super_admin"
      ? "superadmin"
      : "client"
    : null;

  // Legacy setRole - does nothing in real auth mode
  // Kept for backward compatibility during transition
  const setRole = (_role: "client" | "superadmin" | null) => {
    console.warn("[auth] setRole is deprecated. Use Supabase Auth instead.");
  };

  // Legacy logout - maps to signOut
  const logout = () => {
    signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        signInWithEmail,
        signOut,
        // Legacy compatibility
        role,
        setRole,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Legacy hook for backward compatibility
 * Maps to useAuth with old interface
 */
export function useRole() {
  const { role, setRole, logout } = useAuth();
  return { role, setRole, logout };
}
