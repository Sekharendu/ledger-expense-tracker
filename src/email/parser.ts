import { parseAmount, validDate, type Category } from '../expenses.ts';
import type { EmailEvidence, EmailExpense } from './types.ts';

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

function extractAmount(text: string): { amount?: number; reason?: string; currencyFromContext?: boolean } {
  if (/(?:\b(?:USD|EUR|GBP|AUD|CAD|SGD|AED|JPY|PKR|LKR|NPR|MUR|SCR)\b|[$€£])/i.test(text)) return { reason: 'Non-INR or mixed-currency document; currency conversion is not supported.' };
  const currency = '(?:INR|Rs\\.?|₹)';
  const number = '(\\d[\\d,]*(?:\\.\\d{1,2})?)(?![\\d.])';
  // Total labels with an inline currency outrank line items and subtotal.
  const total = new RegExp(`(?:grand\\s+total|total\\s+(?:amount|paid|due|payable)|amount\\s+(?:paid|due|payable|charged|refunded)|refund\\s+amount|(?<!sub)\\btotal)\\s*[:=—-]?\\s*(?:${currency}\\s*${number}|${number}\\s*${currency})`, 'gi');
  const totals = [...text.matchAll(total)].map(match => currencyAmount(match[1] ?? match[2])).filter((value): value is number => value !== null);
  const unique = [...new Set(totals)];
  if (unique.length === 1) return { amount: unique[0] };
  if (unique.length > 1) return { reason: 'Conflicting totals; review the original email manually.' };
  // Some Indian GST PDFs put "Rupees Only" in words and leave currency off
  // numeric rows. Require currency evidence and a standalone final-total row;
  // never infer INR from a bare number, GST alone, or a subtotal/tax row.
  const indianCurrency = /\bINR\b|₹|\bIndian\s+Rupees\b/i.test(text) ||
    (/\brupees\b/i.test(text) && /\bCGST\b/i.test(text) && /\b(?:SGST|UTGST)\b/i.test(text));
  if (indianCurrency) {
    const finalTotal = new RegExp(`^[ \\t]*(?:total[ \\t]+invoice[ \\t]+amount|total[ \\t]+amount[ \\t]+after[ \\t]+tax|grand[ \\t]+total|net[ \\t]+(?:amount|payable))[ \\t]*[:=—-]?[ \\t]*(?:\\r?\\n[ \\t]*)?(?:${currency}[ \\t]*)?${number}(?:[ \\t]*${currency})?[ \\t]*$`, 'gim');
    const contextualTotals = [...new Set([...text.matchAll(finalTotal)].map(match => currencyAmount(match[1])).filter((value): value is number => value !== null))];
    if (contextualTotals.length === 1) return { amount: contextualTotals[0], currencyFromContext: true };
    if (contextualTotals.length > 1) return { reason: 'Conflicting final invoice totals; review the original email manually.' };
  }
  const amounts = [...text.matchAll(new RegExp(`${currency}\\s*${number}|${number}\\s*${currency}`, 'gi'))].map(match => currencyAmount(match[1] ?? match[2])).filter((value): value is number => value !== null);
  const values = [...new Set(amounts)];
  return values.length === 1 ? { amount: values[0] } : { reason: values.length ? 'Multiple amounts with no clear total.' : 'No supported INR total found.' };
}

function extractDate(text: string, suggested: EmailEvidence['suggestedStatus'], received: string) {
  const label = suggested === 'unpaid' ? '(?:due\\s+date|pay(?:ment)?\\s+due)' : '(?:payment\\s+date|transaction\\s+date|invoice\\s+date|receipt\\s+date|date)';
  const match = text.match(new RegExp(`${label}\\s*[:—-]?\\s*(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4})`, 'i'));
  if (match) {
    let value = match[1];
    const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (numeric) value = `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
    else if (!/^\d{4}-/.test(value)) {
      const parts = value.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
      const index = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(parts?.[2].slice(0, 3).toLowerCase() ?? '');
      value = parts && index >= 0 ? `${parts[3]}-${String(index + 1).padStart(2, '0')}-${parts[1].padStart(2, '0')}` : '';
    }
    if (validDate(value)) return { date: value, inferred: false };
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
    const result = extractAmount(text);
    if (!result.amount) { reasons.push(result.reason!); continue; }
    const kind = /\b(refund|refunded|credit note)\b/i.test(message.subject) || /\b(refund\s+amount|amount\s+refunded|refund\s+(?:issued|processed|successful|completed))\b/i.test(text) ? 'refund' : 'expense';
    const unpaid = /\b(amount due|payment due|pay by|due date|unpaid|outstanding)\b/i.test(content) && !/\b(amount due|outstanding)\s*:?\s*(?:INR|Rs\.?|₹)?\s*0(?:\.00)?(?![\d.,])/i.test(content);
    const paid = /\b(payment (?:received|successful|confirmed)|paid successfully|amount paid|payment status\s*:\s*paid|receipt|refund (?:issued|processed|successful|completed))\b/i.test(content);
    const suggestedStatus = kind === 'refund' ? (paid ? 'paid' : 'review') : unpaid ? 'unpaid' : paid ? 'paid' : 'review';
    const extractedDate = extractDate(text, suggestedStatus, message.receivedAt);
    if (!validDate(extractedDate.date)) { reasons.push('No usable transaction date.'); continue; }
    const invoiceNumber = text.match(/\b(?:invoice|receipt)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{2,79})/i)?.[1];
    const invoiceKey = kind === 'expense' && invoiceNumber && senderAddress ? `${message.accountKey}:${senderAddress}:${invoiceNumber.toLowerCase()}` : undefined;
    const evidence: EmailEvidence = {
      provider: 'gmail', accountKey: message.accountKey, messageId: message.id,
      threadId: message.threadId ?? message.id, subject: message.subject.slice(0, 250), sender: message.from.slice(0, 250),
      sourceUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.id)}`,
      invoiceNumber, invoiceKey, suggestedStatus,
      confidence: suggestedStatus !== 'review' && !extractedDate.inferred && !result.currencyFromContext ? 'high' : 'medium',
      originalAmount: result.amount,
      attachment: document.filename,
    };
    const note = [
      'Imported from Gmail. Confirm the amount, category and payment status before counting it as spending.',
      `Detected status: ${suggestedStatus}.`,
      extractedDate.inferred ? 'Date inferred from email delivery; verify transaction or due date.' : 'Date extracted from document; verify before confirming.',
      result.currencyFromContext ? 'INR identified from the invoice currency or Indian GST context; verify the currency.' : '',
      invoiceNumber ? `Invoice reference: ${invoiceNumber}.` : 'No invoice reference detected; check for a related receipt.',
      document.filename ? `Attachment: ${document.filename}.` : '',
    ].filter(Boolean).join(' ');
    expenses.push({ id: `gmail:${message.accountKey}:${message.id}:${index}`, merchant, amount: result.amount, date: extractedDate.date, category: categorize(`${merchant}\n${content}`), status: 'review', kind, source: `Gmail · ${message.subject.slice(0, 150)}`, note, email: evidence });
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
