import { parseAmount, validDate, type Category } from '../expenses.ts';
import type { EmailEvidence, EmailExpense } from './types.ts';
import { classifyPayment } from './payment.ts';

export type BillingDocument = { text: string; filename?: string };
export type BillingMessage = {
  id: string; threadId?: string; accountKey: string; subject: string;
  from: string; receivedAt: string; documents: BillingDocument[];
};

function currencyAmount(raw: string): number | null {
  // Accept grouping only when it is valid Indian or international grouping.
  const clean = raw.trim();
  if (clean.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(clean) && !/^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/.test(clean)) return null;
  return parseAmount(clean.replaceAll(',', ''));
}

function extractAmount(text: string, kind: 'expense' | 'refund'): { amount?: number; reason?: string; currencyFromContext?: boolean } {
  if (/(?:\b(?:USD|EUR|GBP|AUD|CAD|SGD|AED|JPY|PKR|LKR|NPR|MUR|SCR)\b|[$€£])/i.test(text)) return { reason: 'Non-INR or mixed-currency document; currency conversion is not supported.' };
  const currency = '(?:INR|Rs\\.?|₹)';
  const number = '(\\d[\\d,]*(?:\\.\\d{1,2})?)(?![\\d.])';
  if (kind === 'refund') {
    const refundTotal = new RegExp(`(?:refund\\s+amount|amount\\s+refunded)\\s*[:=—-]?\\s*(?:${currency}\\s*${number}|${number}\\s*${currency})`, 'gi');
    const refunds = [...new Set([...text.matchAll(refundTotal)].map(match => currencyAmount(match[1] ?? match[2])).filter((value): value is number => value !== null))];
    if (refunds.length === 1) return { amount: refunds[0] };
    if (refunds.length > 1) return { reason: 'Conflicting refund amounts; review the original email manually.' };
  }
  // Invoice totals outrank tendered amounts and remaining balances.
  const finalLabels = '(?:grand\\s+total|total\\s+invoice\\s+amount|total\\s+amount\\s+after\\s+tax|net\\s+(?:amount|payable))';
  const markedFinal = new RegExp(`${finalLabels}\\s*[:=—-]?\\s*(?:${currency}\\s*${number}|${number}\\s*${currency})`, 'gi');
  const markedFinals = [...text.matchAll(markedFinal)].map(match => currencyAmount(match[1] ?? match[2])).filter((value): value is number => value !== null);
  const indianCurrency = /\bINR\b|₹|\bIndian\s+Rupees\b/i.test(text) ||
    (/\brupees\b/i.test(text) && /\bCGST\b/i.test(text) && /\b(?:SGST|UTGST)\b/i.test(text));
  const contextualFinal = new RegExp(`^[ \\t]*${finalLabels}[ \\t]*[:=—-]?[ \\t]*(?:\\r?\\n[ \\t]*)?(?:${currency}[ \\t]*)?${number}(?:[ \\t]*${currency})?[ \\t]*$`, 'gim');
  const contextualFinals = indianCurrency ? [...text.matchAll(contextualFinal)].map(match => currencyAmount(match[1])).filter((value): value is number => value !== null) : [];
  const finals = [...new Set([...markedFinals, ...contextualFinals])];
  if (finals.length === 1) return { amount: finals[0], currencyFromContext: !markedFinals.length };
  if (finals.length > 1) return { reason: 'Conflicting final invoice totals; review the original email manually.' };
  // Total labels with an inline currency outrank line items and subtotal.
  const total = new RegExp(`(?:grand\\s+total|total\\s+(?:amount|paid|due|payable)|amount\\s+(?:paid|due|payable|charged|refunded)|refund\\s+amount|(?<!sub)\\btotal)\\s*[:=—-]?\\s*(?:${currency}\\s*${number}|${number}\\s*${currency})`, 'gi');
  const totals = [...text.matchAll(total)].map(match => currencyAmount(match[1] ?? match[2])).filter((value): value is number => value !== null);
  const unique = [...new Set(totals)];
  if (unique.length === 1) return { amount: unique[0] };
  if (unique.length > 1) return { reason: 'Conflicting totals; review the original email manually.' };
  const amounts = [...text.matchAll(new RegExp(`${currency}\\s*${number}|${number}\\s*${currency}`, 'gi'))].map(match => currencyAmount(match[1] ?? match[2])).filter((value): value is number => value !== null);
  const values = [...new Set(amounts)];
  return values.length === 1 ? { amount: values[0] } : { reason: values.length ? 'Multiple amounts with no clear total.' : 'No supported INR total found.' };
}

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const month = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const ordinal = '(?:st|nd|rd|th)?';
// ISO, day-first numeric (Indian convention), "12 Mar 2026", "12-Mar-26", "Mar 12, 2026".
const dateValue = `(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})|\\d{1,2}${ordinal}[ \\t-]*${month}[ \\t,-]*(?:\\d{4}|\\d{2})|${month}[ \\t]+\\d{1,2}${ordinal},?[ \\t]+\\d{4})(?![\\d])`;

function isoDate(raw: string): string {
  const year = (value: string) => value.length === 2 ? `20${value}` : value;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const numeric = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/);
  if (numeric) return `${year(numeric[3])}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  const dayFirst = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?[ \t-]*([A-Za-z]+)\.?[ \t,-]*(\d{4}|\d{2})$/);
  const monthFirst = raw.match(/^([A-Za-z]+)\.?[ \t]+(\d{1,2})(?:st|nd|rd|th)?,?[ \t]+(\d{4})$/);
  const [day, name, yearText] = dayFirst ? [dayFirst[1], dayFirst[2], dayFirst[3]] : monthFirst ? [monthFirst[2], monthFirst[1], monthFirst[3]] : [];
  const index = monthNames.indexOf(name?.slice(0, 3).toLowerCase() ?? '');
  return day && yearText && index >= 0 ? `${year(yearText)}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}` : '';
}

function extractDate(text: string, suggested: EmailEvidence['suggestedStatus'], received: string) {
  const issued = [
    '(?:(?:invoice|receipt|bill|order|issue|document)\\s+(?:date|dt\\.?)|date\\s+of\\s+(?:issue|invoice)|issued\\s+on)',
    '(?<!(?:due|expiry|delivery|start|end|from|valid|birth)[ \\t]+)\\bdate(?:\\s*(?:&|and)\\s*time)?',
  ];
  // Unpaid bills prefer the due date, then the printed issue date, before falling back to the received date.
  const labels = suggested === 'unpaid'
    ? ['(?:due\\s+date|pay(?:ment)?\\s+due(?:\\s+(?:date|by|on))?|due\\s+(?:on|by)|pay\\s+by)', ...issued]
    : ['(?:(?:payment|transaction|txn)\\s+(?:date|on)|paid\\s+on|date\\s+of\\s+payment)', ...issued];
  for (const label of labels) {
    for (const match of text.matchAll(new RegExp(`${label}\\s*[:=—–-]?\\s*${dateValue}`, 'gi'))) {
      const value = isoDate(match[1]);
      if (validDate(value)) return { date: value, inferred: false };
    }
  }
  // A received date is evidence only for review, never asserted to be a payment/due date.
  return { date: received.slice(0, 10), inferred: true };
}

function categorize(text: string): Category {
  if (/\b(swiggy|zomato|restaurant|food|dining)\b/i.test(text)) return 'Food';
  if (/\b(uber|ola|ride|taxi|metro|railway)\b/i.test(text)) return 'Transport';
  if (/\b(adobe|github|software|hosting|cloud|saas)\b/i.test(text)) return 'Software';
  if (/\b(airtel|jio|electricity|broadband|utility|water bill)\b/i.test(text)) return 'Utilities';
  if (/\b(amazon|flipkart|shopping)\b/i.test(text)) return 'Shopping';
  return 'Other';
}

export function parseBillingMessage(message: BillingMessage): { expenses: EmailExpense[]; reasons: string[] } {
  const expenses: EmailExpense[] = [];
  const reasons: string[] = [];
  const senderAddress = message.from.match(/<?([^\s<>]+@[^\s<>]+)>?/)?.[1]?.toLowerCase() ?? '';
  const senderName = message.from.replace(/<[^>]*>/g, '').replace(/^"|"$/g, '').trim();
  const merchant = (senderName && !senderName.includes('@') ? senderName : senderAddress.split('@')[1] || message.from || 'Unknown merchant').slice(0, 150);
  for (const [index, document] of message.documents.entries()) {
    const text = document.text.normalize('NFKC').replace(/\u00a0/g, ' ');
    const content = `${message.subject}\n${text}`;
    if (!/\b(invoice|receipt|bill|payment\s+(?:received|successful|confirmation)|refund|order\s+(?:confirmation|summary))\b/i.test(content)) { reasons.push('No billing evidence detected.'); continue; }
    if (/\b(credit card statement|account statement|minimum amount due|statement balance)\b/i.test(content)) { reasons.push('Statement excluded to avoid counting underlying purchases twice.'); continue; }
    if (/\b(payment failed|payment declined|transaction failed|order cancelled|order canceled)\b/i.test(content) && !/\brefund(?:ed|\s+(?:issued|processed|successful|completed))\b/i.test(content)) { reasons.push('Failed payment or cancelled order; no confirmed refund.'); continue; }
    const kind = /\b(refund|refunded|credit note)\b/i.test(message.subject) || /\b(refund\s+amount|amount\s+refunded|refund\s+(?:issued|processed|successful|completed))\b/i.test(text) ? 'refund' : 'expense';
    const result = extractAmount(text, kind);
    if (!result.amount) { reasons.push(result.reason!); continue; }
    const payment = classifyPayment(text, result.amount, kind);
    const suggestedStatus = payment.status;
    const extractedDate = extractDate(text, suggestedStatus, message.receivedAt);
    if (!validDate(extractedDate.date)) { reasons.push('No usable transaction date.'); continue; }
    const automaticPaid = kind === 'expense' && payment.confirmed && payment.status === 'paid' && !extractedDate.inferred;
    const invoiceNumber = text.match(/\b(?:invoice|receipt)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{2,79})/i)?.[1];
    const invoiceKey = kind === 'expense' && invoiceNumber && senderAddress ? `${message.accountKey}:${senderAddress}:${invoiceNumber.toLowerCase()}` : undefined;
    const evidence: EmailEvidence = {
      provider: 'gmail', accountKey: message.accountKey, messageId: message.id,
      threadId: message.threadId ?? message.id, subject: message.subject.slice(0, 250), sender: message.from.slice(0, 250),
      sourceUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.id)}`,
      invoiceNumber, invoiceKey, suggestedStatus,
      payment, paymentSource: document.filename ? 'attachment' : 'email',
      confidence: suggestedStatus !== 'review' && !extractedDate.inferred && !result.currencyFromContext ? 'high' : 'medium',
      originalAmount: result.amount,
      attachment: document.filename,
    };
    const note = [
      automaticPaid ? 'Imported from Gmail. Marked paid automatically from explicit payment evidence. You can correct this record.' : 'Imported from Gmail. Confirm the amount, category and payment status before counting it as spending.',
      `Detected status: ${suggestedStatus}.`,
      payment.evidence ? `Payment evidence: ${payment.evidence}.` : 'No explicit full-payment evidence found.',
      payment.method ? `Payment method: ${payment.method.replaceAll('_', ' ')}.` : '',
      payment.amountPaid !== undefined ? `Amount paid: INR ${(payment.amountPaid / 100).toFixed(2)}.` : '',
      payment.balanceDue !== undefined ? `Balance due: INR ${(payment.balanceDue / 100).toFixed(2)}.` : '',
      extractedDate.inferred ? 'Date inferred from email delivery; verify transaction or due date.' : 'Date extracted from document; verify before confirming.',
      result.currencyFromContext ? 'INR identified from the invoice currency or Indian GST context; verify the currency.' : '',
      invoiceNumber ? `Invoice reference: ${invoiceNumber}.` : 'No invoice reference detected; check for a related receipt.',
      document.filename ? `Attachment: ${document.filename}.` : '',
    ].filter(Boolean).join(' ');
    expenses.push({ id: `gmail:${message.accountKey}:${message.id}:${index}`, merchant, amount: result.amount, date: extractedDate.date, category: categorize(`${merchant}\n${content}`), status: automaticPaid ? 'paid' : 'review', kind, source: `Gmail · ${message.subject.slice(0, 150)}`, note, email: evidence });
  }
  // A payment confirmation in the body can prove its attached invoice only
  // when both explicitly identify the same invoice and amount.
  for (const expense of expenses.filter(item => item.kind === 'expense' && item.email.attachment && item.status !== 'paid')) {
    const matchingBody = expenses.find(item => !item.email.attachment && item.status === 'paid' && item.kind === expense.kind && item.amount === expense.amount && item.email.invoiceNumber && item.email.invoiceNumber.toLowerCase() === expense.email.invoiceNumber?.toLowerCase());
    if (matchingBody && expense.email.payment?.status !== 'unpaid' && !expense.email.payment?.evidence) {
      expense.status = 'paid'; expense.date = matchingBody.date;
      expense.email = { ...expense.email, suggestedStatus: 'paid', payment: matchingBody.email.payment, paymentSource: 'email', confidence: matchingBody.email.confidence };
      expense.note = matchingBody.note + ` Matching attachment: ${expense.email.attachment}.`;
    }
  }
  // A summary in the body and its PDF represent one purchase, not two.
  const unique = expenses.filter(item => item.email.attachment || !expenses.some(other => other.email.attachment && other.amount === item.amount && other.kind === item.kind && (!item.email.invoiceNumber || !other.email.invoiceNumber || item.email.invoiceNumber === other.email.invoiceNumber)));
  return { expenses: unique, reasons };
}

export function mergeEmailExpenses<T extends { id: string; amount: number; date: string; merchant: string; kind: string; email?: EmailEvidence }>(existing: T[], incoming: T[]) {
  const merged = [...existing];
  let duplicates = 0;
  for (const item of incoming) {
    const exact = merged.some(old => old.id === item.id || (item.email?.invoiceKey && old.email?.invoiceKey === item.email.invoiceKey && old.kind === item.kind && old.email.originalAmount === item.email.originalAmount));
    if (exact) { duplicates++; continue; }
    merged.push(item);
  }
  return { expenses: merged, added: merged.length - existing.length, duplicates };
}
