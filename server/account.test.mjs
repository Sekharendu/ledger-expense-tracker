import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteLedgerAccount } from './account.mjs';
import { createHostedServer } from './hosted.mjs';

test('account deletion revokes Gmail and sessions before deleting the authenticated user', async () => {
  const operations = [];
  await deleteLedgerAccount({
    userId: 'verified-user', sessionToken: 'verified-session',
    disconnect: async id => { operations.push(`disconnect:${id}`); },
    store: {
      revokeUserSessions: async token => { operations.push(`sessions:${token}`); },
      deleteUser: async id => { operations.push(`delete:${id}`); },
    },
  });
  assert.deepEqual(operations, ['disconnect:verified-user', 'sessions:verified-session', 'delete:verified-user']);
});

test('failed Gmail revocation preserves the account for a retry', async () => {
  let deleted = false;
  await assert.rejects(deleteLedgerAccount({
    userId: 'user', sessionToken: 'session',
    disconnect: async () => { throw new Error('Google temporarily unavailable'); },
    store: { revokeUserSessions: async () => {}, deleteUser: async () => { deleted = true; } },
  }), /Google temporarily unavailable/);
  assert.equal(deleted, false);
});

test('account API requires authentication and explicit confirmation, and ignores supplied user IDs', async () => {
  const deleted = [];
  const store = {
    authenticate: async token => token === 'valid' ? { id: 'verified-user' } : null,
    cancelAttempts: async () => {}, connection: async () => null,
    revokeUserSessions: async token => { assert.equal(token, 'valid'); },
    deleteUser: async id => { deleted.push(id); },
  };
  const server = createHostedServer({ allowedOrigins: [] }, { store, cipher: {}, google: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/account`, { method: 'DELETE' })).status, 401);
    assert.equal((await fetch(`${base}/api/account`, { method: 'DELETE', headers: { Authorization: 'Bearer valid' } })).status, 400);
    const response = await fetch(`${base}/api/account?userId=someone-else`, { method: 'DELETE', headers: { Authorization: 'Bearer valid', 'X-Ledger-Confirm-Deletion': 'true' } });
    assert.equal(response.status, 200);
    assert.deepEqual(deleted, ['verified-user']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
