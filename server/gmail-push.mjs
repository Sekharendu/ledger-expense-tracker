import { Buffer } from 'node:buffer';
import { OAuth2Client } from 'google-auth-library';
import { ProviderError } from './gmail.mjs';

export const PUSH_PATH = '/api/gmail/notifications';
const canonicalAudience = `https://ledger-expense-tracker-sekharendus-projects.vercel.app${PUSH_PATH}`;

export function pushConfigured(config) {
  const topic = config.pubsubTopic?.match(/^projects\/([a-z][a-z0-9-]{4,61}[a-z0-9])\/topics\/([A-Za-z][A-Za-z0-9._~-]{2,254})$/);
  const subscription = config.pubsubSubscription?.match(/^projects\/([^/]+)\/subscriptions\/[A-Za-z][A-Za-z0-9._~-]{2,254}$/);
  return Boolean(topic && subscription && topic[1] === subscription[1] && config.pubsubAudience === canonicalAudience && /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(config.pubsubServiceAccount ?? ''));
}

export function createPushVerifier(config, client = new OAuth2Client()) {
  return async token => {
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience: config.pubsubAudience });
      const claims = ticket.getPayload();
      return Boolean(claims?.email_verified === true && claims.email === config.pubsubServiceAccount && claims.aud === config.pubsubAudience);
    } catch { return false; }
  };
}

async function bodyOf(request) {
  const limit = 64 * 1024;
  if (request.body !== undefined) {
    const raw = typeof request.body === 'string' || Buffer.isBuffer(request.body) ? request.body.toString() : JSON.stringify(request.body);
    if (!raw || Buffer.byteLength(raw) > limit) throw new ProviderError('Notification is too large.', 413);
    try { return JSON.parse(raw); } catch { throw new ProviderError('Invalid notification.', 400); }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ProviderError('Notification is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProviderError('Invalid notification.', 400); }
}

export function createNotificationReceiver(config, { store, scan, verifyToken = createPushVerifier(config) }) {
  return async request => {
    if (!pushConfigured(config)) throw new ProviderError('Gmail notifications are not configured.', 503);
    if (request.method !== 'POST') throw new ProviderError('Use POST for Gmail notifications.', 405);
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token || !await verifyToken(token)) throw new ProviderError('Invalid notification identity.', 401);
    const body = await bodyOf(request);
    if (body?.subscription !== config.pubsubSubscription) throw new ProviderError('Unexpected notification subscription.', 403);
    const data = body.message?.data;
    if (typeof data !== 'string' || data.length > 8192 || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(data)) throw new ProviderError('Invalid notification payload.', 400);
    let payload;
    try { payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8')); } catch { throw new ProviderError('Invalid notification payload.', 400); }
    if (typeof payload?.emailAddress !== 'string' || payload.emailAddress.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.emailAddress) || typeof payload.historyId !== 'string' || !/^\d{1,30}$/.test(payload.historyId)) throw new ProviderError('Invalid mailbox notification.', 400);
    const connection = await store.connectionByEmail(payload.emailAddress.toLowerCase());
    // Late notifications after disconnect/deletion need no retry and must not scan.
    if (!connection?.enabled || connection.status !== 'connected') return;
    try { await scan(connection.user_id); }
    catch (error) {
      // A busy lease or transient provider failure is retried by Pub/Sub.
      if (error instanceof ProviderError && error.status === 401) return;
      throw new ProviderError('Mailbox processing is pending. Retry this notification.', 503);
    }
  };
}

export function createWatchManager(config, { store, cipher, google, now = Date.now }) {
  return {
    async ensure(userId) {
      if (!pushConfigured(config)) return false;
      const connection = await store.connection(userId);
      if (!connection?.enabled || connection.status !== 'connected' || !connection.encrypted_tokens) return false;
      const time = now();
      if (connection.gmail_watch_topic === config.pubsubTopic && !connection.gmail_watch_error && Date.parse(connection.gmail_watch_expires_at) > time + 24 * 60 * 60_000 && Date.parse(connection.gmail_watch_attempted_at) > time - 24 * 60 * 60_000) return true;
      if (Date.parse(connection.gmail_watch_attempted_at) > time - 15 * 60_000) return false;
      const attempted = { gmail_watch_attempted_at: new Date(time).toISOString() };
      const signal = AbortSignal.timeout(20_000);
      try {
        if (!await store.updateWatch(userId, connection.email, attempted)) return false;
        let tokens = cipher.open(connection.encrypted_tokens);
        if (tokens.expiresAt < time + 60_000) {
          const fresh = await google.refresh(tokens.refreshToken, { signal });
          tokens = { ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken };
          if (!await store.updateWatchTokens(userId, connection.email, connection.encrypted_tokens, cipher.seal(tokens))) return false;
        }
        const result = await google.watch(tokens.accessToken, config.pubsubTopic, { signal });
        const expires = Number(result.expiration);
        if (!Number.isSafeInteger(expires) || expires <= time || !/^\d{1,30}$/.test(result.historyId ?? '')) throw new Error('Invalid watch response');
        const saved = await store.updateWatch(userId, connection.email, { ...attempted, gmail_watch_topic: config.pubsubTopic, gmail_watch_expires_at: new Date(expires).toISOString(), gmail_watch_history_id: result.historyId, gmail_watch_error: null });
        if (!saved) await google.stopWatch(tokens.accessToken, { signal }).catch(() => {});
        return Boolean(saved);
      } catch {
        await store.updateWatch(userId, connection.email, { ...attempted, gmail_watch_error: 'New-mail notifications could not be renewed. Scheduled checks remain available.' }).catch(() => {});
        return false;
      }
    },
    async stop(connection) {
      if (!connection?.encrypted_tokens || !connection.gmail_watch_topic) return;
      const tokens = cipher.open(connection.encrypted_tokens);
      await google.stopWatch(tokens.accessToken, { signal: AbortSignal.timeout(20_000) });
    },
  };
}
