import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAccount } from './AccountProvider';
import { colors as c, type } from '../theme';

export function AccountSignIn() {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  return <View style={s.page}><View style={s.content}>
    <Text style={s.brand}>ledger.</Text>
    <Text accessibilityRole="header" style={s.title}>Your expenses, in one place.</Text>
    <Text style={s.body}>Sign in to keep your expenses in your account and access them across devices.</Text>
    <Pressable accessibilityRole="button" disabled={busy || account.loading} onPress={() => { setBusy(true); void account.signIn().finally(() => setBusy(false)); }} style={({ pressed }) => [s.button, pressed && { opacity: 0.8 }]}><Text style={s.buttonText}>{account.loading ? 'Opening your account…' : busy ? 'Signing in…' : 'Sign in with Google'}</Text></Pressable>
    <Text style={s.body}>This identifies you. Gmail access is optional and can be enabled separately after sign-in.</Text>
    {!!account.error && <Text accessibilityRole="alert" style={s.error}>{account.error}</Text>}
  </View></View>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: c.background, justifyContent: 'center', padding: 28 }, content: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 24 }, brand: { fontSize: 36, fontWeight: '600', color: c.ink }, title: { ...type.headline, color: c.ink }, body: { ...type.body, color: c.muted }, button: { backgroundColor: c.primary, borderRadius: 12, padding: 18, alignItems: 'center', minHeight: 52 }, buttonText: { color: c.onPrimary, fontWeight: '600', fontSize: 16 }, error: { ...type.body, color: c.error } });
