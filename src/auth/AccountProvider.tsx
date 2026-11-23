import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import type { Session } from '@supabase/supabase-js';
import { completeGoogleSignIn, supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();
type Account = { session: Session | null; loading: boolean; error: string; signIn: () => Promise<void>; signOut: () => Promise<void> };
const Context = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error: issue }) => { if (active) { setSession(data.session); setLoading(false); if (issue) setError('Your session could not be restored. Sign in again.'); } }).catch(() => { if (active) { setLoading(false); setError('Your session could not be restored. Sign in again.'); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { if (active) { setSession(next); setLoading(false); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  async function signIn() {
    setError('');
    try {
      if (!supabase) throw new Error('Sign-in is temporarily unavailable. Please try again later.');
      const redirectTo = Platform.OS === 'web' ? `${window.location.origin}/auth/callback` : makeRedirectUri({ scheme: 'ledger', path: 'auth/callback' });
      const { data, error: issue } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, scopes: 'openid email profile' } });
      if (issue || !data.url) throw new Error('Google sign-in could not be started. Please try again.');
      if (Platform.OS === 'web') window.location.assign(data.url);
      else {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') await completeGoogleSignIn(result.url);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign-in failed. Please try again.'); }
  }
  async function signOut() {
    if (!supabase) return;
    const { error: issue } = await supabase.auth.signOut({ scope: 'local' });
    if (issue) throw new Error('Could not sign out. Check your connection and try again.');
    setSession(null);
  }
  return <Context.Provider value={{ session, loading, error, signIn, signOut }}>{children}</Context.Provider>;
}

export function useAccount() {
  const account = useContext(Context);
  if (!account) throw new Error('AccountProvider is missing.');
  return account;
}
