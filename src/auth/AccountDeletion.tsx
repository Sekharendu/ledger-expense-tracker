import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAccount } from './AccountProvider';
import { colors as c, type } from '../theme';

export function AccountDeletion({ disabled = false }: { disabled?: boolean }) {
  const account = useAccount();
  const [visible, setVisible] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (busy || confirmation !== 'DELETE') return;
    setBusy(true); setError('');
    try { await account.deleteAccount(); setVisible(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete your account. Please try again.'); }
    finally { setBusy(false); }
  }

  return <>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { setConfirmation(''); setError(''); setVisible(true); }} style={({ pressed }) => [s.outline, pressed && s.pressed, disabled && s.disabled]}><Text style={s.deleteText}>Delete Ledger account</Text></Pressable>
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => { if (!busy) setVisible(false); }}>
      <View style={s.backdrop}><ScrollView contentContainerStyle={s.modalScroll} keyboardShouldPersistTaps="handled"><View style={s.dialog}>
        <Text accessibilityRole="header" style={s.heading}>Delete your account?</Text>
        <Text style={s.body}>This permanently deletes your Ledger account, expenses, Gmail connection and scan history. Gmail access is revoked first. This cannot be undone.</Text>
        <Text style={s.body}>Your original emails and Google account are not deleted.</Text>
        <Text style={s.label}>Type DELETE to confirm</Text>
        <TextInput accessibilityLabel="Type DELETE to confirm account deletion" autoCapitalize="characters" autoCorrect={false} editable={!busy} value={confirmation} onChangeText={setConfirmation} style={s.input}/>
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={busy || confirmation !== 'DELETE'} onPress={() => { void remove(); }} style={({ pressed }) => [s.deleteButton, pressed && s.pressed, (busy || confirmation !== 'DELETE') && s.disabled]}><Text style={s.deleteButtonText}>{busy ? 'Deleting account…' : 'Permanently delete account'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setVisible(false)} style={({ pressed }) => [s.cancel, pressed && s.pressed]}><Text style={s.body}>Cancel</Text></Pressable>
      </View></ScrollView></View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  outline: { borderWidth: 1, borderColor: c.error, borderRadius: 12, padding: 16, minHeight: 52, alignItems: 'center', marginTop: 16 }, deleteText: { ...type.body, color: c.error, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }, modalScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 }, dialog: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.background, borderRadius: 20, padding: 24, gap: 18 },
  heading: { ...type.title, color: c.ink }, body: { ...type.body, color: c.ink }, label: { ...type.label, color: c.muted }, input: { ...type.body, color: c.ink, backgroundColor: c.surface, borderWidth: 1, borderColor: c.outline, borderRadius: 10, padding: 14 },
  error: { ...type.body, color: c.error }, deleteButton: { minHeight: 52, borderRadius: 12, backgroundColor: c.error, padding: 16, alignItems: 'center' }, deleteButtonText: { ...type.body, color: c.onPrimary, fontWeight: '600' }, cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.8 }, disabled: { opacity: 0.45 },
});
