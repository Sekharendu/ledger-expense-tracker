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
  assert.equal(expense.status, 'paid');
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
  assert.equal(result.expenses[0].status, 'review');
  const partial = parseBillingMessage(message('Grand Total INR 100\nRefund amount INR 10\nRefund completed\nDate: 2026-11-10', { subject: 'Partial refund' })).expenses[0];
  assert.equal(partial.amount, 1000);
  assert.equal(partial.status, 'review');
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

test('Indian GST PDF totals use rupee context without requiring an inline currency symbol', () => {
  const text = 'Invoice No. : TEST-123\nInvoice Date : 10-11-2026\nSub Total 1.000 10.00 0.00 10.00\nTotal Invoice Amount in Words:\nTen Rupees Only Total Amount Before Tax 10.00\nTotal CGST 0.00\nTotal SGST/UTGST 0.00\nTotal Amount After Tax 10.00\nTotal Invoice Amount 10.00\nPetty Cash Payment 10.00';
  const result = parseBillingMessage(message('', { subject: 'Fwd: Invoice', documents: [{ text: 'Please find the attached invoice.' }, { text, filename: 'invoice.pdf' }] }));
  assert.equal(result.expenses.length, 1);
  const expense = result.expenses[0];
  assert.equal(expense.amount, 1000);
  assert.equal(expense.date, '2026-11-10');
  assert.equal(expense.email.invoiceNumber, 'TEST-123');
  assert.equal(expense.email.attachment, 'invoice.pdf');
  assert.equal(expense.email.confidence, 'medium');
  assert.equal(expense.status, 'paid');
  assert.equal(expense.email.payment?.method, 'cash');
  assert.equal(expense.email.payment?.amountPaid, 1000);
  assert.match(expense.email.payment?.evidence ?? '', /Petty Cash Payment/);
  assert.match(expense.note, /verify the currency/);
  assert.equal(mergeEmailExpenses([expense], result.expenses).added, 0);
});

test('contextual totals exclude subtotal and tax rows, and reject conflicting final amounts', () => {
  const context = 'Currency: INR\nSub Total 100.00\nTotal CGST 9.00\nTotal SGST 9.00\n';
  assert.equal(parseBillingMessage(message(`${context}Total Amount After Tax 118.00\nTotal Invoice Amount 118.00`)).expenses[0].amount, 11800);
  assert.equal(parseBillingMessage(message(`${context}Total Invoice Amount\n118.00`)).expenses[0].amount, 11800);
  assert.equal(parseBillingMessage(message(`${context}Grand Total 118.00\nTotal Invoice Amount 119.00`)).expenses.length, 0);
  assert.equal(parseBillingMessage(message(context)).expenses.length, 0);
});

test('bare totals and non-Indian rupees are not inferred as INR', () => {
  for (const text of ['Total Invoice Amount 10.00', 'Ten Rupees Only\nTotal Invoice Amount 10.00', 'CGST 0.00\nSGST 0.00\nTotal Invoice Amount 10.00', 'Ten Rupees Only\nCGST 0.00\nSGST 0.00\nTotal Invoice Amount 1,2,3.00', 'PKR\nTen Rupees Only\nCGST 0.00\nSGST 0.00\nTotal Invoice Amount 10.00']) {
    assert.equal(parseBillingMessage(message(text)).expenses.length, 0, text);
  }
});

test('payment facts preserve final invoice totals and partial payments stay in review', () => {
  const expense = parseBillingMessage(message('Invoice No: TEST-PARTIAL\nInvoice date: 2026-11-10\nGrand Total INR 100.00\nAmount Paid INR 50.00\nBalance Due INR 50.00\nPayment successful')).expenses[0];
  assert.equal(expense.amount, 10000);
  assert.equal(expense.status, 'review');
  assert.equal(expense.email.payment?.amountPaid, 5000);
  assert.equal(expense.email.payment?.balanceDue, 5000);
  assert.notEqual(expense.email.suggestedStatus, 'paid');
});

test('automatic paid status needs payment evidence and a document date', () => {
  const expense = parseBillingMessage(message('Total INR 100.00\nPayment successful')).expenses[0];
  assert.equal(expense.status, 'review');
  assert.equal(expense.email.suggestedStatus, 'paid');
  const invoice = parseBillingMessage(message('Invoice date: 2026-11-10\nTotal INR 100.00')).expenses[0];
  assert.equal(invoice.status, 'review');
  const receipt = parseBillingMessage(message('Receipt date: 2026-11-10\nTotal INR 100.00')).expenses[0];
  assert.equal(receipt.status, 'review');
  const paid = parseBillingMessage(message('Invoice date: 2026-11-10\nPayment date: 2026-11-12\nTotal INR 100.00\nPayment status: paid')).expenses[0];
  assert.equal(paid.status, 'paid');
  assert.equal(paid.date, '2026-11-12');
  const dueFirst = parseBillingMessage(message('Due date: 2026-12-01\nInvoice date: 2026-11-10\nTotal INR 100.00\nPayment status: paid')).expenses[0];
  assert.equal(dueFirst.date, '2026-11-10');
  const dueOnly = parseBillingMessage(message('Due date: 2026-12-01\nTotal INR 100.00\nPayment status: paid')).expenses[0];
  assert.equal(dueOnly.status, 'review');
});

test('body payment evidence transfers only to an attachment with the same invoice and amount', () => {
  const body = 'Invoice No: TEST-LINKED\nPayment date: 2026-11-12\nTotal INR 100.00\nPayment received';
  const pdf = 'Invoice No: TEST-LINKED\nInvoice date: 2026-11-10\nGrand Total INR 100.00';
  const result = parseBillingMessage(message('', { documents: [{ text: body }, { text: pdf, filename: 'invoice.pdf' }] }));
  assert.equal(result.expenses.length, 1);
  assert.equal(result.expenses[0].status, 'paid');
  assert.equal(result.expenses[0].date, '2026-11-12');
  assert.equal(result.expenses[0].email.paymentSource, 'email');
  const unrelated = parseBillingMessage(message('', { subject: 'Payment successful', documents: [{ text: pdf, filename: 'invoice.pdf' }] }));
  assert.equal(unrelated.expenses[0].status, 'review');
  const pending = parseBillingMessage(message('', { documents: [{ text: body }, { text: pdf + '\nPayment pending', filename: 'invoice.pdf' }] }));
  assert.equal(pending.expenses[0].status, 'review');
});
