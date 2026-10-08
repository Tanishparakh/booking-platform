import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { get, getToken, post, setToken } from './api';

export type Role = 'CLIENT' | 'PROFESSIONAL' | 'ADMIN' | 'SUPPORT';
export interface User { id: number; email: string; fullName: string; role: Role; verificationStatus?: string }

interface Ctx {
  user: User | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const refresh = async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try { setUser(await get('/auth/me')); } catch { setToken(null); setUser(null); }
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  return (
    <AuthCtx.Provider value={{
      user, loading, refresh,
      signIn: async (t) => { setToken(t); await refresh(); },
      signOut: () => { post('/auth/logout').catch(() => {}); setToken(null); setUser(null); },
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const homeFor = (role: Role) => ({ CLIENT: '/', PROFESSIONAL: '/pro', ADMIN: '/admin', SUPPORT: '/staff' }[role]);
