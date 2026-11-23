import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { createGoogleClient, extractMessage, extractPdfText, GMAIL_SCOPE, syncMailbox } from './gmail.mjs';

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
test('authorization uses state, offline read-only access and PKCE', () => {
  const google = createGoogleClient({ clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost/callback' });
  const url = new URL(google.authorizationUrl('state', 'challenge'));
  assert.equal(url.searchParams.get('scope'), GMAIL_SCOPE);
  assert.equal(url.searchParams.get('state'), 'state');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
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
