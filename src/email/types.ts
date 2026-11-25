import type { Expense } from '../expenses';
import type { PaymentClassification } from './payment';

export type EmailEvidence = {
  provider: 'gmail';
  accountKey: string;
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  sourceUrl: string;
  invoiceNumber?: string;
  invoiceKey?: string;
  suggestedStatus: 'paid' | 'unpaid' | 'review';
  confidence: 'high' | 'medium';
  originalAmount: number;
  attachment?: string;
  payment?: PaymentClassification;
  paymentSource?: 'email' | 'attachment';
};

export type EmailExpense = Expense & { email: EmailEvidence };
export type SkippedEmail = { messageId: string; subject: string; reason: string };
export type SyncResult = {
  expenses: EmailExpense[];
  skipped: SkippedEmail[];
  scanned: number;
  hasMore: boolean;
  nextPageToken?: string;
  completedAt: string;
};
export type Connection = {
  connected: boolean;
  email?: string;
  error?: string;
  lastSync?: string;
  status?: string;
  hasMore?: boolean;
  backgroundTracking?: boolean;
  scanSchedule?: string;
  watchConnected?: boolean;
  trackingMode?: 'push' | 'polling';
};

export function isEmailEvidence(value: unknown): value is EmailEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as EmailEvidence;
  return evidence.provider === 'gmail' &&
    ['accountKey', 'messageId', 'threadId', 'subject', 'sender', 'sourceUrl'].every(key => typeof (evidence as unknown as Record<string, unknown>)[key] === 'string') &&
    /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/[A-Za-z0-9%_-]+$/.test(evidence.sourceUrl) &&
    ['high', 'medium'].includes(evidence.confidence) && ['paid', 'unpaid', 'review'].includes(evidence.suggestedStatus) &&
    Number.isSafeInteger(evidence.originalAmount) && evidence.originalAmount > 0 &&
    (evidence.invoiceKey === undefined || typeof evidence.invoiceKey === 'string') &&
    (evidence.invoiceNumber === undefined || typeof evidence.invoiceNumber === 'string') &&
    (evidence.attachment === undefined || typeof evidence.attachment === 'string') &&
    (evidence.paymentSource === undefined || ['email', 'attachment'].includes(evidence.paymentSource)) &&
    (evidence.payment === undefined || isPayment(evidence.payment));
}

function isPayment(value: unknown): value is PaymentClassification {
  if (!value || typeof value !== 'object') return false;
  const payment = value as PaymentClassification;
  return ['paid', 'unpaid', 'review'].includes(payment.status) && typeof payment.confirmed === 'boolean' &&
    (!payment.confirmed || payment.status === 'paid') &&
    (payment.evidence === undefined || typeof payment.evidence === 'string') &&
    (payment.method === undefined || ['cash', 'card', 'upi', 'bank_transfer'].includes(payment.method)) &&
    (payment.amountPaid === undefined || (Number.isSafeInteger(payment.amountPaid) && payment.amountPaid >= 0)) &&
    (payment.balanceDue === undefined || (Number.isSafeInteger(payment.balanceDue) && payment.balanceDue >= 0));
}
