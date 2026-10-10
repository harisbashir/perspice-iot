import type { MeResponse, Permission } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type Session, api, refreshSession, session } from '@/api/client';

interface AuthContextValue {
  user: MeResponse | null;
  /** True until the initial session restore (refresh cookie) has finished. */
  loading: boolean;
  login(email: string, password: string, totp?: string): Promise<MeResponse>;
  logout(): Promise<void>;
  hasPerm(p: Permission): boolean;
  setUser(u: MeResponse): void;
  /** The user signed out on purpose (rather than the session expiring). */
  signedOut: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => session.subscribe((s) => setUser(s?.user ?? null)), []);

  useEffect(() => {
    let cancelled = false;
    void refreshSession().finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const s = await api<Session>('/auth/login', { body: { email, password, ...(totp ? { totp } : {}) } });
    setSignedOut(false);
    session.set(s);
    return s.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setSignedOut(true);
      session.set(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      hasPerm: (p) => !!user?.permissions.includes(p),
      setUser,
      signedOut,
    }),
    [user, loading, login, logout, signedOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
