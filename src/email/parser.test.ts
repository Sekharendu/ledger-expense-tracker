import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEmailExpenses, parseBillingMessage, type BillingMessage } from './parser.ts';

const message = (text: string, extras: Partial<BillingMessage> = {}): BillingMessage => ({
  id: 'message-1', accountKey: 'account-1', threadId: 'thread-1', subject: 'Your invoice',
  from: 'Example Store <billing@example.com>', receivedAt: '2026-11-23T12:00:00Z', documents: [{ text }], ...extras,
});

test('extracts INR total over line items, a reference, date and provenance', () => {
  const result = parseBillingMessage(message('Invoice No: INV-123\nInvoice date: 2026-11-21\nSubtotal INR 1,000\nGST INR 180\nGrand Total INR 1,180.50\nPayment successful'));
  assert.equal(result.expenses.length, 1);
  const expense = result.expenses[0];
  assert.equal(expense.amount, 118050);
  assert.equal(expense.date, '2026-11-21');
  assert.equal(expense.status, 'review');
  assert.equal(expense.email.suggestedStatus, 'paid');
  assert.equal(expense.email.invoiceNumber, 'INV-123');
  assert.equal(expense.email.messageId, 'message-1');
  assert.ok(expense.email.sourceUrl.startsWith('https://mail.google.com/'));
});
test('handles Indian grouping and a due date without counting an unpaid invoice', () => {
  const result = parseBillingMessage(message('Invoice No: BILL-17\nAmount due: ₹1,25,000.00\nDue date: 28/11/2026'));
  assert.equal(result.expenses[0].amount, 12500000);
  assert.equal(result.expenses[0].date, '2026-11-28');
  assert.equal(result.expenses[0].email.suggestedStatus, 'unpaid');
  assert.equal(result.expenses[0].status, 'review');
});
test('refunds are separate records and cannot be treated as unpaid expenses', () => {
  const result = parseBillingMessage(message('Refund amount: INR 85.00\nRefund processed\nDate: 6 November 2026', { subject: 'Your refund' }));
  assert.equal(result.expenses[0].kind, 'refund');
  assert.equal(result.expenses[0].date, '2026-11-06');
  assert.equal(result.expenses[0].email.suggestedStatus, 'paid');
});
test('unsupported currencies, ambiguous totals and bad monetary grouping are skipped', () => {
  for (const text of ['Total: USD 25', 'Total: INR 100\nTotal: INR 200', 'Items: ₹100 and ₹200', 'Total: Rs 1,2,3.00', 'Total: INR 1.234', 'Total: 100']) {
    assert.equal(parseBillingMessage(message(text)).expenses.length, 0, text);
  }
});
test('statements and failed payments do not turn into expenses', () => {
  for (const text of ['Credit card statement\nTotal: INR 1000', 'Payment failed\nTotal: INR 250']) assert.equal(parseBillingMessage(message(text)).expenses.length, 0);
});
test('missing dates are explicit in the review note', () => {
  const expense = parseBillingMessage(message('Total: ₹499')).expenses[0];
  assert.equal(expense.date, '2026-11-23');
  assert.equal(expense.email.confidence, 'medium');
  assert.match(expense.note, /inferred from email delivery/);
});
test('same-message resync and invoice/receipt pairs preserve corrected existing records', () => {
  const first = parseBillingMessage(message('Invoice No: INV-001\nTotal: INR 500')).expenses[0];
  const corrected = { ...first, merchant: 'My corrected vendor', amount: 45000, status: 'paid' as const };
  const receipt = parseBillingMessage(message('Invoice No: INV-001\nTotal: INR 500', { id: 'message-2', subject: 'Payment receipt' })).expenses[0];
  const result = mergeEmailExpenses([corrected], [first, receipt]);
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 2);
  assert.deepEqual(result.expenses, [corrected]);
});
test('different accounts and refund transactions remain distinct', () => {
  const first = parseBillingMessage(message('Invoice No: INV-001\nTotal: INR 500')).expenses[0];
  const second = parseBillingMessage(message('Invoice No: INV-001\nTotal: INR 500', { accountKey: 'another-account' })).expenses[0];
  const refund = parseBillingMessage(message('Refund amount: INR 500', { id: 'refund', subject: 'Refund' })).expenses[0];
  assert.equal(mergeEmailExpenses([first], [second, refund]).added, 2);
});

test('a body summary and attached invoice are one purchase', () => {
  const text = 'Invoice No: INV-101\nTotal: INR 499';
  const result = parseBillingMessage(message(text, { documents: [{ text }, { text, filename: 'invoice.pdf' }] }));
  assert.equal(result.expenses.length, 1);
  assert.equal(result.expenses[0].email.attachment, 'invoice.pdf');
});
test('small unpaid balances and changed invoice amounts are not silently discarded', () => {
  const first = parseBillingMessage(message('Invoice No: INV-102\nAmount due: INR 0.01')).expenses[0];
  assert.equal(first.email.suggestedStatus, 'unpaid');
  const second = parseBillingMessage(message('Invoice No: INV-102\nAmount due: INR 20', { id: 'other-message' })).expenses[0];
  assert.equal(mergeEmailExpenses([first], [second]).added, 1);
});
