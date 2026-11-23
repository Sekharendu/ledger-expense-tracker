import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createTokenCipher } from './cipher.mjs';
import { HostedStore } from './store.mjs';
import { createGoogleClient, GMAIL_SCOPE, ProviderError, syncMailbox } from './gmail.mjs';
import { isExpense } from '../src/expenses.ts';

const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const challenge = value => createHash('sha256').update(value).digest('base64url');

export function createHostedHandler(config, dependencies = {}) {
  const configured = Boolean(config.supabaseUrl && config.supabaseSecret && config.encryptionKey);
  const store = dependencies.store ?? (configured ? new HostedStore(createClient(config.supabaseUrl, config.supabaseSecret, { auth: { persistSession: false, autoRefreshToken: false } })) : null);
  const cipher = dependencies.cipher ?? (configured ? createTokenCipher(config.encryptionKey) : null);
  const google = dependencies.google ?? createGoogleClient(config);
  const gmailConfigured = Boolean(config.clientId && config.clientSecret);
  const json = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };

  async function scan(userId) {
    const connection = await store.claimScan(userId);
    if (!connection) throw new ProviderError('Gmail is disconnected or another scan is running.', 409);
    let run;
    try {
      run = await store.startRun(userId);
      let tokens = cipher.open(connection.encrypted_tokens);
      if (tokens.expiresAt < Date.now() + 60_000) {
        const refreshed = await google.refresh(tokens.refreshToken);
        tokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? tokens.refreshToken };
        if (!await store.updateLeaseTokens(userId, connection.lease, cipher.seal(tokens))) throw new ProviderError('Gmail was disconnected during the scan.', 409);
      }
      const result = await syncMailbox({ api: google.api, token: tokens.accessToken, email: connection.email, pageToken: connection.next_page_token, pdfExtractor: dependencies.pdfExtractor });
      if (!result.expenses.every(isExpense)) throw new Error('Invalid parsed records');
      const committed = await store.commitScan(userId, connection.lease, run, result.expenses, result);
      if (committed.cancelled) throw new ProviderError('The scan was cancelled because Gmail was disconnected.', 409);
      return { ...result, ...committed, expenses: [] }; // Records are already committed to PostgreSQL.
    } catch (error) {
      const safe = error instanceof ProviderError ? error.message : 'The email scan could not finish. Try again.';
      await store.failScan(userId, connection.lease, run, safe, error instanceof ProviderError && error.status === 401).catch(() => {});
      throw error instanceof ProviderError ? error : new ProviderError(safe);
    }
  }

  async function disconnect(userId) {
    await store.cancelAttempts(userId);
    const connection = await store.connection(userId);
    if (!connection?.encrypted_tokens) return;
    // Disable before network revocation: no in-flight scan can commit after this write.
    await store.updateConnection(userId, { enabled: false, status: 'revoke_pending', next_sync_at: null, lease: null, lease_until: null });
    const tokens = cipher.open(connection.encrypted_tokens);
    await google.revoke(tokens.refreshToken ?? tokens.accessToken);
    await store.updateConnection(userId, { status: 'disconnected', encrypted_tokens: null, last_error: null, next_page_token: null });
  }

  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const origin = request.headers.origin;
      if (origin && !config.allowedOrigins.includes(origin)) return json(response, 403, { error: 'Origin not allowed.' });
      if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
      if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'); response.writeHead(204); response.end(); return; }
      const url = new URL(request.url, 'https://ledger.invalid');
      if (url.pathname === '/api/health') return json(response, 200, { ok: true, databaseConfigured: Boolean(store), gmailConfigured });
      if (!store || !cipher) return json(response, 503, { error: 'The account service is temporarily unavailable.' });

      if (url.pathname === '/api/cron') {
        const expected = `Bearer ${config.cronSecret ?? ''}`;
        const supplied = request.headers.authorization ?? '';
        if (!config.cronSecret || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return json(response, 401, { error: 'Unauthorized' });
        await store.purgeExpiredAttempts();
        for (const item of await store.revokePending(10)) await disconnect(item.user_id).catch(() => {});
        const results = [];
        const started = Date.now();
        for (const item of await store.dueConnections(20)) {
          if (Date.now() - started > 120_000) break;
          try { const result = await scan(item.user_id); results.push({ ok: true, added: result.added }); }
          catch { results.push({ ok: false }); }
        }
        return json(response, 200, { processed: results.length, successful: results.filter(item => item.ok).length });
      }

      if (url.pathname === '/api/oauth/google/callback') {
        const attempt = await store.claimAttempt(hash(url.searchParams.get('state') ?? ''));
        if (!attempt) return json(response, 400, { error: 'Invalid or expired Gmail connection request.' });
        const finish = (status, message) => { response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ledger Gmail connection</title><main><h1>Ledger</h1><p>${message}</p><p>Return to the Ledger app. You can close this window.</p></main></html>`); };
        let tokens;
        try {
          if (url.searchParams.has('error')) throw new ProviderError('Gmail permission was declined. You can continue tracking expenses manually.', 400);
          const code = url.searchParams.get('code');
          if (!code) throw new ProviderError('Google did not return a connection code.', 400);
          const proof = cipher.open(attempt.encrypted_proof);
          tokens = await google.exchange(code, proof.verifier);
          const identity = await google.identity(tokens.idToken, proof.nonce);
          if (identity.sub !== proof.googleSub) throw new ProviderError('Choose the same Google account you used to sign in to Ledger.', 403);
          if (!tokens.scope?.split(' ').includes(GMAIL_SCOPE) || !tokens.refreshToken) throw new ProviderError('Read-only Gmail permission was not granted. Manual tracking remains available.', 403);
          const profile = await google.profile(tokens.accessToken);
          const saved = await store.finishConnection(attempt.token_hash, profile.emailAddress, cipher.seal(tokens));
          if (!saved) throw new ProviderError('The Gmail connection was cancelled.', 409);
          return finish(200, 'Gmail connected. Ledger can now scan your billing emails.');
        } catch (error) {
          if (tokens) await google.revoke(tokens.refreshToken ?? tokens.accessToken).catch(() => {});
          const safe = error instanceof ProviderError ? error.message : 'Gmail could not be connected. You can continue tracking expenses manually.';
          await store.finishAttempt(attempt.token_hash, 'error', safe);
          return finish(400, 'Gmail was not connected. Your Ledger account and expenses are unchanged.');
        }
      }

      const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      const user = token ? await store.authenticate(token) : null;
      if (!user) return json(response, 401, { error: 'Sign in to Ledger to continue.' });
      if (url.pathname === '/api/connection' && request.method === 'GET') {
        const record = await store.connection(user.id);
        return json(response, 200, { connected: Boolean(record?.enabled && record.status === 'connected'), email: record?.email, status: record?.status ?? 'disconnected', error: record?.last_error, lastSync: record?.last_sync_at, hasMore: Boolean(record?.next_page_token), backgroundTracking: true, scanSchedule: 'daily' });
      }
      if (url.pathname === '/api/gmail/start' && request.method === 'POST') {
        if (!gmailConfigured) return json(response, 503, { error: 'Gmail connection is temporarily unavailable. Manual expense tracking is available.' });
        if (!user.googleSub) return json(response, 403, { error: 'Sign in with Google before connecting Gmail.' });
        const existing = await store.connection(user.id);
        if (existing?.enabled) return json(response, 409, { error: 'Gmail is already connected.' });
        const attemptToken = random(); const state = random(); const verifier = random(); const nonce = random();
        await store.cancelAttempts(user.id);
        await store.createAttempt({ token_hash: hash(attemptToken), state_hash: hash(state), user_id: user.id, encrypted_proof: cipher.seal({ verifier, nonce, googleSub: user.googleSub }), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
        return json(response, 201, { attemptToken, authorizationUrl: google.authorizationUrl(state, challenge(verifier), nonce) });
      }
      if (url.pathname === '/api/gmail/status') {
        const attempt = await store.getAttempt(hash(url.searchParams.get('attempt') ?? ''), user.id);
        return attempt ? json(response, 200, attempt) : json(response, 404, { error: 'Gmail connection request expired. Try again.' });
      }
      if (url.pathname === '/api/connection' && request.method === 'DELETE') {
        await disconnect(user.id);
        return json(response, 200, { disconnected: true });
      }
      if (url.pathname === '/api/sync' && request.method === 'POST') return json(response, 200, await scan(user.id));
      return json(response, 404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (!response.headersSent) json(response, error instanceof ProviderError ? error.status : 500, { error: error instanceof ProviderError ? error.message : 'The service could not complete the request. Please try again.' });
      else response.end();
    }
  };
}

export const hostedConfig = () => ({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecret: process.env.SUPABASE_SECRET_KEY,
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
  cronSecret: process.env.CRON_SECRET,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
});

export const createHostedServer = (config, dependencies) => createServer(createHostedHandler(config, dependencies));
