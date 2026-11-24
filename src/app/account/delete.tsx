import { Link } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAccount } from '../../auth/AccountProvider';
import { AccountDeletion } from '../../auth/AccountDeletion';
import { AccountSignIn } from '../../auth/AccountSignIn';
import { colors as c, type } from '../../theme';

export default function DeleteAccountPage() {
  const account = useAccount();
  return <ScrollView contentContainerStyle={s.page}><View style={s.content}>
    <Text accessibilityRole="header" style={s.heading}>Delete your Ledger account</Text>
    <Text style={s.body}>You can delete your account without the Android app. Sign in with the Google account you use for Ledger, then return to this page or open Settings → Delete Ledger account.</Text>
    <Text style={s.body}>Deletion removes your Ledger account, expense records, mailbox connection and scan history. Connected Gmail access is revoked first. It does not delete your Google account or your original emails.</Text>
    {account.session ? <><Text style={s.body}>{account.session.user.email}</Text><AccountDeletion /></> : <AccountSignIn />}
    <Link href="/" style={s.link}>Return to Ledger</Link>
  </View></ScrollView>;
}

const s = StyleSheet.create({ page: { flexGrow: 1, padding: 28, backgroundColor: c.background }, content: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: 22 }, heading: { ...type.headline, color: c.ink }, body: { ...type.body, color: c.ink }, link: { ...type.body, color: c.primaryText, paddingVertical: 14 } });
