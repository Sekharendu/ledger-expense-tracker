import { useEffect, useState } from 'react';
import { Platform, Text, View, Linking, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { completeGoogleSignIn } from '../../auth/supabase';
import { colors as c } from '../../theme';

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      const url = Platform.OS === 'web' ? window.location.href : await Linking.getInitialURL();
      if (!url) throw new Error('Sign-in callback could not be opened.');
      await completeGoogleSignIn(url);
      if (active) router.replace('/');
    })().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Sign-in failed.'); });
    return () => { active = false; };
  }, [router]);
  return <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center', padding: 28, gap: 20 }}><Text style={{ color: c.ink }}>{error || 'Completing Google sign-in…'}</Text>{!!error && <Pressable accessibilityRole="button" onPress={() => router.replace('/')}><Text style={{ color: c.primary }}>Return to sign-in</Text></Pressable>}</View>;
}
