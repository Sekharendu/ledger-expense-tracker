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
