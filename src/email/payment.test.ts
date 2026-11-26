import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPayment } from './payment.ts';

test('explicit success and matching cash/card/UPI amounts prove payment in integer paise', () => {
  for (const text of ['Payment successful', 'Payment received', 'Payment status: paid', 'Paid in full', 'Petty Cash Payment 10.00', 'Card Payment: INR 10.00', 'UPI payment ₹10.00', 'Amount paid: Rs. 10.00']) {
    const result = classifyPayment(text, 1000, 'expense');
    assert.equal(result.status, 'paid', text);
    assert.equal(result.confirmed, true);
    assert.ok(result.evidence && text.includes(result.evidence));
  }
  const cash = classifyPayment('Petty Cash Payment 10.00', 1000, 'expense');
  assert.equal(cash.method, 'cash');
  assert.equal(cash.amountPaid, 1000);
});

test('partial, conflicting amounts, and positive due override payment success', () => {
  for (const text of ['Payment successful\nAmount paid INR 5.00', 'Payment successful\nPartial payment', 'Card Payment 10.00\nUPI Payment 5.00', 'Amount paid 10.00\nBalance due 0.00\nBalance due 1.00']) {
    assert.equal(classifyPayment(text, 1000, 'expense').status, 'review', text);
  }
  const unpaid = classifyPayment('Payment successful\nBalance due INR 5.00', 1000, 'expense');
  assert.equal(unpaid.status, 'unpaid');
  assert.equal(unpaid.balanceDue, 500);
  assert.equal(unpaid.confirmed, false);
});

test('pending, failed, reversed, and negated statements cannot prove payment', () => {
  for (const text of ['Payment pending', 'Payment failed', 'Payment not received', 'Payment was not successful', 'Not paid in full', 'Payment reversed', 'Payment status: declined', 'Transaction unsuccessful', 'Paid successfully\nPayment pending']) {
    const result = classifyPayment(text, 1000, 'expense');
    assert.equal(result.status, 'review', text);
    assert.equal(result.confirmed, false);
  }
});

test('generic receipts, instructions, method labels and zero due are insufficient proof', () => {
  for (const text of ['Invoice\nTotal INR 10', 'Receipt\nTotal INR 10', 'Payment method: card', 'Payment instructions: pay by UPI', 'Balance due INR 0.00', 'Cash Payment Instructions: 10.00', 'Please make Card Payment 10.00', 'Payment instructions\nUPI payment INR 10.00', 'Amount paid 1,00.00']) {
    assert.equal(classifyPayment(text, 1000, 'expense').status, 'review', text);
  }
});

test('refund needs completed or received proof, and pending or issued alone stays review', () => {
  for (const text of ['Refund received', 'Refund processed', 'Refund status: completed', 'Amount refunded']) assert.equal(classifyPayment(text, 1000, 'refund').status, 'paid', text);
  for (const text of ['Refund initiated', 'Refund issued', 'Payment successful', 'Refund not received', 'Refund processed\nRefund pending', 'Refund completed\nBalance due INR 5']) assert.equal(classifyPayment(text, 1000, 'refund').status, 'review', text);
});

test('amount parsing handles Indian grouping and never rounds a mismatched payment to total', () => {
  const result = classifyPayment('Amount paid: INR 1,23,456.78', 12345678, 'expense');
  assert.equal(result.amountPaid, 12345678);
  assert.equal(result.status, 'paid');
  assert.equal(classifyPayment('Amount paid: INR 10.01', 1000, 'expense').status, 'review');
  assert.equal(classifyPayment('Payment successful', 0, 'expense').status, 'review');
});

test('conditional instructions and negated status override matching paid amounts', () => {
  for (const text of ['If payment successful, send receipt', 'After payment received, we ship', 'Amount Paid 10.00\nPayment has not been successful', 'Amount Paid 10.00\nPayment not yet received']) assert.equal(classifyPayment(text, 1000, 'expense').status, 'review', text);
  assert.equal(classifyPayment('Refund completed\nRefund not yet processed', 1000, 'refund').status, 'review');
  const cash = classifyPayment('Cash Payment 10.00\nUPI payment instructions: scan QR to pay', 1000, 'expense');
  assert.equal(cash.status, 'paid');
  assert.equal(cash.method, 'cash');
});

test('policy small print and conditional promises do not block real payment evidence', () => {
  for (const text of [
    'Tax Invoice\nAmount Paid: ₹590.00\nTerms: Interest @18% p.a. will be charged on unpaid invoices.',
    'Payment successful\nRefunds will be processed once the item is returned.',
    'Total Paid ₹590.00\nIf payment is not received within 7 days, the order will be cancelled.',
    'Payment Status: Paid\nPlease note: late payment charges apply to pending payments.',
    'Grand Total ₹590.00\nUnpaid Amount: ₹0.00\nAmount Paid ₹590.00',
  ]) assert.equal(classifyPayment(text, 59000, 'expense').status, 'paid', text);
});

test('common Indian receipt wording proves payment', () => {
  for (const text of [
    'Transaction Successful', 'Invoice status: Paid', 'Status: Success', 'Paid via UPI on 12 Mar 2026', 'PAID',
    'Thank you for your payment', 'We have received your payment', 'Received with thanks from Ravi Kumar the sum of Rupees Five Hundred',
    'Received from Ravi Kumar an amount of Rs 590', 'Payment of ₹590 has been received', 'You paid ₹590.00', 'UTR No: 412345678901',
    'Paid: ₹590.00', 'Amount Received Rs. 590.00', 'Amount Payable ₹590.00\nPaid via UPI',
  ]) assert.equal(classifyPayment(text, 59000, 'expense').status, 'paid', text);
});

test('payable and due totals equal to a fully paid amount are not balances', () => {
  assert.equal(classifyPayment('Total Due ₹590.00\nAmount Paid ₹590.00\nBalance ₹0.00', 59000, 'expense').status, 'paid');
  assert.equal(classifyPayment('Amount Due ₹590.00\nPayment successful', 59000, 'expense').status, 'unpaid');
  assert.equal(classifyPayment('Amount Payable ₹590.00', 59000, 'expense').status, 'unpaid');
});

test('wider wording still never proves payment from intent, instructions or cash on delivery', () => {
  for (const text of ['Amount to be paid: ₹590.00', 'Must be paid by 5 Mar 2026', 'Payment Mode: Cash on Delivery\nOrder confirmed', 'Payment Status: Pending\nTerms apply', 'Order confirmation', 'Pay via UPI to ledger@okaxis', 'Payment confirmation awaited']) {
    assert.notEqual(classifyPayment(text, 59000, 'expense').status, 'paid', text);
  }
});

test('refund wording such as credited counts, initiated does not', () => {
  for (const text of ['Refund of ₹85 has been credited to your account', 'Refunded to your original payment method', 'Refund successful']) assert.equal(classifyPayment(text, 8500, 'refund').status, 'paid', text);
  assert.equal(classifyPayment('Refund will be credited in 5-7 days', 8500, 'refund').status, 'review');
});
