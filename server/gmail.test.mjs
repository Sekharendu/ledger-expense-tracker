import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { createGoogleClient, extractMessage, extractPdfText, GMAIL_SCOPE, ProviderError, readJson, syncMailbox } from './gmail.mjs';

const encoded = text => Buffer.from(text).toString('base64url');
const fixture = (parts, id = 'msg') => ({ id, threadId: 'thread', internalDate: String(Date.parse('2026-11-23T12:00:00Z')), payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Your invoice' }, { name: 'From', value: 'Store <billing@store.test>' }], parts } });

test('nested MIME, HTML entities and external text-body data are decoded', async () => {
  const calls = [];
  const gmail = fixture([{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { attachmentId: 'body' } }] }]);
  const result = await extractMessage(gmail, 'account', async route => { calls.push(route); return { data: encoded('<h1>Receipt</h1><p>Total: &#8377;1,299.00</p><img src="https://tracking.invalid/pixel"><p>Payment date: 2026-11-22</p>') }; }, 'token');
  assert.equal(calls.length, 1);
  assert.equal(result.expenses[0].amount, 129900);
  assert.equal(result.expenses[0].date, '2026-11-22');
});
test('PDF attachments feed the same parser, and unreadable attachments are reported', async () => {
  const gmail = fixture([{ filename: 'invoice.pdf', mimeType: 'application/pdf', body: { attachmentId: 'attachment', size: 50 } }]);
  const result = await extractMessage(gmail, 'account', async () => ({ data: encoded('pdf bytes') }), 'token', async () => 'Invoice No: PDF-123\nTotal: INR 499\nDate: 2026-11-21');
  assert.equal(result.expenses[0].amount, 49900);
  assert.equal(result.expenses[0].email.attachment, 'invoice.pdf');
  const failed = await extractMessage(gmail, 'account', async () => ({ data: encoded('bad') }), 'token', async () => { throw new Error('encrypted'); });
  assert.equal(failed.expenses.length, 0);
  assert.equal(failed.warnings.length, 1);
});
test('Gmail list pagination returns a continuation without losing messages', async () => {
  const routes = [];
  const result = await syncMailbox({ token: 'token', email: 'me@example.com', pageToken: 'page-2', api: async route => {
    routes.push(route);
    return route.startsWith('/messages?') ? { messages: [{ id: 'msg' }], nextPageToken: 'page-3' } : fixture([{ mimeType: 'text/plain', body: { data: encoded('Receipt\nTotal: INR 599') } }]);
  } });
  assert.match(routes[0], /pageToken=page-2/);
  assert.equal(result.scanned, 1);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextPageToken, 'page-3');
  assert.equal(result.expenses[0].amount, 59900);
});

test('a removed or oversized message does not block later messages or pagination', async () => {
  const result = await syncMailbox({ token: 'token', email: 'me@example.com', api: async route => {
    if (route.startsWith('/messages?')) return { messages: [{ id: 'removed' }, { id: 'oversized' }, { id: 'good' }], nextPageToken: 'continue' };
    if (route.includes('/removed?')) throw new ProviderError('not found', 404);
    if (route.includes('/oversized?')) throw new ProviderError('too large', 413);
    return fixture([{ mimeType: 'text/plain', body: { data: encoded('Receipt\nTotal: INR 499') } }], 'good');
  } });
  assert.equal(result.scanned, 3);
  assert.equal(result.expenses.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.nextPageToken, 'continue');
  assert.match(result.skipped[0].reason, /removed/);
  assert.match(result.skipped[1].reason, /size limit/);
});

test('an unreadable PDF does not discard an otherwise readable email receipt', async () => {
  const message = fixture([{ mimeType: 'text/plain', body: { data: encoded('Receipt\nTotal: INR 250') } }, { filename: 'gone.pdf', mimeType: 'application/pdf', body: { attachmentId: 'removed' } }]);
  const result = await extractMessage(message, 'account', async () => { throw new ProviderError('removed', 404); }, 'token');
  assert.equal(result.expenses[0].amount, 25000);
  assert.equal(result.warnings.length, 1);
});

test('authentication and quota errors keep the page retryable instead of skipping messages', async () => {
  for (const status of [401, 403, 429, 502]) {
    await assert.rejects(syncMailbox({ token: 'token', email: 'me@example.com', api: async route => {
      if (route.startsWith('/messages?')) return { messages: [{ id: 'message' }], nextPageToken: 'continue' };
      throw new ProviderError('provider failure', status);
    } }), error => error instanceof ProviderError && error.status === status);
  }
});

test('Gmail 403 rate-limit errors retry, while permission failures do not', async () => {
  const responses = [new Response(JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }), { status: 403 }), new Response(JSON.stringify({ messages: [] }), { status: 200 })];
  const delays = [];
  const client = createGoogleClient({ fetcher: async () => responses.shift(), sleep: async delay => { delays.push(delay); } });
  assert.deepEqual(await client.api('/messages', 'token'), { messages: [] });
  assert.deepEqual(delays, [1000]);
  let calls = 0;
  const denied = createGoogleClient({ fetcher: async () => { calls++; return new Response(JSON.stringify({ error: { errors: [{ reason: 'insufficientPermissions' }] } }), { status: 403 }); }, sleep: async () => { throw new Error('must not retry'); } });
  await assert.rejects(denied.api('/messages', 'token'), error => error.status === 403);
  assert.equal(calls, 1);
});

test('response byte limits are reported distinctly from temporary provider failures', async () => {
  await assert.rejects(readJson(new Response(JSON.stringify({ large: 'x'.repeat(100) })), 10), error => error instanceof ProviderError && error.status === 413);
});
test('authorization uses state, offline read-only access and PKCE', () => {
  const google = createGoogleClient({ clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost/callback' });
  const url = new URL(google.authorizationUrl('state', 'challenge'));
  assert.equal(url.searchParams.get('scope'), GMAIL_SCOPE);
  assert.equal(url.searchParams.get('state'), 'state');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
});

test('deadline commits completed messages and resumes remaining IDs without relisting or duplicates', async () => {
  const controller = new AbortController();
  const receipt = id => fixture([{ mimeType: 'text/plain', body: { data: encoded('Receipt\nTotal: INR 599') } }], id);
  const first = await syncMailbox({ email: 'me@example.com', token: 'token', signal: controller.signal, api: async route => {
    if (route.startsWith('/messages?')) return { messages: [{ id: 'first' }, { id: 'second' }], nextPageToken: 'google-page-2' };
    if (route.includes('/second?')) { controller.abort(); throw controller.signal.reason; }
    return receipt('first');
  } });
  assert.equal(first.scanned, 1);
  assert.equal(first.expenses.length, 1);
  assert.equal(first.skipped.length, 0);
  const cursor = JSON.parse(Buffer.from(first.nextPageToken.split(':')[1], 'base64url').toString());
  assert.deepEqual(cursor, { messages: [{ id: 'second' }], nextPageToken: 'google-page-2' });
  const second = await syncMailbox({ email: 'me@example.com', token: 'token', pageToken: first.nextPageToken, api: async route => {
    assert.match(route, /^\/messages\/second\?/);
    return receipt('second');
  } });
  assert.equal(second.scanned, 1);
  assert.equal(second.nextPageToken, 'google-page-2');
  assert.equal(new Set([...first.expenses, ...second.expenses].map(expense => expense.id)).size, 2);
});

test('a stalled first message produces a bounded retryable error instead of empty success', async () => {
  let requestSignal;
  await assert.rejects(syncMailbox({ email: 'me@example.com', budgetMs: 20, api: async (route, token, limit, { signal }) => {
    if (route.startsWith('/messages?')) return { messages: [{ id: 'slow' }] };
    requestSignal = signal;
    return new Promise(() => {});
  } }), error => error instanceof ProviderError && error.status === 504 && /manually/.test(error.message));
  assert.equal(requestSignal.aborted, true);
});

test('PDF deadline never imports partial documents or silently skips the interrupted message', async () => {
  const controller = new AbortController();
  const message = fixture([{ mimeType: 'text/plain', body: { data: encoded('Receipt\nTotal: INR 999') } }, { mimeType: 'application/pdf', filename: 'slow.pdf', body: { data: encoded('pdf') } }]);
  await assert.rejects(syncMailbox({ email: 'me@example.com', signal: controller.signal, api: async route => route.startsWith('/messages?') ? { messages: [{ id: 'msg' }] } : message, pdfExtractor: async (bytes, { signal }) => {
    assert.equal(signal.aborted, false);
    controller.abort();
    throw controller.signal.reason;
  } }), error => error.status === 504);
  const retried = await syncMailbox({ email: 'me@example.com', api: async route => route.startsWith('/messages?') ? { messages: [{ id: 'msg' }] } : message, pdfExtractor: async () => 'Receipt\nTotal: INR 999' });
  assert.equal(retried.scanned, 1);
  assert.equal(retried.expenses.length, 1);
  assert.equal(retried.hasMore, false);
});

test('scan cancellation interrupts Gmail retry backoff and terminates real PDF workers', async () => {
  const controller = new AbortController();
  let requests = 0;
  const client = createGoogleClient({ fetcher: async () => {
    requests++;
    return new Response('{}', { status: 429 });
  }, sleep: async () => { controller.abort(); } });
  await assert.rejects(client.api('/messages', 'token', undefined, { signal: controller.signal }));
  assert.equal(requests, 1);
  const pdfController = new AbortController();
  const reason = new Error('scan deadline');
  const extraction = extractPdfText(textPdf('Invoice Total: INR 1499.00'), { signal: pdfController.signal });
  pdfController.abort(reason);
  await assert.rejects(extraction, error => error === reason);
});

test('a provider request timeout stays retryable instead of marking an email skipped', async () => {
  const client = createGoogleClient({ fetcher: async () => { throw new DOMException('request timed out', 'TimeoutError'); } });
  await assert.rejects(syncMailbox({ email: 'me@example.com', api: async (...args) => args[0].startsWith('/messages?') ? { messages: [{ id: 'slow' }] } : client.api(...args) }), error => error instanceof ProviderError && error.status === 502);
});

function textPdf(text) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
test('real PDF text extraction reads an invoice and rejects invalid PDFs', async () => {
  const text = await extractPdfText(textPdf('Invoice Total: INR 1499.00'));
  assert.match(text, /INR 1499.00/);
  await assert.rejects(extractPdfText(Buffer.from('not a pdf')));
});
