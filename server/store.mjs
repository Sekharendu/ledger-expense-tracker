import { Buffer } from 'node:buffer';

export class HostedStore {
  constructor(admin) { this.admin = admin; }
  async result(query) {
    const { data, error } = await query;
    if (error) throw new Error(`Database operation failed (${error.code ?? 'unknown'}).`);
    return data;
  }
  async authenticate(token) {
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data?.user) return null;
    let sessionId;
    try { sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).session_id; } catch { return null; }
    if (!/^[a-f0-9-]{36}$/i.test(sessionId ?? '')) return null;
    if (!await this.result(this.admin.rpc('ledger_session_active', { p_user: data.user.id, p_session: sessionId }))) return null;
    return { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name ?? '', googleSub: data.user.identities?.find(identity => identity.provider === 'google')?.identity_data?.sub };
  }
  createAttempt(record) { return this.result(this.admin.from('ledger_oauth_attempts').insert(record)); }
  getAttempt(hash, userId) { return this.result(this.admin.from('ledger_oauth_attempts').select('status,error').eq('token_hash', hash).eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle()); }
  claimAttempt(stateHash) { return this.result(this.admin.from('ledger_oauth_attempts').update({ status: 'exchanging' }).eq('state_hash', stateHash).eq('status', 'pending').gt('expires_at', new Date().toISOString()).select().maybeSingle()); }
  finishAttempt(hash, status, error = null) { return this.result(this.admin.from('ledger_oauth_attempts').update({ status, error, encrypted_proof: '' }).eq('token_hash', hash)); }
  finishConnection(hash, email, encryptedTokens) { return this.result(this.admin.rpc('ledger_finish_gmail', { p_hash: hash, p_email: email, p_tokens: encryptedTokens })); }
  cancelAttempts(userId) { return this.result(this.admin.from('ledger_oauth_attempts').update({ status: 'cancelled', encrypted_proof: '' }).eq('user_id', userId).in('status', ['pending','exchanging'])); }
  connection(userId) { return this.result(this.admin.from('ledger_gmail_connections').select().eq('user_id', userId).maybeSingle()); }
  setConnection(userId, fields) { return this.result(this.admin.from('ledger_gmail_connections').upsert({ user_id: userId, ...fields })); }
  updateConnection(userId, fields) { return this.result(this.admin.from('ledger_gmail_connections').update(fields).eq('user_id', userId)); }
  updateLeaseTokens(userId, lease, encryptedTokens) { return this.result(this.admin.from('ledger_gmail_connections').update({ encrypted_tokens: encryptedTokens }).eq('user_id', userId).eq('lease', lease).eq('enabled', true).select('user_id').maybeSingle()); }
  claimScan(userId) { return this.result(this.admin.rpc('ledger_claim_scan', { p_user: userId })).then(rows => rows[0] ?? null); }
  async startRun(userId) { return this.result(this.admin.from('ledger_sync_history').insert({ user_id: userId }).select('id').single()).then(row => row.id); }
  commitScan(userId, lease, run, expenses, result) { return this.result(this.admin.rpc('ledger_commit_scan', { p_user: userId, p_lease: lease, p_run: run, p_expenses: expenses, p_result: result })); }
  async failScan(userId, lease, run, message, revoked) {
    await this.result(this.admin.from('ledger_gmail_connections').update({ lease: null, lease_until: null, last_error: message, next_sync_at: new Date(Date.now() + 30 * 60_000).toISOString(), ...(revoked ? { status: 'reconnect_required', enabled: false } : {}) }).eq('user_id', userId).eq('lease', lease));
    if (run) await this.result(this.admin.from('ledger_sync_history').update({ status: 'error', completed_at: new Date().toISOString(), error: message }).eq('id', run).eq('user_id', userId));
  }
  dueConnections(limit) { return this.result(this.admin.from('ledger_gmail_connections').select('user_id').eq('enabled', true).eq('status', 'connected').lte('next_sync_at', new Date().toISOString()).order('next_sync_at').limit(limit)); }
  revokePending(limit) { return this.result(this.admin.from('ledger_gmail_connections').select().eq('status', 'revoke_pending').limit(limit)); }
  async purgeExpiredAttempts() { await this.result(this.admin.from('ledger_oauth_attempts').delete().lt('expires_at', new Date().toISOString())); }
}
