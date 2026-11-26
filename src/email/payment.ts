export type PaymentClassification = {
  status: 'paid' | 'unpaid' | 'review';
  evidence?: string;
  method?: 'cash' | 'card' | 'upi' | 'bank_transfer';
  amountPaid?: number;
  balanceDue?: number;
  confirmed: boolean;
};

type Amount = { value: number; evidence: string };

const number = '(\\d[\\d,]*(?:\\.\\d{1,2})?)(?![\\d.,])';
const currency = '(?:INR|Rs\\.?|₹)[ \\t]*';
const separator = '[ \\t]*[:=–—-]?[ \\t]*(?:\\r?\\n[ \\t]*)?';
const gap = '[ \\t]+';

/** Labels whose amount is money actually handed over. */
const paidLabels = [
  `amount${gap}paid`, `paid${gap}amount`, `total${gap}paid`, `net${gap}paid`, `amount${gap}received`, `received${gap}amount`,
  `payment${gap}received`, `amount${gap}collected`, `you${gap}(?:have${gap})?paid`,
  `(?:petty${gap})?cash${gap}payment`, `(?:(?:credit|debit)${gap})?card${gap}payment`, `upi${gap}payment`,
  `(?:net${gap}banking|bank${gap}transfer)${gap}payment`, `paid${gap}(?:by|via|using|through)${gap}(?:cash|(?:(?:credit|debit)${gap})?card|upi|net${gap}banking|bank${gap}transfer)`,
].join('|');
/** Remaining balances: a positive value means money is still owed. */
const balanceLabels = [
  `balance${gap}(?:due|payable|amount|outstanding)`, `outstanding(?:${gap}(?:amount|balance|due))?`, `remaining${gap}(?:balance|amount)`,
  `unpaid${gap}(?:amount|balance)`, `pending${gap}amount`, `amount${gap}pending`, `balance`,
].join('|');
/** Often just the invoice total, even on a receipt that was paid. */
const dueLabels = `(?:amount|total)${gap}due`;
const payableLabels = `(?:amount|total)${gap}payable|payable${gap}amount`;

/** Statements that are not a statement of fact about this payment. */
const conditional = /\b(?:if|after|once|when|until|upon|unless|in[ \t]+case)\b[^\n]{0,80}\b(?:payment|paid|pay|refund)/i;
const boilerplate = /\b(?:terms|conditions|polic(?:y|ies)|subject[ \t]+to|liable|interest|late[ \t]+(?:fee|payment|charges?)|penalt(?:y|ies)|shall|will[ \t]+be|would[ \t]+be|may[ \t]+be|can[ \t]+be|please[ \t]+note|disclaimer|jurisdiction|queries|disputes?|contact[ \t]+us|customer[ \t]+care)\b/i;
const statusLabel = /\bstatus[ \t]*[:=-]/i;
const zeroAfter = /^(?:[ \t]+(?:amount|balance|due))?[ \t]*[:=–—-]?[ \t]*(?:(?:INR|Rs\.?|₹)[ \t]*)?0+(?:\.0{1,2})?(?![\d.,])/i;

const negated = /\b(?:payment|refund|transaction)\b[^\n.!?]{0,30}\bnot\b(?:[ \t]+(?:yet|been))?[ \t]+(?:paid|received|successful|completed|processed)\b/gi;
const blocked = /\b(?:not[ \t]+(?:yet[ \t]+)?(?:paid|received|successful|completed|processed)|unpaid|unsettled|partially[ \t]+paid|partial[ \t]+payment|cash[ \t]+on[ \t]+delivery|pay[ \t]+on[ \t]+delivery|(?:payment|transaction|refund)(?:[ \t]+status)?[ \t:=-]*(?:is[ \t]+|was[ \t]+|has[ \t]+been[ \t]+)?(?:not[ \t]+(?:received|successful|completed|processed)|pending|failed|declined|reversed|cancelled|canceled|unsuccessful)|(?:pending|failed|declined|reversed)[ \t]+(?:payment|transaction|refund))\b/gi;

const expenseProof = [
  /\b(?:payment|transaction|txn)(?:[ \t]+status)?[ \t:=-]*(?:(?:has[ \t]+been|was|is)[ \t]+)?(?:successful(?:ly)?|success|succeeded|received|confirmed|paid|completed|complete|captured|settled|done)\b/i,
  /\b(?:invoice|bill|order)(?:[ \t]+status)?[ \t:=-]*(?:(?:has[ \t]+been|was|is)[ \t]+)?(?:paid|settled)\b/i,
  /\bstatus[ \t]*[:=-][ \t]*(?:paid|success(?:ful)?|completed|captured|settled)\b/i,
  /(?<!\b(?:be|to)[ \t]+)\bpaid[ \t]+(?:in[ \t]+full|successfully|on[ \t]+\d|via|by|using|through|with)\b/i,
  /\b(?:fully|successfully)[ \t]+paid\b/i,
  /\bthank(?:s|[ \t]+you)[ \t]+for[ \t]+(?:your[ \t]+|the[ \t]+)?(?:payment|paying)\b/i,
  /\b(?:we|i)[ \t]+(?:have[ \t]+)?received[ \t]+(?:your[ \t]+|the[ \t]+)?payment\b/i,
  /\bpayment[ \t]+(?:of|for)\b[^\n]{0,60}\b(?:has[ \t]+been|was|is)[ \t]+(?:received|successful|completed|confirmed)\b/i,
  /\breceived[ \t]+with[ \t]+thanks\b/i,
  /\breceived[ \t]+(?:a|the)[ \t]+sum[ \t]+of\b/i,
  /\breceived[ \t]+from\b[^\n]{0,80}(?:\b(?:sum|amount|rupees)\b|\b(?:rs\.?|inr)(?=[ \t]*\d)|₹)/i,
  /\byou[ \t]+(?:have[ \t]+)?(?:successfully[ \t]+)?paid\b/i,
  /^[ \t]*\**[ \t]*paid[ \t]*\**[ \t]*$/im,
  /\b(?:UTR|RRN)[ \t]*(?:no\.?|number|#|ref(?:erence)?)?[ \t]*[:=-]?[ \t]*[A-Z0-9]{10,22}\b/i,
];
const refundProof = [
  /\brefund(?:[ \t]+status)?[ \t:=-]*(?:(?:has[ \t]+been|was|is)[ \t]+)?(?:received|processed|completed|successful|credited)\b/i,
  /\brefund\b[^\n.]{0,40}\b(?:has[ \t]+been|was)[ \t]+(?:credited|processed|completed|received)\b/i,
  /\b(?:received|completed)[ \t]+refund\b|\bamount[ \t]+refunded\b|\brefunded[ \t]+(?:to|into)[ \t]+your\b|\brefunded[ \t]+successfully\b/i,
];

function paise(raw: string): number | undefined {
  if (raw.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw) && !/^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/.test(raw)) return;
  const [whole, fraction = ''] = raw.replaceAll(',', '').split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(value) ? value : undefined;
}

function amounts(text: string, label: string, requireCurrency = false): Amount[] {
  const pattern = new RegExp(`\\b(?:${label})${separator}${requireCurrency ? currency : `(?:${currency})?`}${number}`, 'gi');
  return [...text.matchAll(pattern)]
    .flatMap(match => { const value = paise(match[1]); return value === undefined ? [] : [{ value, evidence: match[0].trim().slice(0, 160) }]; });
}

/** Lines, plus sentences inside long PDF lines. Amounts such as "Rs. 10.00" never split. */
function statements(text: string) {
  return text.split(/\r?\n|(?<=[a-z)][.!?])[ \t]+(?=[A-Z])/).map(item => item.trim()).filter(Boolean);
}

function firstVeto(lines: string[]) {
  for (const line of lines) {
    for (const pattern of [negated, blocked]) {
      for (const match of line.matchAll(pattern)) {
        // "Unpaid: 0.00" or "Pending amount ₹0" reports a cleared balance.
        if (!zeroAfter.test(line.slice((match.index ?? 0) + match[0].length))) return match[0];
      }
    }
  }
}

/** Classify one document only: subject lines and other attachments cannot prove its payment. */
export function classifyPayment(text: string, totalAmount: number, kind: 'expense' | 'refund'): PaymentClassification {
  const all = statements(text.normalize('NFKC').replace(/ /g, ' '));
  // Conditional promises ("once payment is received…") neither prove nor block payment.
  const factual = all.filter(line => !conditional.test(line));
  // Policy small print cannot block payment, but a labelled status line always counts.
  const relevant = factual.filter(line => statusLabel.test(line) || !boilerplate.test(line));
  const content = factual.join('\n');

  const paid = [...amounts(content, paidLabels), ...amounts(content, '(?<!\\b(?:be|to|being|been)[ \\t]+)paid', true)];
  const methodText = paid.find(item => /\b(?:cash|card|upi|bank[ \t]+transfer|net[ \t]+banking)\b/i.test(item.evidence))?.evidence ?? content;
  const method: PaymentClassification['method'] = /\bupi\b/i.test(methodText) ? 'upi' : /\b(?:credit|debit)?[ \t]*card\b/i.test(methodText) ? 'card' : /\b(?:petty[ \t]+)?cash\b/i.test(methodText) ? 'cash' : /\b(?:bank[ \t]+transfer|net[ \t]+banking|neft|imps|rtgs)\b/i.test(methodText) ? 'bank_transfer' : undefined;
  const relevantText = relevant.join('\n');
  const balances = amounts(relevantText, balanceLabels);
  const dues = amounts(relevantText, dueLabels);
  const payables = amounts(relevantText, payableLabels);

  const uniquePaid = [...new Set(paid.map(item => item.value))];
  const instructions = paid.some(item => {
    const index = content.indexOf(item.evidence);
    const preceding = content.slice(0, index).split('\n');
    const line = (preceding.at(-1) ?? '') + content.slice(index).split('\n')[0];
    const previousLine = preceding.at(-2) ?? '';
    return /\b(?:instructions|how[ \t]+to[ \t]+pay|please[ \t]+(?:pay|make))\b/i.test(line) || /\bpayment[ \t]+instructions\b/i.test(previousLine);
  });
  const fullAmountPaid = !instructions && uniquePaid.length === 1 && uniquePaid[0] === totalAmount;
  const proof = (kind === 'expense' ? expenseProof : refundProof).map(pattern => factual.map(line => line.match(pattern)?.[0]).find(Boolean)).find(Boolean);
  const clearedBalance = balances.length > 0 && balances.every(item => item.value === 0);

  // "Amount due"/"Payable" equal to the total restates the invoice total once payment is shown.
  const outstanding = [
    ...balances,
    ...dues.filter(item => !(item.value === totalAmount && (fullAmountPaid || clearedBalance))),
    ...payables.filter(item => !(item.value === totalAmount && (fullAmountPaid || clearedBalance || proof))),
  ];
  const uniqueDue = [...new Set(outstanding.map(item => item.value))];
  const details = { method, ...(uniquePaid.length === 1 ? { amountPaid: uniquePaid[0] } : {}), ...(uniqueDue.length === 1 ? { balanceDue: uniqueDue[0] } : {}) };
  const result = (status: PaymentClassification['status'], evidence?: string): PaymentClassification => ({ ...details, status, confirmed: status === 'paid', ...(evidence ? { evidence: evidence.trim().slice(0, 160) } : {}) });

  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) return result('review');
  const veto = firstVeto(relevant);
  if (veto) return result('review', veto);
  const positiveDue = outstanding.find(item => item.value > 0);
  if (uniqueDue.length > 1 || uniquePaid.length > 1) return result('review', (positiveDue ?? paid[0] ?? outstanding[0])?.evidence);
  if (positiveDue) return result(kind === 'expense' ? 'unpaid' : 'review', positiveDue.evidence);
  if (paid.some(item => item.value !== totalAmount)) return result('review', paid[0].evidence);
  if (proof) return result('paid', proof);
  if (kind === 'expense' && fullAmountPaid) return result('paid', paid[0].evidence);
  return result('review');
}
