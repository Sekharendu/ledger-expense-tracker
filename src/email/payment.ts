export type PaymentClassification = {
  status: 'paid' | 'unpaid' | 'review';
  evidence?: string;
  method?: 'cash' | 'card' | 'upi' | 'bank_transfer';
  amountPaid?: number;
  balanceDue?: number;
  confirmed: boolean;
};

const number = '(\\d[\\d,]*(?:\\.\\d{1,2})?)(?![\\d.,])';
const currency = '(?:(?:INR|Rs\\.?|₹)[ \\t]*)?';
const separator = '[ \\t]*[:=–—-]?[ \\t]*(?:\\r?\\n[ \\t]*)?';

function paise(raw: string): number | undefined {
  if (raw.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw) && !/^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/.test(raw)) return;
  const [whole, fraction = ''] = raw.replaceAll(',', '').split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(value) ? value : undefined;
}

function amounts(text: string, label: string) {
  return [...text.matchAll(new RegExp(`\\b${label}${separator}${currency}${number}`, 'gi'))]
    .flatMap(match => { const value = paise(match[1]); return value === undefined ? [] : [{ value, evidence: match[0].trim().slice(0, 160) }]; });
}

/** Classify one document only: subject lines and other attachments cannot prove its payment. */
export function classifyPayment(text: string, totalAmount: number, kind: 'expense' | 'refund'): PaymentClassification {
  const content = text.normalize('NFKC').replace(/\u00a0/g, ' ');
  const paid = amounts(content, '(?:amount[ \\t]+paid|paid[ \\t]+amount|payment[ \\t]+received|(?:petty[ \\t]+)?cash[ \\t]+payment|(?:credit[ \\t]+|debit[ \\t]+)?card[ \\t]+payment|upi[ \\t]+payment|bank[ \\t]+transfer[ \\t]+payment|paid[ \\t]+(?:by|via)[ \\t]+(?:cash|card|upi|bank[ \\t]+transfer))');
  const methodText = paid.find(item => /\b(?:cash|card|upi|bank[ \t]+transfer)\b/i.test(item.evidence))?.evidence ?? content;
  const method: PaymentClassification['method'] = /\bupi\b/i.test(methodText) ? 'upi' : /\b(?:credit|debit)?[ \t]*card\b/i.test(methodText) ? 'card' : /\b(?:petty[ \t]+)?cash\b/i.test(methodText) ? 'cash' : /\b(?:bank[ \t]+transfer|neft|imps|rtgs)\b/i.test(methodText) ? 'bank_transfer' : undefined;
  const due = amounts(content, '(?:balance[ \\t]+due|amount[ \\t]+due|outstanding(?:[ \\t]+(?:amount|balance))?|balance[ \\t]+payable|remaining[ \\t]+balance|total[ \\t]+due)');
  const uniquePaid = [...new Set(paid.map(item => item.value))];
  const uniqueDue = [...new Set(due.map(item => item.value))];
  const details = { method, ...(uniquePaid.length === 1 ? { amountPaid: uniquePaid[0] } : {}), ...(uniqueDue.length === 1 ? { balanceDue: uniqueDue[0] } : {}) };
  const result = (status: PaymentClassification['status'], evidence?: string): PaymentClassification => ({ ...details, status, confirmed: status === 'paid', ...(evidence ? { evidence: evidence.trim().slice(0, 160) } : {}) });
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) return result('review');
  const conditional = content.match(/\b(?:if|after|once|when|until|upon)\b[^\n.!?]{0,80}\b(?:payment|paid|refund)\b/i);
  if (conditional) return result('review', conditional[0]);
  const negated = content.match(/\b(?:payment|refund|transaction)\b[^\n.!?]{0,30}\bnot\b(?:[ \t]+(?:yet|been))?[ \t]+(?:paid|received|successful|completed|processed)\b/i);
  if (negated) return result('review', negated[0]);
  const blocked = content.match(/\b(?:not[ \t]+(?:yet[ \t]+)?(?:paid|received|successful|completed|processed)|unpaid|unsettled|partially[ \t]+paid|partial[ \t]+payment|(?:payment|transaction|refund)(?:[ \t]+status)?[ \t:=-]*(?:is[ \t]+|was[ \t]+|has[ \t]+been[ \t]+)?(?:not[ \t]+(?:received|successful|completed|processed)|pending|failed|declined|reversed|cancelled|canceled|unsuccessful)|(?:pending|failed|declined|reversed)[ \t]+(?:payment|transaction|refund))\b/i);
  if (blocked) return result('review', blocked[0]);
  const positiveDue = due.find(item => item.value > 0);
  if (uniqueDue.length > 1 || uniquePaid.length > 1) return result('review', (positiveDue ?? paid[0] ?? due[0])?.evidence);
  if (positiveDue) return result(kind === 'expense' ? 'unpaid' : 'review', positiveDue.evidence);
  if (paid.some(item => item.value !== totalAmount)) return result('review', paid[0].evidence);
  if (kind === 'refund') {
    const proof = content.match(/\brefund(?:[ \t]+status)?[ \t:=-]*(?:(?:has[ \t]+been|was|is)[ \t]+)?(?:received|processed|completed|successful)\b|\b(?:received|completed)[ \t]+refund\b|\bamount[ \t]+refunded\b/i);
    return proof ? result('paid', proof[0]) : result('review');
  }
  const proof = content.match(/\bpayment(?:[ \t]+status)?[ \t:=-]*(?:(?:has[ \t]+been|was|is)[ \t]+)?(?:successful|received|confirmed|paid|completed)\b|\bpaid[ \t]+(?:in[ \t]+full|successfully)\b/i);
  if (proof) return result('paid', proof[0]);
  const instructions = paid.some(item => {
    const index = content.indexOf(item.evidence);
    const preceding = content.slice(0, index).split('\n');
    const line = (preceding.at(-1) ?? '') + content.slice(index).split('\n')[0];
    const previousLine = preceding.at(-2) ?? '';
    return /\b(?:instructions|how[ \t]+to[ \t]+pay|please[ \t]+(?:pay|make))\b/i.test(line) || /\bpayment[ \t]+instructions\b/i.test(previousLine);
  });
  if (!instructions && paid.length && paid[0].value === totalAmount) return result('paid', paid[0].evidence);
  return result('review');
}
