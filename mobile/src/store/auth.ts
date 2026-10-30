import { create } from 'zustand';
import { api, loadTokens, saveTokens, setSignedOutHandler } from '../api/client';

interface AuthState {
  status: 'loading' | 'out' | 'in';
  bootstrap: () => Promise<void>;
  signInWith: (t: { accessToken: string; refreshToken: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => {
  setSignedOutHandler(() => set({ status: 'out' }));
  return {
    status: 'loading',
    bootstrap: async () => { set({ status: (await loadTokens()) ? 'in' : 'out' }); },
    signInWith: async (t) => { await saveTokens({ accessToken: t.accessToken, refreshToken: t.refreshToken }); set({ status: 'in' }); },
    signOut: async () => {
      const { getTokens } = await import('../api/client');
      const rt = getTokens()?.refreshToken;
      try { if (rt) await api('/auth/logout', { method: 'POST', body: { refreshToken: rt }, auth: false }); } catch { /* offline: still clear locally */ }
      await saveTokens(null);
      set({ status: 'out' });
    },
  };
});
