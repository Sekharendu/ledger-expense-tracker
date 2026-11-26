import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { convert } from 'html-to-text';
import { parseBillingMessage } from '../src/email/parser.ts';
import { OAuth2Client } from 'google-auth-library';
import { GMAIL_PROCESSOR_VERSION } from './gmail-version.mjs';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const CURSOR_PREFIX = 'ledger-scan-v1:';
export const SCAN_BUDGET_MS = 90_000;

function abortable(operation, signal) {
  if (!signal) return operation;
  if (signal.aborted) { Promise.resolve(operation).catch(() => {}); signal.throwIfAborted(); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

// The content itself cannot be read (encrypted, oversized, malformed). Retrying will not help,
// unlike timeouts or a crashed worker, which are retried on the next scan.
export class UnreadableContentError extends Error {}

const IMPORTED_FIELDS = ['merchant', 'amount', 'date', 'category', 'status', 'kind', 'note'];
// Records what the scanner wrote so a later processor version can replace the record only while the user has not edited it.
function tagImport(expense) {
  const imported = Object.fromEntries(IMPORTED_FIELDS.map(field => [field, expense[field] ?? null]));
  return { ...expense, email: { ...expense.email, processorVersion: GMAIL_PROCESSOR_VERSION, imported } };
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
      if (size > limit) throw new ProviderError('Email or attachment exceeds the import size limit.', 413);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export function createGoogleClient({ clientId, clientSecret, redirectUri, fetcher = fetch, sleep = (ms, { signal } = {}) => delay(ms, undefined, { signal }) }) {
  async function tokenRequest(parameters, signal) {
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: clientId, client_secret: clientSecret }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    const data = await readJson(response, 64 * 1024);
    if (!response.ok || typeof data.access_token !== 'string') throw new ProviderError(data.error === 'invalid_grant' ? 'Gmail access expired or was revoked. Disconnect and reconnect your account.' : 'Google could not authorize this connection. Check the OAuth configuration and try again.', data.error === 'invalid_grant' ? 401 : 502);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000, scope: data.scope, idToken: data.id_token };
  }
  async function api(...args) {
    try { return await requestApi(...args); }
    catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('Gmail could not finish loading this email. Retry syncing.', 502);
    }
  }
  async function requestApi(pathname, accessToken, limit, { signal, method, body } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      const response = await fetcher(`${API}${pathname}`, { ...(method ? { method } : {}), headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
      if (!response.ok) {
        const detail = await readJson(response, 64 * 1024).catch(() => null);
        signal?.throwIfAborted();
        const reasons = Array.isArray(detail?.error?.errors) ? detail.error.errors.map(error => error.reason) : [];
        const rateLimited = response.status === 429 || (response.status === 403 && reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)));
        if ((rateLimited || response.status >= 500) && attempt < 2) { await abortable(sleep(1000 * 2 ** attempt, { signal }), signal); continue; }
        if (response.status === 401) throw new ProviderError('Gmail access expired or was revoked. Reconnect your account.', 401);
        if (response.status === 400) throw new ProviderError('Gmail rejected this request or its expired page token.', 400);
        if (response.status === 404) throw new ProviderError('The Gmail message or attachment is no longer available.', 404);
        if (rateLimited) throw new ProviderError('Gmail rate limit reached. Wait a minute before syncing again.', 429);
        if (response.status === 403 && reasons.includes('dailyLimitExceeded')) throw new ProviderError('The Gmail API daily quota has been reached. Try syncing later.', 429);
        if (response.status === 403) throw new ProviderError('Google denied Gmail access. Enable the Gmail API and grant read-only email permission.', 403);
        throw new ProviderError('Gmail could not load a message. Please try again.', 502);
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
    refresh: (refreshToken, { signal } = {}) => tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }, signal),
    profile: accessToken => api('/profile', accessToken, 64 * 1024),
    watch: (accessToken, topicName, { signal } = {}) => api('/watch', accessToken, 64 * 1024, { signal, method: 'POST', body: { topicName } }),
    stopWatch: (accessToken, { signal } = {}) => api('/stop', accessToken, 64 * 1024, { signal, method: 'POST' }),
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

export async function extractPdfText(bytes, { signal } = {}) {
  signal?.throwIfAborted();
  if (bytes.length > MAX_PDF_BYTES) throw new UnreadableContentError('PDF exceeds 8 MB.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const abort = () => { clearTimeout(timeout); reject(signal.reason); void worker.terminate(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { reject(new Error('PDF processing timed out.')); void worker.terminate(); }, 20_000);
    // Node's watch mode posts its own messages from workers, so wait for the extractor's result shape.
    worker.on('message', result => {
      if (typeof result?.text !== 'string' && typeof result?.error !== 'string') return;
      clearTimeout(timeout); if (typeof result.error === 'string') reject(new UnreadableContentError(result.error)); else resolve(result.text); void worker.terminate();
    });
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
    worker.once('exit', code => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); if (code !== 0) reject(new Error('PDF worker stopped.')); });
  });
}

export async function extractMessage(message, accountKey, api, token, pdfExtractor = extractPdfText, { signal } = {}) {
  const header = name => message.payload?.headers?.find(value => value.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  const parts = flatten(message.payload);
  const documents = [];
  const warnings = [];
  let retryable = false;
  const plain = parts.filter(part => part.mimeType === 'text/plain' && !part.filename);
  const html = parts.filter(part => part.mimeType === 'text/html' && !part.filename);
  const bodyParts = plain.length ? plain : html;
  let body = '';
  for (const part of bodyParts.slice(0, 10)) {
    signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    try {
      if ((part.body?.size ?? 0) > MAX_PDF_BYTES) throw new UnreadableContentError('PDF exceeds 8 MB.');
      const data = part.body?.data ?? (part.body?.attachmentId ? (await api(`/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, token)).data : null);
      if (!data) throw new UnreadableContentError('PDF data unavailable.');
      const text = await abortable(pdfExtractor(Buffer.from(data, 'base64url'), { signal }), signal);
      documents.push({ text, filename: (part.filename || 'invoice.pdf').slice(0, 150) });
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProviderError && ![404, 413].includes(error.status)) throw error;
      if (error instanceof UnreadableContentError || error instanceof ProviderError) warnings.push('PDF could not be read (encrypted, scanned, too large, or invalid). Review the source email.');
      else { retryable = true; warnings.push('PDF could not be read this time (timed out or the reader stopped). It will be retried on the next scan.'); }
    }
  }
  if (pdfs.length > 5) warnings.push('Only the first five PDF attachments were scanned.');
  const receivedAt = new Date(Number(message.internalDate));
  if (Number.isNaN(receivedAt.getTime())) throw new UnreadableContentError('Invalid message date');
  const result = parseBillingMessage({ id: message.id, threadId: message.threadId, accountKey, subject: header('Subject'), from: header('From'), receivedAt: receivedAt.toISOString(), documents });
  return { ...result, warnings, retryable, subject: header('Subject') };
}

export async function syncMailbox({ budgetMs = SCAN_BUDGET_MS, signal: parentSignal, ...options }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Mailbox scan budget reached.')), budgetMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  try { return await syncPage({ ...options, signal }); }
  catch (error) {
    if (signal.aborted) throw new ProviderError('This billing email could not finish within the scan time limit. Retry syncing; if it keeps failing, review the source email and add its expenses manually.', 504);
    throw error;
  }
  finally { clearTimeout(timer); }
}

async function syncPage({ api: providerApi, token, email, pageToken, pdfExtractor, signal, getProcessed }) {
  const api = (path, accessToken, limit) => { signal.throwIfAborted(); return abortable(providerApi(path, accessToken, limit, { signal }), signal); };
  const accountKey = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 20);
  const query = 'newer_than:90d -in:spam -in:trash -in:sent {invoice receipt bill "payment successful" "payment received" "order confirmation" refund}';
  const parameters = new URLSearchParams({ q: query, maxResults: '25' });
  const continuation = pageToken?.startsWith(CURSOR_PREFIX) ? JSON.parse(Buffer.from(pageToken.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8')) : null;
  if (pageToken && !continuation) parameters.set('pageToken', pageToken);
  let list;
  if (getProcessed) {
    const headParameters = new URLSearchParams({ q: query, maxResults: '25' });
    const head = await api(`/messages?${headParameters}`, token, 256 * 1024);
    if (continuation) list = continuation;
    else if (pageToken) {
      try { list = await api(`/messages?${parameters}`, token, 256 * 1024); }
      catch (error) {
        if (!(error instanceof ProviderError) || ![400, 404].includes(error.status)) throw error;
        list = head; // Restart an expired provider cursor; processed IDs prevent reimports.
      }
    } else list = head;
    const ids = [...new Set([...(head.messages ?? []), ...(list.messages ?? [])].map(item => item.id))];
    list = { ...list, messages: ids.map(id => ({ id })) };
  } else list = continuation ?? await api(`/messages?${parameters}`, token, 256 * 1024);
  const processed = new Set(getProcessed ? await getProcessed((list.messages ?? []).map(item => item.id)) : []);
  const expenses = [];
  const skipped = [];
  const processedMessageIds = [];
  let scanned = 0;
  for (const reference of list.messages ?? []) {
    if (processed.has(reference.id)) { scanned++; continue; }
    try {
      const message = await api(`/messages/${encodeURIComponent(reference.id)}?format=full`, token);
      const result = await extractMessage(message, accountKey, api, token, pdfExtractor, { signal });
      signal.throwIfAborted();
      if (result.retryable) {
        // Importing the readable part now would leave the failed attachment unimported for good, so wait for a full read.
        skipped.push({ messageId: reference.id, subject: result.subject.slice(0, 250), reason: 'An attachment could not be read this time. This email will be retried on the next scan.' });
        scanned++;
        continue;
      }
      expenses.push(...result.expenses.map(tagImport));
      for (const reason of result.warnings) skipped.push({ messageId: reference.id, subject: result.subject.slice(0, 250), reason });
      if (!result.expenses.length) skipped.push({ messageId: reference.id, subject: result.subject.slice(0, 250), reason: result.reasons[0] ?? 'No readable invoice text or supported attachment.' });
    } catch (error) {
      if (signal.aborted) break; // Retry this whole message; its partial extraction is never committed.
      if (error instanceof ProviderError && ![404, 413].includes(error.status)) throw error;
      const permanent = error instanceof ProviderError || error instanceof UnreadableContentError;
      const reason = error instanceof ProviderError && error.status === 404 ? 'Message or attachment was removed before it could be imported.' : error instanceof ProviderError && error.status === 413 ? 'Message exceeds the import size limit. Review it in Gmail.' : permanent ? 'Could not extract this message. Review it in Gmail.' : 'Could not extract this message this time. It will be retried on the next scan.';
      skipped.push({ messageId: reference.id, subject: 'Message could not be processed', reason });
      if (!permanent) { scanned++; continue; } // Unexpected errors may be transient or fixed by an update, so leave the message unprocessed.
    }
    processedMessageIds.push(reference.id);
    scanned++;
  }
  if (signal.aborted && !processedMessageIds.length) throw new ProviderError('This billing email could not finish within the scan time limit. Retry syncing; if it keeps failing, review the source email and add its expenses manually.', 504);
  const remaining = (list.messages ?? []).slice(scanned);
  const nextPageToken = remaining.length ? CURSOR_PREFIX + Buffer.from(JSON.stringify({ messages: remaining, nextPageToken: list.nextPageToken })).toString('base64url') : list.nextPageToken;
  return { expenses, skipped, scanned, processedMessageIds, processorVersion: GMAIL_PROCESSOR_VERSION, hasMore: Boolean(nextPageToken), nextPageToken, completedAt: new Date().toISOString() };
}
