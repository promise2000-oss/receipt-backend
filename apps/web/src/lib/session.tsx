"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AuthDTO, BusinessDTO, UserDTO } from "@eleos/shared";
import { api, ApiError } from "./api";

interface SessionState {
  user: UserDTO | null;
  business: BusinessDTO | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (payload: unknown) => Promise<void>;
  logout: () => Promise<void>;
  updateBusiness: (business: BusinessDTO) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [business, setBusiness] = useState<BusinessDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<AuthDTO>("/api/auth/me");
      setUser(data.user);
      setBusiness(data.business);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setUser(null);
        setBusiness(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<AuthDTO>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setUser(data.user);
    setBusiness(data.business);
    setLoading(false);
  }, []);

  const signup = useCallback(async (payload: unknown) => {
    const data = await api<AuthDTO>("/api/auth/signup", {
      method: "POST",
      body: payload,
    });
    setUser(data.user);
    setBusiness(data.business);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    setBusiness(null);
  }, []);

  const updateBusiness = useCallback((next: BusinessDTO) => setBusiness(next), []);

  const value = useMemo<SessionState>(
    () => ({
      user,
      business,
      loading,
      refresh,
      login,
      signup,
      logout,
      updateBusiness,
    }),
    [user, business, loading, refresh, login, signup, logout, updateBusiness],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}

/**
 * Route guard for the authenticated area. Redirects to /login (remembering
 * where the user was headed) once the session check comes back empty.
 */
export function useRequireAuth(): { ready: boolean } {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    }
  }, [loading, user, pathname, router]);

  return { ready: !loading && !!user };
}
