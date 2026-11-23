import { isEmailEvidence, type EmailEvidence } from './email/types.ts';

export const categories = ['Shopping', 'Food', 'Transport', 'Utilities', 'Software', 'Other'] as const;
export type Category = typeof categories[number];
export type Expense = {
  id: string; merchant: string; amount: number; date: string;
  category: Category; status: 'paid' | 'unpaid' | 'review';
  kind: 'expense' | 'refund'; source: string; note: string;
  email?: EmailEvidence;
};

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function parseAmount(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function summarize(items: Expense[], month: string) {
  const paid = items.filter(item => item.status === 'paid' && item.date.startsWith(month));
  const signed = (item: Expense) => item.kind === 'refund' ? -item.amount : item.amount;
  return {
    total: paid.reduce((sum, item) => sum + signed(item), 0),
    count: paid.length,
    categories: categories.map(category => ({ category, amount: paid.filter(item => item.category === category).reduce((sum, item) => sum + signed(item), 0) })),
    unpaid: items.filter(item => item.status === 'unpaid' && item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0),
    review: items.filter(item => item.status === 'review').length,
  };
}

export function mergeExpenses(existing: Expense[], incoming: Expense[]) {
  const seen = new Set(existing.map(item => item.id));
  return [...existing, ...incoming.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; })];
}

export function sampleExpenses(now = new Date()): Expense[] {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return [
    { id: `demo-${month}-1`, merchant: 'Adobe', amount: 149900, date: `${month}-02`, category: 'Software', status: 'paid', kind: 'expense', source: 'Sample email · Adobe receipt', note: 'Creative Cloud monthly subscription. This is fictional sample data.' },
    { id: `demo-${month}-2`, merchant: 'Swiggy', amount: 48500, date: `${month}-05`, category: 'Food', status: 'paid', kind: 'expense', source: 'Sample email · Your order receipt', note: 'Dinner delivery. This is fictional sample data.' },
    { id: `demo-${month}-3`, merchant: 'Amazon', amount: 249900, date: `${month}-09`, category: 'Shopping', status: 'review', kind: 'expense', source: 'Sample email · Invoice attached', note: 'Payment status needs confirmation. This is fictional sample data.' },
    { id: `demo-${month}-4`, merchant: 'Airtel', amount: 99900, date: `${month}-28`, category: 'Utilities', status: 'unpaid', kind: 'expense', source: 'Sample email · Broadband bill', note: 'Due on the date shown. This is fictional sample data.' },
    { id: `demo-${month}-5`, merchant: 'Swiggy refund', amount: 8500, date: `${month}-06`, category: 'Food', status: 'paid', kind: 'refund', source: 'Sample email · Refund confirmation', note: 'Partial order refund. This is fictional sample data.' },
  ];
}

export function isExpense(value: unknown): value is Expense {
  if (!value || typeof value !== 'object') return false;
  const item = value as Expense;
  return typeof item.id === 'string' && typeof item.merchant === 'string' && item.merchant.trim().length > 0 && Number.isSafeInteger(item.amount) && item.amount > 0 && typeof item.date === 'string' && validDate(item.date) && categories.includes(item.category) && ['paid', 'unpaid', 'review'].includes(item.status) && ['expense', 'refund'].includes(item.kind) && !(item.kind === 'refund' && item.status === 'unpaid') && typeof item.source === 'string' && typeof item.note === 'string' && (item.email === undefined || isEmailEvidence(item.email));
}

export function toCsv(items: Expense[]) {
  // Prefix spreadsheet formulas to keep merchant and source text inert on export.
  const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
  return ['Merchant,Amount,Currency,Date,Category,Status,Kind,Source', ...items.map(item => [cell(item.merchant), (item.amount / 100).toFixed(2), 'INR', item.date, item.category, item.status, item.kind, cell(item.source)].join(','))].join('\r\n');
}
