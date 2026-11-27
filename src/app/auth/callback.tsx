import { useEffect, useState } from 'react';
import { Platform, Text, View, Pressable } from 'react-native';
import { useLinkingURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useAccount } from '../../auth/AccountProvider';
import { completeGoogleSignIn } from '../../auth/supabase';
import { colors as c } from '../../theme';

export default function AuthCallback() {
  const router = useRouter();
  const { session } = useAccount();
  // On Android the sign-in redirect reaches an app that is already running, so the URL is
  // the latest incoming link, not the launch URL (getInitialURL is null in that case).
  const linkingUrl = useLinkingURL();
  const url = Platform.OS === 'web' ? (typeof window === 'undefined' ? null : window.location.href) : linkingUrl;
  const [error, setError] = useState('');
  useEffect(() => {
    // The sign-in screen may already have finished the exchange from the browser result.
    if (session) { router.replace('/'); return; }
    let active = true;
    if (!url?.includes('auth/callback')) {
      const timer = setTimeout(() => { if (active) setError('Sign-in callback could not be opened.'); }, 10_000);
      return () => { active = false; clearTimeout(timer); };
    }
    completeGoogleSignIn(url).then(() => { if (active) router.replace('/'); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Sign-in failed.'); });
    return () => { active = false; };
  }, [router, session, url]);
  return <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center', padding: 28, gap: 20 }}><Text style={{ color: c.ink }}>{error || 'Completing Google sign-in…'}</Text>{!!error && <Pressable accessibilityRole="button" onPress={() => router.replace('/')}><Text style={{ color: c.primary }}>Return to sign-in</Text></Pressable>}</View>;
}
