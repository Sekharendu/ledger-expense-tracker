import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const storage = {
  async getItem(name: string) {
    if (Platform.OS === 'web') return typeof window === 'undefined' ? null : window.sessionStorage.getItem(name);
    const metadata = await SecureStore.getItemAsync(`${name}.index`);
    if (!metadata) return null;
    const { revision, count } = JSON.parse(metadata) as { revision: string; count: number };
    if (!Number.isInteger(count) || count < 1 || count > 250) return null;
    const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${name}.${revision}.${index}`)));
    return chunks.every(value => value !== null) ? chunks.join('') : null;
  },
  async setItem(name: string, value: string) {
    if (Platform.OS === 'web') { window.sessionStorage.setItem(name, value); return; }
    const previous = await SecureStore.getItemAsync(`${name}.index`);
    const revision = Crypto.randomUUID();
    // Small chunks also fit SecureStore limits when account metadata contains Unicode.
    const count = Math.max(1, Math.ceil(value.length / 400));
    if (count > 250) throw new Error('Account session exceeds storage limits.');
    for (let index = 0; index < count; index++) await SecureStore.setItemAsync(`${name}.${revision}.${index}`, value.slice(index * 400, (index + 1) * 400));
    await SecureStore.setItemAsync(`${name}.index`, JSON.stringify({ revision, count }));
    if (previous) {
      const old = JSON.parse(previous) as { revision: string; count: number };
      await Promise.all(Array.from({ length: Math.min(old.count, 250) }, (_, index) => SecureStore.deleteItemAsync(`${name}.${old.revision}.${index}`)));
    }
  },
  async removeItem(name: string) {
    if (Platform.OS === 'web') { window.sessionStorage.removeItem(name); return; }
    const previous = await SecureStore.getItemAsync(`${name}.index`);
    await SecureStore.deleteItemAsync(`${name}.index`);
    if (previous) {
      const old = JSON.parse(previous) as { revision: string; count: number };
      await Promise.all(Array.from({ length: Math.min(old.count, 250) }, (_, index) => SecureStore.deleteItemAsync(`${name}.${old.revision}.${index}`)));
    }
  },
};

export const supabase = url && key ? createClient(url, key, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
}) : null;

if (Platform.OS !== 'web' && supabase) {
  AppState.addEventListener('change', state => { if (state === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh(); });
}

let callback: { code: string; result: Promise<void> } | undefined;
export async function completeGoogleSignIn(callbackUrl: string) {
  if (!supabase) throw new Error('Sign-in is temporarily unavailable.');
  const parsed = new URL(callbackUrl);
  const code = parsed.searchParams.get('code');
  if (!code || parsed.searchParams.has('error')) throw new Error('Google sign-in was cancelled or could not be completed.');
  if (callback?.code === code) return callback.result;
  const result = supabase.auth.exchangeCodeForSession(code).then(({ error }) => { if (error) throw new Error('Google sign-in could not be completed. Please try again.'); });
  callback = { code, result };
  return result;
}
