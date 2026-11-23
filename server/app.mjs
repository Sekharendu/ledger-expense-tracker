import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { createGoogleClient, GMAIL_SCOPE, ProviderError, syncMailbox } from './gmail.mjs';
import { createVault, tokenHash } from './vault.mjs';

const random = () => randomBytes(32).toString('base64url');
const sha256 = value => createHash('sha256').update(value).digest('base64url');

export async function createEmailServer(config, dependencies = {}) {
  const vault = dependencies.vault ?? await createVault(config.dataDirectory);
  const google = dependencies.google ?? createGoogleClient(config);
  const configured = Boolean(config.clientId && config.clientSecret);
  const pending = new Map();
  const states = new Map();
  const syncing = new Set();
  const limits = new Map();
  const allowedOrigins = new Set(config.allowedOrigins);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', new URL(config.redirectUri).hostname, ...(config.allowedHosts ?? [])]);
  const valid = record => record && record.expiresAt > Date.now();

  function json(response, status, data) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }
  function rateLimit(request, name, maximum) {
    const key = `${request.socket.remoteAddress}:${name}`;
    const previous = limits.get(key);
    const item = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 60_000 };
    item.count++;
    limits.set(key, item);
    if (limits.size > 1000) for (const [id, value] of limits) if (value.until < Date.now()) limits.delete(id);
    return item.count <= maximum;
  }
  function cleanupPending() {
    for (const [hash, record] of pending) if (!valid(record)) { pending.delete(hash); if (record.stateHash) states.delete(record.stateHash); }
  }
  function authenticated(request) {
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    const hash = token ? tokenHash(token) : '';
    const record = hash ? vault.get(hash) ?? pending.get(hash) : undefined;
    return valid(record) ? { hash, record } : null;
  }

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      const host = new URL(`http://${request.headers.host ?? ''}`).hostname;
      if (!allowedHosts.has(host)) return json(response, 403, { error: 'Host not allowed.' });
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return json(response, 403, { error: 'Origin not allowed.' });
      if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.writeHead(204); response.end(); return;
      }
      if (!rateLimit(request, 'api', 180)) return json(response, 429, { error: 'Too many requests. Try again in a minute.' });
      cleanupPending();
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/health' && request.method === 'GET') return json(response, 200, { ok: true, configured, provider: 'gmail' });

      if (url.pathname === '/api/session' && request.method === 'POST') {
        if (!configured) return json(response, 503, { error: 'Gmail setup is required. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.server, then restart the email server.' });
        if (!rateLimit(request, 'connect', 10) || pending.size >= 100) return json(response, 429, { error: 'Too many connection attempts. Try again in a minute.' });
        const token = random();
        const hash = tokenHash(token);
        const state = random();
        const verifier = random();
        const record = { expiresAt: Date.now() + 10 * 60_000, stateHash: tokenHash(state), verifier };
        pending.set(hash, record); states.set(record.stateHash, hash);
        return json(response, 201, { sessionToken: token, authorizationUrl: google.authorizationUrl(state, sha256(verifier)) });
      }

      if (url.pathname === '/oauth/google/callback' && request.method === 'GET') {
        const stateHash = tokenHash(url.searchParams.get('state') ?? '');
        const hash = states.get(stateHash);
        const record = hash ? pending.get(hash) : undefined;
        if (!valid(record)) return json(response, 400, { error: 'Invalid or expired Google sign-in request. Start again from Ledger.' });
        states.delete(stateHash); // One-time state, including on denied access.
        delete record.stateHash;
        const finish = (status, message) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ledger Gmail connection</title><main><h1>Ledger</h1><p>${message}</p><p>You can close this window and return to Ledger.</p></main></html>`); };
        if (url.searchParams.has('error')) { record.error = 'Google sign-in was cancelled or permission was denied. Try connecting again.'; return finish(400, 'Gmail was not connected.'); }
        const code = url.searchParams.get('code');
        if (!code) { record.error = 'Google did not return an authorization code.'; return finish(400, 'Gmail was not connected.'); }
        try {
          const tokens = await google.exchange(code, record.verifier);
          if (!tokens.scope?.split(' ').includes(GMAIL_SCOPE) || !tokens.refreshToken) {
            await google.revoke(tokens.refreshToken ?? tokens.accessToken).catch(() => {});
            throw new ProviderError('Read-only Gmail permission and offline access are required. Reconnect and allow email access.');
          }
          const profile = await google.profile(tokens.accessToken);
          if (typeof profile.emailAddress !== 'string') throw new ProviderError('Google did not return a Gmail account.');
          // A user can disconnect while the browser is completing authorization.
          if (pending.get(hash) !== record) { await google.revoke(tokens.refreshToken).catch(() => {}); return finish(400, 'This connection was cancelled.'); }
          await vault.set(hash, { tokens, email: profile.emailAddress, expiresAt: Date.now() + 90 * 24 * 60 * 60_000 });
          pending.delete(hash);
          return finish(200, 'Gmail connected successfully. Return to Ledger and scan your invoices.');
        } catch (error) {
          record.error = error instanceof ProviderError ? error.message : 'Gmail authorization could not be saved. Please try again.';
          return finish(400, 'Gmail could not be connected. Check Ledger for details.');
        }
      }

      const session = authenticated(request);
      if (!session) return json(response, 401, { error: 'Connection expired. Connect Gmail again.' });
      const { hash, record } = session;
      if (url.pathname === '/api/connection' && request.method === 'GET') return json(response, 200, { connected: Boolean(record.tokens), email: record.email, error: record.error, lastSync: record.lastSync });

      if (url.pathname === '/api/connection' && request.method === 'DELETE') {
        if (syncing.has(hash)) return json(response, 409, { error: 'A scan is running. Wait for it to finish before disconnecting.' });
        if (record.tokens) await google.revoke(record.tokens.refreshToken ?? record.tokens.accessToken);
        await vault.remove(hash);
        pending.delete(hash);
        if (record.stateHash) states.delete(record.stateHash);
        return json(response, 200, { disconnected: true });
      }

      if (url.pathname === '/api/sync' && request.method === 'POST') {
        if (!record.tokens) return json(response, 409, { error: 'Finish Google sign-in before scanning.' });
        if (syncing.has(hash)) return json(response, 409, { error: 'A scan is already running.' });
        if (!rateLimit(request, `sync:${hash}`, 6)) return json(response, 429, { error: 'Wait a minute before scanning again.' });
        const pageToken = url.searchParams.get('pageToken') ?? undefined;
        if (pageToken && (pageToken.length > 2000 || !/^[A-Za-z0-9_+/=-]+$/.test(pageToken))) return json(response, 400, { error: 'Invalid Gmail page cursor. Start a new scan.' });
        syncing.add(hash);
        try {
          if (record.tokens.expiresAt < Date.now() + 60_000) {
            const refreshed = await google.refresh(record.tokens.refreshToken);
            record.tokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? record.tokens.refreshToken };
            await vault.set(hash, record);
          }
          const result = await syncMailbox({ api: google.api, token: record.tokens.accessToken, email: record.email, pageToken, pdfExtractor: dependencies.pdfExtractor });
          record.lastSync = result.completedAt;
          await vault.set(hash, record);
          return json(response, 200, result);
        } finally { syncing.delete(hash); }
      }
      return json(response, 404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const status = error instanceof ProviderError ? error.status : 500;
      json(response, status, { error: error instanceof ProviderError ? error.message : 'Email service could not complete the request. Try again.' });
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 30;
  return server;
}
