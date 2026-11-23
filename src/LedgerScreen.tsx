import React, { useState } from 'react';
import { Alert, Linking, Modal, Platform, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categories, Expense, mergeExpenses, parseAmount, sampleExpenses, summarize, toCsv, validDate } from './expenses';
import { colors as c, type } from './theme';
import { Icon, IconName } from './Icon';
import { GmailConnection } from './email/GmailConnection';
import { useAccount } from './auth/AccountProvider';
import { AccountSignIn } from './auth/AccountSignIn';
import { useCloudExpenses } from './auth/useCloudExpenses';

const money = (amount: number) => `${amount < 0 ? '−' : ''}₹${(Math.abs(amount) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
type Tab = 'Overview' | 'Inbox' | 'Upcoming' | 'Settings';
const destinations: { label: Tab; icon: IconName }[] = [
  { label: 'Overview', icon: 'overview' }, { label: 'Inbox', icon: 'inbox' },
  { label: 'Upcoming', icon: 'clock' }, { label: 'Settings', icon: 'settings' },
];
function ActionButton({ label, onPress, secondary = false, destructive = false, disabled }: { label: string; onPress: () => void; secondary?: boolean; destructive?: boolean; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, destructive && s.destructive, pressed && (secondary ? s.rowPressed : s.addPressed), disabled && s.disabled]}><Text style={[s.buttonText, secondary && s.secondaryText, destructive && s.destructiveText]}>{label}</Text></Pressable>;
}

export default function App() {
  const account = useAccount();
  return account.session ? <LedgerDashboard key={account.session.user.id} /> : <AccountSignIn />;
}

function LedgerDashboard() {
  const account = useAccount();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = ['Inbox', 'Upcoming', 'Settings'].includes(params.tab ?? '') ? params.tab as Tab : 'Overview';
  const setTab = (value: Tab) => router.setParams({ tab: value });
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const expanded = width >= 760;
  const stacked = width / fontScale < 350;
  const [navHeight, setNavHeight] = useState(84);
  const { items, loaded, storageError, busy, commit, refresh } = useCloudExpenses();
  const [filter, setFilter] = useState<'All' | 'Review'>('All');
  const [editing, setEditing] = useState<Expense | null>(null);
  const [visible, setVisible] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState<Expense['category']>('Other');
  const [status, setStatus] = useState<Expense['status']>('paid');
  const [kind, setKind] = useState<Expense['kind']>('expense');
  const [formError, setFormError] = useState('');
  const [month, setMonth] = useState(today().slice(0, 7));

  const stats = summarize(items, month);
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const review = items.filter(item => item.status === 'review');
  const upcoming = items.filter(item => item.status === 'unpaid').sort((a, b) => a.date.localeCompare(b.date));
  const recent = [...items].sort((a, b) => b.date.localeCompare(a.date));

  function open(item?: Expense) {
    setEditing(item ?? null); setMerchant(item?.merchant ?? ''); setAmount(item ? (item.amount / 100).toFixed(2) : '');
    setDate(item?.date ?? today()); setCategory(item?.category ?? 'Other'); setStatus(item?.status ?? 'paid'); setKind(item?.kind ?? 'expense'); setFormError(''); setVisible(true);
  }
  async function save() {
    const parsed = parseAmount(amount);
    if (!merchant.trim() || !parsed || !validDate(date)) { setFormError('Enter a merchant, a positive amount with up to 2 decimals, and a valid YYYY-MM-DD date.'); return; }
    if (kind === 'refund' && status === 'unpaid') { setFormError('A refund must be received (paid) or awaiting review.'); return; }
    const item: Expense = { id: editing?.id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`, merchant: merchant.trim(), amount: parsed, date, category, status, kind, source: editing?.source ?? 'Manual entry', note: editing?.note ?? '', ...(editing?.email ? { email: editing.email } : {}) };
    if (await commit(editing ? items.map(old => old.id === editing.id ? item : old) : [...items, item])) setVisible(false);
  }
  function shiftMonth(offset: number) {
    const value = new Date(`${month}-01T12:00:00`); value.setMonth(value.getMonth() + offset);
    setMonth(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`);
  }
  async function loadSamples() { await commit(mergeExpenses(items, sampleExpenses())); }
  async function exportRecords() {
    try { await Share.share({ title: 'Ledger expense CSV', message: toCsv(items) }); }
    catch { Alert.alert('Sharing unavailable', 'Please try again on your Android device.'); }
  }
  const row = (item: Expense) => <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Edit ${item.merchant}, ${money(item.amount)}, ${item.status}`}
    key={item.id} onPress={() => open(item)}
    style={({ pressed }) => [s.row, stacked && s.rowStacked, pressed && s.rowPressed]}>
    <View style={s.rowIdentity}>
      <View style={s.avatar}><Icon name="receipt" size={20} color={c.primary}/></View>
      <View style={s.rowDescription}><Text style={s.rowTitle}>{item.merchant}</Text><Text style={s.muted}>{item.category} · {item.date}</Text></View>
    </View>
    <View style={[s.rowFigures, stacked && s.rowFiguresStacked]}>
      <Text style={[s.amount, item.kind === 'refund' && s.refund]}>{item.kind === 'refund' ? '−' : ''}{money(item.amount)}</Text>
      <Text style={[s.badge, item.status === 'review' && s.reviewText]}>{item.status === 'review' ? 'Needs review' : item.status === 'unpaid' ? 'Unpaid · due date' : item.kind === 'refund' ? 'Refund received' : 'Paid'}</Text>
    </View>
  </Pressable>;
  const empty = (title: string, body: string) => <View style={s.empty}>
    <View style={s.emptyMark}><Icon name="receipt" size={25} color={c.primary}/></View>
    <Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyBody}>{body}</Text>
  </View>;
  const navigation = <View accessibilityRole="tablist" onLayout={event => { if (!expanded) setNavHeight(event.nativeEvent.layout.height); }} style={[s.nav, expanded && s.navRail]}>
    {expanded && <View style={s.railBrand}><Icon name="receipt" size={28} color={c.onDark}/></View>}
    {destinations.map(({ label, icon }) => <Pressable key={label}
      accessibilityRole="tab" accessibilityState={{ selected: tab === label }} onPress={() => setTab(label)}
      style={({ pressed }) => [s.navItem, expanded && s.railItem, pressed && s.navPressed]}>
      <View style={[s.navIcon, tab === label && s.navIconActive]}><Icon name={icon} size={21} color={tab === label ? c.onPrimary : c.mutedOnDark}/></View>
      <Text style={[s.navText, tab === label && s.navActive]}>{label}</Text>
    </Pressable>)}
  </View>;

  return <View style={[s.app, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <StatusBar barStyle="dark-content" />
    <View style={[s.shell, expanded && s.shellExpanded]}>
      {expanded && navigation}
      <View style={s.workspace}>
        <View style={s.header}>
          <View style={s.wordmark}><View style={s.brandMark}><View style={s.brandLine}/><View style={[s.brandLine, s.brandLineShort]}/></View><Text style={s.logo}>ledger.</Text></View>
          <View style={s.localBadge}><Icon name="device" size={15} color={c.muted}/><Text style={s.localText}>Your account</Text></View>
        </View>
        <ScrollView key={tab} contentContainerStyle={[s.content, expanded && s.contentExpanded]} keyboardShouldPersistTaps="handled">
          {!!storageError && <Text accessibilityRole="alert" style={s.error}>{storageError}</Text>}
          {!loaded && !storageError && <Text accessibilityRole="status" style={s.intro}>Opening your ledger…</Text>}
          <View style={s.titleRow}><Text accessibilityRole="header" style={s.title}>{tab === 'Overview' ? 'Your money,\nat a glance.' : tab === 'Inbox' ? 'Expense inbox' : tab === 'Upcoming' ? 'Coming up' : 'Make it yours'}</Text></View>

          {tab === 'Overview' && <>
            <View style={s.statement}>
              <View style={s.monthRow}>
                <Text style={s.month}>{monthName}</Text>
                <View style={s.monthControls}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shiftMonth(-1)} style={({ pressed }) => [s.monthArrow, pressed && s.navPressed]}><Icon name="left" size={19} color={c.onDark}/></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shiftMonth(1)} style={({ pressed }) => [s.monthArrow, pressed && s.navPressed]}><Icon name="right" size={19} color={c.onDark}/></Pressable>
                </View>
              </View>
              <View style={s.balance}><Text style={s.balanceLabel}>Total spent</Text><Text adjustsFontSizeToFit numberOfLines={1} style={s.balanceAmount}>{money(stats.total)}</Text><Text style={s.statementMuted}>{stats.count} confirmed records · refunds deducted</Text></View>
              <View style={s.statementFooter}><Icon name="check" size={16} color={c.mutedOnDark}/><Text style={s.statementMuted}>Only paid records count toward this total.</Text></View>
            </View>
            <View style={[s.tiles, stacked && s.tilesStacked]}>
              <Pressable accessibilityRole="button" onPress={() => setTab('Upcoming')} style={({ pressed }) => [s.tile, pressed && s.rowPressed]}>
                <Text style={s.muted}>Unpaid invoices · all dates</Text><Text style={s.tileValue}>{money(stats.unpaid)}</Text><View style={s.inlineAction}><Text style={s.tileFoot}>View upcoming bills</Text><Icon name="arrow" size={16} color={c.primary}/></View>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { setFilter('Review'); setTab('Inbox'); }} style={({ pressed }) => [s.tile, s.tileDivider, stacked && s.tileDividerStacked, pressed && s.rowPressed]}>
                <Text style={s.muted}>Needs your review</Text><Text style={s.tileValue}>{stats.review.toString().padStart(2, '0')}</Text><View style={s.inlineAction}><Text style={s.tileFoot}>Check expense details</Text><Icon name="arrow" size={16} color={c.primary}/></View>
              </Pressable>
            </View>
            <View style={[s.details, expanded && s.detailsExpanded]}>
              <View style={s.detailColumn}>
                <Text accessibilityRole="header" style={s.sectionTitle}>Where it went</Text>
                <View style={s.breakdown}>{stats.categories.some(item => item.amount !== 0) ? stats.categories.filter(item => item.amount !== 0).map(item => <View key={item.category} style={s.category}>
                  <View style={s.categoryRow}><Text style={s.rowTitle}>{item.category}</Text><Text style={s.categoryAmount}>{money(item.amount)}</Text></View>
                  <View style={s.track}><View style={[s.trackFill, { width: `${Math.min(100, Math.abs(item.amount) / Math.max(...stats.categories.map(value => Math.abs(value.amount)), 1) * 100)}%` }]}/></View>
                </View>) : empty('A fresh start', 'Add an expense or load sample invoices to see your spending breakdown.')}</View>
              </View>
              <View style={s.detailColumn}>
                <View style={s.sectionRow}><Text accessibilityRole="header" style={s.sectionTitle}>Recent activity</Text><Pressable accessibilityRole="button" onPress={() => { setFilter('All'); setTab('Inbox'); }} style={({ pressed }) => [s.textButton, pressed && s.rowPressed]}><Text style={s.link}>View all</Text><Icon name="arrow" size={16} color={c.primary}/></Pressable></View>
                {recent.slice(0, 4).map(row)}
                {items.length === 0 && <><Text style={s.intro}>Your next expense starts the story.</Text><ActionButton label="Explore sample invoices" onPress={loadSamples} secondary disabled={!loaded || busy}/><Text style={s.caption}>Five fictional records to explore the review workflow.</Text></>}
              </View>
            </View>
          </>}

          {tab === 'Inbox' && <>
            <Text style={s.intro}>Every record, with its source. Tap an item to correct details or confirm payment.</Text>
            <View style={s.chips}>{(['All', 'Review'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={({ pressed }) => [s.chip, filter === value && s.chipActive, pressed && s.pressed]}><Text style={filter === value ? s.chipSelected : s.chipText}>{value === 'Review' ? `Needs review (${review.length})` : 'All records'}</Text></Pressable>)}</View>
            {(filter === 'Review' ? review : recent).map(row)}
            {(filter === 'Review' ? review : recent).length === 0 && empty(filter === 'Review' ? 'All caught up' : 'Your inbox is ready', filter === 'Review' ? 'There are no records waiting for review.' : 'Add a manual expense or explore the sample invoices.')}
          </>}

          {tab === 'Upcoming' && <>
            <Text style={s.intro}>Unpaid invoices stay here until you confirm payment. Dates shown are due dates.</Text>
            <View style={s.outstanding}><Text style={s.balanceLabel}>Total outstanding · all dates</Text><Text style={s.outstandingAmount}>{money(stats.unpaid)}</Text></View>
            {upcoming.map(item => <View key={item.id}>{item.date < today() && <Text style={s.overdue}>Overdue</Text>}{row(item)}</View>)}
            {upcoming.length === 0 && empty('Nothing outstanding', 'Unpaid invoices will appear here, separate from your spending.')}
            <Text style={s.caption}>When paying an invoice, open it, change the status to Paid, and set the date to the payment date.</Text>
          </>}

          {tab === 'Settings' && <>
            <GmailConnection onImport={refresh} disabled={!loaded || busy} Button={ActionButton} styles={s} />
            <View style={s.settingSection}><View style={s.settingHeading}><Icon name="device" color={c.primary}/><Text accessibilityRole="header" style={s.settingTitle}>Your Ledger account</Text></View><Text style={s.intro}>{account.session?.user.email}</Text><Text style={s.intro}>Expenses are saved in your account and available across your devices. Signing out of this app keeps your expenses and any connected Gmail tracking.</Text><Text style={s.muted}>Currency: INR · Indian rupees</Text><ActionButton label="Sign out" onPress={() => { void account.signOut().catch(reason => Alert.alert('Could not sign out', reason instanceof Error ? reason.message : 'Please try again.')); }} secondary disabled={busy}/></View>
            <ActionButton label="Load sample invoices" onPress={loadSamples} secondary disabled={!loaded || busy}/>
            <Text style={s.caption}>Adds five fictional records for this month. Loading them again will not duplicate them.</Text>
            <ActionButton label="Share records as CSV text" onPress={exportRecords} secondary disabled={!loaded || busy}/>
            <View style={s.deleteSection}><ActionButton label="Delete all expenses" onPress={() => Alert.alert('Delete all expenses?', 'This permanently deletes your loaded expenses from your account. Gmail remains connected until you disconnect it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void commit([]); } }])} secondary destructive disabled={!loaded || busy}/></View>
            <Text style={s.caption}>Ledger · Android MVP · Gmail invoice import</Text>
          </>}
        </ScrollView>
        {(tab === 'Overview' || tab === 'Inbox') && <View pointerEvents="box-none" style={[s.addDock, { bottom: expanded ? 24 : navHeight + 14 }]}><Pressable accessibilityRole="button" accessibilityLabel="Add an expense" accessibilityState={{ disabled: !loaded || busy }} disabled={!loaded || busy} onPress={() => open()} style={({ pressed }) => [s.addButton, pressed && s.addPressed, (!loaded || busy) && s.disabled]}><Icon name="plus" size={22} color={c.onPrimary}/><Text style={s.buttonText}>Add an expense</Text></Pressable></View>}
        {!expanded && navigation}
      </View>
    </View>

    <Modal visible={visible} animationType="none" onRequestClose={() => setVisible(false)}>
      <KeyboardAvoidingView style={[s.modal, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.formHeader}><Text accessibilityRole="header" style={s.formTitle}>{editing ? 'Review record' : 'New expense'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close expense form" onPress={() => setVisible(false)} style={({ pressed }) => [s.closeButton, pressed && s.rowPressed]}><Icon name="close" color={c.ink}/></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.formContent}>
          <Text style={s.label}>Merchant</Text><TextInput accessibilityLabel="Merchant" value={merchant} onChangeText={setMerchant} placeholder="e.g. Adobe" placeholderTextColor={c.muted} selectionColor={c.primaryContainer} style={s.input}/>
          <Text style={s.label}>Amount · INR</Text><TextInput accessibilityLabel="Amount in rupees" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.muted} selectionColor={c.primaryContainer} style={[s.input, s.amountInput]}/>
          <Text style={s.label}>{status === 'unpaid' ? 'Due date' : 'Transaction date'} · YYYY-MM-DD</Text><TextInput accessibilityLabel="Date in YYYY-MM-DD format" value={date} onChangeText={setDate} autoCapitalize="none" selectionColor={c.primaryContainer} style={s.input}/>
          <Text style={s.label}>Category</Text><View style={s.chips}>{categories.map(value => <Pressable accessibilityRole="button" accessibilityState={{ selected: category === value }} key={value} onPress={() => setCategory(value)} style={({ pressed }) => [s.chip, category === value && s.chipActive, pressed && s.pressed]}><Text style={category === value ? s.chipSelected : s.chipText}>{value}</Text></Pressable>)}</View>
          <Text style={s.label}>Type</Text><View style={s.chips}>{(['expense', 'refund'] as const).map(value => <Pressable accessibilityRole="button" accessibilityState={{ selected: kind === value }} key={value} onPress={() => setKind(value)} style={({ pressed }) => [s.chip, kind === value && s.chipActive, pressed && s.pressed]}><Text style={kind === value ? s.chipSelected : s.chipText}>{value === 'refund' ? 'Refund' : 'Expense'}</Text></Pressable>)}</View>
          <Text style={s.label}>Payment status</Text><View style={s.chips}>{(['paid', 'unpaid', 'review'] as const).map(value => <Pressable accessibilityRole="button" accessibilityState={{ selected: status === value }} key={value} onPress={() => setStatus(value)} style={({ pressed }) => [s.chip, status === value && s.chipActive, pressed && s.pressed]}><Text style={status === value ? s.chipSelected : s.chipText}>{value === 'review' ? 'Needs review' : value === 'paid' ? 'Paid / received' : 'Unpaid'}</Text></Pressable>)}</View>
          {editing && <View style={s.source}><Text style={s.label}>Source</Text><Text style={s.rowTitle}>{editing.source}</Text><Text style={s.intro}>{editing.note}</Text>{editing.email && <ActionButton label="Open source in Gmail" onPress={() => { void Linking.openURL(editing.email!.sourceUrl).catch(() => Alert.alert('Could not open Gmail', 'Open Gmail and search for the subject shown above.')); }} secondary disabled={false} />}</View>}
          {!!formError && <Text accessibilityRole="alert" style={s.error}>{formError}</Text>}
          {!!storageError && <Text accessibilityRole="alert" style={s.error}>{storageError}</Text>}
          <ActionButton label={busy ? 'Saving…' : 'Save record'} onPress={save} disabled={!loaded || busy}/>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: c.background },
  shell: { flex: 1 }, shellExpanded: { flexDirection: 'row' }, workspace: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: 24, paddingVertical: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: c.outline },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { fontSize: 27, lineHeight: 34, fontWeight: '600', color: c.ink, letterSpacing: -0.8 },
  brandMark: { width: 28, height: 30, borderRadius: 7, backgroundColor: c.primary, paddingHorizontal: 7, justifyContent: 'center', gap: 5 },
  brandLine: { height: 2, width: 14, backgroundColor: c.onPrimary }, brandLineShort: { width: 9 },
  localBadge: { flexDirection: 'row', gap: 5, alignItems: 'center', flexShrink: 1 }, localText: { ...type.label, color: c.muted, flexShrink: 1 },
  muted: { ...type.label, color: c.muted },
  content: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 112, width: '100%', maxWidth: 1080, alignSelf: 'center' },
  contentExpanded: { paddingHorizontal: 40, paddingTop: 36 },
  titleRow: { marginBottom: 24 }, title: { ...type.headline, color: c.ink },
  statement: { backgroundColor: c.ink, borderRadius: 16, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 20 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  month: { ...type.body, color: c.onDark, fontWeight: '500', flexShrink: 1 }, monthControls: { flexDirection: 'row', gap: 8 }, monthArrow: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  balance: { paddingTop: 14, paddingBottom: 24 }, balanceLabel: { ...type.body, color: c.mutedOnDark },
  balanceAmount: { ...type.display, color: c.onDark, marginTop: 4, marginBottom: 8, fontVariant: ['tabular-nums'] },
  statementMuted: { ...type.label, color: c.mutedOnDark, flexShrink: 1 }, statementFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: c.outlineOnDark, paddingTop: 16 },
  tiles: { flexDirection: 'row', borderBottomWidth: 1, borderColor: c.outline, paddingVertical: 22, marginBottom: 4 }, tilesStacked: { flexDirection: 'column' },
  tile: { flex: 1, minWidth: 0, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 4 }, tileDivider: { borderLeftWidth: 1, borderColor: c.outline, paddingLeft: 18, marginLeft: 8 }, tileDividerStacked: { borderLeftWidth: 0, borderTopWidth: 1, paddingLeft: 8, paddingTop: 18, marginTop: 12, marginLeft: 0 },
  tileValue: { fontSize: 25, lineHeight: 34, color: c.ink, fontWeight: '500', marginTop: 8, marginBottom: 6, fontVariant: ['tabular-nums'], flexShrink: 1 },
  tileFoot: { ...type.label, color: c.primaryText, flexShrink: 1 }, inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  details: { gap: 4 }, detailsExpanded: { flexDirection: 'row', gap: 36 }, detailColumn: { flex: 1, minWidth: 0 },
  sectionTitle: { ...type.title, color: c.ink, marginTop: 28, marginBottom: 18, flexShrink: 1 },
  breakdown: { paddingTop: 4 }, category: { paddingBottom: 22 }, categoryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  categoryAmount: { ...type.body, color: c.ink, fontWeight: '500', fontVariant: ['tabular-nums'] }, track: { height: 4, backgroundColor: c.outline, borderRadius: 2 }, trackFill: { height: 4, borderRadius: 2, backgroundColor: c.primary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, textButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 4, marginTop: 10 }, link: { ...type.label, color: c.primaryText, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: c.outline, paddingVertical: 18, minHeight: 76 }, rowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 }, rowPressed: { backgroundColor: c.surface },
  rowIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }, rowDescription: { flex: 1, minWidth: 0 }, rowFigures: { alignItems: 'flex-end', maxWidth: '48%', flexShrink: 1 }, rowFiguresStacked: { alignItems: 'flex-start', marginLeft: 48, maxWidth: '100%' },
  avatar: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: c.primaryContainer },
  rowTitle: { ...type.body, color: c.ink, fontWeight: '500' }, amount: { ...type.body, color: c.ink, fontWeight: '600', fontVariant: ['tabular-nums'] }, refund: { color: c.primaryText }, badge: { ...type.label, color: c.muted, marginTop: 4 }, reviewText: { color: c.primaryText, fontWeight: '600' },
  button: { minHeight: 52, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', padding: 16, marginTop: 16 }, secondary: { backgroundColor: c.surface, borderColor: c.outline, borderWidth: 1 },
  buttonText: { ...type.body, color: c.onPrimary, fontWeight: '600' }, secondaryText: { color: c.ink }, destructive: { backgroundColor: 'transparent', borderColor: c.error }, destructiveText: { color: c.error }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.4 },
  addDock: { position: 'absolute', bottom: 98, right: 24, left: 24, alignItems: 'flex-end' }, addButton: { minHeight: 56, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.primary, paddingHorizontal: 20, paddingVertical: 14 }, addPressed: { backgroundColor: c.primaryPressed },
  nav: { flexDirection: 'row', gap: 8, backgroundColor: c.ink, paddingHorizontal: 8, paddingVertical: 12 }, navRail: { flexDirection: 'column', width: 112, paddingTop: 24, gap: 18 },
  railBrand: { alignItems: 'center', paddingVertical: 20, marginBottom: 24 }, railItem: { flex: 0, minHeight: 72 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 60, paddingVertical: 2 }, navIcon: { width: 48, minHeight: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, navIconActive: { backgroundColor: c.primary }, navText: { ...type.label, color: c.mutedOnDark, marginTop: 6, textAlign: 'center' }, navActive: { color: c.onDark, fontWeight: '600' }, navPressed: { backgroundColor: c.outlineOnDark },
  intro: { ...type.body, color: c.muted, marginTop: 4, marginBottom: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 12 }, chip: { borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.outline, paddingHorizontal: 16, paddingVertical: 13, minHeight: 48, justifyContent: 'center' }, chipActive: { backgroundColor: c.primaryContainer, borderColor: c.primary }, chipSelected: { ...type.body, color: c.onPrimaryContainer, fontWeight: '600' }, chipText: { ...type.body, color: c.muted },
  empty: { paddingVertical: 32, alignItems: 'center', gap: 12 }, emptyMark: { width: 52, height: 52, backgroundColor: c.surface, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }, emptyTitle: { ...type.title, color: c.ink, textAlign: 'center' }, emptyBody: { ...type.body, color: c.muted, textAlign: 'center', maxWidth: 300 }, caption: { ...type.label, color: c.muted, marginVertical: 12 },
  outstanding: { backgroundColor: c.ink, borderRadius: 16, padding: 24, marginTop: 8, marginBottom: 12 }, outstandingAmount: { ...type.headline, color: c.onDark, marginTop: 12, fontVariant: ['tabular-nums'] }, overdue: { ...type.label, color: c.error, fontWeight: '600', marginTop: 24 },
  settingSection: { borderBottomWidth: 1, borderColor: c.outline, paddingTop: 12, paddingBottom: 24, marginBottom: 16 }, settingHeading: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 }, settingTitle: { ...type.title, color: c.ink, flexShrink: 1 }, statusPill: { backgroundColor: c.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignSelf: 'flex-start' }, deleteSection: { marginTop: 36 },
  modal: { flex: 1, backgroundColor: c.background }, formHeader: { paddingHorizontal: 24, paddingVertical: 18, borderBottomWidth: 1, borderColor: c.outline, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 }, formTitle: { ...type.headline, color: c.ink, flexShrink: 1 }, closeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  formContent: { padding: 24, paddingBottom: 48, width: '100%', maxWidth: 620, alignSelf: 'center' }, label: { ...type.body, fontWeight: '500', color: c.ink, marginTop: 20, marginBottom: 10 }, input: { ...type.body, color: c.ink, backgroundColor: c.surface, borderColor: c.outline, borderWidth: 1, borderRadius: 12, padding: 16, minHeight: 56 }, amountInput: { fontSize: 26, lineHeight: 34, fontVariant: ['tabular-nums'] }, source: { borderTopWidth: 1, borderColor: c.outline, marginTop: 24 }, error: { ...type.body, color: c.error, backgroundColor: c.errorContainer, padding: 16, borderRadius: 12, marginVertical: 12 },
});
