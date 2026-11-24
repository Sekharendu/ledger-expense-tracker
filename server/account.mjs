/** Delete only the account established by the verified bearer session. */
export async function deleteLedgerAccount({ userId, sessionToken, disconnect, store }) {
  // Keep the account until Google has revoked access, so a failed revocation can be retried.
  // disconnect() disables scans first; the database lease check rejects in-flight imports.
  await disconnect(userId);
  await store.revokeUserSessions(sessionToken);
  // Hard deletion cascades to profiles, expenses, Gmail credentials and sync history.
  await store.deleteUser(userId);
}
