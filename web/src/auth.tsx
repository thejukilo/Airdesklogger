import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import * as api from "./api";
import { runBiometric } from "./lib/biometric";

interface AuthState {
  user: api.SessionUser | null;
  /** Full profile including subscription state. Loaded lazily after sign-in. */
  profile: api.Profile | null;
  mfaEnabled: boolean;
  loading: boolean;
  /** True when the session was dropped because the token expired, for a notice on login. */
  sessionExpired: boolean;
  /** True (native app only) when a restored session is waiting for biometric unlock. */
  locked: boolean;
  /** Whether the holder has turned on biometric unlock on this device. */
  biometricEnabled: boolean;
  login: (email: string, password: string, code?: string) => Promise<{ mfaRequired: boolean }>;
  logout: () => void;
  setMfaEnabled: (enabled: boolean) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  /** Prompt for biometric unlock; returns true on success. */
  unlock: () => Promise<boolean>;
  refreshUser: (user: api.SessionUser) => void;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

const USER_KEY = "airdesk.user";
const MFA_KEY = "airdesk.mfa";
const BIO_KEY = "airdesk.biometric";

function bioPref(): boolean {
  return Capacitor.isNativePlatform() && localStorage.getItem(BIO_KEY) === "true";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.SessionUser | null>(null);
  const [profile, setProfile] = useState<api.Profile | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(bioPref());

  async function loadProfile() {
    try {
      const p = await api.getProfile();
      setProfile(p);
    } catch {
      // Profile is non-critical; the banner just won't show until next fetch.
      setProfile(null);
    }
  }

  // Restore the session from storage on first load. The token is validated by
  // the API on the next request; here we only rehydrate the cached identity.
  useEffect(() => {
    const token = api.getToken();
    const cached = localStorage.getItem(USER_KEY);
    if (token && cached) {
      setUser(JSON.parse(cached) as api.SessionUser);
      setMfaEnabled(localStorage.getItem(MFA_KEY) === "true");
      // In the native app, a restored session is locked until biometric unlock.
      // The LockScreen (shown because `locked`) runs the prompt on mount.
      if (bioPref()) setLocked(true);
      void loadProfile();
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
      profile,
      mfaEnabled,
      loading,
      sessionExpired,
      locked,
      biometricEnabled,
      async login(email, password, code) {
        const res = await api.login(email, password, code);
        if (res.mfaRequired && !res.token) return { mfaRequired: true };
        api.setToken(res.token ?? null);
        localStorage.setItem(USER_KEY, JSON.stringify(res.user));
        localStorage.setItem(MFA_KEY, String(res.mfaEnabled));
        setUser(res.user ?? null);
        setMfaEnabled(Boolean(res.mfaEnabled));
        setSessionExpired(false);
        void loadProfile();
        return { mfaRequired: false };
      },
      logout() {
        api.setToken(null);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(MFA_KEY);
        setUser(null);
        setProfile(null);
        setMfaEnabled(false);
        setSessionExpired(false);
        setLocked(false);
      },
      setMfaEnabled(enabled: boolean) {
        localStorage.setItem(MFA_KEY, String(enabled));
        setMfaEnabled(enabled);
      },
      setBiometricEnabled(enabled: boolean) {
        localStorage.setItem(BIO_KEY, String(enabled));
        setBiometricEnabledState(enabled);
        if (!enabled) setLocked(false);
      },
      async unlock() {
        const ok = await runBiometric("Unlock your logbook");
        if (ok) setLocked(false);
        return ok;
      },
      refreshUser(next: api.SessionUser) {
        localStorage.setItem(USER_KEY, JSON.stringify(next));
        setUser(next);
      },
      async refreshProfile() {
        await loadProfile();
      },
    }),
    [user, profile, mfaEnabled, loading, sessionExpired, locked, biometricEnabled],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
