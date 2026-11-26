import type { ComponentType } from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useGmail } from './useGmail';

type Props = {
  onImport: () => Promise<void>;
  disabled: boolean;
  Button: ComponentType<{ label: string; onPress: () => void; disabled: boolean; secondary?: boolean }>;
  styles: { settingSection: ViewStyle; settingTitle: TextStyle; intro: TextStyle; muted: TextStyle; error: TextStyle; caption: TextStyle };
};

export function GmailConnection({ onImport, disabled, Button, styles: s }: Props) {
  const gmail = useGmail(onImport);
  const schedule = gmail.connection.scanSchedule === 'every15minutes' ? 'about every 15 minutes' : gmail.connection.scanSchedule === 'daily' ? 'daily' : 'periodically';
  return <View style={s.settingSection}>
    <Text accessibilityRole="header" style={s.settingTitle}>Gmail invoices</Text>
    <Text style={s.intro}>{gmail.connection.connected ? `Connected to ${gmail.connection.email}. Read-only access to find billing emails from the last 90 days.` : 'Connect Gmail to find receipts, invoices and refunds. Ledger requests read-only access; it cannot send or delete emails.'}</Text>
    {!gmail.connection.connected && !gmail.waiting && gmail.connection.status !== 'revoke_pending' && <Button label={gmail.busy ? 'Connecting…' : 'Connect Gmail'} onPress={gmail.connect} disabled={disabled || gmail.busy} />}
    {gmail.connection.status === 'revoke_pending' && <Text style={s.intro}>Tracking is stopped. Google access could not be revoked yet; retry Disconnect to finish.</Text>}
    {gmail.waiting && <Text accessibilityLiveRegion="polite" style={s.intro}>Waiting for Google sign-in. Finish in the browser, then return here.</Text>}
    {gmail.connection.connected && <>
      <Text style={s.intro}>{gmail.connection.watchConnected ? `New-mail notifications trigger automatic checks. Delivery may be delayed; recovery checks run ${schedule}.` : `Automatic checks run ${schedule}. New-mail notifications are not connected yet.`}</Text>
      <Button label={gmail.busy ? 'Checking invoices…' : 'Check now'} onPress={() => { void gmail.sync(); }} disabled={disabled || gmail.busy} />
      {gmail.hasMore && <Button label="Continue checking older invoices" onPress={() => { void gmail.sync(); }} secondary disabled={disabled || gmail.busy} />}
      <Text style={s.caption}>Clear full-payment evidence and a document date let Ledger mark an expense paid automatically. Other imports need review. Text PDFs are supported; scanned images and currency conversion are not.</Text>
      {!!gmail.connection.lastSync && <Text style={s.muted}>Last scan: {new Date(gmail.connection.lastSync).toLocaleString('en-IN')}</Text>}
    </>}
    {!!gmail.error && <Text accessibilityRole="alert" style={s.error}>{gmail.error}</Text>}
    {gmail.report && <View accessibilityLiveRegion="polite">
      <Text style={s.intro}>{gmail.report.scanned} emails scanned · {gmail.report.added} records added · {gmail.report.duplicates} duplicates skipped{gmail.report.refreshed ? ` · ${gmail.report.refreshed} records updated` : ''}.</Text>
      {gmail.report.skipped.length > 0 && <>
        <Text style={s.muted}>{gmail.report.skipped.length} items need attention or could not be imported:</Text>
        {gmail.report.skipped.slice(0, 8).map((item, index) => <Text key={`${item.messageId}-${index}`} style={s.caption}>{item.subject}: {item.reason}</Text>)}
        {gmail.report.skipped.length > 8 && <Text style={s.muted}>And {gmail.report.skipped.length - 8} more. Check the source emails in Gmail.</Text>}
      </>}
    </View>}
    {gmail.hasSession && <Button label={gmail.waiting ? 'Cancel Gmail connection' : 'Disconnect Gmail'} onPress={gmail.disconnect} secondary disabled={gmail.busy} />}
    <Text style={s.caption}>While Gmail is connected, background tracking continues when the app is closed or you are signed out. Your dashboard refreshes about every 30 seconds while the app is open. Disconnecting stops future scans and revokes Gmail access. Existing expenses remain in your account.</Text>
  </View>;
}
