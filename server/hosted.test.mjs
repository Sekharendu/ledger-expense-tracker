import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHostedHandler, createHostedServer } from './hosted.mjs';
import { createTokenCipher } from './cipher.mjs';
import { HostedStore } from './store.mjs';
import { GMAIL_SCOPE } from './gmail.mjs';

test('hosted flow separates account sessions, optional Gmail permission, background scans and disconnect', async () => {
  const cipher = createTokenCipher(randomBytes(32).toString('base64'));
  const attempts = new Map();
  const connections = new Map();
  const sessions = new Map([['signed-in-A', { id: 'userA', email: 'a@example.com', googleSub: 'googleA' }], ['signed-in-B', { id: 'userB', email: 'b@example.com', googleSub: 'googleB' }]]);
  const expenses = [{ id: 'manual', userId: 'userA' }];
  const processed = new Set();
  let state;
  let nonce;
  let revoked = false;
  const store = {
    authenticate: async token => sessions.get(token) ?? null,
    connection: async id => connections.has(id) ? structuredClone(connections.get(id)) : null,
    createAttempt: async record => { attempts.set(record.token_hash, structuredClone(record)); },
    cancelAttempts: async id => { for (const record of attempts.values()) if (record.user_id === id) record.status = 'cancelled'; },
    claimAttempt: async hash => { const record = [...attempts.values()].find(item => item.state_hash === hash && item.status === undefined); if (!record) return null; record.status = 'exchanging'; return structuredClone(record); },
    getAttempt: async (hash, id) => { const record = attempts.get(hash); return record?.user_id === id ? { status: record.status ?? 'pending', error: record.error } : null; },
    finishAttempt: async (hash, status, error) => { Object.assign(attempts.get(hash), { status, error }); },
    finishConnection: async (hash, email, encryptedTokens) => { const attempt = attempts.get(hash); if (attempt.status !== 'exchanging') return false; attempt.status = 'complete'; connections.set(attempt.user_id, { user_id: attempt.user_id, email, encrypted_tokens: encryptedTokens, enabled: true, status: 'connected' }); return true; },
    updateConnection: async (id, fields) => { Object.assign(connections.get(id), fields); },
    updateLeaseTokens: async (id, lease, tokens) => { const row = connections.get(id); if (!row.enabled || row.lease !== lease) return null; row.encrypted_tokens = tokens; return { user_id: id }; },
    claimScan: async id => { const row = connections.get(id); if (!row?.enabled || row.lease) return null; row.lease = 'lease'; return structuredClone(row); },
    startRun: async () => 'run',
    processedMessages: async (id, ids) => ids.filter(message => processed.has(`${id}:${message}`)),
    commitScan: async (id, lease, _run, items, result) => { const row = connections.get(id); if (!row.enabled || row.lease !== lease) return { cancelled: true }; let added = 0; for (const item of items) if (!expenses.some(old => old.id === item.id && old.userId === id)) { expenses.push({ ...item, userId: id }); added++; } for (const message of result.processedMessageIds) processed.add(`${id}:${message}`); row.next_page_token = result.nextPageToken; row.lease = null; row.last_sync_at = new Date().toISOString(); return { added, duplicates: items.length - added }; },
    failScan: async id => { connections.get(id).lease = null; },
    purgeExpiredAttempts: async () => {},
    revokePending: async () => [],
    dueConnections: async () => [...connections.values()].filter(item => item.enabled).map(item => ({ user_id: item.user_id })),
  };
  const google = {
    authorizationUrl: (value, _challenge, proofNonce) => { state = value; nonce = proofNonce; return `https://accounts.google.com/auth?state=${value}`; },
    exchange: async () => ({ accessToken: 'private-access-token', refreshToken: 'private-refresh-token', idToken: 'verified-token', expiresAt: Date.now() + 3600_000, scope: `openid email ${GMAIL_SCOPE}` }),
    identity: async (_token, value) => { assert.equal(value, nonce); return { sub: 'googleA' }; },
    profile: async () => ({ emailAddress: 'a@example.com' }),
    revoke: async () => { revoked = true; },
    api: async route => route.startsWith('/messages?') ? { messages: [{ id: 'msg' }] } : { id: 'msg', threadId: 'thread', internalDate: String(Date.now()), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Invoice' }, { name: 'From', value: 'Store <billing@vendor.test>' }], body: { data: btoa('Invoice No: INV-123\nTotal: INR 499') } } },
  };
  const server = createHostedServer({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://ledger.example/api/oauth/google/callback', allowedOrigins: ['http://localhost:8081'], cronSecret: 'cron-secret' }, { store, cipher, google });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token = 'signed-in-A', method = 'GET') => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` } });
  try {
    // Account identity alone does not grant inbox access.
    assert.equal((await (await call('/api/connection')).json()).connected, false);
    assert.equal((await call('/api/sync', 'signed-in-A', 'POST')).status, 409);
    const begin = await (await call('/api/gmail/start', 'signed-in-A', 'POST')).json();
    assert.ok(begin.attemptToken);
    assert.equal((await call('/api/oauth/google/callback?state=incorrect&code=code')).status, 400);
    assert.equal((await call(`/api/oauth/google/callback?state=${state}&code=code`)).status, 200);
    assert.equal((await call(`/api/oauth/google/callback?state=${state}&code=code`)).status, 400);
    const info = await (await call('/api/connection')).json();
    assert.equal(info.connected, true);
    assert.equal(JSON.stringify(info).includes('private-access-token'), false);
    assert.equal(connections.get('userA').encrypted_tokens.includes('private-refresh-token'), false);
    assert.equal((await (await call('/api/connection', 'signed-in-B')).json()).connected, false);
    assert.equal((await call(`/api/gmail/status?attempt=${begin.attemptToken}`, 'signed-in-B')).status, 404);
    const scan = await (await call('/api/sync', 'signed-in-A', 'POST')).json();
    assert.equal(scan.added, 1);
    assert.equal(expenses.length, 2);
    assert.equal(expenses[1].status, 'review');
    // Signing out ends the session but retains the mailbox and existing records.
    sessions.delete('signed-in-A');
    assert.equal((await call('/api/connection')).status, 401);
    assert.equal(connections.get('userA').enabled, true);
    assert.equal((await call('/api/cron', 'wrong')).status, 401);
    assert.equal((await call('/api/cron', 'crön-secret')).status, 401);
    assert.equal((await call('/api/cron', 'cron-secret')).status, 200);
    sessions.set('signed-in-A', { id: 'userA', email: 'a@example.com', googleSub: 'googleA' });
    assert.equal((await call('/api/connection', 'signed-in-A', 'DELETE')).status, 200);
    assert.equal(revoked, true);
    assert.equal(connections.get('userA').enabled, false);
    assert.equal(connections.get('userA').encrypted_tokens, null);
    assert.equal(expenses.length, 2);
    // Declining a new Gmail request keeps manual tracking and the app account intact.
    await call('/api/gmail/start', 'signed-in-A', 'POST');
    assert.equal((await call(`/api/oauth/google/callback?state=${state}&error=access_denied`)).status, 400);
    assert.equal((await call('/api/connection')).status, 200);
    assert.equal(expenses[0].id, 'manual');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Gmail readiness requires its callback as well as client credentials', async () => {
  for (const [redirectUri, expected] of [[undefined, false], ['', false], ['https://ledger.example/api/oauth/google/callback', true]]) {
    const handler = createHostedHandler({ clientId: 'client', clientSecret: 'secret', redirectUri, allowedOrigins: [] }, { store: {}, cipher: {}, google: {} });
    let status;
    let body;
    await handler({ method: 'GET', url: '/api/health', headers: {} }, { setHeader() {}, writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); } });
    assert.equal(status, 200);
    assert.equal(body.gmailConfigured, expected);
  }
});

test('disconnect cancellation stays cancelled in sync history instead of becoming an error', async () => {
  const updates = [];
  const store = new HostedStore({ from(table) {
    return {
      update(fields) { updates.push({ table, fields }); return this; },
      eq() { return this; },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
  } });
  await store.failScan('user', 'lease', 'run', 'Disconnected during scan', false, true);
  const history = updates.find(update => update.table === 'ledger_sync_history');
  assert.equal(history.fields.status, 'cancelled');
  assert.equal(history.fields.error, null);
});
