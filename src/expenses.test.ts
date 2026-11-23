import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExpense, mergeExpenses, parseAmount, sampleExpenses, summarize, toCsv, validDate } from './expenses.ts';

test('only confirmed expenses and refunds contribute to monthly spending', () => {
  const items = sampleExpenses(new Date('2026-11-15T12:00:00'));
  const result = summarize(items, '2026-11');
  assert.equal(result.total, 189900);
  assert.equal(result.unpaid, 99900);
  assert.equal(result.review, 1);
  assert.equal(summarize(items, '2026-10').total, 0);
  const approved = items.map(item => item.status === 'review' ? { ...item, status: 'paid' as const } : item);
  assert.equal(summarize(approved, '2026-11').total, 439800);
});
test('sample imports are idempotent and preserve user edits', () => {
  const items = sampleExpenses();
  items[0].merchant = 'Corrected merchant';
  assert.deepEqual(mergeExpenses(items, sampleExpenses()), items);
  assert.equal(mergeExpenses([], [...items, ...items]).length, items.length);
});
test('amounts use integer paise and reject ambiguous or invalid values', () => {
  assert.equal(parseAmount('1499.99'), 149999);
  for (const value of ['-5', '0', 'NaN', '1.234', '1e3', '1,000', '99999999999999999']) assert.equal(parseAmount(value), null);
});
test('dates reject impossible calendar dates and persisted data is validated', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(isExpense(sampleExpenses()[0]), true);
  assert.equal(isExpense({ ...sampleExpenses()[0], amount: -2 }), false);
  assert.equal(isExpense({ ...sampleExpenses()[0], kind: 'refund', status: 'unpaid' }), false);
});
test('CSV protects formula cells and escapes quotes and delimiters', () => {
  const item = { ...sampleExpenses()[0], merchant: '=SUM(1,2)', source: 'Receipt "quoted"' };
  const csv = toCsv([item]);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"Receipt ""quoted"""'));
});
