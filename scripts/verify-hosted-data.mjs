import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { HostedStore } from '../server/store.mjs';

// Explicit opt-in: creates two temporary confirmed accounts, sends no emails,
// tests only their records, and deletes both accounts (with cascading rows).
if (!process.argv.includes('--run')) {
  console.log('Use --run to verify isolated temporary accounts against the configured hosted project.');
  process.exit(0);
}

const root = new URL('../', import.meta.url);
const publicEnv = parseEnv(await readFile(new URL('.env', root), 'utf8'));
const serverEnv = parseEnv(await readFile(new URL('.env.server', root), 'utf8'));
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(serverEnv.SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, options);
const store = new HostedStore(admin);
const publicClient = () => createClient(publicEnv.EXPO_PUBLIC_SUPABASE_URL, publicEnv.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const accounts = [];
const apiBase = process.argv.includes('--api') ? 'https://ledger-expense-tracker-sekharendus-projects.vercel.app' : null;
const passed = [];
const check = (condition, label) => { if (!condition) throw new Error(`Failed: ${label}`); passed.push(label); };
const success = (result, label) => { check(!result.error, label); return result.data; };
let failed = false;

try {
  check(publicEnv.EXPO_PUBLIC_SUPABASE_URL === serverEnv.SUPABASE_URL, 'public and server use the same project');
  for (const label of ['a', 'b']) {
    const email = `ledger-readiness-${randomUUID()}-${label}@example.invalid`;
    const password = randomBytes(32).toString('base64url');
    const created = success(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Temporary Ledger readiness test' } }), `create isolated account ${label}`);
    accounts.push({ user: created.user, client: publicClient() });
    const account = accounts[accounts.length - 1];
    const signedIn = success(await account.client.auth.signInWithPassword({ email, password }), `establish real Supabase session ${label}`);
    account.token = signedIn.session.access_token;
  }
  const [a, b] = accounts;
  const id = `readiness-${randomUUID()}`;
  const record = { id, merchant: 'Temporary readiness purchase', amount: 12345, date: '2026-11-24', category: 'Other', status: 'paid', kind: 'expense', source: 'Readiness verification', note: 'Temporary automated verification record; removed after test.' };
  success(await a.client.from('ledger_expenses').insert({ user_id: a.user.id, id, payload: record }), 'manual create on hosted PostgreSQL');
  const own = success(await a.client.from('ledger_expenses').select('payload').eq('id', id), 'owner can query own record');
  check(own.length === 1 && own[0].payload.amount === 12345, 'owner reads expected expense');
  const other = success(await b.client.from('ledger_expenses').select('id').eq('id', id), 'other account query is isolated');
  check(other.length === 0, 'other account cannot read expense');
  const overwrite = success(await b.client.from('ledger_expenses').update({ payload: { ...record, amount: 1 } }).eq('id', id).select('id'), 'cross-account update is filtered');
  check(overwrite.length === 0, 'other account cannot change expense');
  const forged = await b.client.from('ledger_expenses').insert({ user_id: a.user.id, id: `${id}-forged`, payload: { ...record, id: `${id}-forged` } });
  check(Boolean(forged.error), 'forged owner insert rejected');
  const privateRows = await a.client.from('ledger_gmail_connections').select('user_id');
  check(Boolean(privateRows.error), 'client cannot query Gmail credential table');
  const privateAttempts = await a.client.from('ledger_oauth_attempts').select('user_id');
  check(Boolean(privateAttempts.error), 'client cannot query private OAuth attempts');
  const backendUser = await store.authenticate(a.token);
  check(backendUser?.id === a.user.id, 'backend validates real account and active session');
  if (apiBase) {
    const request = (path, token, method = 'GET', extra = {}) => fetch(`${apiBase}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: apiBase, ...extra }, signal: AbortSignal.timeout(30_000) });
    check((await request('/api/connection')).status === 401, 'live API rejects anonymous connection requests');
    const connection = await request('/api/connection', a.token);
    check(connection.status === 200, 'live API authenticates account with production origin');
    const info = await connection.json();
    check(info.connected === false && !('encrypted_tokens' in info), 'live API returns only safe connection metadata');
    check((await request('/api/account', b.token, 'DELETE')).status === 400, 'live account deletion requires explicit confirmation');
    const childId = `${id}-account-delete`;
    success(await b.client.from('ledger_expenses').insert({ user_id: b.user.id, id: childId, payload: { ...record, id: childId } }), 'create account-deletion test record');
    const deleted = await request('/api/account', b.token, 'DELETE', { 'X-Ledger-Confirm-Deletion': 'true' });
    check(deleted.status === 200, 'live account deletion succeeds for confirmed authenticated owner');
    b.deletedViaApi = true;
    const remaining = success(await admin.from('ledger_expenses').select('id').eq('user_id', b.user.id), 'query account-deletion cascade');
    check(remaining.length === 0, 'account deletion cascades to expense data');
    check((await request('/api/connection', b.token)).status === 401, 'live API rejects deleted-account session');
  }
  success(await a.client.from('ledger_expenses').update({ payload: { ...record, amount: 20000 } }).eq('id', id), 'manual edit on hosted PostgreSQL');
  const changed = success(await a.client.from('ledger_expenses').select('payload').eq('id', id).single(), 'read edited record');
  check(changed.payload.amount === 20000, 'manual edit persisted');
  const anon = await publicClient().from('ledger_expenses').select('id');
  check(Boolean(anon.error), 'anonymous account cannot read expense table');
  const secondDevice = publicClient();
  success(await secondDevice.auth.setSession({ access_token: a.token, refresh_token: (await a.client.auth.getSession()).data.session.refresh_token }), 'restore account session on second client');
  const shared = success(await secondDevice.from('ledger_expenses').select('payload').eq('id', id), 'second client reads same account');
  check(shared.length === 1 && shared[0].payload.amount === 20000, 'same account sees data across clients');
  success(await a.client.from('ledger_expenses').delete().eq('id', id), 'manual delete on hosted PostgreSQL');
  const empty = success(await secondDevice.from('ledger_expenses').select('id').eq('id', id), 'deletion visible on second client');
  check(empty.length === 0, 'manual deletion persisted across clients');
  success(await a.client.auth.signOut({ scope: 'local' }), 'sign out real account session');
  check(await store.authenticate(a.token) === null, 'backend rejects signed-out session');
  const stale = success(await secondDevice.from('ledger_expenses').select('id'), 'query with signed-out JWT is evaluated');
  check(stale.length === 0, 'database rejects stale signed-out session access');
} catch (error) {
  failed = true;
  console.log(JSON.stringify({ status: 'failed', check: error instanceof Error && error.message.startsWith('Failed: ') ? error.message : 'Hosted verification could not complete; no credentials or provider response bodies are displayed.' }));
} finally {
  const cleanup = [];
  for (const account of accounts) {
    if (account.deletedViaApi) {
      const result = await admin.auth.admin.getUserById(account.user.id);
      cleanup.push(result.error?.status === 404 || !result.data?.user);
      continue;
    }
    await account.client.auth.signOut({ scope: 'local' }).catch(() => {});
    const result = await admin.auth.admin.deleteUser(account.user.id);
    cleanup.push(!result.error);
  }
  console.log(JSON.stringify({ status: failed ? 'failed' : 'passed', checksPassed: passed, temporaryAccountsCreated: accounts.length, temporaryAccountsRemoved: cleanup.filter(Boolean).length, emailsSent: 0 }));
  if (failed || cleanup.some(value => !value)) process.exitCode = 1;
}
