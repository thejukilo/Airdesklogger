import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "./api";

interface AuthState {
  user: api.SessionUser | null;
  mfaEnabled: boolean;
  loading: boolean;
  /** True when the session was dropped because the token expired, for a notice on login. */
  sessionExpired: boolean;
  login: (email: string, password: string, code?: string) => Promise<{ mfaRequired: boolean }>;
  logout: () => void;
  setMfaEnabled: (enabled: boolean) => void;
  refreshUser: (user: api.SessionUser) => void;
}

const Ctx = createContext<AuthState | null>(null);

const USER_KEY = "airdesk.user";
const MFA_KEY = "airdesk.mfa";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.SessionUser | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restore the session from storage on first load. The token is validated by
  // the API on the next request; here we only rehydrate the cached identity.
  useEffect(() => {
    const token = api.getToken();
    const cached = localStorage.getItem(USER_KEY);
    if (token && cached) {
      setUser(JSON.parse(cached) as api.SessionUser);
      setMfaEnabled(localStorage.getItem(MFA_KEY) === "true");
    }
    setLoading(false);
  }, []);

  // When any authenticated request is rejected with a 401, the token has
  // expired: clear the session so the route guard returns the user to login,
  // and flag it so the login screen can explain why.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      api.setToken(null);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(MFA_KEY);
      setUser(null);
      setMfaEnabled(false);
      setSessionExpired(true);
    });
    return () => api.setUnauthorizedHandler(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      mfaEnabled,
      loading,
      sessionExpired,
      async login(email, password, code) {
        const res = await api.login(email, password, code);
        if (res.mfaRequired && !res.token) return { mfaRequired: true };
        api.setToken(res.token ?? null);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
        localStorage.setItem(MFA_KEY, String(res.mfaEnabled));
        setUser(res.user ?? null);
        setMfaEnabled(Boolean(res.mfaEnabled));
        setSessionExpired(false);
        return { mfaRequired: false };
      },
      logout() {
        api.setToken(null);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(MFA_KEY);
        setUser(null);
        setMfaEnabled(false);
        setSessionExpired(false);
      },
      setMfaEnabled(enabled: boolean) {
        localStorage.setItem(MFA_KEY, String(enabled));
        setMfaEnabled(enabled);
      },
      refreshUser(next: api.SessionUser) {
        localStorage.setItem(USER_KEY, JSON.stringify(next));
        setUser(next);
      },
    }),
    [user, mfaEnabled, loading, sessionExpired],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
