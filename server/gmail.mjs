import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Worker } from 'node:worker_threads';
import { convert } from 'html-to-text';
import { parseBillingMessage } from '../src/email/parser.ts';
import { OAuth2Client } from 'google-auth-library';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export async function readJson(response, limit = 16 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('Empty response from provider.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ProviderError('Email or attachment exceeds the import size limit.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export function createGoogleClient({ clientId, clientSecret, redirectUri, fetcher = fetch }) {
  async function tokenRequest(parameters) {
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await readJson(response, 64 * 1024);
    if (!response.ok || typeof data.access_token !== 'string') throw new ProviderError(data.error === 'invalid_grant' ? 'Gmail access expired or was revoked. Disconnect and reconnect your account.' : 'Google could not authorize this connection. Check the OAuth configuration and try again.', data.error === 'invalid_grant' ? 401 : 502);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000, scope: data.scope, idToken: data.id_token };
  }
  async function api(pathname, accessToken, limit) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetcher(`${API}${pathname}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt)); continue; }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new ProviderError('Gmail access expired or was revoked. Reconnect your account.', 401);
        if (response.status === 403) throw new ProviderError('Google denied Gmail access. Enable the Gmail API and grant read-only email permission.', 403);
        throw new ProviderError(response.status === 429 ? 'Gmail rate limit reached. Wait a minute before syncing again.' : 'Gmail could not load a message. Please try again.', response.status === 429 ? 429 : 502);
      }
      return readJson(response, limit);
    }
  }
  return {
    authorizationUrl(state, challenge, nonce) {
      const parameters = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: nonce ? `openid email ${GMAIL_SCOPE}` : GMAIL_SCOPE, access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256', ...(nonce ? { nonce } : {}) });
      return `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`;
    },
    async identity(idToken, nonce) {
      const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken, audience: clientId });
      const identity = ticket.getPayload();
      if (!identity?.sub || !identity.email_verified || identity.nonce !== nonce) throw new ProviderError('Google could not verify the connected mailbox identity.', 403);
      return identity;
    },
    exchange: (code, verifier) => tokenRequest({ code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    refresh: refreshToken => tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
    profile: accessToken => api('/profile', accessToken, 64 * 1024),
    async revoke(token) {
      const response = await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(20_000) });
      await response.body?.cancel();
      if (!response.ok && response.status !== 400) throw new ProviderError('Could not revoke access at Google. Retry disconnect, or revoke Ledger in your Google account permissions.');
    },
    api,
  };
}

function flatten(part, output = []) {
  if (!part) return output;
  output.push(part);
  for (const child of part.parts ?? []) flatten(child, output);
  return output;
}

export async function extractPdfText(bytes) {
  if (bytes.length > MAX_PDF_BYTES) throw new Error('PDF exceeds 8 MB.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const timeout = setTimeout(() => { reject(new Error('PDF processing timed out.')); void worker.terminate(); }, 20_000);
    worker.once('message', result => { clearTimeout(timeout); if (result.error) reject(new Error(result.error)); else resolve(result.text); void worker.terminate(); });
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
    worker.once('exit', code => { clearTimeout(timeout); if (code !== 0) reject(new Error('PDF worker stopped.')); });
  });
}

export async function extractMessage(message, accountKey, api, token, pdfExtractor = extractPdfText) {
  const header = name => message.payload?.headers?.find(value => value.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  const parts = flatten(message.payload);
  const documents = [];
  const warnings = [];
  const plain = parts.filter(part => part.mimeType === 'text/plain' && !part.filename);
  const html = parts.filter(part => part.mimeType === 'text/html' && !part.filename);
  const bodyParts = plain.length ? plain : html;
  let body = '';
  for (const part of bodyParts.slice(0, 10)) {
    if ((part.body?.size ?? 0) > 1_000_000) { warnings.push('Email body exceeds the text import limit.'); continue; }
    const data = part.body?.data ?? (part.body?.attachmentId ? (await api(`/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, token)).data : '');
    const bytes = Buffer.from(data ?? '', 'base64url');
    if (bytes.length > 1_000_000) { warnings.push('Email body exceeds the text import limit.'); continue; }
    const charset = part.headers?.find(value => value.name.toLowerCase() === 'content-type')?.value?.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1] ?? 'utf-8';
    let text;
    try { text = new TextDecoder(charset).decode(bytes); } catch { text = bytes.toString('utf8'); }
    body += (part.mimeType === 'text/html' ? convert(text, { wordwrap: false, preserveNewlines: true, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }] }) : text) + '\n';
  }
  if (body.trim()) documents.push({ text: body.slice(0, 250_000) });
  const pdfs = parts.filter(part => part.mimeType === 'application/pdf' || /\.pdf$/i.test(part.filename ?? ''));
  for (const part of pdfs.slice(0, 5)) {
    try {
      if ((part.body?.size ?? 0) > MAX_PDF_BYTES) throw new Error('PDF exceeds 8 MB.');
      const data = part.body?.data ?? (part.body?.attachmentId ? (await api(`/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, token)).data : null);
      if (!data) throw new Error('PDF data unavailable.');
      const text = await pdfExtractor(Buffer.from(data, 'base64url'));
      documents.push({ text, filename: (part.filename || 'invoice.pdf').slice(0, 150) });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      warnings.push('PDF could not be read (encrypted, scanned, too large, or invalid). Review the source email.');
    }
  }
  if (pdfs.length > 5) warnings.push('Only the first five PDF attachments were scanned.');
  const receivedAt = new Date(Number(message.internalDate));
  if (Number.isNaN(receivedAt.getTime())) throw new Error('Invalid message date');
  const result = parseBillingMessage({ id: message.id, threadId: message.threadId, accountKey, subject: header('Subject'), from: header('From'), receivedAt: receivedAt.toISOString(), documents });
  return { ...result, warnings, subject: header('Subject') };
}

export async function syncMailbox({ api, token, email, pageToken, pdfExtractor }) {
  const accountKey = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 20);
  const query = 'newer_than:90d -in:spam -in:trash -in:sent {invoice receipt bill "payment successful" "payment received" "order confirmation" refund}';
  const parameters = new URLSearchParams({ q: query, maxResults: '25' });
  if (pageToken) parameters.set('pageToken', pageToken);
  const list = await api(`/messages?${parameters}`, token, 256 * 1024);
  const expenses = [];
  const skipped = [];
  for (const reference of list.messages ?? []) {
    try {
      const message = await api(`/messages/${encodeURIComponent(reference.id)}?format=full`, token);
      const result = await extractMessage(message, accountKey, api, token, pdfExtractor);
      expenses.push(...result.expenses);
      for (const reason of result.warnings) skipped.push({ messageId: reference.id, subject: result.subject.slice(0, 250), reason });
      if (!result.expenses.length) skipped.push({ messageId: reference.id, subject: result.subject.slice(0, 250), reason: result.reasons[0] ?? 'No readable invoice text or supported attachment.' });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      skipped.push({ messageId: reference.id, subject: 'Message could not be processed', reason: 'Could not extract this message. Review it in Gmail.' });
    }
  }
  return { expenses, skipped, scanned: (list.messages ?? []).length, hasMore: Boolean(list.nextPageToken), nextPageToken: list.nextPageToken, completedAt: new Date().toISOString() };
}
