import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmailServer } from './app.mjs';
import { createVault, tokenHash } from './vault.mjs';
import { GMAIL_SCOPE } from './gmail.mjs';

test('vault encrypts tokens, survives restart and fails closed on a wrong key', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ledger-vault-test-'));
  try {
    const vault = await createVault(directory);
    const hash = tokenHash('session');
    await vault.set(hash, { tokens: { refreshToken: 'super-secret-refresh' }, email: 'private@example.com' });
    const bytes = await readFile(path.join(directory, 'connections.enc'));
    assert.equal(bytes.includes(Buffer.from('super-secret-refresh')), false);
    assert.equal(bytes.includes(Buffer.from('private@example.com')), false);
    const restored = await createVault(directory);
    assert.equal(restored.get(hash).tokens.refreshToken, 'super-secret-refresh');
    await restored.remove(hash);
    assert.equal((await createVault(directory)).get(hash), undefined);
    await writeFile(path.join(directory, 'encryption.key'), Buffer.alloc(32, 1));
    await assert.rejects(createVault(directory), /Cannot decrypt/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('OAuth, authenticated sync, refresh, callback replay and disconnect work end to end', async () => {
  const records = new Map();
  const vault = { get: hash => records.has(hash) ? structuredClone(records.get(hash)) : undefined, set: async (hash, record) => { records.set(hash, structuredClone(record)); }, remove: async hash => { records.delete(hash); } };
  let state;
  let challenge;
  let refreshed = false;
  let revoked = false;
  let exchanged = 0;
  const google = {
    authorizationUrl: (value, proof) => { state = value; challenge = proof; return `https://accounts.google.com/test?state=${value}`; },
    exchange: async (code, verifier) => { exchanged++; assert.equal(code, 'valid-code'); assert.ok(verifier); return { accessToken: 'access', refreshToken: 'refresh', scope: GMAIL_SCOPE, expiresAt: Date.now() - 1 }; },
    profile: async () => ({ emailAddress: 'me@example.com' }),
    refresh: async token => { assert.equal(token, 'refresh'); refreshed = true; return { accessToken: 'new-access', expiresAt: Date.now() + 3600_000 }; },
    revoke: async token => { assert.equal(token, 'refresh'); revoked = true; },
    api: async (route, token) => {
      assert.equal(token, 'new-access');
      if (route.startsWith('/messages?')) return { messages: [{ id: 'msg-1' }] };
      return { id: 'msg-1', threadId: 'thread-1', internalDate: String(Date.parse('2026-11-23T12:00:00Z')), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Your receipt' }, { name: 'From', value: 'Store <billing@example.com>' }], body: { data: Buffer.from('Receipt\nInvoice No: INV-123\nTotal: INR 1499\nDate: 2026-11-22').toString('base64url') } } };
    },
  };
  const server = await createEmailServer({ clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost/oauth/google/callback', allowedOrigins: ['http://localhost:8081'] }, { google, vault });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  const call = (route, options = {}) => fetch(base + route, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  try {
    assert.equal((await call('/api/sync', { method: 'POST' })).status, 401);
    assert.equal((await call('/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const start = await call('/api/session', { method: 'POST' });
    assert.equal(start.status, 201);
    token = (await start.json()).sessionToken;
    assert.ok(challenge);
    assert.equal((await (await call('/api/connection')).json()).connected, false);
    assert.equal((await call('/oauth/google/callback?state=wrong&code=valid-code')).status, 400);
    const callback = `/oauth/google/callback?state=${state}&code=valid-code`;
    assert.equal((await call(callback)).status, 200);
    assert.equal((await call(callback)).status, 400);
    assert.equal(exchanged, 1);
    const connection = await (await call('/api/connection')).json();
    assert.equal(connection.connected, true);
    assert.equal(connection.email, 'me@example.com');
    assert.equal(JSON.stringify(connection).includes('refresh'), false);
    const sync = await call('/api/sync', { method: 'POST' });
    assert.equal(sync.status, 200);
    const result = await sync.json();
    assert.equal(refreshed, true);
    assert.equal(result.expenses[0].amount, 149900);
    assert.equal(result.expenses[0].status, 'review');
    assert.ok((await (await call('/api/connection')).json()).lastSync);
    assert.equal((await call('/api/connection', { method: 'DELETE' })).status, 200);
    assert.equal(revoked, true);
    assert.equal(records.size, 0);
    assert.equal((await call('/api/connection')).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('unconfigured service reports a setup requirement without minting sessions', async () => {
  const server = await createEmailServer({ clientId: '', clientSecret: '', redirectUri: 'http://localhost/oauth/google/callback', allowedOrigins: [] }, { vault: { get: () => undefined }, google: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/session`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Gmail setup is required/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
