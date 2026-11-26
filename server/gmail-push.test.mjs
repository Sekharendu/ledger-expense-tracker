import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { createNotificationReceiver, createPushVerifier, createWatchManager, pushConfigured } from './gmail-push.mjs';
import { ProviderError } from './gmail.mjs';
import { createHostedServer } from './hosted.mjs';
import { createTokenCipher } from './cipher.mjs';

const config = {
  pubsubTopic: 'projects/ledger-expense-tracker-515710/topics/ledger-gmail-incoming',
  pubsubSubscription: 'projects/ledger-expense-tracker-515710/subscriptions/ledger-gmail-push',
  pubsubAudience: 'https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/gmail/notifications',
  pubsubServiceAccount: 'ledger-gmail-push@ledger-expense-tracker-515710.iam.gserviceaccount.com',
};
const envelope = () => ({ subscription: config.pubsubSubscription, message: { messageId: 'delivery-1', data: Buffer.from(JSON.stringify({ emailAddress: 'User@example.com', historyId: '12345' })).toString('base64url') } });
const request = (body = envelope(), token = 'valid') => ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body });

test('push identity verifies Google signature/audience and the exact verified service account', async () => {
  let claims = { email: config.pubsubServiceAccount, email_verified: true, aud: config.pubsubAudience };
  const verifier = createPushVerifier(config, { verifyIdToken: async options => { assert.equal(options.audience, config.pubsubAudience); return { getPayload: () => claims }; } });
  assert.equal(pushConfigured(config), true);
  assert.equal(pushConfigured({ ...config, pubsubAudience: 'https://attacker.example' }), false);
  assert.equal(await verifier('signed-token'), true);
  for (const change of [{ email: 'other@example.com' }, { email_verified: false }, { aud: 'https://other.example' }]) {
    claims = { email: config.pubsubServiceAccount, email_verified: true, aud: config.pubsubAudience, ...change };
    assert.equal(await verifier('token'), false);
  }
  assert.equal(await createPushVerifier(config, { verifyIdToken: async () => { throw new Error('Invalid signature'); } })('invalid'), false);
});

test('authenticated push processes only the selected enabled mailbox and acknowledges late disconnects', async () => {
  let connected = true;
  const scanned = [];
  const receiver = createNotificationReceiver(config, {
    verifyToken: async token => token === 'valid',
    store: { connectionByEmail: async email => { assert.equal(email, 'user@example.com'); return connected ? { user_id: 'account-a', enabled: true, status: 'connected' } : null; } },
    scan: async user => scanned.push(user),
  });
  await assert.rejects(receiver(request(envelope(), 'forged')), error => error.status === 401);
  assert.equal(scanned.length, 0);
  await receiver(request());
  assert.deepEqual(scanned, ['account-a']);
  const stream = Readable.from([Buffer.from(JSON.stringify(envelope()))]);
  Object.assign(stream, { headers: { authorization: 'Bearer valid' }, method: 'POST' });
  await receiver(stream);
  connected = false;
  await receiver(request());
  assert.deepEqual(scanned, ['account-a', 'account-a']);
});

test('unexpected subscription, malformed data and oversized requests never trigger scans', async () => {
  let scans = 0;
  const receiver = createNotificationReceiver(config, { verifyToken: async () => true, store: { connectionByEmail: async () => ({ enabled: true, status: 'connected' }) }, scan: async () => scans++ });
  await assert.rejects(receiver(request({ ...envelope(), subscription: 'projects/other/subscriptions/other' })), error => error.status === 403);
  await assert.rejects(receiver(request({ ...envelope(), message: { data: 'invalid!' } })), error => error.status === 400);
  await assert.rejects(receiver(request('x'.repeat(65537))), error => error.status === 413);
  await assert.rejects(receiver({ ...request(), method: 'GET' }), error => error.status === 405);
  assert.equal(scans, 0);
});

test('busy or temporarily failing scans request redelivery; revoked access is acknowledged', async () => {
  let status = 409;
  const receiver = createNotificationReceiver(config, { verifyToken: async () => true, store: { connectionByEmail: async () => ({ user_id: 'a', enabled: true, status: 'connected' }) }, scan: async () => { throw new ProviderError('failure', status); } });
  await assert.rejects(receiver(request()), error => error.status === 503);
  status = 502;
  await assert.rejects(receiver(request()), error => error.status === 503);
  status = 401;
  await receiver(request());
});

test('Gmail history IDs accept exact JSON numbers and strings but reject invalid or rounded values', async () => {
  let scans = 0;
  const receiver = createNotificationReceiver(config, {
    verifyToken: async () => true,
    store: { connectionByEmail: async () => ({ user_id: 'a', enabled: true, status: 'connected' }) },
    scan: async () => scans++,
  });
  const withHistory = historyId => request({ ...envelope(), message: { data: Buffer.from(JSON.stringify({ emailAddress: 'user@example.com', historyId })).toString('base64url') } });
  for (const id of [12345, '12345', '9007199254740993']) await receiver(withHistory(id));
  assert.equal(scans, 3);
  for (const id of [9007199254740992, -1, 1.5, null, true, {}, '', '1e5']) {
    await assert.rejects(receiver(withHistory(id)), error => error.status === 400);
  }
  assert.equal(scans, 3);
});

test('watches register, renew daily and stop without exposing tokens', async () => {
  let time = Date.parse('2026-11-25T00:00:00Z');
  let watches = 0; let stopped = 0;
  const row = { enabled: true, status: 'connected', email: 'user@example.com', encrypted_tokens: { accessToken: 'access', refreshToken: 'refresh', expiresAt: time + 99_000_000 } };
  const manager = createWatchManager(config, {
    now: () => time, cipher: { open: value => value, seal: value => value },
    store: { connection: async () => row, updateWatch: async (_id, email, fields) => { assert.equal(email, row.email); Object.assign(row, fields); return { user_id: 'a' }; } },
    google: { watch: async (token, topic) => { assert.equal(token, 'access'); assert.equal(topic, config.pubsubTopic); watches++; return { historyId: '123', expiration: String(time + 7 * 86400_000) }; }, stopWatch: async () => stopped++ },
  });
  assert.equal(await manager.ensure('a'), true);
  assert.equal(await manager.ensure('a'), true);
  assert.equal(watches, 1);
  time += 86400_000 + 1000;
  assert.equal(await manager.ensure('a'), true);
  assert.equal(watches, 2);
  await manager.stop(row);
  assert.equal(stopped, 1);
  row.enabled = false;
  assert.equal(await manager.ensure('a'), false);
  assert.equal(watches, 2);
});

test('failed watch setup leaves connection enabled, records a safe error and backs off', async () => {
  const time = Date.parse('2026-11-25T00:00:00Z');
  let calls = 0;
  const row = { enabled: true, status: 'connected', email: 'user@example.com', encrypted_tokens: { accessToken: 'access', expiresAt: time + 3600_000 } };
  const manager = createWatchManager(config, {
    now: () => time, cipher: { open: value => value },
    store: { connection: async () => row, updateWatch: async (_id, _email, fields) => { Object.assign(row, fields); return { user_id: 'a' }; } },
    google: { watch: async () => { calls++; throw new Error('private provider details'); } },
  });
  assert.equal(await manager.ensure('a'), false);
  assert.equal(row.enabled, true);
  assert.doesNotMatch(row.gmail_watch_error, /private provider/);
  assert.equal(await manager.ensure('a'), false);
  assert.equal(calls, 1);
});

test('HTTP push imports once, duplicate deliveries reuse processed IDs, and disconnect stops imports', async () => {
  const cipher = createTokenCipher(Buffer.alloc(32, 9).toString('base64'));
  const row = { user_id: 'account-a', email: 'user@example.com', enabled: true, status: 'connected', encrypted_tokens: cipher.seal({ accessToken: 'access', expiresAt: Date.now() + 3600_000 }) };
  const processed = new Set(); const expenses = new Map(); let fullReads = 0;
  const store = {
    connectionByEmail: async email => email === row.email ? row : null,
    claimScan: async () => { if (!row.enabled || row.lease) return null; row.lease = 'lease'; return { ...row }; },
    startRun: async () => 'run', processedMessages: async (_id, ids) => ids.filter(id => processed.has(id)),
    commitScan: async (_id, lease, _run, items, result) => { assert.equal(row.lease, lease); items.forEach(item => expenses.set(item.id, item)); result.processedMessageIds.forEach(id => processed.add(id)); row.lease = null; return { added: items.length, duplicates: 0 }; },
    failScan: async () => { row.lease = null; },
  };
  const google = { api: async route => {
    if (route.startsWith('/messages?')) return { messages: [{ id: 'invoice' }] };
    fullReads++;
    return { id: 'invoice', internalDate: String(Date.now()), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Invoice' }, { name: 'From', value: 'Store <billing@example.test>' }], body: { data: Buffer.from('Invoice date: 2026-11-25\nTotal INR 100\nPayment successful').toString('base64url') } } };
  } };
  const server = createHostedServer({ ...config, allowedOrigins: [] }, { store, cipher, google, verifyPushToken: async token => token === 'valid' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const send = (token = 'valid') => fetch(`http://127.0.0.1:${server.address().port}/api/gmail/notifications`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(envelope()) });
  try {
    assert.equal((await send('invalid')).status, 401);
    assert.equal((await send()).status, 204);
    assert.equal((await send()).status, 204);
    assert.equal(expenses.size, 1);
    assert.equal([...expenses.values()][0].status, 'paid');
    assert.equal(fullReads, 1);
    row.enabled = false;
    assert.equal((await send()).status, 204);
    assert.equal(fullReads, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
